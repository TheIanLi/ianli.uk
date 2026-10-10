// 设备判定：性能档位、布局模式、减少动态效果。只在浏览器里运行。
import { CONFIG, type Tier } from './config';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

/** compact = 手机式布局（底部抽屉、底部工具栏）；wide = 电脑式布局 */
export function isCompact(w = innerWidth, h = innerHeight): boolean {
  const { compactWidth, touchShortSide } = CONFIG.layout;
  return w < compactWidth || (coarsePointer() && Math.min(w, h) < touchShortSide);
}

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/** 网址里 ?tier= 强制的档位；强制时不再自动降档，方便测试 */
export function forcedTier(): Tier | null {
  const t = new URLSearchParams(location.search).get('tier');
  return t && t in CONFIG.tiers ? (t as Tier) : null;
}

/**
 * 初始档位：一律从最高档开始（访客基本是朋友，手机都不差）。网址加 ?tier=low|mid|high 可强制指定，方便测试。
 * 唯一例外是没有显卡、用 CPU 软件渲染的环境（虚拟机、无头浏览器），真机不会遇到。
 * 真跑不动时，运行中的自动降档（StarMap 里的 PerformanceMonitor + 质量阶梯）会按实测帧率往下调。
 */
export function detectTier(): Tier {
  const forced = forcedTier();
  if (forced) return forced;
  if (/swiftshader|llvmpipe|software/i.test(gpuName())) return 'low';
  return 'high';
}

export interface Quality {
  dpr: number;
  msaa: number;
  bloom: boolean;
  bloomLevels: number;
}

/**
 * 质量阶梯：第 0 级是该档位（触屏再收一点）的完整画质，往后每一级降一点。
 * 运行中帧率不够就往后退一级，够了再往前回一级。
 */
export function qualityLadder(tier: Tier): Quality[] {
  const T = CONFIG.tiers[tier];
  const touch = coarsePointer();
  const top: Quality = {
    dpr: Math.min(devicePixelRatio || 1, T.dpr),
    msaa: touch ? Math.min(T.msaa, CONFIG.touch.msaa) : T.msaa,
    bloom: T.bloom,
    bloomLevels: touch ? Math.min(T.bloomLevels, CONFIG.touch.bloomLevels) : T.bloomLevels,
  };
  const steps: Quality[] = [top];
  let q = { ...top };
  while (q.dpr > 1) steps.push((q = { ...q, dpr: Math.max(1, +(q.dpr - 0.25).toFixed(2)) }));
  if (q.msaa > 0) steps.push((q = { ...q, msaa: 0 }));
  if (q.bloom && q.bloomLevels > 5) steps.push((q = { ...q, bloomLevels: 5 }));
  if (q.bloom) steps.push((q = { ...q, bloom: false }));
  return steps;
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const SEEN_KEY = 'ianli.introSeen';
export function introSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function markIntroSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* 隐私模式等情况下写不进去，就当每次都是第一次 */
  }
}
