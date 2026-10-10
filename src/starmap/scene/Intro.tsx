// 开场特效：蓄能粒子、爆发闪光与冲击波、辉光爆闪、镜头震动、节点拖尾。
// 读 world.introT（Driver 每帧算好的开场时间）。挂在 Driver 之后，所以拿到的是本帧位置。
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useSafeFrame } from './safeFrame';
import * as THREE from 'three';
import { CATS } from '../../lib/meta';
import { CONFIG, type Tier } from '../config';
import { clamp, easeOut, seededRandom, type World } from '../world';
import { makeRing, setRing } from './ring';
import { textures } from './textures';

const ADD = THREE.AdditiveBlending;

export function Intro({ world: w, tier, reduce }: { world: World; tier: Tier; reduce: boolean }) {
  const camera = useThree((s) => s.camera);
  const fx = useMemo(() => build(w, tier), [w, tier]);

  useSafeFrame(() => {
    const I = CONFIG.intro;
    const t = w.introT;
    const since = t - I.bang; // 爆发后经过的时间
    const live = !reduce && t < I.done + 0.5;

    // ---- 阶段一：蓄能粒子螺旋汇聚 ----
    const cg = fx.charge.geometry;
    if (live && t < I.bang + 0.05) {
      fx.charge.visible = true;
      const pos = cg.attributes.position.array as Float32Array;
      for (let k = 0; k < fx.cN; k++) {
        const [r0, th0, y0, delay, dur] = fx.cSeed[k];
        const p = clamp((t - delay) / dur, 0, 1);
        const e = p * p * p; // 越靠近越快
        const r = r0 * (1 - e);
        const th = th0 + e * I.chargeSpin;
        pos[k * 3] = Math.cos(th) * r;
        pos[k * 3 + 1] = y0 * (1 - e);
        pos[k * 3 + 2] = Math.sin(th) * r;
      }
      cg.attributes.position.needsUpdate = true;
      (fx.charge.material as THREE.PointsMaterial).opacity = clamp(t / 0.3, 0, 1);
    } else fx.charge.visible = false;

    // ---- 阶段二：爆发 ----
    // 闪光
    const flashMat = fx.flash.material as THREE.SpriteMaterial;
    if (live && since > 0 && since < 1.2) {
      const f = since / 1.0;
      fx.flash.visible = true;
      fx.flash.scale.setScalar(6 + easeOut(f) * 70);
      flashMat.opacity = Math.pow(1 - clamp(f, 0, 1), 1.8) * I.flash;
    } else fx.flash.visible = false;

    // 冲击波：两道，第二道稍晚、稍小
    const S = I.shockwave;
    fx.waves.forEach((ring, j) => {
      const d = since - j * 0.14;
      if (!live || d < 0 || d > S.duration) return setRing(ring, 0, 0);
      const p = d / S.duration;
      ring.position.set(0, 0, 0);
      ring.quaternion.copy(camera.quaternion);
      ring.scale.setScalar(S.size * (j ? 0.7 : 1) * 0.5);
      setRing(ring, easeOut(p) * 0.98, (1 - p) * (1 - p) * (j ? 0.6 : 1));
    });

    // 辉光爆闪（最终强度由 Ripple 统一写入 bloom，避免两处互相覆盖）
    w.introSpike = live && since > 0 ? I.bloomSpike * Math.exp(-since / I.bloomDecay) : 0;

    // 镜头震动（叠加在 Driver 已经算好的相机位置上）
    if (live && since > 0 && since < 1.5) {
      const a = I.shake * Math.exp(-since / I.shakeDecay);
      camera.position.x += a * (Math.sin(t * 71) * 0.6 + Math.sin(t * 133) * 0.4);
      camera.position.y += a * (Math.sin(t * 89 + 1) * 0.6 + Math.sin(t * 157) * 0.4);
      camera.position.z += a * Math.sin(t * 97 + 2) * 0.5;
      camera.updateMatrixWorld();
    }

    // 节点拖尾：记录每个节点最近的位置，画成渐隐的线
    const L = I.trailLen;
    if (live && since > 0 && t < I.trailFadeAt + 0.8) {
      fx.trails.visible = true;
      const fade = 1 - clamp((t - I.trailFadeAt) / 0.8, 0, 1);
      const hist = fx.hist;
      const tp = fx.trails.geometry.attributes.position.array as Float32Array;
      const tc = fx.trails.geometry.attributes.color.array as Float32Array;
      // 按开场时间固定间隔采样（和屏幕刷新率无关，120Hz 手机上拖尾长度也一样）
      const shift = t - fx.lastSample >= 1 / 60;
      if (shift) fx.lastSample = t;
      for (let i = 0; i < w.n; i++) {
        const base = i * L * 3;
        // 往后挪一格，最新位置放在 0
        if (shift) hist.copyWithin(base + 3, base, base + (L - 1) * 3);
        const R = w.R[i];
        hist[base] = R.x;
        hist[base + 1] = R.y;
        hist[base + 2] = R.z;
        if (!fx.histInit[i]) {
          for (let k = 1; k < L; k++) hist.set([R.x, R.y, R.z], base + k * 3);
          fx.histInit[i] = 1;
        }
        const c = fx.ncol[i];
        for (let k = 0; k < L - 1; k++) {
          const o = (i * (L - 1) + k) * 6;
          tp.set(hist.subarray(base + k * 3, base + k * 3 + 3), o);
          tp.set(hist.subarray(base + (k + 1) * 3, base + (k + 1) * 3 + 3), o + 3);
          const a0 = (1 - k / (L - 1)) * fade * 2.2;
          const a1 = (1 - (k + 1) / (L - 1)) * fade * 2.2;
          tc.set([c.r * a0, c.g * a0, c.b * a0, c.r * a1, c.g * a1, c.b * a1], o);
        }
      }
      fx.trails.geometry.attributes.position.needsUpdate = true;
      fx.trails.geometry.attributes.color.needsUpdate = true;
    } else {
      fx.trails.visible = false;
      fx.histInit.fill(0);
      fx.lastSample = -1;
    }
  });

  return (
    <>
      <primitive object={fx.charge} />
      <primitive object={fx.flash} />
      {fx.waves.map((r, j) => (
        <primitive key={j} object={r} />
      ))}
      <primitive object={fx.trails} />
    </>
  );
}

