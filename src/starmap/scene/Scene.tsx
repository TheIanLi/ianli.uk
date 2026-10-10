// 3D 场景：灯光、星空、节点、连线、流光、开场特效，以及驱动一切的 Driver。
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { useSafeFrame } from './safeFrame';
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { CONFIG, type Tier } from '../config';
import type { Quality } from '../device';
import { useUI } from '../store';
import { clamp, damp, easeOut, type World } from '../world';
import { Edges } from './Edges';
import { Intro } from './Intro';
import { Ripple } from './Ripple';
import { Starfield } from './Starfield';
import { NodeShape } from './NodeShapes';

interface SceneProps {
  world: World;
  tier: Tier;
  quality: Quality;
  reduce: boolean;
}

export function Scene({ world, tier, quality, reduce }: SceneProps) {
  const background = useMemo(makeBackground, []);
  return (
    <>
      {/* 背景：中心微亮的深蓝渐变。用场景背景（永远最先画、垫在最底层）。
          之前用一张大光晕精灵模拟，但半透明物体排在不透明物体之后画，它反而盖住了中心的恒星和行星。 */}
      <primitive attach="background" object={background} />
      <fogExp2 attach="fog" args={['#05060d', 0.0052]} />
      <Starfield world={world} tier={tier} reduce={reduce} />
      <Edges world={world} reduce={reduce} />
      {world.nodes.map((n, i) => (
        <NodeShape key={n.slug} world={world} i={i} tier={tier} />
      ))}
      <Driver world={world} reduce={reduce} />
      <Intro world={world} tier={tier} reduce={reduce} />
      <Ripple world={world} reduce={reduce} />
      <Effects world={world} quality={quality} />
      <Precompile world={world} bloom={quality.bloom} />
    </>
  );
}

/**
 * 预编译所有着色器：开场、选中时才出现的东西（冲击波、拖尾、涟漪、高亮连线…）平时是隐藏的，
 * 第一次出现时才编译就会卡一下。这里先临时设为可见，交给异步编译（不阻塞主线程），提交后立刻恢复。
 * 完成后 world.warm.compiled = true，开场时钟才会开始走。
 */
function Precompile({ world, bloom }: { world: World; bloom: boolean }) {
  const done = useRef(false);
  useSafeFrame(({ gl, scene, camera }) => {
    if (done.current) return;
    // 开了辉光时，场景实际画进后期管线的离屏画布（线性色彩、无色调映射），着色器变体和直接画到屏幕不同；
    // 所以要等后期管线建好，并且在它的输入画布上编译，才能编译出真正会用到的版本
    const needComposer = bloom;
    if (needComposer && !world.composer) return;
    done.current = true;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const prev = gl.getRenderTarget();
    let job: Promise<unknown>;
    try {
      gl.setRenderTarget(needComposer ? world.composer!.inputBuffer : null);
      job = gl.compileAsync(scene, camera);
    } catch {
      job = Promise.resolve();
    } finally {
      gl.setRenderTarget(prev);
    }
    for (const o of hidden) o.visible = false; // 编译任务已经收集好材质，马上恢复，画面上不会闪
    const finish = () => void (world.warm.compiled = true);
    job.then(finish, finish);
  });
  return null;
}

/**
 * 后期：辉光 → 色调映射 → 暗角 → 胶片颗粒。
 * 低档位不挂后期管线（省性能），改由渲染器自己做色调映射。
 */
