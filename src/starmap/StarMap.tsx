// 首页 3D 星图岛的入口。负责：WebGL 检测、输入（拖动/缩放/点击/键盘）、深链、性能降档。
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { advance, Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { MotionConfig } from 'motion/react';
import { CONFIG, type Tier } from './config';
import { loadView, saveView, type SavedView } from './resume';
import { openReader, preloadReader } from './reader';
import { coarsePointer, detectTier, forcedTier, hasWebGL, introSeen, isCompact, markIntroSeen, qualityLadder, reducedMotion } from './device';
import { useUI } from './store';
import { clamp, World, type GraphData } from './world';
import { Scene } from './scene/Scene';
import { setFatalHandler } from './scene/safeFrame';
import { Hud } from './hud/Hud';
import { Labels } from './hud/Labels';
import { Panel, PanelWarm } from './hud/Panel';
import { Palette } from './hud/Palette';
import { NameDust } from './hud/NameDust';
import { PerfStats } from './scene/PerfStats';
import './starmap.css';

/** 3D 出任何错都退回 2D 列表，而不是白屏 */
class Fallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('[星图] 3D 渲染失败，退回列表', err);
    document.documentElement.classList.remove('has-3d');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** 恢复离开前的画面：跳过开场，镜头、节点位置、选中的节点直接摆到位。返回恢复时选中的节点（没有是 -1） */
function resumeView(w: World, v: SavedView): number {
  w.portrait = innerHeight > innerWidth * 1.2;
  w.resumed = true;
  w.introT = 99; // 开场时间直接拨到结束之后：节点、连线、标签都是最终状态
  w.introId++;
  w.warm.ready = true;
  w.introDone = true;
  w.hover = -1;
  w.acc = 0;
  w.alpha = 0.03;
  w.labelW.fill(0);
  for (let i = 0; i < w.n; i++) {
    w.P[i].set(v.P[i * 3], v.P[i * 3 + 1], v.P[i * 3 + 2]);
    w.V[i].set(0, 0, 0);
  }
  w.userZoomed = v.zoomed;
  w.camG.th = w.camS.th = v.th;
  w.camG.ph = w.camS.ph = v.ph;
  w.camG.r = w.camS.r = v.r;
  const i = v.sel ? w.nodes.findIndex((n) => n.slug === v.sel) : -1;
  if (i >= 0) {
    w.camG.tx.copy(w.P[i]);
    if (w.portrait) w.camG.tx.y *= CONFIG.sim.portraitYScale;
    w.lastSel = i; // 已经在节点上了，不要再飞一次
    w.selAt = w.ms() - 1e6;
    w.resumeSnap = true;
  } else w.camG.tx.set(0, 0, 0);
  w.camS.tx.copy(w.camG.tx);
  useUI.setState({ hudIn: true, nameIn: true });
  if (i >= 0) useUI.getState().select(i);
  return i;
}

function startIntro(w: World, reduce: boolean, speed: number) {
  w.resumed = false;
  w.portrait = innerHeight > innerWidth * 1.2; // 第一帧之前就确定横竖屏，预演布局才对
  const R0 = w.baseRadius(innerWidth, innerHeight);
  w.introStart = performance.now();
  w.introSpeed = speed;
  w.introT = 0;
  w.introId++;
  w.warm.frames = 0;
  w.warm.elapsed = 0;
  w.warm.ready = false;
  useUI.setState({ hudIn: reduce, nameIn: reduce });
  w.introDone = reduce;
  w.hover = -1;
  w.acc = 0;
  w.userZoomed = false;
  w.labelW.fill(0); // 标签会重新打字，宽度等打完再测
  w.camG.tx.set(0, 0, 0);
  w.camG.r = R0;
  w.camS.r = reduce ? R0 : R0 * 2.1;
  if (reduce) {
    w.seed(false);
    for (let k = 0; k < 500; k++) w.step(-1);
  } else w.seed(true);
}

export default function StarMap({ graph }: { graph: GraphData }) {
  const [ok] = useState(hasWebGL);
  const world = useMemo(() => new World(graph), [graph]);
  if (import.meta.env.DEV) {
    (window as unknown as { __sm: World }).__sm = world; // 开发时可在控制台检查
    world.timeScale = Number(new URLSearchParams(location.search).get('timeScale')) || 1;
  }
  const reduce = useMemo(reducedMotion, []);
  const [tier] = useState<Tier>(detectTier);
  // ?tier= 强制档位时不自动升降；开发时加 ?adapt 可以在强制档位下照样测试自动升降
  const [locked] = useState(() => forcedTier() !== null && !(import.meta.env.DEV && new URLSearchParams(location.search).has('adapt')));
  // 质量阶梯：第 qi 级。帧率不够往后退一级，够了往前回一级（见 device.ts qualityLadder）
  const ladder = useMemo(() => qualityLadder(tier), [tier]);
  const [qi, setQi] = useState(0);
  const quality = ladder[Math.min(qi, ladder.length - 1)];
  const adaptLocked = useRef(false); // 来回升降太多次后锁定
  const adaptReady = () => !locked && !adaptLocked.current && (!CONFIG.adapt.startAfterIntro || world.introDone);
  // 触屏设备帧率封顶（120Hz 屏全速渲染会发热、降频，反而更卡）
  const [fpsCap] = useState(() => (coarsePointer() ? CONFIG.touch.fpsCap : 0));
  // 稳定性：逐帧出错 → 退回 2D；WebGL 上下文丢失 → 先显示 2D，恢复后用新的上下文重建整个 3D 场景
  const [failed, setFailed] = useState(false);
  const [lost, setLost] = useState(false);
  const [glKey, setGlKey] = useState(0);
  useEffect(() => {
    setFatalHandler(() => {
      document.documentElement.classList.remove('has-3d');
      setFailed(true);
    });
    return () => setFatalHandler(null);
  }, []);
  const [firstSpeed] = useState(() => (introSeen() ? CONFIG.intro.repeatSpeed : 1));
  const nonce = useUI((s) => s.replayNonce);
  const selected = useUI((s) => s.selected);
  const compact = useUI((s) => s.compact);
  const hudIn = useUI((s) => s.hudIn);
  const reading = useUI((s) => s.reading);
  const stage = useRef<HTMLDivElement>(null);
  const perfEl = useRef<HTMLDivElement>(null);
  const [showPerf] = useState(() => new URLSearchParams(location.search).has('fps'));
  // 手动重放总是完整速度；开发时可用 ?introSpeed=0.1 慢放开场来检查细节
  const devSpeed = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('introSpeed')) || 0 : 0;
  const introSpeed = devSpeed || (nonce > 0 ? 1 : firstSpeed);

  // 初始化：WebGL 不可用就保留 2D 列表
  useLayoutEffect(() => {
    if (!ok) {
      document.documentElement.classList.remove('has-3d');
      return;
    }
    useUI.setState({
      slugs: graph.nodes.map((n) => n.slug),
      compact: isCompact(),
      landOn: (slug) => {
        const i = graph.nodes.findIndex((n) => n.slug === slug || n.moons.some((m) => m.slug === slug));
        if (i >= 0 && i !== useUI.getState().selected) useUI.getState().select(i);
      },
    });
    markIntroSeen();
  }, [ok, graph]);

  // 从文章页回来：恢复离开前的画面，不重播开场（手动刷新、点"重放开场"照常播）
  const [saved] = useState(() => (ok && !reduce ? loadView(world) : null));
  const resumeHold = useRef<{ i: number; r: number } | null>(null);

  // 开场（首次 / 重放）
  useLayoutEffect(() => {
    if (!ok) return;
    if (saved && nonce === 0) resumeHold.current = { i: resumeView(world, saved), r: saved.r };
    else startIntro(world, reduce, introSpeed);
  }, [ok, world, reduce, nonce, introSpeed, saved]);

  // 离开页面（去读文章、关标签页）时记下当前画面
  useEffect(() => {
    if (!ok) return;
    const onHide = () => saveView(world, useUI.getState().selected);
    addEventListener('pagehide', onHide);
    return () => removeEventListener('pagehide', onHide);
  }, [ok, world]);

  // 深链：#slug 直接飞到节点；浏览器前进后退也跟着变
  useEffect(() => {
    if (!ok) return;
    const fromHash = () => {
      const slug = decodeURIComponent(location.hash.slice(1));
      // 下属笔记（小卫星）没有自己的星：落到它的父节点上
      return world.nodes.findIndex((n) => n.slug === slug || n.moons.some((m) => m.slug === slug));
    };
    const i = fromHash();
    if (i >= 0) {
      if (reduce) useUI.getState().select(i);
      else world.pendingSelect = i;
    }
    const onHash = () => {
      const j = fromHash();
      if (j >= 0) useUI.getState().select(j);
      else useUI.getState().deselect();
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [ok, world, reduce]);

  // 选中一颗星后，稍等一下在后台预载它的文章，点"阅读全文"时就不用等
  useEffect(() => {
    if (!ok || selected < 0) return;
    const id = setTimeout(() => preloadReader(`/n/${world.nodes[selected].slug}/`), CONFIG.ui.readerPreload * 1000);
    return () => clearTimeout(id);
  }, [ok, selected, world]);

  // 选中/取消时调整镜头距离；视口偏移由 Panel 按实际尺寸设置
  useEffect(() => {
    // 刚恢复画面：镜头距离用离开时的（用户可能手动缩放过），这一次不重算
    const hold = resumeHold.current;
    if (hold) {
      if (hold.i !== selected) return; // 恢复的选中状态还没生效
      resumeHold.current = null;
      world.camG.r = hold.r;
      return;
    }
    if (selected >= 0) world.camG.r = CONFIG.camera.selectR[compact ? 'compact' : 'wide'];
    else {
      world.camG.r = world.baseRadius(innerWidth, innerHeight);
      world.off.gx = world.off.gy = 0;
    }
    world.lastInteract = performance.now();
  }, [selected, compact, world]);

  // 窗口变化：切换布局模式、重算默认镜头距离
  useEffect(() => {
    const onResize = () => {
      useUI.getState().setCompact(isCompact());
      world.labelW.fill(0); // 字号可能变了，重新测量标签宽度
      world.userZoomed = false;
      if (useUI.getState().selected < 0) world.camG.r = world.baseRadius(innerWidth, innerHeight);
    };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [world]);

  // 帧率封顶：画布设为不自动渲染，由这里每 1/fps 秒推进一帧
  useEffect(() => {
    if (!ok || !fpsCap) return;
    let raf = 0;
    let last = 0;
    const interval = 1000 / fpsCap - 1; // 留 1ms 余量，避免 60Hz 屏上因为抖动掉到 30
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < interval) return;
      last = t;
      if (useUI.getState().reading) return; // 文章盖着的时候不画
      advance(t / 1000); // R3F 的 advance 要的是秒，rAF 给的是毫秒
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ok, fpsCap]);

  // 视差倾斜：电脑跟随鼠标位置；手机跟随陀螺仪（安卓需 HTTPS；iOS 需在一次触摸里申请权限）
  useEffect(() => {
    if (!ok || reduce) return;
    const { tilt } = world;
    const onMouse = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      tilt.gx = clamp((e.clientX / innerWidth - 0.5) * 2, -1, 1);
      tilt.gy = clamp((e.clientY / innerHeight - 0.5) * 2, -1, 1);
    };
    const onLeave = () => {
      tilt.gx = tilt.gy = 0;
    };
    // 陀螺仪：以第一次读数为基准，基准慢慢跟随，换个姿势拿手机会自动回中
    let base: { b: number; g: number } | null = null;
    const range = CONFIG.tilt.gyroRange;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      base.b += (e.beta - base.b) * 0.01;
      base.g += (e.gamma - base.g) * 0.01;
      tilt.gx = clamp((e.gamma - base.g) / range, -1, 1);
      tilt.gy = clamp((e.beta - base.b) / range, -1, 1);
    };
    type IOSOrientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> };
    const DOE = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null) as IOSOrientation | null;
    let asked = false;
    const askIOS = () => {
      if (asked || !DOE?.requestPermission) return;
      asked = true;
      DOE.requestPermission()
        .then((r) => r === 'granted' && addEventListener('deviceorientation', onOrient))
        .catch(() => {});
    };
    addEventListener('pointermove', onMouse);
    document.documentElement.addEventListener('pointerleave', onLeave);
    if (DOE && !DOE.requestPermission) addEventListener('deviceorientation', onOrient);
    else addEventListener('pointerdown', askIOS, { once: true });
    return () => {
      removeEventListener('pointermove', onMouse);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      removeEventListener('deviceorientation', onOrient);
      removeEventListener('pointerdown', askIOS);
    };
  }, [ok, reduce, world]);

  // 键盘：/ 搜索、Esc 返回、方向键沿连线跳、回车读全文
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea');
      if (ui.palette || typing || ui.reading) return;
      if (e.key === '/') {
        e.preventDefault();
        ui.setPalette(true);
      } else if (e.key === 'Escape') {
        if (ui.selected >= 0) ui.deselect();
        else if (ui.focusCat) ui.clearCat();
      } else if (e.key.startsWith('Arrow')) {
        if ((e.target as HTMLElement)?.closest?.('button, a')) return;
        e.preventDefault();
        if (ui.selected < 0) return ui.select(0);
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
        if (!dir) return;
        const j = world.neighborInDirection(ui.selected, dir[0], dir[1]);
        if (j >= 0) ui.select(j);
      } else if (e.key === 'Enter' && ui.selected >= 0 && !(e.target as HTMLElement)?.closest?.('button, a')) {
        openReader(`/n/${world.nodes[ui.selected].slug}/`, ui.landOn);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [world]);

  // 指针：拖动旋转、双指缩放、点击选中、滚轮缩放
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ptrs = new Map<number, { x: number; y: number }>();
    let moved = false;
    let down = { x: 0, y: 0 };
    let pinch: { d: number; r: number } | null = null;
    const pdist = () => {
      const [a, b] = [...ptrs.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const touch = coarsePointer();
    const { camG } = world;
    const { dragSpeed, minR, maxR, wheelSpeed } = CONFIG.camera;

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        moved = false;
        down = { x: e.clientX, y: e.clientY };
      }
      if (ptrs.size === 2) {
        pinch = { d: pdist(), r: camG.r };
        moved = true;
      }
      world.lastInteract = performance.now();
    };
    const onMove = (e: PointerEvent) => {
      const p = ptrs.get(e.pointerId);
      if (p) {
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (ptrs.size === 1) {
          if (!moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
            moved = true;
            world.dragging = true;
            el.classList.add('dragging');
          }
          if (moved) {
            camG.th -= dx * dragSpeed;
            camG.ph = clamp(camG.ph - dy * dragSpeed, 0.25, Math.PI - 0.25);
          }
        } else if (ptrs.size === 2 && pinch) {
          camG.r = clamp((pinch.r * pinch.d) / pdist(), minR, maxR);
          world.userZoomed = true;
        }
        world.lastInteract = performance.now();
      } else if (e.pointerType === 'mouse') {
        world.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        world.mouse.t = world.ms();
        const h = world.pick(e.clientX, e.clientY, false);
        if (h !== world.hover) {
          world.hover = h;
          el.classList.toggle('pointing', h >= 0);
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      const single = ptrs.size === 1;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (!ptrs.size) {
        world.dragging = false;
        el.classList.remove('dragging');
      }
      if (single && !moved && e.type === 'pointerup') {
        const i = world.pick(e.clientX, e.clientY, touch || e.pointerType !== 'mouse');
        const ui = useUI.getState();
        if (i >= 0) ui.select(i);
        else {
          ui.deselect();
          // 点击空白处：星空荡开一圈波纹
          world.wave.x = (e.clientX / innerWidth) * 2 - 1;
          world.wave.y = -(e.clientY / innerHeight) * 2 + 1;
          world.wave.t = world.ms();
        }
      }
    };
    const onLeave = () => {
      if (!ptrs.size && world.hover >= 0) {
        world.hover = -1;
        el.classList.remove('pointing');
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camG.r = clamp(camG.r * (1 + e.deltaY * wheelSpeed), minR, maxR);
      world.userZoomed = true;
      world.lastInteract = performance.now();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
    };
  }, [world, ok]);

  if (!ok || failed) return null;

  return (
    <MotionConfig reducedMotion="user">
      <div className={`sm${lost ? ' sm-lost' : ''}${compact ? ' compact' : ''}${selected >= 0 ? ' has-sel' : ''}${CONFIG.ui.glassBlur ? ' sm-blur' : ''}${hudIn ? ' hud-in' : ''}`}>
        <div ref={stage} className="sm-stage" tabIndex={0} aria-label="3D 星图：拖动旋转，点击节点查看详情；方向键沿连线跳转，回车阅读全文">
          <Fallback>
            <Canvas
              flat
              dpr={quality.dpr}
              frameloop={fpsCap ? 'never' : reading ? 'demand' : 'always'} // 文章盖着的时候不画
              gl={{ antialias: !ladder[0].bloom, alpha: false, powerPreference: 'high-performance' }}
              camera={{ fov: CONFIG.camera.fov, near: 0.1, far: 2000, position: [0, 0, 190] }}
              key={glKey}
              onCreated={({ gl }) => {
                document.documentElement.classList.add('sm-ready', 'has-3d');
                if (import.meta.env.DEV) (window as unknown as { __gl: unknown }).__gl = gl; // 开发时可在控制台检查渲染器
                const cv = gl.domElement;
                cv.addEventListener(
                  'webglcontextlost',
                  (e) => {
                    e.preventDefault(); // 告诉浏览器我们会处理恢复，否则不会触发 restored
                    document.documentElement.classList.remove('has-3d');
                    setLost(true);
                  },
                  { once: true },
                );
                cv.addEventListener(
                  'webglcontextrestored',
                  () => {
                    setLost(false);
                    setGlKey((k) => k + 1); // 换一个全新的画布和上下文，所有着色器、贴图、星云重新生成
                  },
                  { once: true },
                );
              }}
            >
              <PerformanceMonitor
                flipflops={CONFIG.adapt.flipflops}
                onDecline={() => adaptReady() && setQi((i) => Math.min(i + 1, ladder.length - 1))}
                onIncline={() => adaptReady() && setQi((i) => Math.max(i - 1, 0))}
                onFallback={() => void (adaptLocked.current = true)}
              >
                <Scene world={world} tier={tier} quality={quality} reduce={reduce} />
                {showPerf && <PerfStats el={perfEl} tier={tier} level={qi} levels={ladder.length} />}
              </PerformanceMonitor>
            </Canvas>
          </Fallback>
        </div>
        {showPerf && <div className="sm-perf" ref={perfEl} />}
        <Labels world={world} />
        <Hud world={world} reduce={reduce} />
        <NameDust key={nonce} world={world} reduce={reduce} />
        <Panel world={world} />
        <PanelWarm world={world} />
        <Palette world={world} />
      </div>
    </MotionConfig>
  );
}
