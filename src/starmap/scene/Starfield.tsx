// 背景：三层视差星空（各自闪烁、缓慢漂移）+ 一张程序生成的淡星云。
// 视差：world.tilt（鼠标或陀螺仪）让三层以不同幅度反向偏转，近层动得多、远层动得少。
import { useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useSafeFrame } from './safeFrame';
import * as THREE from 'three';
import { CONFIG, type Tier } from '../config';
import { seededRandom, type World } from '../world';
import { NOISE } from './glsl';

const vert = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
attribute float aSpeed;
uniform float uTime;
uniform float uPixelRatio;
uniform float uTwinkle;
// 背景交互（屏幕空间）：鼠标附近的星星被推开并变亮；点击处荡开一圈波纹
uniform vec2 uMouse;
uniform float uMouseK;
uniform float uAspect;
uniform vec4 uWave; // xy = 点击位置（NDC），z = 已过秒数，w = 强度
uniform float uPush;
uniform float uRadius;
uniform float uWaveSpeed;
uniform float uWaveWidth;
uniform float uGlow;
varying vec3 vColor;
void main() {
  float tw = 1.0 - uTwinkle * 0.5 + uTwinkle * 0.5 * sin(uTime * aSpeed + aPhase);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 ndc = clip.xy / clip.w;
  vec2 asp = vec2(uAspect, 1.0);
  // 鼠标推开
  vec2 dm = (ndc - uMouse) * asp;
  float lm = length(dm);
  float f = uMouseK * exp(-lm * lm / (uRadius * uRadius));
  ndc += (dm / (lm + 1e-4)) / asp * f * uPush;
  // 点击波纹：一圈向外扩散的波前
  vec2 dw = (ndc - uWave.xy) * asp;
  float lw = length(dw);
  float ring = exp(-pow((lw - uWave.z * uWaveSpeed) / uWaveWidth, 2.0)) * exp(-uWave.z * 1.4) * uWave.w;
  ndc += (dw / (lw + 1e-4)) / asp * ring * uPush * 0.9;
  clip.xy = ndc * clip.w;
  gl_Position = clip;
  float lift = 1.0 + (f + ring) * uGlow;
  vColor = aColor * tw * lift;
  gl_PointSize = aSize * uPixelRatio * (0.85 + 0.15 * tw) * (1.0 + (f + ring) * 0.6);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
  #include <colorspace_fragment>
}`;

interface LayerSpec {
  count: number;
  r: [number, number];
  size: [number, number];
  bright: [number, number];
}

/** 所有星空层共享的交互参数（同一个对象引用，改一处全部生效） */
const SHARED = {
  uMouse: { value: new THREE.Vector2(9, 9) },
  uMouseK: { value: 0 },
  uAspect: { value: 1 },
  uWave: { value: new THREE.Vector4(0, 0, 99, 0) },
  uRadius: { value: CONFIG.bgInteract.radius },
  uWaveSpeed: { value: CONFIG.bgInteract.waveSpeed },
  uWaveWidth: { value: CONFIG.bgInteract.waveWidth },
  uGlow: { value: CONFIG.bgInteract.glow },
  uReveal: { value: CONFIG.bgInteract.reveal },
  uRevealRadius: { value: CONFIG.bgInteract.revealRadius },
  uWaveGlow: { value: CONFIG.bgInteract.waveGlow },
};
const SHARED_RES = { value: new THREE.Vector2(1, 1) };

function makeLayer(spec: LayerSpec, seed: number, brightShare: number, push: number) {
  const rnd = seededRandom(seed);
  const n = spec.count;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const phase = new Float32Array(n);
  const speed = new Float32Array(n);
  const tints = ['#cdd6ff', '#ffe2c4', '#ffffff', '#c9b8ff', '#bfe3ff'].map((c) => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1;
    const th = rnd() * Math.PI * 2;
    const r = spec.r[0] + rnd() * (spec.r[1] - spec.r[0]);
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(th);
    const c = tints[Math.floor(rnd() * tints.length)];
    // 少数亮星超过辉光阈值，会"闪光"
    const hot = rnd() < brightShare;
    const b = hot ? 1.2 + rnd() * 1.1 : spec.bright[0] + rnd() * (spec.bright[1] - spec.bright[0]);
    col[i * 3] = c.r * b;
    col[i * 3 + 1] = c.g * b;
    col[i * 3 + 2] = c.b * b;
    size[i] = (spec.size[0] + rnd() * (spec.size[1] - spec.size[0])) * (hot ? 1.4 : 1);
    phase[i] = rnd() * Math.PI * 2;
    speed[i] = 0.6 + rnd() * 2.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uTwinkle: { value: 1 }, uPush: { value: push }, ...SHARED },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---- 星云：开场时用着色器在 GPU 上烘焙一次成等距柱状贴图（几毫秒，比 CPU 快两个数量级）----
// 在球面方向上采样 3D 噪声，所以没有接缝；域扭曲让云呈丝缕状，暗尘带切出明暗结构，银河带让分布有方向感。
const bakeVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const bakeFrag = /* glsl */ `
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uBandN;
uniform float uStrength; uniform float uSeed; uniform float uScale; uniform float uWarp; uniform float uDust; uniform float uBandWidth;
varying vec2 vUv;
${NOISE}
void main() {
  float lon = vUv.x * 6.2831853;
  float lat = (vUv.y - 0.5) * 3.1415927;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 q = vec3(fbm3(d * 1.4 + uSeed), fbm3(d * 1.4 + uSeed + 5.2), fbm3(d * 1.4 + uSeed + 9.7));
  float n = fbm3(d * uScale + (q - 0.5) * uWarp);
  float band = exp(-pow(dot(d, uBandN) / uBandWidth, 2.0));
  // 柔和的阈值（宽过渡 + 平方），避免出现硬边色块；大部分区域保持接近纯黑
  float dens = pow(smoothstep(0.38, 1.0, n), 2.2) * (0.15 + band);
  float dust = smoothstep(0.45, 0.85, fbm3(d * 3.2 + q * 1.6 + 3.1));
  dens *= 1.0 - dust * uDust;
  float m = fbm3(d * 1.1 + 17.0);
  vec3 c = mix(uC1, uC2, smoothstep(0.35, 0.65, m));
  c = mix(c, uC3, smoothstep(0.55, 0.8, q.x) * 0.55);
  float haze = band * (0.55 + 0.45 * fbm3(d * 14.0)) * (1.0 - dust * 0.7);
  vec3 col = c * dens * uStrength + vec3(0.55, 0.62, 1.0) * haze * uStrength * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`;

// 星云球壳：采样烘焙好的贴图；鼠标附近像手电筒一样把星云"照亮"，点击的波纹扫过时亮一圈
const shellVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const shellFrag = /* glsl */ `
uniform sampler2D map; uniform float uStrength; uniform float opacity; uniform vec2 uRes;
uniform vec2 uMouse; uniform float uMouseK; uniform float uAspect; uniform vec4 uWave; uniform float uWaveSpeed; uniform float uWaveWidth;
uniform float uReveal; uniform float uRevealRadius; uniform float uWaveGlow;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec2 asp = vec2(uAspect, 1.0);
  float dm = length((ndc - uMouse) * asp);
  float reveal = uMouseK * exp(-dm * dm / (uRevealRadius * uRevealRadius)) * uReveal;
  float dw = length((ndc - uWave.xy) * asp);
  float ring = exp(-pow((dw - uWave.z * uWaveSpeed) / (uWaveWidth * 2.5), 2.0)) * exp(-uWave.z * 1.2) * uWave.w * uWaveGlow;
  c *= uStrength * (1.0 + reveal + ring);
  c += vec3(0.04, 0.05, 0.09) * (reveal * 0.5 + ring) * uStrength * 4.0; // 没有云的地方也透出一点微光
  gl_FragColor = vec4(c * opacity, 1.0);
  #include <colorspace_fragment>
}`;

function makeNebula(tier: Tier) {
  const N = CONFIG.nebula;
  const [w, h] = N.texSize[tier];
  const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
  rt.texture.wrapS = THREE.RepeatWrapping;
  rt.texture.minFilter = THREE.LinearFilter;
  const bake = new THREE.ShaderMaterial({
    vertexShader: bakeVert,
    fragmentShader: bakeFrag,
    uniforms: {
      uC1: { value: new THREE.Color(N.colors[0]) },
      uC2: { value: new THREE.Color(N.colors[1]) },
      uC3: { value: new THREE.Color(N.colors[2]) },
      uBandN: { value: new THREE.Vector3(0.35, 1, 0.2).normalize() },
      uStrength: { value: 1 }, // 按满亮度烘焙，充分利用 8 位精度；实际浓度由球壳材质的颜色控制
      uSeed: { value: (CONFIG.sim.seed % 97) * 0.37 },
      uScale: { value: N.scale },
      uWarp: { value: N.warp },
      uDust: { value: N.dust },
      uBandWidth: { value: N.bandWidth },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bake));
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 两层球壳：远层完整、近层更淡，倾斜时偏移量不同 → 有体积感
  const shell = (r: number, strength: number) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(r, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: shellVert,
        fragmentShader: shellFrag,
        uniforms: { map: { value: null }, uStrength: { value: strength }, opacity: { value: 0 }, uRes: SHARED_RES, ...SHARED },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        userData: { target: 1 },
      }),
    );
  const far = shell(980, N.strength);
  const near = shell(720, N.strength * N.nearLayer);
  near.visible = tier === 'high'; // 近层星云只是很淡的体积感：只在高档位画，省一次全屏计算
  near.rotation.set(0.6, 2.1, 0.3);
  [far, near].forEach((m) => {
    m.frustumCulled = false;
    m.renderOrder = -9;
  });
  let baked = false;
  return {
    far,
    near,
    /** 第一次调用时烘焙；之后每帧淡入 */
    step(gl: THREE.WebGLRenderer, dt: number) {
      if (!baked) {
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(rt);
        gl.render(quadScene, quadCam);
        gl.setRenderTarget(prev);
        baked = true;
        for (const m of [far, near]) (m.material as THREE.ShaderMaterial).uniforms.map.value = rt.texture;
        bake.dispose();
      }
      for (const m of [far, near]) {
        const u = (m.material as THREE.ShaderMaterial).uniforms;
        if (u.opacity.value < 1) u.opacity.value = Math.min(1, u.opacity.value + dt / 1.5);
      }
    },
  };
}

// ---- 亮星的十字星芒 ----
function spikeTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.08, 'rgba(255,255,255,0.55)');
  rg.addColorStop(0.3, 'rgba(255,255,255,0.06)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, S, S);
  for (const [x0, y0, x1, y1] of [[0, S / 2, S, S / 2], [S / 2, 0, S / 2, S]]) {
    const lg = g.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    if (y0 === y1) g.fillRect(0, S / 2 - 0.75, S, 1.5);
    else g.fillRect(S / 2 - 0.75, 0, 1.5, S);
  }
  return new THREE.CanvasTexture(cv);
}

export function Starfield({ world: w, tier, reduce }: { world: World; tier: Tier; reduce: boolean }) {
  const gl = useThree((s) => s.gl);
  const S = CONFIG.stars;
  const layers = useMemo(
    () =>
      S.layers.map((spec, k) =>
        makeLayer({ ...spec, count: Math.round(spec.count * S.tierScale[tier]) } as LayerSpec, CONFIG.sim.seed + 100 + k, S.brightShare, CONFIG.bgInteract.push[k]),
      ),
    [tier, S],
  );
  const neb = useMemo(() => makeNebula(tier), [tier]);
  // 前景尘埃：在星系周围漂浮的微粒，旋转视角时和远处星空产生真实视差
  const dust = useMemo(() => {
    const D = S.dust;
    return makeLayer({ count: Math.round(D.count * S.tierScale[tier]), r: D.r, size: D.size, bright: D.bright } as LayerSpec, CONFIG.sim.seed + 300, 0, CONFIG.bgInteract.dustPush);
  }, [tier, S]);
  // 亮星星芒
  const spikes = useMemo(() => {
    const g = new THREE.Group();
    const tex = spikeTexture();
    const rnd = seededRandom(CONFIG.sim.seed + 400);
    const tints = ['#dfe6ff', '#fff0dc', '#e6dcff'];
    const list: { sp: THREE.Sprite; ph: number; sp0: number; base: number }[] = [];
    for (let k = 0; k < S.spikes.count; k++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 420 + rnd() * 380, q = Math.sqrt(1 - u * u);
      const base = S.spikes.glow * (0.6 + rnd() * 0.6);
      const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(tints[k % 3]).multiplyScalar(base), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const sp = new THREE.Sprite(mat);
      sp.position.set(r * q * Math.cos(th), r * u, r * q * Math.sin(th));
      sp.scale.setScalar(S.spikes.size * (0.6 + rnd() * 0.8) * (r / 600));
      g.add(sp);
      list.push({ sp, ph: rnd() * 6.28, sp0: 0.6 + rnd() * 1.4, base });
    }
    return { g, list };
  }, [S]);
  const groups = useRef<THREE.Group[]>([]);

  useSafeFrame(({ clock, size }, dt) => {
    const t = clock.elapsedTime;
    const dpr = gl.getPixelRatio();
    // 背景交互参数：鼠标位置缓动跟随；停止移动 1.5 秒后效果淡出
    const BI = CONFIG.bgInteract;
    const now = w.ms();
    SHARED.uAspect.value = size.width / size.height;
    SHARED_RES.value.set(size.width * dpr, size.height * dpr);
    SHARED.uMouse.value.lerp(w.mouse, Math.min(1, dt * 8));
    const k = reduce ? 0 : now - w.mouse.t < 1500 ? 1 : 0;
    SHARED.uMouseK.value += (k - SHARED.uMouseK.value) * Math.min(1, dt * 3);
    SHARED.uWave.value.set(w.wave.x, w.wave.y, (now - w.wave.t) / 1000, reduce ? 0 : BI.waveAmp);
    neb.step(gl, dt);
    for (const pts of [...layers, dust]) {
      const m = pts.material as THREE.ShaderMaterial;
      m.uniforms.uTime.value = reduce ? 0 : t;
      m.uniforms.uPixelRatio.value = dpr;
      m.uniforms.uTwinkle.value = reduce ? 0 : S.twinkle;
    }
    layers.forEach((_, k) => {
      const g = groups.current[k];
      if (!g) return;
      // 缓慢漂移 + 视差：近层随倾斜反向偏得多
      const f = S.parallax[k];
      g.rotation.y = (reduce ? 0 : t * S.drift[k]) - w.tilt.x * f;
      g.rotation.x = w.tilt.y * f;
    });
    spikes.g.rotation.copy(groups.current[1]?.rotation ?? spikes.g.rotation);
    for (const s of spikes.list) {
      const tw = reduce ? 1 : 0.7 + 0.3 * Math.sin(t * s.sp0 + s.ph);
      (s.sp.material as THREE.SpriteMaterial).opacity = tw;
    }
    dust.rotation.y = reduce ? 0 : t * S.dust.drift;
    const p0 = S.parallax[0];
    neb.far.rotation.set(w.tilt.y * p0 * 0.5, (reduce ? 0 : t * S.drift[0] * 0.5) - w.tilt.x * p0 * 0.5, 0);
    neb.near.rotation.set(0.6 + w.tilt.y * p0, 2.1 + (reduce ? 0 : t * S.drift[0]) - w.tilt.x * p0, 0.3);
  });

  return (
    <>
      <primitive object={neb.far} />
      <primitive object={neb.near} />
      {layers.map((pts, k) => (
        <group key={k} ref={(g) => void (g && (groups.current[k] = g))}>
          <primitive object={pts} />
        </group>
      ))}
      <primitive object={spikes.g} />
      <primitive object={dust} />
    </>
  );
}
