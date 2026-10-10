// 需要触发界面重绘的状态（选中、筛选、搜索框开关、重放）。
// 注意：逐帧变化的东西（位置、悬停、相机）不放这里，放在 world.ts 的可变对象里。
import { create } from 'zustand';
import type { Cat } from '../lib/meta';

interface UIState {
  selected: number; // -1 表示未选中
  focusCat: Cat | null;
  palette: boolean;
  replayNonce: number; // 每次重放开场 +1
  compact: boolean;
  slugs: string[];
  hudIn: boolean; // 开场走到 hudAt：界面淡入
  nameIn: boolean; // 开场走到 nameAt：名字解码出现
  select: (i: number) => void;
  deselect: () => void;
  toggleCat: (c: Cat) => void;
  clearCat: () => void;
  setPalette: (open: boolean) => void;
  replay: () => void;
  setCompact: (c: boolean) => void;
}

const setHash = (slug: string | null) => {
  const url = slug ? `#${slug}` : location.pathname + location.search;
  history.replaceState(null, '', url);
};

export const useUI = create<UIState>((set, get) => ({
  selected: -1,
  focusCat: null,
  palette: false,
  replayNonce: 0,
  compact: false,
  slugs: [],
  hudIn: false,
  nameIn: false,
  select: (i) => {
    set({ selected: i });
    setHash(get().slugs[i] ?? null);
  },
  deselect: () => {
    if (get().selected < 0) return;
    set({ selected: -1 });
    setHash(null);
  },
  toggleCat: (c) => set((s) => ({ focusCat: s.focusCat === c ? null : c })),
  clearCat: () => set({ focusCat: null }),
  setPalette: (open) => set({ palette: open }),
  replay: () => {
    get().deselect();
    set((s) => ({ replayNonce: s.replayNonce + 1, hudIn: false, nameIn: false }));
  },
  setCompact: (compact) => set({ compact }),
}));
