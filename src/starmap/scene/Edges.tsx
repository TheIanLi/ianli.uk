// 连线：有粗细的发光线（LineSegments2），每条细分成若干小段逐段上色，
// 于是能做颜色渐变、开场画线的笔尖、以及悬停时沿线传播的能量脉冲。
// 两层：底层画所有连线；上层只画与选中节点相连的线，更粗、带脉冲。
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useSafeFrame } from './safeFrame';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { CATS } from '../../lib/meta';
import { CONFIG } from '../config';
import { useUI } from '../store';
import type { World } from '../world';
import { textures } from './textures';

interface Layer {
  obj: LineSegments2;
  mat: LineMaterial;
  pos: Float32Array; // 每段 6 个数：起点 xyz、终点 xyz
  col: Float32Array; // 每段 6 个数：起点 rgb、终点 rgb
  posAttr: THREE.InterleavedBuffer;
  colAttr: THREE.InterleavedBuffer;
}

function makeLayer(segs: number): Layer {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(segs * 6));
  geo.setColors(new Float32Array(segs * 6));
  const mat = new LineMaterial({
    linewidth: 1,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    worldUnits: false,
  });
  // 去掉圆头改成平头：同一条线细分出的小段是共线的，平头正好无缝相接；
  // 圆头会在接缝处重叠，叠加混合下亮度翻倍，看起来像一串珠子。
  const CAP = 'if ( len2 > 1.0 ) discard;';
  if (!mat.fragmentShader.includes(CAP)) console.warn('[星图] LineMaterial 着色器结构变了，平头补丁未生效');
  mat.fragmentShader = mat.fragmentShader.replace(CAP, 'discard;');
  const obj = new LineSegments2(geo, mat);
  obj.frustumCulled = false;
  const posAttr = (geo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data;
  const colAttr = (geo.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data;
  return { obj, mat, pos: posAttr.array as Float32Array, col: colAttr.array as Float32Array, posAttr, colAttr };
}

export function Edges({ world: w, reduce }: { world: World; reduce: boolean }) {
  const gl = useThree((s) => s.gl);
  const K = CONFIG.edges.segments;
  const fx = useMemo(() => {
    const E = w.edges.length;
    const base = makeLayer(E * K);
    const top = makeLayer(E * K);
    const { dot } = textures();
    // 脉冲波峰上的光点 + 开场画线的笔尖
    const sparkCap = E * (CONFIG.edges.pulses + 1);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCap * 3), 3));
    sGeo.setDrawRange(0, 0);
    const sparks = new THREE.Points(
      sGeo,
      new THREE.PointsMaterial({
        size: CONFIG.edges.flowSize,
        map: dot,
        color: new THREE.Color('#fff3df').multiplyScalar(CONFIG.glow.flow),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    sparks.frustumCulled = false;
    const ncol = w.nodes.map((n) => new THREE.Color(CATS[n.cat].color));
    return { base, top, sparks, ncol };
  }, [w, K]);

  const tmp = useMemo(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  useSafeFrame(({ clock }) => {
    const EC = CONFIG.edges;
    const GL = CONFIG.glow;
    const ui = useUI.getState();
    const active = w.hover >= 0 ? w.hover : ui.selected;
    const tt = clock.elapsedTime;
    const dpr = gl.getPixelRatio();
    fx.base.mat.linewidth = EC.width * dpr;
    fx.top.mat.linewidth = EC.activeWidth * dpr;

    const { base, top, ncol } = fx;
    const BP = base.pos;
    const BC = base.col;
    const TP = top.pos;
    const TC = top.col;
    const SP = fx.sparks.geometry.attributes.position.array as Float32Array;
    const { a, b } = tmp;
    let topSegs = 0;
    let sc = 0;
    const activeBase = EC.active * GL.lineBase;
    const activeTop = EC.active * GL.lineActive * 0.55;

    // 逐段写入缓冲区（直接按下标写，每帧不分配新对象，避免手机上的垃圾回收卡顿）
    const writeSeg = (P: Float32Array, C: Float32Array, o: number, cA: THREE.Color, cB: THREE.Color, u0: number, u1: number, i0: number, i1: number) => {
      P[o] = a.x; P[o + 1] = a.y; P[o + 2] = a.z;
      P[o + 3] = b.x; P[o + 4] = b.y; P[o + 5] = b.z;
      C[o] = (cA.r + (cB.r - cA.r) * u0) * i0;
      C[o + 1] = (cA.g + (cB.g - cA.g) * u0) * i0;
      C[o + 2] = (cA.b + (cB.b - cA.b) * u0) * i0;
      C[o + 3] = (cA.r + (cB.r - cA.r) * u1) * i1;
      C[o + 4] = (cA.g + (cB.g - cA.g) * u1) * i1;
      C[o + 5] = (cA.b + (cB.b - cA.b) * u1) * i1;
    };

    for (let k = 0; k < w.edges.length; k++) {
      const e = w.edges[k];
      const dr = w.edgeDraw[k];
      const A = w.R[e.from];
      const B = w.R[e.to];
      const cA = ncol[e.from];
      const cB = ncol[e.to];
      const touches = active >= 0 && (e.s === active || e.t === active);
      let it = EC.base * GL.lineBase * Math.min(w.dim[e.s], w.dim[e.t]);
      if (!touches && active < 0 && ui.focusCat && w.nodes[e.s].cat === ui.focusCat && w.nodes[e.t].cat === ui.focusCat)
        it = EC.catFocus * GL.lineActive;
      if (touches) it = activeBase;
      const reverse = touches && e.to === active; // 脉冲总是从选中节点往外走
      const drawing = dr > 0 && dr < 1;
      // 两端在节点附近淡出：线不会扎进星球里，核心附近也不会因为线多而糊成一片
      const len = A.distanceTo(B) || 1;
      const fA = Math.min(0.45, (EC.endFade * (w.isCore(e.from) ? 1.8 : 1)) / len);
      const fB = Math.min(0.45, (EC.endFade * (w.isCore(e.to) ? 1.8 : 1)) / len);
      const fade = (u: number) => smooth(0, fA, u) * smooth(1, 1 - fB, u);

      for (let j = 0; j < K; j++) {
        const u0 = j / K;
        const u1 = (j + 1) / K;
        a.lerpVectors(A, B, u0);
        b.lerpVectors(A, B, u1);
        // 还没画到的段颜色为 0（叠加混合下不可见）；画线中离笔尖越近越亮
        let i0 = u0 < dr ? it : 0;
        let i1 = u1 <= dr ? it : 0;
        if (drawing) {
          i0 *= 1 + EC.drawTipGlow * Math.exp(-((dr - u0) ** 2) / 0.004);
          i1 *= 1 + EC.drawTipGlow * Math.exp(-((dr - u1) ** 2) / 0.004);
        }
        const e0 = fade(u0);
        const e1 = fade(u1);
        writeSeg(BP, BC, (k * K + j) * 6, cA, cB, u0, u1, i0 * e0, i1 * e1);

        if (touches && dr >= 1) {
          const p0 = pulse(reverse ? 1 - u0 : u0, tt, reduce);
          const p1 = pulse(reverse ? 1 - u1 : u1, tt, reduce);
          writeSeg(TP, TC, topSegs * 6, cA, cB, u0, u1, (activeTop + p0) * e0, (activeTop + p1) * e1);
          topSegs++;
        }
      }

      // 光点：脉冲波峰 / 开场笔尖
      if (touches && dr >= 1 && !reduce) {
        for (let p = 0; p < EC.pulses; p++) {
          const u = (tt * EC.pulseSpeed + p / EC.pulses) % 1;
          a.lerpVectors(A, B, reverse ? 1 - u : u);
          SP[sc * 3] = a.x; SP[sc * 3 + 1] = a.y; SP[sc * 3 + 2] = a.z;
          sc++;
        }
      } else if (drawing) {
        a.lerpVectors(A, B, dr);
        SP[sc * 3] = a.x; SP[sc * 3 + 1] = a.y; SP[sc * 3 + 2] = a.z;
        sc++;
      }
    }

    base.posAttr.needsUpdate = true;
    base.colAttr.needsUpdate = true;
    (top.obj.geometry as LineSegmentsGeometry).instanceCount = topSegs;
    top.obj.visible = topSegs > 0;
    if (topSegs) {
      top.posAttr.needsUpdate = true;
      top.colAttr.needsUpdate = true;
    }
    fx.sparks.geometry.setDrawRange(0, sc);
    fx.sparks.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <>
      <primitive object={fx.base.obj} />
      <primitive object={fx.top.obj} />
      <primitive object={fx.sparks} />
    </>
  );
}

/** 平滑阶跃：a→b 之间从 0 过渡到 1（a>b 时反向） */
function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** u（0..1，从选中节点往外）处的脉冲亮度：若干个高斯包随时间向外走 */
function pulse(u: number, tt: number, reduce: boolean): number {
  if (reduce) return 0;
  const EC = CONFIG.edges;
  let v = 0;
  for (let p = 0; p < EC.pulses; p++) {
    const c = (tt * EC.pulseSpeed + p / EC.pulses) % 1;
    const d = u - c;
    v += Math.exp(-(d * d) / (2 * EC.pulseWidth * EC.pulseWidth));
  }
  return v * EC.pulseGlow;
}
