// 从文章页回到星图时，恢复离开前的画面（镜头、选中的节点、节点位置），不重播开场。
// 文章页是不带 3D 的独立页面，回来等于重新加载首页；这里在离开时把画面存进 sessionStorage，回来时读出来。
import type { World } from './world';

const KEY = 'ianli.view';
const MAX_AGE = 6 * 3600 * 1000; // 超过这么久就当成一次新的访问，照常播开场

export interface SavedView {
  at: number;
  sel: string; // 选中节点的 slug，没选中是 ''
  th: number;
  ph: number;
  r: number;
  zoomed: boolean;
  P: number[]; // 每个节点的位置 x,y,z
}

/** 离开页面时调用 */
export function saveView(w: World, selected: number) {
  if (!w.introDone) return; // 开场还没播完就走了：没有可恢复的画面
  const view: SavedView = {
    at: Date.now(),
    sel: selected >= 0 ? w.nodes[selected].slug : '',
    th: w.camG.th,
    ph: w.camG.ph,
    r: w.camG.r,
    zoomed: w.userZoomed,
    P: w.P.flatMap((p) => [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    /* 存不进去（隐私模式等）：回来时照常播开场 */
  }
}

/**
 * 回来时调用：有可恢复的画面就返回它。
 * 只在"从本站别的页面回来"时恢复（点返回星图、浏览器后退）；手动刷新、从外面进来都照常播开场。
 */
export function loadView(w: World): SavedView | null {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'reload') return null;
    const fromSite = nav?.type === 'back_forward' || document.referrer.startsWith(location.origin + '/');
    if (!fromSite) return null;
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as SavedView | null;
    if (!v || Date.now() - v.at > MAX_AGE) return null;
    if (!Array.isArray(v.P) || v.P.length !== w.n * 3 || !v.P.every(Number.isFinite)) return null; // 节点数变了（网站更新过）
    if (![v.th, v.ph, v.r].every(Number.isFinite)) return null;
    return v;
  } catch {
    return null;
  }
}
