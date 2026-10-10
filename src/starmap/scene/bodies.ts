// 五类节点的"天体"造型（全部是自定义着色器）。光源统一是位于原点的中心恒星，
// 所以每个天体都有向光面 / 背光面。几何内核（立方体、八面体等）作为外圈的全息线框笼保留。
import * as THREE from 'three';
import { CATS } from '../../lib/meta';
import type { GraphNode } from '../../lib/graph';
import { CONFIG, type Tier } from '../config';
import { seededRandom } from '../world';
import { NOISE, OUTPUT } from './glsl';
import { textures } from './textures';

const ADD = THREE.AdditiveBlending;
const col = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ---------------------------------------------------------------------------
// 着色器
// ---------------------------------------------------------------------------
const bodyVert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vObj;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// 行星表面：噪声地貌 / 条纹 + 恒星光照 + 夜面灯光 + 边缘大气
const planetFrag = /* glsl */ `
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uAtmo; uniform vec3 uLightCol;
uniform float uScale; uniform float uSeed; uniform float uBands; uniform float uLights; uniform float uFalloff; uniform float uFill;
uniform float uTime; uniform float uDim;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(-vWorld); // 恒星在原点
  vec3 p = normalize(vObj);
  // 只用两层低频噪声：表面是柔和的大色块（细碎的高频在小尺寸下会变成噪点）
  float n = 0.5 + 0.38 * snoise(p * uScale + uSeed) + 0.12 * snoise(p * uScale * 2.3 + uSeed * 1.7);
  if (uBands > 0.0) n = mix(n, 0.5 + 0.5 * sin(p.y * uBands + n * 5.0), 0.55);
  vec3 albedo = mix(uColA, uColB, smoothstep(0.25, 0.85, n)); // 宽过渡：表面是柔和的大色块，不是细碎噪点
  // 光照随离恒星的距离衰减：近处亮、远处暗，画面自然形成由中心向外的层次
  float atten = 1.25 / (1.0 + pow(length(vWorld) / uFalloff, 2.0));
  float wrap = smoothstep(-0.2, 1.0, dot(N, L)) * atten;
  // 补光：从观察方向打一点柔光（像摄影补光），背光的星球也不会是一片死黑
  float fill = pow(max(dot(N, V), 0.0), 1.5) * uFill;
  vec3 c = albedo * (0.1 + 1.3 * wrap + fill);
  if (uLights > 0.0) {
    float s = snoise(p * 22.0 + uSeed);
    float blink = 0.75 + 0.25 * sin(uTime * 2.0 + s * 40.0);
    c += uAtmo * smoothstep(0.74, 0.88, s) * (1.0 - smoothstep(0.0, 0.35, wrap)) * uLights * blink;
  }
  float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  c += uAtmo * fr * (0.35 + 0.9 * wrap);
  gl_FragColor = vec4(c * uDim, 1.0);
  ${OUTPUT}
}`;

// 大气外壳：背面渲染，边缘发光，向光侧更亮
const atmoVert = /* glsl */ `
varying vec3 vNv; varying vec3 vWorld; varying vec3 vNw;
void main() {
  vNv = normalize(normalMatrix * normal);
  vNw = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const atmoFrag = /* glsl */ `
