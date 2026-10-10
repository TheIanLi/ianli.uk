// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://ianli.uk',
  integrations: [react()],
  // 关掉开发工具栏：它每次 DOM 变化都会扫描页面（点击节点弹出卡片时会造成明显卡顿），对本项目没用
  devToolbar: { enabled: false },
  vite: {
    // 开发时启动就预打包 3D 依赖，避免首次打开页面时 Vite 重新打包导致的 504 + 自动刷新
    optimizeDeps: {
      include: [
        'three',
        'three/examples/jsm/lines/LineSegments2.js',
        'three/examples/jsm/lines/LineSegmentsGeometry.js',
        'three/examples/jsm/lines/LineMaterial.js',
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
        'postprocessing',
        'motion/react',
        'zustand',
      ],
    },
  },
  markdown: {
    shikiConfig: { theme: 'github-dark-dimmed', wrap: false },
  },
});
