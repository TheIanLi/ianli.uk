# ianli.uk 项目说明

个人网站：折腾记录（VPS、Linux、AI 工具）+ 个人笔记。首页是可互动的 3D 星图，每颗星是一篇笔记。核心是展示：酷、震撼、可互动。
用户编程基础一般，靠 vibe coding。**用中文沟通**，每一步说清楚终端跑什么命令、浏览器看什么。

## 背景
- 域名 ianli.uk 托管在 Cloudflare，根域名绑在 Worker `weathered-king-9548`（原占位页可丢弃），已开"始终使用 HTTPS"。
- **两个已有子域名（探针、服务器；具体名字只记在本机，不进公开仓库）绝对不要动；不改任何 DNS 记录。**
- GitHub：TheIanLi，仓库 `ianli.uk`（公开）。
- 原型：`reference/starmap-preview.html`（three r128 单文件草稿）。正式版在它基础上升级，不是照抄。
- 设计与计划：`docs/plan.md`。

## 约束
- 主要访客在中国大陆：**不用任何外部 CDN 和 Google Fonts**，全部 npm 打包到本地，字体用系统字体栈。
- 首页 JS gzip 软上限 ~600KB，超了要说明原因。**硬指标是帧率**：桌面 60fps，手机流畅；低端设备自动降级（像素比、辉光）。测试机：RTX 4060 Laptop；vivo X100（基准）；便宜备用机（低档位）。
- 只需普通浏览器能打开，不为微信做专门适配。
- 不写个人经历、不暴露隐私：探针不链接探针子域名、不公开服务器列表；sing-box 只写技术层面，不放配置/端口/节点；`repo` 只填自己已公开的非 fork 仓库。
- **不提交任何密钥、IP、配置秘密。** git 提交身份是 noreply 邮箱（本仓库 local config）；提交前跑 `npm run check:secrets`（pre-commit hook 会自动跑）。
- 不确定的（库 API、Cloudflare 配置）先查文档或源码，不要猜。

## 技术方案
- Astro 7 静态站。首页 3D 是 React 岛（`client:only="react"`）：React Three Fiber + drei + @react-three/postprocessing。HUD/面板用 React + `motion/react`。
- **逐帧动画一律 `useFrame` + ref 改值，禁止每帧 setState。**
- 文章页 `/n/<slug>/` 和 404 纯静态，不加载 React 和 3D。
- 组件库：React Bits（CSS 版本）、Uiverse 按需用；Tailwind 只在真用到 Aceternity 组件时加，且只作用于该组件。不装 Anime.js。
- 力导向布局：沿用原型自写模拟（REP=25, SPR=.04, CEN=.006, DAMP=.88, 距离平方下限 9），固定随机种子。
- 特效数值集中在 `src/starmap/config.ts` 一个对象里，用户说"再亮一点"就改这里。

## 内容（以后写笔记只需要做这一步）
每个节点是 `src/content/nodes/<slug>.md`，文件名就是 slug 和网址 `/n/<slug>/`。frontmatter：

```yaml
title: VPS                 # 必填
cat: net                   # 必填：core 本站 / net 服务器与网络 / ai AI 与 Agent / proj 项目 / base 基础
status: ok                 # 必填：ok 在用 / wip 迭代中 / old 折腾过
summary: 一两句话摘要       # 必填，星图卡片里显示
date: 2026-10-09           # 必填，创建日期
updated: 2026-10-20        # 可选；30 天内的更新会在星图上带"最近更新"标记
links: [linux, sing-box]   # 可选，相连节点的 slug；连线是双向的，只需在一边写
cmd: ssh vps 'uptime'      # 可选，卡片里的命令；以 # 开头的行显示为注释
aliases: [服务器, server]  # 可选，搜索用
parent: vps                # 可选，预留：以后节点多了可挂到主题下
repo: https://github.com/TheIanLi/xxx   # 可选，只填已公开的仓库
```
图片放在 md 旁边，用 `![说明](./图片.png)` 引用，构建时自动压缩。
links/parent 写了不存在的 slug 会**直接构建失败**并提示是哪个文件。

