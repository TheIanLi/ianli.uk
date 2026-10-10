// 选中涟漪：飞到节点时从节点向外扩散两圈光环；停留期间隔一会儿再扩散一圈淡的。
// 另外统一写入辉光强度（开场爆闪 + 到达闪光），避免多个组件互相覆盖。
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useSafeFrame } from './safeFrame';
import * as THREE from 'three';
import { CATS } from '../../lib/meta';
import { CONFIG } from '../config';
import { useUI } from '../store';
import { clamp, easeOut, type World } from '../world';
import { makeRing, setRing } from './ring';

export function Ripple({ world: w, reduce }: { world: World; reduce: boolean }) {
  const camera = useThree((s) => s.camera);
  const RP = CONFIG.ripple;
  // 3 个环：两圈到达涟漪 + 一圈循环的淡涟漪
  const rings = useMemo(() => [0, 1, 2].map(() => makeRing('#ffffff', 1, RP.width)), [RP.width]);
  const colors = useMemo(() => w.nodes.map((n) => new THREE.Color(CATS[n.cat].color).multiplyScalar(RP.glow)), [w, RP.glow]);

  useSafeFrame(() => {
    const sel = useUI.getState().selected;
    const now = w.ms();
    // 到达时刻 = 选中时刻 + 飞行用时的 70%（涟漪在镜头快到时炸开）
    const arrive = w.selAt + CONFIG.fly.duration * 700;
    const since = (now - arrive) / 1000;
    let glow = 0;

    if (sel < 0 || reduce || w.introT < CONFIG.intro.bang + 1) {
      rings.forEach((r) => setRing(r, 0, 0));
    } else {
      const pos = w.R[sel];
      const scale = RP.size * 0.5 * (w.isCore(sel) ? 1.6 : 1);
      rings.forEach((r, j) => {
        r.position.copy(pos);
        r.quaternion.copy(camera.quaternion);
        r.scale.setScalar(scale);
        (r.material.uniforms.uColor.value as THREE.Color).copy(colors[sel]);
        let d: number;
        let strength: number;
        if (j < 2) {
          d = since - j * RP.gap; // 到达涟漪
          strength = j ? 0.6 : 1;
        } else {
          const first = RP.duration + RP.gap; // 到达涟漪结束后才开始循环
          d = since > first ? (since - first) % RP.repeatEvery : -1;
          strength = RP.repeatOpacity;
        }
        if (d < 0 || d > RP.duration) return setRing(r, 0, 0);
        const p = d / RP.duration;
        setRing(r, 0.12 + easeOut(p) * 0.86, (1 - p) * (1 - p) * strength);
      });
      if (since > 0) glow = RP.arriveGlow * Math.exp(-since / 0.25) * clamp(since / 0.05, 0, 1);
    }

    w.selectGlow = glow;
    if (w.bloom) w.bloom.intensity = CONFIG.bloom.intensity * (1 + w.introSpike + w.selectGlow);
  });

  return (
    <>
      {rings.map((r, j) => (
        <primitive key={j} object={r} />
      ))}
    </>
  );
}