uniform vec3 uAtmo; uniform float uDim; uniform float uGlow;
varying vec3 vNv; varying vec3 vWorld; varying vec3 vNw;
void main() {
  // 背面渲染时法线背对镜头：越靠近行星边缘 dot 越负 → 越亮，往外渐隐
  float i = pow(clamp(0.62 - dot(vNv, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.0); // 上限 1，否则行星边缘会被辉光放大成白斑
  float lit = 0.2 + 0.8 * smoothstep(-0.5, 1.0, dot(vNw, normalize(-vWorld)));
  float a = i * lit * uGlow * uDim;
  gl_FragColor = vec4(uAtmo * a, a);
  ${OUTPUT}
}`;

// 恒星表面：两层流动的等离子噪声 + 临边昏暗
const starFrag = /* glsl */ `
uniform vec3 uDeep; uniform vec3 uHot; uniform vec3 uWhite; uniform float uTime; uniform float uInt; uniform float uDim;
varying vec3 vWorld; varying vec3 vN; varying vec3 vObj;
${NOISE}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 p = normalize(vObj);
  float g1 = fbm3(p * 2.2 + vec3(0.0, uTime * 0.07, uTime * 0.03));
  float g2 = fbm3(p * 6.0 - vec3(uTime * 0.11));
  float gran = g1 * 0.6 + g2 * 0.4;
  float mu = max(dot(N, V), 0.0);
  vec3 c = mix(uDeep, uHot, smoothstep(0.3, 0.75, gran));
  c = mix(c, uWhite, pow(mu, 2.5) * 0.55);
  c *= (0.45 + 0.85 * pow(mu, 0.5)) * uInt;
  gl_FragColor = vec4(c * uDim, 1.0);
  ${OUTPUT}
}`;

// 日冕：面向镜头的方片，柔光 + 缓慢变化的放射状光丝 + 若隐若现的星芒
const coronaVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const coronaFrag = /* glsl */ `
uniform vec3 uCol; uniform float uTime; uniform float uInt; uniform float uDim; uniform float uSpikes;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float ang = atan(q.y, q.x);
  float rays = snoise(vec3(cos(ang) * 2.5, sin(ang) * 2.5, uTime * 0.12)) * 0.5 + 0.5;
  rays = pow(rays, 2.5) * exp(-max(r - 0.2, 0.0) * 5.0);
  float inner = exp(-max(r - 0.2, 0.0) * 11.0);
  float halo = exp(-r * 4.0) * 0.35;
  float sp = pow(abs(cos((ang + uTime * 0.02) * 2.0)), 120.0) * exp(-r * 2.6) * uSpikes;
  float a = (inner * 0.8 + halo + rays * 0.7 + sp) * smoothstep(1.0, 0.75, r) * smoothstep(0.12, 0.21, r);
  a *= uInt * uDim;
  gl_FragColor = vec4(uCol * a, a);
  ${OUTPUT}
}`;

// 行星环：按半径的条纹
const ringFrag = /* glsl */ `
uniform vec3 uCol; uniform float uDim; uniform float uIn; uniform float uOut;
varying vec3 vObj;
${NOISE}
void main() {
  float r = length(vObj.xy);
  float t = (r - uIn) / (uOut - uIn);
  float bands = 0.45 + 0.55 * (snoise(vec3(r * 9.0, 0.0, 1.7)) * 0.5 + 0.5);
  float a = bands * smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.7, t) * 0.55 * uDim;
  gl_FragColor = vec4(uCol * a, a);
  ${OUTPUT}
}`;
const ringVert = /* glsl */ `
varying vec3 vObj;
void main() { vObj = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// AI 迷你星系：位置在着色器里按较差自转计算（内圈快、外圈慢）
const galVert = /* glsl */ `
attribute float aR; attribute float aAng; attribute float aH; attribute float aSize; attribute float aB;
uniform float uTime; uniform float uScale; uniform float uPixelRatio; uniform vec3 uIn; uniform vec3 uOut;
varying vec3 vCol;
void main() {
  float ang = aAng + uTime * (0.35 / (0.18 + aR));
  vec3 p = vec3(cos(ang) * aR, aH, sin(ang) * aR) * uScale;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uPixelRatio * 80.0 / -mv.z, 0.6 * uPixelRatio, 4.0 * uPixelRatio);
  vCol = mix(uIn, uOut, smoothstep(0.05, 0.7, aR)) * aB;
}`;
const vortexFrag = /* glsl */ `
uniform float uDim;
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a * uDim;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a, a);
  ${OUTPUT}
}`;

// ---------------------------------------------------------------------------
// 天体对象
// ---------------------------------------------------------------------------
export interface Body {
  group: THREE.Group;
  /** 每帧更新：t 秒，dim 亮度系数，hot 悬停/选中程度 0..1 */
  update(t: number, dim: number, hot: number, dpr: number, cam: THREE.Camera): void;
}

function shader(vert: string, frag: string, uniforms: Record<string, THREE.IUniform>, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
  return new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms, ...opts });
}