## 星图代码结构（src/starmap/）
- 加载链路：`boot.ts`（很小，最先跑）先用 fetch 下载 3D 脚本并显示真实进度 → 再 import `mount.tsx` 挂载 React。要下载的文件清单由构建插件 `scripts/sm-manifest.mjs` 写进 index.html。网速慢不自动切 2D：10 秒后给"先看列表"按钮，只有加载失败才自动显示列表。`public/_headers` 让 /_astro/ 长期缓存
- `config.ts` 所有可调数值 · `device.ts` 档位/布局判定 · `store.ts` 界面状态（zustand，只放不逐帧变的）
- `world.ts` 逐帧可变状态 + 力导向模拟 + 屏幕拾取 · `StarMap.tsx` 岛入口：输入、键盘、深链、降档
- `scene/Scene.tsx` 场景 + Driver（逐帧主循环，useFrame 优先级 -10，必须最先跑）· `scene/NodeShapes.tsx` 五类造型
- `scene/Edges.tsx` 粗线与脉冲 · `scene/Intro.tsx` 开场特效 · `scene/Ripple.tsx` 涟漪 + 统一写辉光强度
- `scene/Starfield.tsx` 星空与星云 · `scene/ring.ts` 光环着色器（冲击波和涟漪共用）
- `scene/bodies.ts` 五类天体的着色器与对象（无线框笼） · `scene/glsl.ts` 共用噪声与输出片段
- `hud/` 界面层：Hud（四角/底栏）、Panel（卡片/抽屉）、Palette（搜索）、Labels（标签）
- 布局两种模式：wide（电脑）/ compact（手机或窄窗口），由 `isCompact()` 判定，根元素加 `.compact`
- 测试参数：`?tier=low|mid|high` 强制档位（并锁定，不自动降档）
- 测试环境注意：WSL 里的无头 Chrome 只有 CPU 软件渲染（每秒 1–2 帧），帧率和动画时序都不可信，只适合看静态画面；
  帧率要用户在真机上用 `?fps` 看。在 Windows 原生环境或连接 Windows 上带 GPU 的 Chrome 会准确得多
- 仅开发模式：`?introSpeed=0.1` 慢放开场、`?timeScale=0.1` 慢放飞行和涟漪；控制台 `__sm` 是 world 对象
- 无头浏览器（软件渲染）帧率很低，会触发自动降档；截图测试要加 `?tier=high`

## 发布流程（以后写笔记只需要这样）
1. 新建或修改 `src/content/nodes/<slug>.md`
2. `git add -A && git commit -m "说明"`（提交前会自动扫描密钥）
3. `git push` → Cloudflare 自动构建，一两分钟后 ianli.uk 更新；构建失败时线上保持旧版本
- 本地分支 `history-local` 保存开发早期的完整历史，**永远不要推送**（旧提交里有不公开的子域名）

## 常用命令
- `npm run dev` → 浏览器开 http://localhost:4321（Windows 浏览器直接能开）
- `npm run build` → 构建到 `dist/`；`npm run preview` 预览构建结果
- `npm run check:secrets` → 扫描密钥 / IP
- `npm run dev:fresh` → 清掉 Vite 依赖缓存再启动（装/删依赖后首页报 `_jsxDEV is not a function` 时用）

## 工作方式
- 每个阶段结束：`npm run build` 通过，给出预览地址，更新下面的"当前进度"。
- 特效每做完一项先停下让用户在浏览器看，确认后再做下一项。

## 当前进度
- [x] 阶段 0：脚手架、19 个节点 / 30 条边、文章页 `/n/<slug>/`、基础 404、密钥扫描 hook（2026-10-09）
- [x] 阶段 1：原型功能移植到 R3F + 深链/状态外观/方向键/最近更新 + 性能分级 + 手机电脑分化布局 + 标签避让；首页 JS gzip 350KB（2026-10-09）
- [x] 阶段 2a–2e（2026-10-10，用户授权一次做完，待验收）：
  - 2a 选择性辉光（Bloom，按档位开关；`?tier=` 强制档位时不自动降档）
  - 2b 三段式开场：蓄能粒子 → 爆发（辉光爆闪/冲击波/震屏/拖尾）→ 按 BFS 层级画线 + 标签打字
  - 2c 粗线（LineSegments2，平头无串珠）+ 悬停/选中时沿线传播的能量脉冲
  - 2d 三层视差星空（闪烁）+ 分帧生成的星云 + 鼠标/陀螺仪倾斜（安卓陀螺仪需 HTTPS，部署后才能真机看）
  - 2e 点击飞行（缓入缓出 + FOV 冲刺）+ 选中涟漪
  - 首页 JS gzip 382KB
- [x] 2f 视觉质感重做（2026-10-10，用户反馈"太亮、像多边形、背景像贴图"后）：
  - 方向（用户选定）：天体化 + 几何内核；整体深邃克制
  - 后期：辉光 → Neutral 色调映射 → 暗角 → 胶片颗粒（低档位由渲染器做色调映射）
  - 恒星：流动等离子表面 + 日冕光丝 + 星芒；行星：恒星光照（随距离衰减）+ 大气 + 外圈全息线框笼
  - 服务器=带环冰蓝行星（夜面灯光）、基础=紫色岩质行星、AI=双旋臂小星系、项目=内发光晶体
  - 连线默认很暗、两端在节点附近淡出；聚焦时才亮
  - 背景：GPU 烘焙星云（满亮度烘焙避免 8 位色块）+ 两层视差 + 星芒亮星 + 前景尘埃
  - 首页 JS gzip 389KB
