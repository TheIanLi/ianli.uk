// 开场名字星尘：从中心恒星涌出，在屏幕中央拼成 IAN LI（和正式标题同一款字体），
// 停留时可以用鼠标拨散；然后整体飞向左上角、缩小淡出，正式标题在此时"解码"出现。
// 普通 2D 画布 + 自己的动画循环，读 world.introT（开场时间，已含播放倍速）。
import { useEffect, useRef } from 'react';
import { CONFIG } from '../config';
import type { World } from '../world';

const NAME = 'IAN LI';
const FONT = 'IanName';
// 和正式标题一致的渐变：本站白 → 基础紫 → AI 橙
const STOPS: [number, [number, number, number]][] = [
  [0, [243, 239, 255]],
  [0.55, [201, 184, 255]],
  [1, [255, 176, 84]],
];
const grad = (u: number) => {
  for (let k = 1; k < STOPS.length; k++) {
    const [u1, c1] = STOPS[k];
    const [u0, c0] = STOPS[k - 1];
    if (u <= u1) {
      const f = (u - u0) / (u1 - u0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
};

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bx: number; // 中央大字里的位置
  by: number;
  sx: number; // 左上角标题里的位置
  sy: number;
  s: number;
  group: number; // 颜色桶 × 闪烁组：同组一次性绘制
}

const BUCKETS = 8; // 渐变量化成 8 档颜色
const PHASES = 4; // 4 组闪烁相位

export function NameDust({ world: w, reduce }: { world: World; reduce: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduce) return;
    const c = cv.current!;
    const g = c.getContext('2d')!;
    const I = CONFIG.intro;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let pts: P[] = [];
    let groups: P[][] = [];
    let lastNow = 0;
    const colors = Array.from({ length: BUCKETS }, (_, b) => grad((b + 0.5) / BUCKETS).join(','));
    let builtFor = -1; // 为哪一次开场构建的（重放时重建）
    let raf = 0;
    let W = 0;
    let H = 0;
    const mouse = { x: -9999, y: -9999 };

    const build = () => {
      W = innerWidth;
      H = innerHeight;
      c.width = W * dpr;
      c.height = H * dpr;
      const title = document.querySelector('.sm .brand h1') as HTMLElement | null;
      const tr = title?.getBoundingClientRect();
      // 字号：按屏宽取，再保证整行不超过屏宽的 80%（窄屏手机上不顶边）
      const probe = document.createElement('canvas').getContext('2d')!;
      let fs = Math.min(W * I.dustSize, 150);
      probe.font = `800 ${fs}px ${FONT}, sans-serif`;
      fs *= Math.min(1, (W * 0.8) / probe.measureText(NAME).width);
      probe.font = `800 ${fs}px ${FONT}, sans-serif`;
      const mw = probe.measureText(NAME).width;
      // 只在文字包围盒大小的离屏画布上画字、读像素（不读整个屏幕）
      const bw = Math.ceil(mw + fs * 0.2);
      const bh = Math.ceil(fs * 1.1);
      const off = document.createElement('canvas');
      off.width = bw;
      off.height = bh;
      const o = off.getContext('2d')!;
      o.font = probe.font;
      o.textAlign = 'center';
      o.textBaseline = 'middle';
      o.fillStyle = '#fff';
      o.fillText(NAME, bw / 2, bh / 2);
      const cx = W / 2;
      const cy = H * 0.46;
      const ox = cx - bw / 2; // 离屏画布左上角在屏幕上的位置
      const oy = cy - bh / 2;
      const x0 = cx - mw / 2;
      const top = cy - fs * 0.38;
      const th = fs * 0.76;
      const data = o.getImageData(0, 0, bw, bh).data;
      const gap = Math.max(2, Math.round(fs / 40)); // 排得密一些，压在星系上也清楚
      const core = w.sc[0];
      const next: P[] = [];
      for (let y = 0; y < bh; y += gap)
        for (let x = 0; x < bw; x += gap) {
          if (data[(y * bw + x) * 4 + 3] < 128) continue;
          const bx = ox + x + (Math.random() - 0.5) * gap * 1.1;
          const by = oy + y + (Math.random() - 0.5) * gap * 1.1;
          const u = Math.min(1, Math.max(0, (bx - x0) / mw));
          // 映射到左上角标题的包围盒
          const sx = tr ? tr.left + u * tr.width : 40;
          const sy = tr ? tr.top + ((by - top) / th) * tr.height : 40;
          // 从中心恒星附近出生，带一点向外的初速度
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 18;
          next.push({
            x: (core?.x ?? W / 2) + Math.cos(a) * r,
            y: (core?.y ?? H / 2) + Math.sin(a) * r,
            vx: Math.cos(a) * (2 + Math.random() * 6),
            vy: Math.sin(a) * (2 + Math.random() * 6),
            bx,
            by,
            sx,
            sy,
            s: 0.7 + Math.random() * 1.3,
            group: Math.min(BUCKETS - 1, Math.floor(u * BUCKETS)) * PHASES + Math.floor(Math.random() * PHASES),
          });
        }
      pts = next;
      groups = Array.from({ length: BUCKETS * PHASES }, () => [] as P[]);
      for (const p of pts) groups[p.group].push(p);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = w.introT;
      const end = I.dustOut + I.dustFly + 0.15;
      if (t < I.dustIn || t > end) {
        if (pts.length) {
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.clearRect(0, 0, c.width, c.height);
          if (t > end) {
            pts = [];
            groups = [];
          }
        }
        return;
      }
      if (builtFor !== w.introId) {
        builtFor = w.introId;
        build();
      }
      // 按实际经过的时间推进（以 60fps 为基准换算），120Hz 屏上速度也一样
      const step = Math.min(50, lastNow ? now - lastNow : 16.7) / 16.7;
      lastNow = now;
      const flying = t >= I.dustOut;
      const fp = Math.min(1, Math.max(0, (t - I.dustOut) / I.dustFly));
      const form = Math.min(1, (t - I.dustIn) / I.dustForm);
      const k = (flying ? 0.16 + 0.3 * fp : 0.02 + 0.07 * form) * step; // 弹簧越来越紧
      const damp = Math.pow(flying ? 0.7 : 0.82, step);
      const alpha = flying ? 1 - Math.pow(fp, 1.6) : Math.min(1, form * 2);
      const shrink = flying ? 1 - fp * 0.75 : 1;
      const ef = easeInOut(fp);
      for (const p of pts) {
        const tx = flying ? p.bx + (p.sx - p.bx) * ef : p.bx;
        const ty = flying ? p.by + (p.sy - p.by) * ef : p.by;
        if (!flying) {
          // 停留时鼠标可以拨散星尘
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 8000) {
            const d = Math.sqrt(d2) || 1;
            const f = (1 - d2 / 8000) * 2.4 * step;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }
        p.vx = (p.vx + (tx - p.x) * k) * damp;
        p.vy = (p.vy + (ty - p.y) * k) * damp;
        p.x += p.vx * step;
        p.y += p.vy * step;
      }
      // 分组绘制：同一颜色、同一闪烁相位的星尘合成一条路径，一次填充（几千颗星尘只提交 32 次）
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      for (let gi = 0; gi < groups.length; gi++) {
        const list = groups[gi];
        if (!list.length) continue;
        const tw = 0.75 + 0.25 * Math.sin(now * 0.004 + (gi % PHASES) * 1.57);
        g.fillStyle = `rgba(${colors[Math.floor(gi / PHASES)]},${(alpha * tw).toFixed(3)})`;
        g.beginPath();
        for (const p of list) {
          const r = p.s * shrink;
          g.moveTo(p.x + r, p.y);
          g.arc(p.x, p.y, r, 0, 6.283);
        }
        g.fill();
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onResize = () => {
      if (pts.length) build();
    };
    let cancelled = false;
    // 字体就绪后再开始（采样的字形要和正式标题一致）
    document.fonts.load(`800 100px ${FONT}`).finally(() => {
      if (!cancelled) raf = requestAnimationFrame(tick);
    });
    addEventListener('pointermove', onMove);
    addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      removeEventListener('resize', onResize);
    };
  }, [w, reduce]);

  if (reduce) return null;
  return <canvas ref={cv} className="sm-namedust" aria-hidden="true" />;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