/** 每个节点外圈一层很淡的同色光晕：全景下也能一眼看到，悬停时变亮（亮度低于辉光阈值，不刺眼） */
function haloSprite(color: string, scale: number) {
  const mat = new THREE.SpriteMaterial({ map: textures().glow, color: col(color, 1), transparent: true, opacity: 0.16, depthWrite: false, blending: ADD });
  const sp = new THREE.Sprite(mat);
  sp.scale.setScalar(scale);
  return { sp, mat };
}

export function makeBody(node: GraphNode, index: number, degree: number, tier: Tier): Body {
  const B = CONFIG.bodies;
  const rnd = seededRandom(index * 7919 + 13);
  const seed = rnd() * 100;
  const group = new THREE.Group();
  const size = 0.85 + 0.08 * Math.min(degree, 5); // 连接越多越大
  const c = CATS[node.cat].color;
  const tilt = (rnd() - 0.5) * 0.8;
  const H = B.halo;

  if (node.cat === 'core') {
    const surf = shader(bodyVert, starFrag, {
      uDeep: { value: col(B.star.deep) },
      uHot: { value: col(B.star.hot) },
      uWhite: { value: col(B.star.white) },
      uTime: { value: 0 },
      uInt: { value: B.star.intensity },
      uDim: { value: 1 },
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(2.1, 64, 48), surf);
    const corona = shader(
      coronaVert,
      coronaFrag,
      { uCol: { value: col(B.star.corona) }, uTime: { value: 0 }, uInt: { value: B.star.coronaIntensity }, uDim: { value: 1 }, uSpikes: { value: B.star.spikes } },
      { transparent: true, depthWrite: false, blending: ADD },
    );
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona);
    plane.scale.setScalar(2.1 / 0.2); // 方片里 r=0.2 对应恒星半径
    const ringMat = (k: number, hex: string) =>
      new THREE.MeshBasicMaterial({ color: col(hex, B.star.ringGlow), transparent: true, opacity: k, depthWrite: false, blending: ADD });
    const r1m = ringMat(0.35, B.star.hot);
    const r2m = ringMat(0.22, CATS.ai.color);
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.022, 6, 160), r1m);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(6.0, 0.016, 6, 180), r2m);
    r1.rotation.x = 1.15;
    r2.rotation.set(1.9, 0.5, 0);
    group.add(sphere, plane, r1, r2);
    return {
      group,
      update(t, dim, _hot, _dpr, cam) {
        surf.uniforms.uTime.value = t;
        surf.uniforms.uDim.value = dim;
        corona.uniforms.uTime.value = t;
        corona.uniforms.uDim.value = dim;
        plane.quaternion.copy(cam.quaternion); // 日冕方片永远面向镜头（节点组本身不旋转）
        r1.rotation.z = t * 0.25;
        r2.rotation.z = -t * 0.17;
        r1m.opacity = 0.35 * dim;
        r2m.opacity = 0.22 * dim;
      },
    };
  }

  if (node.cat === 'ai') {
    // 迷你旋涡星系：对数螺线双旋臂 + 旋臂内侧暗尘带 + 明亮核球；粒子很细，靠数量叠出质感
    const G = B.galaxy;
    const n = G.particles[tier];
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
    const aR = new Float32Array(n), aAng = new Float32Array(n), aH = new Float32Array(n), aSize = new Float32Array(n), aB = new Float32Array(n);
    let k = 0;
    while (k < n) {
      const roll = rnd();
      const bulge = roll < 0.24;
      const diffuse = !bulge && roll < 0.5; // 弥散盘面：让星系有体积，而不是两条线
      let r: number, ang: number, h: number, b: number;
      if (bulge) {
        r = Math.abs(gauss()) * 0.2;
        ang = rnd() * Math.PI * 2;
        h = gauss() * 0.1 * (1 - r * 2);
        b = 1.2 + rnd() * 0.8;
      } else if (diffuse) {
        r = Math.sqrt(rnd()) * 0.95;
        ang = rnd() * Math.PI * 2;
        h = gauss() * 0.03;
        b = 0.25 + rnd() * 0.3;
      } else {
        r = 0.08 + -Math.log(1 - rnd() * 0.97) * 0.24;
        if (r > 1) continue;
        const arm = Math.floor(rnd() * 2);
        const off = gauss() * 0.45 * (0.55 + r);
        if (off < -0.04 && off > -0.24 && rnd() < 0.7) continue; // 暗尘带
        ang = Math.log(r / 0.08) / G.pitch + arm * Math.PI + off;
        h = gauss() * 0.025 * (1 + r);
        const inArm = Math.exp(-(off * off) / 0.06);
        b = (0.3 + 0.9 * inArm) * (1.2 - r * 0.7);
      }
      aR[k] = r;
      aAng[k] = ang;
      aH[k] = h;
      aSize[k] = 0.5 + rnd() * 0.8;
      aB[k] = b;
      k++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); // 实际位置在着色器里算
    geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    geo.setAttribute('aAng', new THREE.BufferAttribute(aAng, 1));
    geo.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aB', new THREE.BufferAttribute(aB, 1));
    const mat = shader(
      galVert,
      vortexFrag,
      {
        uTime: { value: 0 },
        uScale: { value: G.radius * size },
        uPixelRatio: { value: 1 },
        uIn: { value: col(G.inner, G.glow) },
        uOut: { value: col(G.outer, G.glow) },
        uDim: { value: 1 },
      },
      { transparent: true, depthWrite: false, blending: ADD },
    );
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    const disk = new THREE.Group();
    disk.rotation.set(0.55 + tilt, rnd() * 3, tilt * 0.5);
    disk.add(pts);
    const halo = haloSprite(c, G.radius * size * 3.2);
    group.add(halo.sp, disk);
    return {
      group,
      update(t, dim, hot, dpr) {
        mat.uniforms.uTime.value = t;
        mat.uniforms.uDim.value = dim * (1 + hot * 0.35);
        mat.uniforms.uPixelRatio.value = dpr;
        halo.mat.opacity = (H.base + H.hot * hot) * dim;
      },
    };
  }

  if (node.cat === 'proj') {
    // 小恒星（粉白）+ 柔和日冕 + 一颗绕行的小卫星
    const S = B.projStar;
    const R = S.radius * size;
    const surf = shader(bodyVert, starFrag, {
      uDeep: { value: col(S.deep) },
      uHot: { value: col(S.hot) },
      uWhite: { value: col(S.white) },
      uTime: { value: 0 },
      uInt: { value: S.intensity },
      uDim: { value: 1 },
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), surf);
    const corona = shader(
      coronaVert,
      coronaFrag,
      { uCol: { value: col(S.corona) }, uTime: { value: seed }, uInt: { value: S.coronaIntensity }, uDim: { value: 1 }, uSpikes: { value: 0 } },
      { transparent: true, depthWrite: false, blending: ADD },
    );
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), corona);
    plane.scale.setScalar(R / (tier === 'high' ? 0.2 : 0.3)); // 中低档位日冕收小，省大面积逐像素噪声；高档位保持完整
    const moonMat = shader(bodyVert, planetFrag, {
      uColA: { value: col('#2b2a36') },
      uColB: { value: col('#b9b4c8') },
      uAtmo: { value: col(c, 0.4) },
      uLightCol: { value: col('#ffffff') },
      uScale: { value: 4 },
      uSeed: { value: seed + 3 },
      uBands: { value: 0 },
      uLights: { value: 0 },
      uFalloff: { value: B.lightFalloff },
      uFill: { value: B.fillLight },
      uTime: { value: 0 },
      uDim: { value: 1 },
    });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(R * 0.28, 24, 16), moonMat);
    const orbit = new THREE.Group();
    orbit.rotation.set(1.2 + tilt, 0, tilt);
    orbit.add(moon);
    const orbitLine = new THREE.Mesh(
      new THREE.TorusGeometry(R * 2.4, 0.012, 4, 120),
      new THREE.MeshBasicMaterial({ color: col(c, 1), transparent: true, opacity: 0.2, depthWrite: false, blending: ADD }),
    );
    orbit.add(orbitLine);
    const halo = haloSprite(c, R * 9);
    group.add(halo.sp, sphere, plane, orbit);
    return {
      group,
      update(t, dim, hot, _dpr, cam) {
        surf.uniforms.uTime.value = t + seed;
        surf.uniforms.uDim.value = dim;
        corona.uniforms.uTime.value = t + seed;
        corona.uniforms.uDim.value = dim * (1 + hot * 0.5);
        plane.quaternion.copy(cam.quaternion);
        const a = t * 0.6 + seed;
        moon.position.set(Math.cos(a) * R * 2.4, Math.sin(a) * R * 2.4, 0);
        moonMat.uniforms.uDim.value = dim;
        (orbitLine.material as THREE.MeshBasicMaterial).opacity = (0.12 + 0.25 * hot) * dim;
        halo.mat.opacity = (H.base + H.hot * hot) * dim;
      },
    };
  }

  // net / base：行星
  const isNet = node.cat === 'net';
  const P = isNet ? B.net : B.base;
  const R = P.radius * size;
  const surf = shader(bodyVert, planetFrag, {
    uColA: { value: col(P.dark) },
    uColB: { value: col(P.light) },
    uAtmo: { value: col(c, P.atmoGlow) },
    uLightCol: { value: col('#ffffff') },
    uScale: { value: P.noiseScale },
    uSeed: { value: seed },
    uBands: { value: isNet ? P.bands : 0 },
    uLights: { value: isNet ? B.net.cityLights : 0 },
    uFalloff: { value: B.lightFalloff },
    uFill: { value: B.fillLight },
    uTime: { value: 0 },
    uDim: { value: 1 },
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), surf);
  planet.rotation.z = tilt;
  const atmo = shader(
    atmoVert,
    atmoFrag,
    { uAtmo: { value: col(c) }, uDim: { value: 1 }, uGlow: { value: P.atmoShell } },
    { transparent: true, depthWrite: false, blending: ADD, side: THREE.BackSide },
  );
  const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.22, 40, 24), atmo);
  const halo = haloSprite(c, R * 7);
  group.add(halo.sp, planet, shell);
  let ringMat: THREE.ShaderMaterial | null = null;
  if (isNet) {
    // 细而通透的行星环
    const rin = R * 1.55, rout = R * 2.05;
    ringMat = shader(
      ringVert,
      ringFrag,
      { uCol: { value: col(c, 0.9) }, uDim: { value: 1 }, uIn: { value: rin }, uOut: { value: rout } },
      { transparent: true, depthWrite: false, blending: ADD, side: THREE.DoubleSide },
    );
    const ring = new THREE.Mesh(new THREE.RingGeometry(rin, rout, 160, 1), ringMat);
    ring.rotation.set(Math.PI / 2 + 0.35 + tilt, 0, tilt);
    group.add(ring);
  }
  return {
    group,
    update(t, dim, hot) {
      surf.uniforms.uTime.value = t;
      surf.uniforms.uDim.value = dim;
      atmo.uniforms.uDim.value = dim * (1 + hot * 0.8);
      if (ringMat) ringMat.uniforms.uDim.value = dim;
      planet.rotation.y = t * 0.12 + seed;
      halo.mat.opacity = (H.base + H.hot * hot) * dim;
    },
  };
}