- [x] 2g（2026-10-10）用户否决 A/B/C 三个风格小样（已删除），确认以 2f 为基础只改两点：
  - 背景可交互：鼠标拨动三层星星与尘埃、星云随鼠标"显影"；点击空白处荡开波纹（屏幕空间，config.bgInteract）
  - 节点重画：去掉全部线框笼；AI=精细迷你旋涡星系；项目=粉白小恒星+卫星；行星低频柔和表面+补光；各节点淡光晕
  - 去掉胶片颗粒；首页加载失败 15 秒后自动显示 2D 列表
  - 首页 JS gzip 390KB
- [x] 2h（2026-10-10）布局与悬停：
  - 布局舒展（排斥 70、连线 17/21）；镜头距离按布局实际屏幕包围盒运行时自动适配并居中（config.camera.autoFit），用户缩放后不再自动改
  - 竖屏显示层纵向拉高 1.4 倍（sim.portraitYScale）
  - 悬停节点时冻结视差倾斜、暂停自动旋转、不扰动布局（之前节点会从鼠标下"溜走"）
- [x] 2i（2026-10-10）点击卡顿与名字：
  - 修点击卡顿：卡片不再强制整页重排（用 ResizeObserver 尺寸）；毛玻璃默认关（ui.glassBlur）；关闭 Astro 开发工具栏
  - 性能精简只作用于中/低档位，高档位画质不变（用户要求"体验优先"）；?fps 显示帧率/绘制次数
  - 名字：开场星尘从恒星涌出拼成 IAN LI（hud/NameDust.tsx），再飞到左上角变成 Syne 800 渐变标题 + 解码效果
  - 字体：Syne 800 裁剪到大写字母/数字/符号，3.5KB，构建时内嵌进 CSS（src/assets/fonts，附 OFL 许可证）
- [x] 2j（2026-10-10）开场被"首屏卡顿吃掉"的问题：
  - 开场时钟改为按帧累加（每帧最多 1/30 秒），页面卡住时开场暂停而不是跳过
  - 预热门槛：先异步预编译所有着色器（含隐藏物体，且在后期管线的离屏画布上编译出真正用到的变体），连续几帧流畅后才开始开场
  - 界面淡入、名字解码改由开场时钟触发（store.hudIn / nameIn），不再用现实时间定时器
- [x] 2k（2026-10-10）按调研报告 docs/research/3d-web-pitfalls.md 修高/中风险项：
  - 质量阶梯（device.ts qualityLadder）：帧率不够依次降分辨率→MSAA→辉光层数→关辉光，够了回升；开场后才观测；来回 8 次锁定
  - 触屏设备帧率封顶 60、不开 MSAA、辉光 6 层
  - WebGL 上下文丢失→显示 2D 列表，恢复后新画布重建；逐帧逻辑出错→退回 2D（scene/safeFrame.ts）
  - 名字星尘按时间推进、分 32 组批量绘制、只采样文字区域
  - 修背景遮挡 bug：背景改为场景背景贴图（之前的大光晕精灵盖住了中心的恒星和行星）
  - 次要文字对比度提到 4.8:1
  - 暂未做（低优先级，见调研报告）：动画暂停按钮（WCAG 2.2.2）、读屏器可用的节点列表、three 资源 dispose
- [x] 部署准备：wrangler.jsonc（纯静态 + 404 页，不写 routes 以免动域名）、.node-version 24、wrangler 固定版本
- [ ] 阶段 3：404 风格、文章页打磨（宽屏利用两侧空间）、手机验收 ← 下一步（等用户验收 2a–2e）
- [x] 阶段 4：部署（2026-10-10）：GitHub 公开仓库 TheIanLi/ianli.uk（main）→ Cloudflare Workers Builds 连到 Worker `weathered-king-9548`，构建 `npm run build`、部署 `npx wrangler deploy`；域名 ianli.uk 由后台管理（wrangler.jsonc 不写 routes）
- [x] 部署后修复（2026-10-10，push 到 main 即自动上线）：
  - 手机抖动：R3F `advance()` 要秒，之前传了毫秒
  - 竖屏"竖菱形"：放宽竖屏三个挤压参数（centerYPortrait / centerXZPortrait / portraitYScale）
  - 加载：显示真实下载进度，不再 15 秒强制 2D（见"加载链路"）
  - 档位：所有真机一律从 high 开始，只有软件渲染走 low，跑不动靠自动降档（用户要求）；`?fps` 看档位和帧率
- [ ] 旋臂星系预览（用户选的 A 方案，要先看预览再决定）：代码在**本地分支 `wip-spiral`**（未推送），开关 `?layout=spiral`，默认仍是 force。待办：旋臂不够明显（可试 twist≈0.085、gap≈6.5、尘埃更宽）、镜头适配偏小偏移；合并前把 camera.phi 改回 1.12。调好后推上去让用户手机看 `ianli.uk/?layout=spiral`
- 暂缓：搬到日本 VPS（用户实测国内第二次访问已经不卡，2026-10-10 决定先不买）。以后若买：根域名 DNS 改动先确认；朋友想要子站时用 VPS 上的 WordPress 多站点（每人单独一条 DNS 记录，不用通配符）
