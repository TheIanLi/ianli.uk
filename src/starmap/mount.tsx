// 3D 星图的挂载入口：boot.ts 下载完所有文件后动态导入这里，把 React 岛渲染到 #sm-root。
// 构建后 scripts/sm-manifest.mjs 按文件名 mount.*.js 找到这个文件，统计它依赖的所有脚本，用来显示下载进度。
import { createRoot } from 'react-dom/client';
import StarMap from './StarMap';
import type { GraphData } from './world';

export function mount(el: HTMLElement, graph: GraphData) {
  createRoot(el).render(<StarMap graph={graph} />);
}
