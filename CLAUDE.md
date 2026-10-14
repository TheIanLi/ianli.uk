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
- 隐私边界（2026-10-13 重定）：不写公司、工作地址、电话、中文名，不点名真人；做事的经过（怎么提需求、否决、验收）可以写。探针不链接探针子域名、不公开服务器列表；sing-box 只写技术层面，不放配置/端口/节点；`repo` 只填自己已公开的非 fork 仓库。
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
parent: bugs               # 可选：挂到另一颗星下面当"下属笔记"。星图上不单独成星，画成绕父节点转的小卫星；只能挂一层
repo: https://github.com/TheIanLi/xxx   # 可选，只填已公开的仓库
```
图片放在 md 旁边，用 `![说明](./图片.png)` 引用，构建时自动压缩。
links/parent 写了不存在的 slug 会**直接构建失败**并提示是哪个文件。

在星图里读文章（阅读层）：点"阅读全文"、卡片里的下属笔记、搜索里的下属笔记，都不离开首页，文章用同源 iframe 盖在星图上（`src/starmap/reader.ts`），星图暂停渲染；地址栏用 pushState 变成文章地址，文章页一侧的配合脚本在 `src/layouts/Base.astro`（报告换页、把"返回星图"和 Esc 变成关闭这一层）。关掉后落到最后读的那篇对应的节点上。直接打开 `/n/<slug>/` 的人看到的仍是独立文章页。
阅读层的两处提速（2026-10-13，都是为了不卡在"浏览器头一回排汉字很慢"上）：选中一颗星 `CONFIG.ui.readerPreload` 秒后，在后台把它的文章预载进一个全透明的 iframe，并把页面一块块分开排版（一次排完会把星图卡住半秒），点"阅读全文"时直接显示；关掉后那一页留着，再点开是原来读到的位置。`hud/Panel.tsx` 的 `PanelWarm` 在加载画面期间把所有卡片的字隐形排一遍，之后点星的第一帧不再花 200 多毫秒排版。

从独立文章页回星图（点"返回星图"或浏览器后退）：不重播开场，恢复离开前的画面（镜头、选中的节点、节点位置）。离开时存进 sessionStorage，回来时读（`src/starmap/resume.ts`，入口在 `StarMap.tsx` 的 `resumeView()`）；手动刷新、从站外进来、点"重放开场"照常播。

下属笔记（写了 `parent` 的）：不进星图的节点和连线（`src/lib/graph.ts` 的 `starGraph()` 过滤），编号跟父节点走（N-19.1、N-19.2…）；在父节点的卡片里列在"收录"下，搜索能搜到（选中直接去文章页），2D 列表里缩在父节点下面，文章页顶部有面包屑。卫星的大小、轨道、亮度在 `CONFIG.moons`，画法在 `src/starmap/scene/Moons.tsx`。

写署名 Ian 的正文：先读本机的写作规则 `voice.md`（不在仓库里），动笔前问他那三个问题；不直接引 Ian 的原话（多是语音输入，他嫌观感不好），润色成转述再写进去，也不要标"原话"；草稿写在本地分支上，Ian 在本地预览里看过、说"可以发"才合并到 main 推送（公开仓库加搜索引擎缓存，发出去收不回来）。

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
- 从 WSL 用真显卡测（2026-10-13 试通）：启动 Windows 的 `chrome.exe --headless=new --remote-debugging-port=9333 --user-data-dir=<Windows 临时目录> --force-device-scale-factor=1.5 --window-size=1707,960`，
  再用 playwright-core 的 `connectOverCDP('http://127.0.0.1:9333')` 连上去（要设 `NO_PROXY=127.0.0.1`）；本地预览 `127.0.0.1:4322` 它能直接打开。
  不要调 `setViewportSize`（会把缩放重置成 100%）。卡顿原因用 `long-animation-frame` 和 `devtools.timeline` 跟踪看。用完用 CDP 的 `Browser.close` 关掉
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
- [x] 内容第一篇（2026-10-13）：`site` 节点写成建站经过的主线（按时间顺序，Ian 的口吻）。方向定为公开知识库：节点一个个填实。后续：朋友小站单独开一颗新星（只写技术、不放链接、不提朋友是谁）；几篇短的坑笔记连到主线。短笔记多了星图会挤（星图还不认 `parent`，文章页已支持），到时再定它们在星图上怎么显示
- [x] 报错及 bug 合集（2026-10-13）：`bugs` 一颗星 + 五条下属笔记（每条约 900 字：原话、排查经过、出问题的代码、时间线）。星图支持 `parent`：下属笔记画成小卫星。写每条之前回去核对记录和一手来源（这次核出主线里"iPhone 一律报 2 核"是过时说法，WebKit 现在是不到 8 核报 4）
- [x] 阅读层与手感（2026-10-13）：文章盖在星图上读（a1c74d1）；点星和开文章提速（c5b2cd0：卡片文字提前排版、文章后台预载并分块排版）。用真显卡实测过，数字见 c5b2cd0 的提交说明
- [x] 内容：给 no-mistakes 提的 PR（2026-10-14）：新星 `no-mistakes-pr`，约 2500 字。6 月的事 Claude Code 这边已无记录，材料来自 GitHub 上的 PR 页面、仓库提交和 Ian 另一个助理的历史记录；Ian 自己也记不清细节，所以只写核对得上的，记不清的地方照直写"记不清"。作者的名字是 Ian 点头后写的，仅这一篇。后续排的是 Agent 配置快照
- [x] 内容：Agent 配置快照（2026-10-14）：改写已有节点 `agent-config-snapshot`，status 改为 old（不再维护），约 1500 字。使用次数以工具自己的 `~/.agent-snapshots/store/index.jsonl` 为准（7/24–9/18 共 39 次，回滚 0 次），不是凭印象。后续排的是自建线路（红线多，写多细先问 Ian）
- [x] 内容：VPS 买机记录（2026-10-14）：改写已有节点 `vps`，标题"VPS：为了用上 AI，我变成了 MJJ"，约 5300 字，按时间线从机场写到现在的中转加落地。商家名可以写；IP、端口、绕地区限制和防封号的做法不写。第一稿写得太短、丢了 6、7 月的材料，被 Ian 退回重写过一次；他说"写的一般，勉强能上"，嫌我对他的经历了解不够。后续排的是短 bug 笔记（SSH 卡 KEXINIT、Claude Code 更新 socket hang up）
- [x] 两条 bug 笔记（2026-10-14，Ian 说写完直接发、他读了再提意见）：`ssh-kexinit-stall`、`claude-code-update-hang-up`，都挂在 bugs 下。材料是 9/21、9/24 的 Claude Code 记录和渡鸦库里 9/12 的对话；写的时候当场复测了更新：现在 TUN 开着，去掉代理环境变量才更新成功，跟 9 月"更新程序不走代理"的结论相反。扫描会把带 @openssh.com 后缀的算法全名当邮箱拦下来。后续：渡鸦、Memory Bridge、LLM-Net-Probe
- [ ] 手感遗留（2026-10-13 停在这里，Ian 2026-10-14 说以后再调，先填内容）：
  - 画质和流畅度的取舍：4060、2560×1440、150% 缩放下星图平时约 64 帧、飞行时约 45 帧，他的屏幕是 165Hz。已请他对比 `?tier=mid&fps`；他说要调才动默认档位（之前他定的是"高档位画质不变"）
  - 每次进首页后第一次点星有一次约 0.5 秒的停顿，主线程是空的，卡在显卡侧；猜是选中特效的着色器首次编译，没查实
  - 关文章时还有几帧 30–65 毫秒的小顿挫；点星那一下 React 渲染占 70–90 毫秒，都没处理
  - 卫星（下属笔记）的速度、大小、亮度（`CONFIG.moons`）他还没给反馈
- 暂缓：搬到日本 VPS（用户实测国内第二次访问已经不卡，2026-10-10 决定先不买）。以后若买：根域名 DNS 改动先确认；朋友想要子站时用 VPS 上的 WordPress 多站点（每人单独一条 DNS 记录，不用通配符）
