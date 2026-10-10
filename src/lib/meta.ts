// 分类与状态的显示名和颜色。首页星图、文章页、404 共用这一份。
export type Cat = 'core' | 'net' | 'ai' | 'proj' | 'base';
export type Status = 'ok' | 'wip' | 'old';

export const CATS: Record<Cat, { name: string; color: string }> = {
  core: { name: '本站', color: '#f3efff' },
  net: { name: '服务器与网络', color: '#5cb6ff' },
  ai: { name: 'AI 与 Agent', color: '#ffb054' },
  proj: { name: '项目', color: '#ff6b8f' },
  base: { name: '基础', color: '#a68fff' },
};
export const CAT_ORDER: Cat[] = ['core', 'net', 'ai', 'proj', 'base'];

export const STATUS: Record<Status, { name: string; cls: string }> = {
  ok: { name: '在用', cls: 's-ok' },
  wip: { name: '迭代中', cls: 's-wip' },
  old: { name: '折腾过', cls: 's-old' },
};
