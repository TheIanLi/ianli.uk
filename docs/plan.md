# ianli.uk 设计与实施计划（v1，2026-10-09）

## 设计要点
- **栈**：Astro 7 + `@astrojs/react` 岛屿；首页一个 `client:only="react"` 岛 = R3F 9 + drei 10 + @react-three/postprocessing 3（three 0.186，React 19.3）。HUD/面板用 React + `motion/react`。文章页、404 纯静态，零 React/3D。
- **数据**：`src/content/nodes/*.md`（title/cat/status/links/summary/cmd?/aliases/date/updated?/parent?/repo?）。构建时生成图数据传给岛：links 视为无向边并去重；引用不存在的 slug 直接构建失败。编号 N-xx：本站固定 N-00，其余按 date→slug 排序，新笔记追加在后，不打乱旧编号。
- **布局**：沿用原型自写力导向（REP=25, SPR=.04, CEN=.006, DAMP=.88, d²≥9）。理由：几十节点 O(n²) 可忽略，0 依赖；d3-force-3d 的八叉树优势要上百节点才体现。改用**固定种子随机数**，每次打开形状一致。
- **性能**：所有逐帧逻辑 = `useFrame` + ref，禁止每帧 setState。初始档位按设备特征判定（触屏/核数/内存/GPU 名），运行中用 drei `PerformanceMonitor` 按实测帧率自动降档（像素比 → 辉光强度 → 关辉光）。`?tier=low|mid|high` 强制档位便于测试；标签页隐藏时暂停渲染。
- **配置**：所有可调数值集中在 `src/starmap/config.ts` 一个对象里。
- **新增交互**：`#slug` 深链飞到节点；old 变暗 / wip 呼吸；方向键在相邻节点间跳；30 天内更新的节点带小标记；二次访问开场缩为 ~1.5s（localStorage，失败则按首次处理）。
- **文章页**：深色 + 纯 CSS 淡星点；代码高亮用 Astro 自带 Shiki（构建时完成）；与 md 同目录的图片 `![](./x.png)` 构建时自动压缩为 webp。
- **组件库**：React Bits 用 CSS 版本，按需复制进来；Tailwind 等真正用到 Aceternity 组件时再加，且样式只作用于该组件。
- **隐私**：探针不链探针子域名；sing-box 只写到技术层面；repo 字段只填自己的公开非 fork 仓库。git 用 noreply 邮箱；每次提交前跑脚本扫描 IP / 密钥特征。

## 阶段（每阶段结束：`npm run build` 通过 + 给出预览地址 + 更新 CLAUDE.md 进度）
| # | 内容 | 你能看到 |
|---|---|---|
| 0 | 建 CLAUDE.md、脚手架、19 个 md（原型 18 + LLM-Net-Probe）+ 边、文章页、基础 404 | `/n/vps/` 等文章页；首页先是 2D 列表 |
| 1 | 把原型全部功能移植到 R3F（造型、交互、卡片/抽屉、搜索、图例、读数、退路、reduced-motion）+ 新增交互 + 性能分级骨架；实测首页 JS 体积 | 和原型同等功能的 3D 星图 |
| 2a | 辉光（UnrealBloom 等效，选择性发光） | ⏸ 你确认 |
| 2b | 三段式开场（蓄能 → 爆发/冲击波/震屏/拖尾 → BFS 画线 + 打字标签） | ⏸ 你确认 |
| 2c | 粗线 Line2（drei `<Line>`）+ 悬停能量脉冲 | ⏸ 你确认 |
| 2d | 多层视差星空 + 闪烁 + 星云 + 光标倾斜 | ⏸ 你确认 |
| 2e | 飞行镜头 + FOV 冲刺 + 选中涟漪 | ⏸ 你确认 |
| 3 | 404 星图风格、文章页打磨、手机/档位验收 | 手机实测 |
| 4 | 部署：先查 Cloudflare 文档给方案 → 你确认 → 建仓库、接 Workers Builds | ianli.uk 上线 |

## 风险
- 测试基准：vivo X100（旗舰，访客主力机型同级）；便宜备用机验收低档位。
- 首页 JS 预估 gzip 350–450KB，在 600KB 软上限内，阶段 1 给出实测数字。
