// 性能读数（网址加 ?fps 才显示）：帧率、每帧绘制次数、档位、像素比。直接写 DOM，不触发 React 重绘。
import { useRef } from 'react';
import { useSafeFrame } from './safeFrame';
import type { Tier } from '../config';

export function PerfStats({ el, tier, level, levels }: { el: React.RefObject<HTMLDivElement | null>; tier: Tier; level: number; levels: number }) {
  const acc = useRef({ frames: 0, t: 0, worst: 0 });
  useSafeFrame(({ gl }, dt) => {
    // 后期管线一帧会渲染多次；关掉自动清零，整帧累计后在这里读出再手动清零
    gl.info.autoReset = false;
    const calls = gl.info.render.calls;
    gl.info.reset();
    const a = acc.current;
    a.frames++;
    a.t += dt;
    a.worst = Math.max(a.worst, dt);
    if (a.t < 0.5 || !el.current) return;
    const fps = a.frames / a.t;
    el.current.textContent = `${fps.toFixed(0)} fps · 最慢一帧 ${(a.worst * 1000).toFixed(0)}ms · 绘制 ${calls} 次/帧 · 档位 ${tier} · 质量 ${levels - level}/${levels} · 像素比 ${gl.getPixelRatio()}`;
    el.current.style.color = fps >= 55 ? '#5fd39a' : fps >= 40 ? '#ffcf6b' : '#ff6b8f';
    a.frames = 0;
    a.t = 0;
    a.worst = 0;
  });
  return null;
}
