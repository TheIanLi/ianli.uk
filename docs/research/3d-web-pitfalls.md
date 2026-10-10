# 3D 星图首页：常见坑、卡顿原因与对策（调研）

> 调研日期：2026-10-10。对照版本：three 0.186.1 · @react-three/fiber 9.8.1 · @react-three/drei 10.7.9 · @react-three/postprocessing 3.1.3 · postprocessing 6.39.5（版本号取自 `node_modules/*/package.json`）。
>
> 来源标记：**【官方】** = 官方文档 / 规范 / 库源码；**【作者】** = 库作者或维护者在 issue 里的回答；**【未核实】** = 只找到二手资料，或是经验判断，没有一手来源。
> 引用库源码时写的是本机 `node_modules` 里的路径，和上面的版本完全一致。

---

## 结论摘要（最重要的 10 条，按重要程度排序）

1. **最大的 GPU 开销是"要画多少像素"。** 像素比（dpr）每升一级，像素数按平方增长，后期每一遍也跟着变贵。所以先给 dpr 设上限，再考虑别的优化。R3F 默认的 dpr 是 `[1, 2]`，MDN 建议画到更小的缓冲区再放大。[来源](https://r3f.docs.pmnd.rs/api/canvas) · [来源](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
2. **逐帧的东西不要走 React。** 不要在 `useFrame` 里 setState，在里面直接改 ref；不要每帧 new 对象（会给垃圾回收添负担）；快速变化的状态用 `getState()` 读，不要订阅。[来源](https://r3f.docs.pmnd.rs/advanced/pitfalls)
3. **首屏"卡一下"多半是着色器编译。** 用 `renderer.compileAsync`，它在支持 `KHR_parallel_shader_compile` 的浏览器上可以不阻塞地轮询编译状态。但 Safari（ANGLE Metal 后端）上"链接"这一步仍然会卡住主线程，所以动画开始前要留一个预热门槛。[来源](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/) · [来源](https://bugs.webkit.org/show_bug.cgi?id=251514)
4. **动画进度要按时间算，不要按帧数算。** 按帧数算，在 120/144Hz 屏上会快一倍。开场这类"不能被跳过"的时间轴，适合用"每帧累加、单帧有上限"的时钟。[来源](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) · [来源](https://r3f.docs.pmnd.rs/advanced/pitfalls)
5. **自动降档必须能降到底。** drei 的 `PerformanceMonitor` 默认 `flipflops = Infinity`，也就是说不设这个值，`onFallback` 永远不会触发；而且只有写了 `onIncline`，画质才会回升。[来源](https://drei.docs.pmnd.rs/performances/performance-monitor) · 源码 `node_modules/@react-three/drei/core/PerformanceMonitor.js:7-19`（默认值在 :12）
6. **后期处理的成本按"遍"算。** pmndrs 的 `EffectPass` 会把多个效果合并成一遍，官方推荐用 HalfFloat 缓冲；Bloom 的 mipmapBlur 是先在全分辨率做一遍亮度提取，再逐级降采样和升采样，层数越多遍数越多。用了后期时，画布的 `antialias` 应关掉，改用合成器的 MSAA。[来源](https://github.com/pmndrs/postprocessing) · [来源](https://github.com/pmndrs/postprocessing/wiki/Antialiasing)
7. **叠加混合的粒子 = overdraw（同一像素被反复画）。** 透明物体都要先把下层画出来再混合，开销跟"粒子个数 × 每个粒子覆盖的像素面积"成正比。`gl_PointSize` 会被夹到硬件支持的范围内，规范只保证最大值至少为 1。[来源](https://developer.android.com/topic/performance/rendering/overdraw) · [来源](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)
8. **WebGL 上下文随时可能丢失**（比如移动端的电源事件）。丢失并恢复之后，之前创建的纹理和缓冲全部失效。iOS 上切到后台、内存不足都有真实报告；R3F 维护者给的第一步建议是降低 dpr。[来源](https://registry.khronos.org/webgl/specs/latest/1.0/) · [来源](https://github.com/pmndrs/react-three-fiber/issues/3309)
9. **GPU 资源不会自动释放。** three 的几何体、材质、纹理、渲染目标都要手动调 `dispose()`；R3F 的 `<primitive>` 卸载时也不会帮你释放。[来源](https://threejs.org/manual/#en/how-to-dispose-of-objects) · [来源](https://r3f.docs.pmnd.rs/api/objects)
10. **动效本身就可能让人头晕。** WebKit 官方把"旋转的视差星空""缩放/推镜头"列为前庭敏感的触发源。要跟随 `prefers-reduced-motion`；按 WCAG 2.2.2，自动开始、持续超过 5 秒的动画还要给出暂停手段。[来源](https://webkit.org/blog/7551/responsive-design-for-motion/) · [来源](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

---

## 1. 卡顿的成因分类与排查方法

### 1.1 成因分类

| 类别 | 典型表现 | 一手依据 |
|---|---|---|
| **主线程长任务** | 点击、拖动没反应，或者偶尔一帧特别长 | 超过 50ms 的任务就是长任务，期间浏览器无法响应交互。【官方】[web.dev](https://web.dev/articles/optimize-long-tasks) |
| **JS / GC** | 周期性掉帧（锯齿状） | R3F 官方："Bad news for the GC"，不要在循环里新建对象。【官方】[R3F Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) |
| **React 重渲染** | 交互时整棵树重算 | "❌ setState in useFrame is bad"，"❌ setState in fast events is bad"。【官方】[R3F Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls) |
| **强制同步布局** | 某次点击卡一下（Performance 面板里能看到 Layout 被 JS 触发） | 在 JS 里读布局值（比如 `offsetWidth`），浏览器就得提前做布局，这叫 "forced synchronous layout"。原则是先读后写。【官方】[web.dev](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing) |
| **GPU 填充率 / 像素比** | 全屏大、dpr 高时掉帧；缩小窗口立刻流畅 | "Consider rendering to a smaller back buffer"。【官方】[MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) |
| **片元着色器复杂度** | 镜头拉近某个物体就卡（它占的像素变多了） | "fragment shaders generally run many more times than vertex shaders"，所以能放进顶点着色器的计算尽量放进去。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) |
| **透明叠加 / overdraw** | 粒子密集处、光晕叠在一起时卡 | 透明像素要求下层先画好再混合，是 overdraw 的主要来源（Android 官方以 UI 为例解释了这个原理，GPU 层面同理）。【官方】[Android](https://developer.android.com/topic/performance/rendering/overdraw) |
| **后期处理** | 开辉光就掉帧 | 每个效果、每一层模糊都是一遍全屏绘制，见第 3 节。 |
| **首帧着色器编译** | 第一次出现某个物体时卡几十到几百毫秒 | 见 1.3。 |
| **纹理上传** | 第一次显示大贴图时卡 | `initTexture` 可以提前上传，"rather than waiting until first render (which can cause noticeable lags due to decode and GPU upload overhead)"。【官方】源码 `three/src/renderers/WebGLRenderer.js:3590-3595` |
| **同步查询 GPU** | 每次调用都卡 | `getError`、`getParameter` 会让调用线程同步等待，"can take as long as 1ms"，主线程上可能拖累整个页面。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) |

### 1.2 排查方法（按顺序做）

1. **先看是 CPU 还是 GPU。** 把窗口缩小到四分之一，如果明显变流畅，就是 GPU 像素量的问题（填充率、后期、overdraw）；没变化就是 CPU（JS、React、布局）。【未核实/经验】这是业界常用的二分法，没有找到一篇官方文章专门写它；依据是 MDN"画小缓冲区"那条的反向推论。
2. **Chrome DevTools → Performance 录制。** 看 Main 轨道里的长任务、Layout（是否被 JS 强制触发）、GC；看 GPU 轨道的占用；看 Frames 轨道每帧耗时；可以开 CPU 降速模拟低端机，官方提醒这种降速"不能真正模拟手机 CPU"。【官方】[DevTools Performance reference](https://developer.chrome.com/docs/devtools/performance/reference)
3. **DevTools → Rendering 面板：** Paint flashing（重绘的区域闪绿色）、Layer borders（显示合成层边界）、FPS 计数。【官方】[Rendering tab](https://developer.chrome.com/docs/devtools/rendering/performance)
4. **`renderer.info`：** `render.calls / triangles / points` 是每帧的绘制统计，`memory.geometries / textures` 是常驻 GPU 的资源数，`programs` 是着色器程序数。【官方】源码 `three/src/renderers/webgl/WebGLInfo.js:5-64`。注意：有后期处理时一帧会渲染很多次，要设 `info.autoReset = false` 再手动 reset，本项目 `scene/PerfStats.tsx:8-12` 已经这么做了。
5. **Spector.js：** 抓一帧，看完整的 WebGL 命令列表和每条命令的状态，适合查"这一帧到底画了多少遍、哪一遍最大"。【官方】[Spector.js](https://github.com/BabylonJS/Spector.js)
6. **资源泄漏：** 反复做同一个操作，看 `renderer.info.memory` 和 `programs` 的数字是否只增不减。
7. **真机测量。** 本项目 CLAUDE.md 已写明：WSL 里的无头 Chrome 是软件渲染，帧率不可信。帧率要在真机上用 `?fps` 看。

### 1.3 首帧着色器编译与纹理上传

- `KHR_parallel_shader_compile` 提供 "a non-blocking poll operation"，可以查询 `COMPLETION_STATUS_KHR` 而不卡住；规范建议 "Never check compile status unless subsequent linking fails"。【官方】[Khronos 扩展规范](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)
- three 的 `compileAsync(scene, camera, targetScene)` 内部先调用同步的 `compile()`，然后每 10ms 轮询 `program.isReady()`。没有这个扩展时，`isReady()` 直接返回 true，于是第一次真正使用时可能还是会卡。【官方】源码 `three/src/renderers/WebGLRenderer.js:1515-1590`、`webgl/WebGLProgram.js:992-1003`
- `compile()` 遍历材质用的是 `scene.traverse`，不是 `traverseVisible`，所以隐藏物体的材质也会被编译。【官方】源码 `WebGLRenderer.js:1456-1497`
- **着色器变体和渲染目标有关。** 色调映射、输出色彩空间取决于当前画到哪里（屏幕还是离屏缓冲），所以要在后期管线的输入缓冲上编译，编出的才是真正会用到的版本。本项目 `scene/Scene.tsx:66-70` 已经这么做了。
- **Safari 例外：** WebKit bug 251514 "KHR_parallel_shader_compile does not allow for shader compilation without blocking"，仍是 NEW 状态。WebKit 的 WebGL 工程师 Kimmo Kinnunen 的解释是 "parallel linking is not yet implemented in ANGLE Metal backend"。【作者】[WebKit 251514](https://bugs.webkit.org/show_bug.cgi?id=251514)。所以在 iPhone 上，预编译本身就是一个长任务，只能靠"预热完成前不开始动画"来掩盖。
- `renderer.debug.checkShaderErrors` 默认是 true。three 的注释写着 "It may be useful to disable this check in production for performance gain"，它在第一次使用程序时会做同步查询。【官方】源码 `WebGLRenderer.js:160-195`、`webgl/WebGLProgram.js:866-900`

---

## 2. R3F 官方性能建议逐条对照

来源：[Scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)、[Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)、[Hooks](https://r3f.docs.pmnd.rs/api/hooks)。全部是【官方】。

| # | 官方建议 | 本项目现状 |
|---|---|---|
| 1 | 不在 `useFrame` 或快速事件里 setState（"You should never setState in there!"） | ✅ 基本做到。`Scene.tsx:164-165` 只在开场走到某个时刻时 setState 一次（hudIn / nameIn）。`hud/Hud.tsx:24` 的标题解码在 0.7 秒内每帧 setText，组件很小，影响低。 |
| 2 | 逐帧变化用 ref 直接修改（"Fast updates are carried out in useFrame by mutation"） | ✅ `world.ts` 整体是可变对象，标签直接改 `style`（`Scene.tsx:400-406`）。 |
| 3 | 用 delta，不要用固定步长 | ✅ `Scene.tsx:148` 把 dt 夹在 0.1 以内；`world.ts` 的 `damp()` 与帧率无关；模拟用固定步频累加器（`Scene.tsx:178-188`）。⚠️ 例外：`hud/NameDust.tsx:159-162` 的星尘物理按帧步进，没有用 dt（见检查清单）。 |
| 4 | 不要每帧新建对象 | 🟡 大部分做到了（共享 `v3`、`tmp`）。剩下的小分配：`Edges.tsx:103,132` 每帧新建闭包，`Starfield.tsx:334` 每帧展开数组，`Intro.tsx:97,107` 每帧建数组字面量。量都不大。 |
| 5 | 快速状态不要响应式订阅，在循环里用 `getState()` | ✅ `useUI.getState()` 在所有 useFrame 里使用。 |
| 6 | 少挂载/卸载（"think twice before you mount/unmount things!"），用 `visible` 切换 | ✅ 冲击波、涟漪、拖尾都用 `visible` 切换（`ring.ts` 的 `setRing`）。⚠️ 档位 `tier` 一变，所有 `useMemo([tier])` 都会重建（见检查清单 H1/M7）。 |
| 7 | 共享几何体和材质 | 🟡 贴图已缓存（`textures.ts`）。每个天体有各自的着色器材质（uniform 不同），节点只有 19 个，可以接受。 |
| 8 | 实例化（"optimally a few hundred or less" 个网格） | ✅ 粒子都是 `Points`。按代码粗算，每帧约 90 次绘制 + 后期约 17 遍，在官方建议范围内。 |
| 9 | 按需渲染 `frameloop="demand"` + `invalidate()` | ❌ 没用（默认 `always`）。这个场景空闲时也在自动旋转、闪烁，按需渲染收益有限；但可以在空闲、面板打开时降帧（见检查清单 M1）。 |
| 10 | `PerformanceMonitor` 根据平均帧率调画质；用 `flipflops` + `onFallback` 设保底 | 🟡 用了，但没设 `flipflops`，所以 `onFallback` 永远不会触发；没有 `onIncline`（`StarMap.tsx:338-345`）。见检查清单 H1。 |
| 11 | AdaptiveDpr / 运动时降画质（regress） | ❌ 没用。drei 的 `AdaptiveDpr` 在 regress 时降低像素比，比如镜头移动时。【官方】[drei AdaptiveDpr](https://drei.docs.pmnd.rs/performances/adaptive-dpr)。本项目飞行时间短，可以不做。 |
| 12 | 昂贵操作用 `startTransition` | 不适用（没有昂贵的 React 状态更新）。 |
| 13 | `useFrame` 传入正优先级就会接管渲染（"disable automatic rendering altogether"） | ✅ 渲染由 EffectComposer 接管（renderPriority 1）；Driver 用 -10 保证最先执行。 |

---

## 3. 后期辉光（pmndrs postprocessing）

**机制（读源码得出，【官方】）**

- `@react-three/postprocessing` 的 `EffectComposer` 默认 `multisampling = 8`、`frameBufferType = HalfFloatType`、`mergeMode = "auto"`（`node_modules/@react-three/postprocessing/dist/index.js:332`）。
- **合并成一遍：** `buildPasses` 会把相邻的 Effect 塞进同一个 `EffectPass`，只有遇到"卷积类 + 卷积类"或"卷积类 + 用到 mainUv 的效果"才拆开（`dist/index.js:305-330`；文档描述见 [EffectComposer](https://react-postprocessing.docs.pmnd.rs/effect-composer)）。README 原话："automatically organizes and merges any given combination of effects … minimizes the amount of render operations"。[来源](https://github.com/pmndrs/postprocessing)
  - 本项目的 Bloom + ToneMapping + Vignette 都不是卷积类，也都不用 mainUv，所以合并成**一个**最终 pass。Bloom 自己的模糊在它的 `update()` 里单独进行，不算进这个 pass。
- **Bloom 的 mipmapBlur 流程：** LuminancePass 在**全分辨率**提取亮部（`resolutionScale = 1`）→ MipmapBlurPass 做 N 级降采样（每级尺寸减半）和 N-1 级升采样（`node_modules/postprocessing/build/index.js:3946-4105`、`3709-3730`、`4330-4360`）。所以 `levels = 8` 大约是 1 + 8 + 7 = 16 次绘制，不过后面几级很小。BloomEffect 的 `resolutionScale = 0.5` 只对旧的 Kawase 模糊有效，对 mipmapBlur 无效（`build/index.js:4106-4160`）。
- **HalfFloat：** README 写道 "Linear, high precision HalfFloatType buffers … are the preferred option"（可以避免暗部色带）。代价是每像素显存比 8 位缓冲多一倍。【官方】[README](https://github.com/pmndrs/postprocessing)
- **抗锯齿：** 用了后期时，画布自带的 antialias "has no effect"，官方建议关掉，改用 EffectComposer 的 `multisampling`（MSAA，需要 WebGL2）。原话 "MSAA provides high quality antialiasing at low computational cost"，但和基于深度的效果一起用可能出伪影。【官方】[wiki: Antialiasing](https://github.com/pmndrs/postprocessing/wiki/Antialiasing)
- **色调映射：** 渲染器的 `toneMapping` 应设为 `NoToneMapping`，改在管线末尾用 `ToneMappingEffect`。【官方】[README](https://github.com/pmndrs/postprocessing)
- **MSAA 不受支持时：** 6.39.5 才加了"`renderbufferStorageMultisample` 不可用时回退到 0"的保护。【作者】vanruesc 在 [#749](https://github.com/pmndrs/postprocessing/issues/749) 里确认 "Fixed in v6.39.5"。本项目正好用的是 6.39.5。

**开销（粗估，【未核实/经验】，需要真机测）**

- 只在开辉光时：MSAA 缓冲的显存 ≈ 画布像素 × 采样数 × 8 字节（RGBA16F），另加深度缓冲。手机 dpr 2 时，画布约 0.8k×1.8k，MSAA 4 采样仅颜色就约 48MB。
- 层数（levels）对柔和度的影响越到后面越小，在中低档位减少层数是性价比最高的降级手段之一。本项目已经这么做（mid 6 层，low 关辉光）。

**本项目对照：** `Scene.tsx:87-112` 和 `config.ts:226-231` 与官方推荐一致：开辉光时 `antialias=false`（`StarMap.tsx:334`）、mipmapBlur、渲染器 NoToneMapping、末尾 ToneMapping、档位控制 MSAA 和层数。

---

## 4. 大量粒子 / 点精灵

- **Points vs InstancedMesh：** `InstancedMesh` 用于大量"同几何、同材质、不同变换"的网格，作用是减少绘制次数。【官方】源码 `three/src/objects/InstancedMesh.js` 的 jsdoc。点精灵永远是面向屏幕的正方形，最便宜，适合星点和尘埃；如果需要真正的 3D 形状或拉长的拖尾，才用 InstancedMesh。【未核实/经验】
- **`gl_PointSize` 上限：** OpenGL ES 3.0 规范 §3.4 原话："clamped to the implementation-dependent point size range … The maximum point size supported must be at least one."【官方】[ES 3.0 spec](https://registry.khronos.org/OpenGL/specs/es/3.0/es_spec_3.0.pdf)。MDN 说实际上几乎所有设备都至少支持 `ALIASED_POINT_SIZE_RANGE: [1,100]`。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)。所以单个点不要指望超过约 100 物理像素；大光晕要用面片（Sprite / Plane）。
- **叠加混合的 overdraw：** 成本 ≈ 粒子数 × 每个粒子覆盖的像素数 × 片元着色器开销。控制办法：给点大小设上限（夹到几像素）；片元着色器里 `discard` 掉几乎透明的像素（省的是混合带宽，片元着色器本身仍然要跑）；不要用大面积的叠加面片层层堆。【未核实/经验】原理依据见 [Android overdraw](https://developer.android.com/topic/performance/rendering/overdraw)。
- **位置在着色器里算 vs CPU 写缓冲：** 能用公式表达的运动（自转、闪烁），放在顶点着色器里算，CPU 每帧只改一个 `uTime` uniform，不用上传数据。MDN 也建议 "Do as much work as you can in the vertex shader"。【官方】需要和 CPU 逻辑交互的（比如力导向布局）才每帧写缓冲，写完设 `needsUpdate`，并且不要每帧重新分配数组。
- **本项目：** AI 星系 `bodies.ts:145-156` 的位置在着色器里算，点大小夹到 `[0.6, 4] × dpr`（`bodies.ts:154`）✅；星空闪烁和鼠标拨动也在着色器里（`Starfield.tsx:10-50`）✅；连线每帧写约 420 段 × 12 个浮点数（`Edges.tsx:173-182`），数据量很小 ✅。数量：高档位 6 个 AI 节点 × 7000 粒子 = 42,000 个叠加点，加约 6,300 颗星和 900 粒尘埃（`config.ts:43,180-190`）。点都很小，问题不大，主要成本在镜头拉近、粒子在屏幕上变大的时候。

---

## 5. 移动端与低端设备

- **dpr 上限：** R3F 的 Canvas 默认 `dpr = [1, 2]`。【官方】[Canvas](https://r3f.docs.pmnd.rs/api/canvas)。iOS 上下文丢失的 issue 里，R3F/three 维护者 CodyJasonBennett 的第一建议是 "You should try lowering DPR as a first step"，并判断这类错误是 "an OS level error from the GPU device being lost or OOM"。【作者】[R3F #3309](https://github.com/pmndrs/react-three-fiber/issues/3309)
- **发热降频：** Web 端没有直接的温度 API。Chrome 的 Compute Pressure API 目前只提供 `"cpu"` 压力源，文档说将来可能加入 "thermals"。【官方】[Compute Pressure](https://developer.chrome.com/docs/web-platform/compute-pressure)。所以实际能做的是：持续监测帧率，掉了就降档；空闲时降低渲染频率。另外，rAF 的频率跟显示器刷新率一致（60/120/144Hz）。【官方】[MDN rAF](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)。所以 120Hz 手机上 GPU 每秒的工作量是 60Hz 的两倍。
- **iOS Safari / WebKit 的已知问题：**
  - iPadOS 17 beta 切到后台后 "WebGL: context lost"，被标为 ANGLE bug 261313 的重复，已修复。【官方】[WebKit 261331](https://bugs.webkit.org/show_bug.cgi?id=261331)
  - 在 three.js 页面之间跳转时上下文丢失，WebKit 的 Kimmo Kinnunen 判断 "Seems to be out of memory error"，至今仍是 NEW。【作者】[WebKit 290623](https://bugs.webkit.org/show_bug.cgi?id=290623)
  - Safari 对同时存在的上下文数量有上限。drcmda（R3F 作者）的说法："there is only a fixed amount of canvases you can create … keep one instance"。【作者】[R3F #2456](https://github.com/pmndrs/react-three-fiber/issues/2456)
  - **iOS 的 WebGL 显存/内存上限没有官方数字。【未核实】** MDN 也说 WebGL 不提供查询显存的 API，"applications must be conscious of VRAM usage"。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
- **上下文丢失的处理（规范）：** 规范原话 "power events on mobile devices may cause the WebGL rendering context to be lost at any time"。只有在 `webglcontextlost` 事件里调用了 `preventDefault()`，上下文才可能恢复；恢复后，"resources such as textures and buffers that were created before … are no longer valid"。【官方】[WebGL 1.0 spec](https://registry.khronos.org/webgl/specs/latest/1.0/)。three 的 `WebGLRenderer` 已经自动 `preventDefault()`，恢复时会重建内部状态，几何体和普通纹理会在下次渲染时重新上传（源码 `WebGLRenderer.js:403-404,1113-1140`）。但**渲染到纹理里的内容**（比如本项目烘焙的星云）会丢失，需要自己重画。测试方法：用 `WEBGL_lose_context.loseContext()` 模拟。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event)
- **标签页切到后台：** "Most browsers stop sending requestAnimationFrame() callbacks to background tabs"，后台的 `setTimeout` 也会被节流。【官方】[MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)。回到前台后的第一帧 delta 会很大，所以要夹住 dt（本项目已经夹到 0.1）。
- **prefers-reduced-motion：** 用来检测用户是否开启了"减少非必要动效"。【官方】[MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
- **`powerPreference: 'high-performance'`：** 双显卡笔记本上会唤醒独显，更耗电。规范也说浏览器会用上下文丢失/恢复来调节功耗和内存，"regardless of the value of this attribute"。【官方】[WebGL spec](https://registry.khronos.org/webgl/specs/latest/1.0/)

---

## 6. 首屏加载

- **现状（从 `dist/` 现有的构建产物量出）：** `StarMap.*.js` 原始 1.2MB，gzip 后约 335KB；`client.*.js`（React）gzip 后约 64KB。这些是 `ls dist/_astro` + `gzip -c | wc -c` 得出的，构建时间 2026-10-10 14:20。总量在项目 600KB 的软上限内。
- **代码分割：** Astro 的 `client:only` 跳过服务端渲染、只在浏览器渲染；`client:visible`、`client:idle` 可以推迟加载。【官方】[Astro directives](https://docs.astro.build/en/reference/directives-reference/)。首页本身就是 3D，所以推迟加载 3D 意义不大。真正的成本是低端手机解析和执行 1.2MB JS 产生的长任务，以及 `useMemo` 里一次性生成几万个粒子的属性。【未核实/经验】
- **占位与过渡：** 加载期间显示一个呼吸光点（`pages/index.astro` 里的 `#sm-loader`），15 秒还没就绪就显示 2D 列表（`index.astro:19`）✅。不支持 WebGL 时保留 2D 列表 ✅。
- **字体：** Syne 裁剪到 3.5KB 并内嵌进 CSS，`NameDust` 用 `document.fonts.load` 等字体就绪再采样（`hud/NameDust.tsx:181`）✅。
- **动画被首帧卡顿"吃掉"：** 按现实时钟推进时，卡住的 500ms 一过，动画直接跳到 500ms 之后。R3F 官方只要求用 delta（[Pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls)）；"单帧推进量设上限 + 等预热完成"是在这个基础上的工程做法。本项目 `Scene.tsx:155-162` 已实现：编译完成并连续 6 帧流畅后才开始，单帧最多推进 1/30 秒，4 秒兜底 ✅。注意它只管开场，飞行和涟漪仍然用现实时钟 `performance.now()`（`world.ts:101`，`Scene.tsx:253-279`）。

---

## 7. DOM 叠加层（标签、HUD）与 WebGL 混用

- **只改合成属性：** "only two properties … `transform`s and `opacity`" 能只在合成阶段完成，不触发布局和重绘。`will-change` 可以提升图层，但 "every layer you create requires memory and management"，"Do not promote elements unnecessarily"。【官方】[web.dev](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)
- **先读后写：** 每帧都在写 style 的页面上，读一次 `offsetWidth` 就会强制整页同步布局。【官方】[web.dev](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)。本项目 2i 阶段改用 `ResizeObserver`（`hud/Panel.tsx:96-116`）就是在修这个 ✅。
- **backdrop-filter：** 规范定义它要把元素后面的内容（Backdrop Root Image）复制到临时缓冲，再做滤镜、合成。【官方】[Filter Effects 2 §2.1](https://drafts.csswg.org/filter-effects-2/)。WebGL 画布每帧都在变，所以模糊也要每帧重做。"面积越大越贵"这类量化说法只在二手资料里找到。【未核实】本项目默认关闭（`config.ts:235`，`starmap.css:181-191`）✅。
- **2D canvas 叠加层：** MDN 建议 "Batch canvas calls together"、"Avoid unnecessary canvas state changes"；`getImageData` 频繁读回时用 `willReadFrequently`（它会强制使用软件渲染的 2D 画布）。【官方】[MDN Optimizing canvas](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) · [MDN getContext](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext)
- **合成层数量：** 每个标签都有 `will-change: transform, opacity`（`starmap.css:147`），19 个没问题；节点涨到几百个时要重新评估。【官方】依据同上 web.dev。

---

## 8. 设计层面的常见坑（星系 / 星图首页）

| 坑 | 依据 | 性质 |
|---|---|---|
| **动效致晕**：旋转星空、多层视差、缩放推镜头 | WebKit 列出的前庭敏感触发源包括 "Scaling and Zooming"、"Spinning and Vortex Effects"（举的例子正是 "Spinning Parallax Starfield"），也说可以保留用户直接操控的效果（比如捏合缩放）。[WebKit](https://webkit.org/blog/7551/responsive-design-for-motion/)。NN/g：视差 "can even cause people to feel sick"，并以 iOS 7 加入"减弱动态效果"为例。[NN/g](https://www.nngroup.com/articles/parallax-usability/) | 官方经验 + 研究机构 |
| **自动播放的持续动画** | WCAG 2.2.2（A 级）：自动开始、持续超过 5 秒、与其他内容同时呈现的移动内容，要有暂停、停止或隐藏的手段 | 规范 |
| **交互触发的动画** | WCAG 2.3.3（AAA 级）：交互触发的动画应能关闭 | 规范 |
| **闪光** | WCAG 2.3.1（A 级）：1 秒内闪烁不超过 3 次。开场只爆闪一次，符合 | 规范 |
| **文字对比度** | WCAG 1.4.3（AA 级）：普通文字至少 4.5:1，大字至少 3:1。星空背景上的半透明小字最容易不达标 | 规范 |
| **可点性 / 可发现性** | NN/g 眼动实验：信号弱的界面（看不出能点）让用户找目标的时间多 22%，而且不确定。[NN/g](https://www.nngroup.com/articles/flat-ui-less-attention-cause-uncertainty/)。星图上的"星星能点吗"属于同类问题，需要悬停反馈和明确的操作提示 | 研究机构 |
| **动效用于吸引注意时要考虑频率** | NN/g："consider its goal, its frequency of occurrence, and its mechanics"。[NN/g](https://www.nngroup.com/articles/animation-usability/) | 研究机构 |
| **信息过载 / 眩光** | 辉光、星云、粒子都在争夺注意力；把非焦点元素压暗（本项目 dimOthers）、连线默认很暗，是常见做法 | 经验【未核实】 |
| **标签重叠** | 按优先级贪心放置、碰撞的就隐藏、加滞回防闪烁，是常见做法 | 经验【未核实】；本项目 `Scene.tsx:371-407` 已实现 |
| **读屏 / 键盘** | 3D 画布对读屏器是一张图。要保留一份文本版的节点列表（可以视觉隐藏），保证键盘能走完所有功能 | 经验；WCAG 2.1.1（键盘可操作）是规范 |

---

## 9. 长期稳定性

- **dispose：** three 文档原话 "these objects are not released automatically"。几何体、材质、纹理、`WebGLRenderTarget` 都要 `dispose()`。【官方】[three manual](https://threejs.org/manual/#en/how-to-dispose-of-objects)
- **R3F 的 primitive：** "Primitives will not dispose of the object they carry on unmount, you are responsible for disposing of it!"【官方】[R3F Objects](https://r3f.docs.pmnd.rs/api/objects)。源码注释："Never dispose of primitives because their state may be kept outside of React!"（`node_modules/@react-three/fiber/dist/events-9ce18a08.esm.js:16661-16668`）。用 JSX 写的 `<mesh>`、`<meshBasicMaterial>` 卸载时才会被自动释放。
- **Canvas 本身不要反复挂载/卸载：** 上下文数量有限，见 drcmda 在 [#2456](https://github.com/pmndrs/react-three-fiber/issues/2456) 的回答。【作者】
- **上下文丢失恢复：** 见第 5 节。另外要考虑**永远恢复不了**的情况（比如浏览器拒绝恢复），这时应该退回 2D。
- **错误边界的盲区：**
  - 着色器编译失败时 three 只打印错误，"it will not work and associated material will not render"，不会抛异常。【官方】源码 `WebGLRenderer.js:160-170`、`webgl/WebGLProgram.js:866-900`。可以用 `renderer.debug.onShaderError` 接管。
  - R3F 的渲染循环在调用每个 useFrame 时没有 try/catch，下一帧的 rAF 已经在循环开头登记了（`events-9ce18a08.esm.js:17413-17416,17430-17431`）。所以某个 useFrame 抛错时，排在它后面的回调和本帧渲染会被跳过，而且每帧都会重复报错。画面会冻结，但 React 错误边界抓不到（它只抓渲染阶段的错误）。【官方】依据是源码阅读，这个推论没有官方文档。
- **HMR：** 模块级缓存（比如 `textures.ts` 的 `cache`、`Starfield.tsx` 的 `SHARED` uniform）在热更新时可能保留旧对象，只影响开发环境。【未核实/经验】

---

## 本项目对照检查清单

> 只列读代码确实看到的情况；行号以 2026-10-10 的工作区为准。风险：高 = 用户可见的严重问题（黑屏、卡死、降不下去）；中 = 某些设备或场景下明显变差；低 = 改了更好。

### 高风险

| 检查项 | 本项目现状（文件:行号） | 风险 | 建议改法 |
|---|---|---|---|
| H1 自动降档能否降到底 | `StarMap.tsx:338-345` 的 `<PerformanceMonitor>` 没传 `flipflops`。drei 默认 `flipflops = Infinity`（`node_modules/@react-three/drei/core/PerformanceMonitor.js:12`），只有 `flipped > flipflops` 才会调 `onFallback`（同文件 :76-80）。所以 `setTier('low')`（`StarMap.tsx:342`）**永远不会执行**。实际效果：最多把 dpr 降到 1，辉光、MSAA、粒子数降不下来；也没有 `onIncline`，dpr 降了就不会回升。 | 高 | ① 自己在 `onDecline` 里计数，dpr 已经是 1 还在 decline，就关辉光，或者把 `bloomLevels` 和 MSAA 调小；也可以按官方示例传 `flipflops={3}`。② 降档尽量"改参数"而不是"换 tier 重建场景"（重建会重新编译、重新生成，还会泄漏，见 M7）。③ 加 `onIncline`，在一定范围内允许回升。 |
| H2 WebGL 上下文丢失 | 全项目没有 `webglcontextlost` / `webglcontextrestored` 监听（grep 结果为空）。`Fallback` 错误边界（`StarMap.tsx:20-32`）只抓 React 渲染错误。星云只烘焙一次：`baked` 标志置 true 后烘焙材质就被 dispose（`Starfield.tsx:236-250`），恢复后星云纹理内容丢失、无法重画。 | 高（移动端，尤其 iOS） | 在 `Canvas onCreated` 里给 `gl.domElement` 加监听：丢失时显示提示或移除 `has-3d` 退回 2D 列表；恢复时重置 `baked`，保留烘焙材质以便重画（或者直接给 Scene 换个 key 重建）；如果几秒内没恢复，就保持 2D。用 `WEBGL_lose_context` 自测。 |

### 中风险

| 检查项 | 本项目现状（文件:行号） | 风险 | 建议改法 |
|---|---|---|---|
| M1 手机上的档位与持续发热 | `device.ts:36-49`：`deviceMemory` 不可用时按 8 算（:41），触屏设备只要内存不低于 6GB 且至少 8 核就判为 high。Chrome 报告的 `deviceMemory` 最高就是 8（这一点【未核实】），所以 vivo X100 这类 8 核旗舰**推断**会落到 high：dpr 2 + MSAA 4 + HalfFloat + 8 层辉光 + 7000×6 粒子（`config.ts:43,228`）。Canvas 没设 `frameloop`（默认 always，`StarMap.tsx:331-337`）：空闲、打开卡片时也满帧渲染，120Hz 屏上就是每秒 120 帧。 | 中 | ① 触屏设备最高只给 mid，或者给手机单独一档"high-mobile"（MSAA 0、6 层）。② 空闲（自动旋转期间）或卡片打开时降到约 30fps：可以切到 `frameloop="demand"`，用定时器调 `invalidate()`；也可以在 useFrame 里按时间跳帧。③ 在 vivo X100 上连续跑 5 分钟，用 `?fps` 观察帧率是否下滑（发热降频）。 |
| M2 PerformanceMonitor 在预热期间就开始采样 | `PerformanceMonitor` 从第一帧开始测（`StarMap.tsx:338`）。第一帧要烘焙星云：高档位 2048×1024 像素，每个像素约 7 次 `fbm3`（每次 4 层 simplex 噪声）（`Starfield.tsx:138-160`，在 `:241-250` 第一次调用时执行），再加上着色器编译。这段慢帧会被算进平均值，可能在好设备上误降 dpr。 | 中 | 等 `world.warm.ready`（或 `introDone`）之后再挂载 `<PerformanceMonitor>`，或者丢掉前几秒的样本。手机档位的星云可以烘焙得更小。 |
| M3 开场星尘按帧步进 | `hud/NameDust.tsx:159-162`：弹簧和阻尼每帧作用一次，没用 dt。120Hz 屏上收敛快一倍，30fps 时慢一倍，可能在飞走前还没拼成字。每个粒子单独设 `fillStyle`、单独 `arc` + `fill`（:164-167）。`build()` 对整个视口做一次 `getImageData`（:85），而它就发生在开场中段（`dustIn = 2.2s`）。 | 中 | ① 改成固定 60Hz 的子步累加（和 `Scene.tsx:178-188` 的模拟同样写法）。② 把透明度分成几档，同一档一次 `beginPath`，再批量 `fill`（MDN "Batch canvas calls"）。③ 只在文字包围盒那么大的离屏画布上采样，或者把采样提前到预热阶段。 |
| M4 运行时错误不会退回 2D | 着色器出错时 three 只打日志、不渲染那个材质（`three/src/renderers/webgl/WebGLProgram.js:866-900`）；useFrame 抛错时画面冻结，React 错误边界抓不到（见第 9 节）。`Fallback` 只包了 `<Canvas>` 的 React 渲染（`StarMap.tsx:330-350`）。 | 中 | 设 `gl.debug.onShaderError`，出错就移除 `has-3d`；给 Driver 的帧回调包 try/catch，第一次出错时记日志并退回 2D（不要每帧都报）。 |
| M5 动效暂停手段（WCAG 2.2.2） | 自动旋转（`Scene.tsx:246`）、星空闪烁、星系自转会一直持续。只跟随系统的减少动态效果设置，而且只在加载时读一次（`StarMap.tsx:66` 的 `useMemo(reducedMotion, [])`），页面内没有暂停按钮。另一方面，reduce 模式覆盖得很全：开场、震屏、拖尾、FOV 冲刺、视差、星尘、脉冲、涟漪都关了（`Scene.tsx:156,197,246,258`，`Intro.tsx:22`，`Starfield.tsx:330-338`，`NameDust.tsx:46`）✅。 | 中 | HUD 加一个"暂停动效"按钮，复用现有的 `reduce` 分支；`matchMedia(...).addEventListener('change')` 跟随系统设置的实时变化。 |
| M6 读屏用户拿不到节点列表 | 有 3D 时 2D 列表 `display:none`（`pages/index.astro:52`），节点标签 `aria-hidden`（`hud/Labels.tsx:8`）。读屏用户只能靠 `/` 搜索（`hud/Palette.tsx`）。 | 中 | 2D 列表在有 3D 时改成"视觉隐藏"（sr-only 写法：`position:absolute; width:1px; height:1px; overflow:hidden; clip-path: inset(50%)`），不要 `display:none`。 |
| M7 primitive 资源从不释放 | 星空、星云渲染目标、天体、连线、开场特效都是 `useMemo` 新建再用 `<primitive>` 挂上（`Starfield.tsx:287-318`，`NodeShapes.tsx:8`，`Edges.tsx` 的 `useMemo`，`Intro.tsx:16`，`Scene.tsx:24`），依赖里有 `tier`，又没有任何 dispose。R3F 文档明确说 primitive 卸载时不会被释放。目前 tier 运行时不会变（因为 H1），所以**现在**不泄漏；一旦修好 H1、让 tier 能在运行时切换，每次切换都会泄漏一整套 GPU 资源，还要重新编译着色器。 | 中（和 H1 联动） | 每个 `useMemo` 配一个 `useEffect(() => () => dispose…, [obj])`，遍历 `traverse` 释放 geometry、material、texture、renderTarget；或者按 H1 的建议只改参数、不重建。 |
| M8 小字对比度 | `--ink-3: #6d6c88` 在 `--bg: #05060d` 上的对比度是 **4.0:1**（按 WCAG 公式计算），低于普通文字要求的 4.5:1。它用在 10–10.5px 的小字上（`starmap.css:52,96,101,119,134,256,313,337`）。远处的标签透明度可以低到 `0.3 × 0.85`（`Scene.tsx:403-405`），算下来约 1.5:1。 | 中 | `--ink-3` 调到 `#777692`（4.61:1）或更亮；远处标签的透明度设个下限（比如 0.5，约 2.7:1），或者接受它是装饰性的深度暗示，只保证悬停/选中时清晰。 |

### 低风险

| 检查项 | 本项目现状（文件:行号） | 风险 | 建议改法 |
|---|---|---|---|
| L1 每帧小分配 | `Edges.tsx:103`（`writeSeg` 闭包）、`:132`（每条边一个 `fade` 闭包）、`Starfield.tsx:334`（`[...layers, dust]`）、`Intro.tsx:97,107`（数组字面量）、`Scene.tsx:372`（`prio` 闭包）、`:406`（模板字符串） | 低 | 提到 useFrame 外面，或者直接内联计算；只有在手机上看到 GC 锯齿时才值得改。 |
| L2 标签宽度测量会强制布局 | `Scene.tsx:335` 写 `textContent`，同一帧 `:339` 就读 `offsetWidth`，每个标签打完字时触发一次同步布局（共 19 次），窗口大小变化后又各一次。注释说"先读后写"，但这一帧实际是先写后读。 | 低 | 在下一帧开头再读，或者用 `ResizeObserver` 统一测量。 |
| L3 每帧写所有标签的样式 | `Scene.tsx:400-406` 每帧给 19 个标签写 `opacity` 和 `transform`，并调用 `classList.toggle('hot')`。只改合成属性 ✅，但值没变也在写。 | 低 | 值没变就不写，或者缓存上次的字符串。节点上百个时再处理。 |
| L4 额外的 WebGL 上下文 | `pages/index.astro` 的内联脚本创建 1 个检测上下文；`device.ts:51-55` 的 `hasWebGL()` 又创建 1 个，没有 `loseContext`；`device.ts:13-19` 的 `gpuName()` 创建 1 个并已 `loseContext` ✅。 | 低 | `hasWebGL()` 也调 `WEBGL_lose_context.loseContext()`，或者直接复用 index.astro 里的检测结果（`has-3d` 类）。 |
| L5 飞行/涟漪用现实时钟 | `world.ts:101` 的 `ms()` 基于 `performance.now()`，用于飞行（`Scene.tsx:253-279`）和涟漪。第一次点击时如果卡顿，飞行会直接跳一段。 | 低 | 可以接受。要彻底解决，就像开场一样用"夹住的 dt 累加"。 |
| L6 星尘画布与循环一直存在 | `hud/NameDust.tsx:120` 的 rAF 在开场结束后仍然每帧空转（立即 return）；全屏透明的 2D canvas（`starmap.css:75`，`z-index:5`）一直留在合成树里。全屏透明层是否有持续合成开销【未核实】。 | 低 | 开场结束后 `cancelAnimationFrame`，并给 canvas 设 `hidden` 或卸载；重放时再挂载（现在已经用 `key={nonce}` 重建）。 |
| L7 生产环境的着色器错误检查 | 没设 `gl.debug.checkShaderErrors = false`（默认 true）。three 注释说生产环境可以关掉来提升性能。 | 低 | 生产环境关掉，同时用 M4 的 `onShaderError` 兜底。 |
| L8 `powerPreference: 'high-performance'` | `StarMap.tsx:334` | 低 | 双显卡笔记本上会唤醒独显，更耗电但更流畅；按"体验优先"的原则可以保留。 |
| L9 键盘焦点样式可能被覆盖 | `.sm-stage { outline: none }`（`starmap.css:21`）和全局的 `:focus-visible`（`styles/base.css:47`）优先级相同，谁生效取决于 CSS 加载顺序。【未核实】没有在浏览器里确认。 | 低 | 加 `.sm-stage:focus-visible { outline: … }`，明确保留焦点框。 |
| L10 首屏 JS | `dist/_astro/StarMap.*.js` 原始 1.2MB，gzip 后约 335KB（单个 chunk）。 | 低 | 在 600KB 上限内，暂时不用动；低端机上的解析时间用 Performance 面板实测。 |

### 已经做对的（不要改坏）

- 逐帧状态全部在 `world` 可变对象里，React 只管低频 UI 状态（`store.ts`）。
- dpr 按档位封顶（`StarMap.tsx:69`，`config.ts:228-230`）。
- 着色器预编译：在后期输入缓冲上 `compileAsync`（`Scene.tsx:50-81`），加上预热门槛和按帧累加的开场时钟（`Scene.tsx:155-162`）。
- 后期配置符合官方推荐：antialias 关闭、用 MSAA、mipmapBlur、末尾色调映射、低档位不挂后期（`Scene.tsx:87-112`）。
- 粒子运动在着色器里算，点大小有上限（`bodies.ts:150-155`）。
- 毛玻璃默认关闭，卡片尺寸用 ResizeObserver（`config.ts:235`，`hud/Panel.tsx:96-116`）。
- reduce motion 覆盖全面，Motion 组件也设了 `reducedMotion="user"`（`StarMap.tsx:327`）。
- 标签避让有优先级和滞回（`Scene.tsx:371-407`）。
- 没有 WebGL 时退回 2D 列表，15 秒超时也会退回（`pages/index.astro:12-24`）。