function Effects({ world, quality: Q }: { world: World; quality: Quality }) {
  const gl = useThree((s) => s.gl);
  const B = CONFIG.bloom;
  const P = CONFIG.post;
  useLayoutEffect(() => {
    gl.toneMapping = Q.bloom ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    if (!Q.bloom) world.composer = world.bloom = null; // 关辉光后不再引用旧的后期管线
  }, [gl, Q.bloom, world]);
  if (!Q.bloom) return null;
  return (
    <EffectComposer multisampling={Q.msaa} ref={(c) => void ((world.composer = c), (world.dithered = false))}>
      <Bloom
        ref={(b) => void (world.bloom = b)}
        mipmapBlur
        intensity={B.intensity}
        luminanceThreshold={B.threshold}
        luminanceSmoothing={B.smoothing}
        radius={B.radius}
        levels={Q.bloomLevels}
      />
      <ToneMapping mode={ToneMappingMode[P.toneMapping]} />
      <Vignette offset={P.vignetteOffset} darkness={P.vignette} />
      {P.grain > 0 ? <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={P.grain} /> : <></>}
    </EffectComposer>
  );
}

/** 背景贴图：屏幕空间的径向渐变（中心 #0c1030 → 边缘 #05060d） */
function makeBackground() {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(S / 2, S * 0.46, 0, S / 2, S * 0.46, S * 0.72);
  gr.addColorStop(0, '#0c1030');
  gr.addColorStop(0.55, '#080a1c');
  gr.addColorStop(1, '#05060d');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Driver：每帧推进模拟、更新节点/相机/标签。全部用 ref 和可变对象，不触发 React 重绘。
// 用负优先级保证它在所有其他 useFrame 之前运行。
// ---------------------------------------------------------------------------
function Driver({ world: w, reduce }: { world: World; reduce: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const v3 = useMemo(() => new THREE.Vector3(), []);
  const frameNo = useRef(0);
  const order = useMemo(() => w.nodes.map((_, i) => i), [w]);
  const placed = useMemo<[number, number, number][]>(() => [], []);

  useSafeFrame(({ clock, size, gl }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const dpr = gl.getPixelRatio();
    const ui = useUI.getState();
    const W = size.width;
    const H = size.height;
    const now = performance.now();
    const { intro: I, nodes: NC, camera: CC } = CONFIG;
    // 开场时钟：预热完成后才走；每帧最多推进 1/30 秒——页面卡顿时开场跟着暂停，不会被"跳过"
    if (reduce) w.introT = 99;
    else if (!w.warm.ready) {
      const W2 = w.warm;
      W2.elapsed += rawDt;
      W2.frames = rawDt < 1 / 40 ? W2.frames + 1 : 0;
      if ((W2.compiled && W2.frames >= 6) || W2.elapsed > 4) W2.ready = true;
    } else w.introT += Math.min(dt, 1 / 30) * w.introSpeed;
    const t = w.introT;
    if (!ui.hudIn && t >= I.hudAt) useUI.setState({ hudIn: true });
    if (!ui.nameIn && t >= I.nameAt) useUI.setState({ nameIn: true });
    const since = t - I.bang;
    const tt = clock.elapsedTime;
    const active = w.hover >= 0 ? w.hover : ui.selected;
    w.portrait = H > W * 1.2;

    // 后期管线建好后开一次抖动，消除深色渐变里的一圈圈色带
    if (w.composer && !w.dithered) {
      for (const pass of w.composer.passes) if ('dithering' in pass) (pass as { dithering: boolean }).dithering = true;
      w.dithered = w.composer.passes.length > 1;
    }

    // ---- 模拟（固定步频，爆发后才开始）----
    if (since > 0) {
      w.acc += dt * (w.introDone ? 1 : w.introSpeed); // 开场期间跟随播放倍速，二次访问的快速开场也能收拢到位
      const h = 1 / CONFIG.sim.stepsPerSecond;
      let steps = 0;
      while (w.acc >= h && steps < 4) {
        w.step(ui.selected); // 只有真正选中才把邻居拉近；悬停不扰动布局，节点不会"跑"
        w.acc -= h;
        steps++;
      }
      if (steps === 4) w.acc = 0;
    }

    // ---- 节点 ----
    const kDim = damp(0.12, dt);
    const kScale = damp(0.18, dt);
    for (let i = 0; i < w.n; i++) {
      const nd = w.nodes[i];
      w.R[i].copy(w.P[i]);
      if (w.portrait) w.R[i].y *= CONFIG.sim.portraitYScale; // 竖屏拉高，填满手机屏幕
      if (!reduce) w.R[i].y += Math.sin(tt * 0.7 + w.phase[i]) * NC.bob;

      // 出现进度：核心在蓄能阶段是一个越来越亮的脉动小点，爆发时冲大再回落
      let ap: number;
      let snap = false; // 开场关键帧直接设定缩放，不走缓动
      if (reduce) ap = 1;
      else if (w.isCore(i)) {
        snap = since < 0.6;
        ap =
          since < 0
            ? (0.1 + 0.32 * Math.pow(t / I.bang, 2)) * (1 + 0.25 * Math.sin(t * (10 + t * 14)))
            : 1 + 0.55 * Math.exp(-since / 0.16);
      } else ap = since < 0 ? 0 : easeOut(since / I.nodesIn);
      w.appear[i] = clamp(ap, 0, 1);

      let target = 1;
      if (active >= 0) target = i === active || w.nb[active].has(i) ? 1 : NC.dimOthers;
      else if (ui.focusCat) target = nd.cat === ui.focusCat ? 1 : NC.dimOthers;
      w.dim[i] += (target - w.dim[i]) * kDim;

      const body = w.visuals[i];
      if (!body) continue;
      const g = body.group;
      let breath = 1;
      if (nd.status === 'wip' && !reduce) breath = 1 + Math.sin(tt * NC.wipBreathSpeed + w.phase[i]) * NC.wipBreathAmount;
      const want = (i === active ? NC.activeScale : 1) * ap * breath;
      g.scale.setScalar(Math.max(snap ? want : g.scale.x + (want - g.scale.x) * kScale, 0.0001));
      g.position.copy(w.R[i]);
      const op = w.dim[i] * (nd.status === 'old' && i !== active ? NC.oldDim : 1);
      const hot = i === active ? 1 : active >= 0 && w.nb[active].has(i) ? 0.4 : 0;
      body.update(reduce ? 0 : tt, op, hot, dpr, camera);
    }

    // ---- 连线绘制进度：开场按层级从核心向外一条条画出（Edges 组件据此渲染）----
    for (let k = 0; k < w.edges.length; k++) {
      const e = w.edges[k];
      w.edgeDraw[k] = reduce ? 1 : easeOut((t - (I.linesStart + e.drawAt * I.linesSpan)) / I.lineDraw);
    }

    if (!w.introDone && t > I.done) w.introDone = true;
    if (w.pendingSelect >= 0 && t > I.hashSelectAt) {
      const p = w.pendingSelect;
      w.pendingSelect = -1;
      ui.select(p);
    }

    // ---- 相机 ----
    const idle = now - w.lastInteract;
    // 悬停在节点上时暂停自动旋转，节点停在鼠标下方
    if (!reduce && ui.selected < 0 && w.hover < 0 && !w.dragging && idle > CC.idleMs) w.camG.th += CC.autoRotate * dt;
    if (ui.selected >= 0) w.camG.tx.copy(w.R[ui.selected]);
    else w.camG.tx.multiplyScalar(1 - damp(0.1, dt));
    const k = damp(CC.ease, dt);
    const { camS, camG, off } = w;

    // 选中变化：开始一段定时飞行（先加速后减速），途中视角张开再收回
    const fnow = w.ms();
    if (ui.selected !== w.lastSel) {
      const F = CONFIG.fly;
      const toNode = ui.selected >= 0;
      if (toNode) w.selAt = fnow;
      if (!reduce && t > I.bang + 1)
        w.flight = {
          start: fnow,
          dur: (toNode ? F.duration : F.backDuration) * 1000,
          punch: toNode ? F.fovPunch : F.fovPunchBack,
          r: camS.r,
          tx: camS.tx.clone(),
        };
      w.lastSel = ui.selected;
    }
    camS.th += (camG.th - camS.th) * k;
    camS.ph += (camG.ph - camS.ph) * k;
    let fov = CC.fov;
    const fl = w.flight;
    if (fl) {
      const p = clamp((fnow - fl.start) / fl.dur, 0, 1);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      camS.r = fl.r + (camG.r - fl.r) * e;
      camS.tx.lerpVectors(fl.tx, camG.tx, e);
      fov += fl.punch * Math.sin(Math.PI * p) * (1 - p * 0.3);
      if (p >= 1) w.flight = null;
    } else {
      camS.r += (camG.r - camS.r) * (t < 3 ? damp(0.035, dt) : k);
      camS.tx.lerp(camG.tx, k);
    }
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // 视差倾斜：鼠标/陀螺仪让镜头绕目标轻微偏转（拖动时不叠加，避免和手势打架）
    const TL = CONFIG.tilt;
    const tilt = w.tilt;
    const kt = damp(TL.ease, dt);
    const tgx = reduce || w.dragging ? 0 : tilt.gx;
    const tgy = reduce || w.dragging ? 0 : tilt.gy;
    // 悬停在节点上时冻结倾斜：否则镜头跟着鼠标偏转，节点会从鼠标下面"溜走"
    if (w.hover < 0) {
      tilt.x += (tgx - tilt.x) * kt;
      tilt.y += (tgy - tilt.y) * kt;
    }
    const th = camS.th - tilt.x * TL.angle;
    const ph = clamp(camS.ph - tilt.y * TL.angle * 0.7, 0.2, Math.PI - 0.2);
    const sp = Math.sin(ph);
    camera.position.set(
      camS.tx.x + camS.r * sp * Math.sin(th),
      camS.tx.y + camS.r * Math.cos(ph),
      camS.tx.z + camS.r * sp * Math.cos(th),
    );
    camera.lookAt(camS.tx);
    off.x += (off.gx - off.x) * k;
    off.y += (off.gy - off.y) * k;
    const vx = off.x + w.fitOff.x;
    const vy = off.y + w.fitOff.y;
    if (Math.abs(vx) > 0.5 || Math.abs(vy) > 0.5) camera.setViewOffset(W, H, vx, vy, W, H);
    else if (camera.view?.enabled) camera.clearViewOffset();
    camera.updateMatrixWorld();

    // ---- 屏幕坐标 ----
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    for (let i = 0; i < w.n; i++) {
      const s = w.sc[i];
      v3.copy(w.R[i]).project(camera);
      s.x = ((v3.x + 1) / 2) * W;
      s.y = ((1 - v3.y) / 2) * H;
      s.z = v3.z;
      s.dist = camera.position.distanceTo(w.R[i]);
      s.ppu = H / 2 / (tanHalf * s.dist);
      // 打字：按层级顺序，一个字一个字地出现
      const title = w.nodes[i].title;
      const j = w.labelRank[i];
      const k = reduce
        ? title.length
        : Math.min(title.length, Math.floor((t - (I.labelsStart + j * I.labelStagger)) / I.typeSpeed));
      const el = w.labels[i];
      if (k !== w.typed[i]) {
        w.typed[i] = k;
        const span = w.labelText[i];
        if (span) span.textContent = k > 0 ? title.slice(0, k) : '';
        el?.classList.toggle('typing', k >= 0 && k < title.length);
      }
      // 宽度只在打完后测一次（先读后写，避免每帧强制重排）
      if (el && !w.labelW[i] && k >= title.length) w.labelW[i] = el.offsetWidth;
    }

    // ---- 自动适配：节点在屏幕上的包围盒 → 距离对齐盒子大小，视口平移对齐盒子中心 ----
    {
      const k2 = damp(CONFIG.camera.autoFit.speed, dt);
      if (ui.selected < 0 && w.introDone && !w.dragging) {
        const box = CONFIG.camera.autoFit[ui.compact ? 'compact' : 'wide'];
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < w.n; i++) {
          const s = w.sc[i];
          if (s.z > 1) continue;
          x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x);
          y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y);
        }
        if (x1 > x0) {
          const bw = (box.right - box.left) * W;
          const bh = (box.bottom - box.top) * H;
          // 视口平移：包围盒中心 → 可用区域中心（测得的位置已含当前平移，所以逐帧累加修正）
          w.fitOff.x += ((x0 + x1) / 2 - ((box.left + box.right) / 2) * W) * k2;
          w.fitOff.y += ((y0 + y1) / 2 - ((box.top + box.bottom) / 2) * H) * k2;
          // 距离：投影尺寸约与距离成反比；用户手动缩放过就不再改
          const ratio = Math.max((x1 - x0) / bw, (y1 - y0) / bh);
          if (!w.userZoomed) w.camG.r = clamp(w.camG.r * (1 + (ratio - 1) * k2), CC.minR, CC.maxR);
        }
      } else if (ui.selected >= 0) {
        // 选中节点时平移归零，节点按卡片偏移正常居中
        w.fitOff.x -= w.fitOff.x * k2 * 4;
        w.fitOff.y -= w.fitOff.y * k2 * 4;
      }
    }

    // ---- 标签避让：按优先级依次放置，和已放置的重叠就隐藏 ----
    const prio = (i: number) =>
      i === active ? 0 : active >= 0 && w.nb[active].has(i) ? 1 : w.isCore(i) ? 2 : 3;
    for (let i = 0; i < w.n; i++) order[i] = i;
    order.sort((a, b) => prio(a) - prio(b) || w.sc[a].dist - w.sc[b].dist);
    placed.length = 0;
    const gap = NC.labelGap;
    const kLab = damp(0.2, dt);
    for (const i of order) {
      const s = w.sc[i];
      const el = w.labels[i];
      if (!el) continue;
      const hot = i === active;
      const onScreen = s.z <= 1 && w.appear[i] >= 0.05 && w.dim[i] > 0.3 && w.typed[i] >= 0;
      const lw = (w.labelW[i] || w.nodes[i].title.length * 13 + 34) * (hot ? 1.12 : 1);
      const lx = clamp(s.x - lw / 2, 6, W - lw - 6); // 贴边时不出屏
      const ly = s.y + (w.isCore(i) ? 5.5 : 3) * s.ppu + 6;
      let free = onScreen;
      // 滞回：已隐藏的标签要多留 8px 才重新出现，避免节点上下漂浮时在临界处反复闪烁
      const g2 = w.labelVis[i] > 0.5 ? gap : gap + 8;
      if (free && !hot)
        for (const r of placed)
          if (lx < r[0] + r[2] + g2 && lx + lw + g2 > r[0] && ly < r[1] + 16 + g2 && ly + 16 + g2 > r[1]) {
            free = false;
            break;
          }
      if (free) placed.push([lx, ly, lw]);
      w.labelVis[i] += ((free ? 1 : 0) - w.labelVis[i]) * kLab;
      if (w.labelVis[i] < 0.01 && !free) {
        el.style.opacity = '0';
        continue;
      }
      const depth = clamp(1.25 - (s.dist - camS.r * 0.6) / (camS.r * 1.1), 0.3, 1);
      el.classList.toggle('hot', hot);
      el.style.opacity = String((hot ? 1 : depth * 0.85) * w.dim[i] * w.labelVis[i]);
      el.style.transform = `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px)`;
    }

    if (++frameNo.current % 6 === 0 && w.coordsEl) {
      const deg = (x: number) => ((((x * 180) / Math.PI) % 360) + 360) % 360;
      w.coordsEl.textContent = `θ ${deg(camS.th).toFixed(1)}° · φ ${deg(camS.ph).toFixed(1)}° · r ${camS.r.toFixed(0)}`;
    }
  }, -10); // 负优先级：每帧最先执行，其他组件（连线、开场特效）读到的都是本帧位置

  return null;
}