function build(w: World, tier: Tier) {
  const I = CONFIG.intro;
  const { glow, dot } = textures();
  const rnd = seededRandom(CONFIG.sim.seed + 7);
  const ncol = w.nodes.map((n) => new THREE.Color(CATS[n.cat].color));

  // 蓄能粒子：随机分布在球壳上，各自带延迟和用时，在爆发前汇聚到中心
  const cN = I.chargeParticles[tier];
  const cSeed: [number, number, number, number, number][] = [];
  const cCol = new Float32Array(cN * 3);
  const palette = [new THREE.Color('#fff2dc'), ...ncol.slice(0, 6)];
  for (let k = 0; k < cN; k++) {
    const r0 = I.chargeRadius[0] + rnd() * (I.chargeRadius[1] - I.chargeRadius[0]);
    const delay = rnd() * 0.45 * I.bang;
    const dur = I.bang - delay - rnd() * 0.08;
    cSeed.push([r0, rnd() * Math.PI * 2, (rnd() - 0.5) * r0 * 0.8, delay, Math.max(0.2, dur)]);
    const c = palette[k % 3 === 0 ? 0 : 1 + (k % (palette.length - 1))];
    const b = 1.2 + rnd() * 1.4;
    cCol.set([c.r * b, c.g * b, c.b * b], k * 3);
  }
  const cGeo = new THREE.BufferGeometry();
  cGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cN * 3), 3));
  cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
  const charge = new THREE.Points(
    cGeo,
    new THREE.PointsMaterial({ size: 0.75, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: ADD }),
  );
  charge.frustumCulled = false;
  charge.visible = false;

  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: new THREE.Color('#fff2dc').multiplyScalar(1.6),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: ADD,
    }),
  );
  flash.visible = false;

  const S = I.shockwave;
  const waves = [makeRing(S.color, S.glow, S.width), makeRing('#ffffff', S.glow * 0.5, S.width * 1.6)];

  // 拖尾：每个节点 trailLen 个历史点 → trailLen-1 段
  const L = I.trailLen;
  const segs = w.n * (L - 1);
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs * 6), 3));
  const trails = new THREE.LineSegments(
    tGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: ADD }),
  );
  trails.frustumCulled = false;
  trails.visible = false;

  return {
    charge,
    cN,
    cSeed,
    flash,
    waves,
    trails,
    hist: new Float32Array(w.n * L * 3),
    histInit: new Uint8Array(w.n),
    lastSample: -1,
    ncol,
  };
}
