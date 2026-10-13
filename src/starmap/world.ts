// 星图的"世界"：所有逐帧变化的可变状态 + 力导向模拟 + 屏幕拾取。
// 这里不用 React state，渲染循环直接读写，避免每帧重绘界面。
import * as THREE from 'three';
import type { BloomEffect, EffectComposer } from 'postprocessing';
import { CONFIG } from './config';
import type { GraphNode } from '../lib/graph';
import type { Body } from './scene/bodies';

export interface GraphData {
  nodes: GraphNode[];
  edges: [string, string][];
}

export interface Edge {
  s: number;
  t: number;
  len: number;
  from: number; // 开场画线的起点（离核心更近的一端）
  to: number;
  drawAt: number; // 开场里第几个被画出（0..1，按层级排序后的位置）
}
export interface ScreenPos {
  x: number;
  y: number;
  z: number;
  ppu: number; // 每世界单位对应多少像素
  dist: number;
}

/** 可复现的伪随机数（mulberry32），保证每次打开星系形状一致 */
export function seededRandom(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
/** 与帧率无关的缓动系数：k 是每 1/60 秒逼近的比例 */
export const damp = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60);

export class World {
  readonly nodes: GraphNode[];
  readonly n: number;
  readonly edges: Edge[];
  readonly nb: Set<number>[];
  readonly recent: boolean[];
  level: number[]; // 到核心的跳数（BFS 层级）
  readonly labelOrder: number[]; // 开场打字顺序
  readonly labelRank: number[]; // 每个节点在打字顺序里的位置

  // 模拟位置 P、速度 V、渲染位置 R（P + 漂浮）
  readonly P: THREE.Vector3[];
  readonly V: THREE.Vector3[];
  readonly R: THREE.Vector3[];
  readonly phase: number[];
  readonly dim: number[]; // 当前亮度系数（缓动中）
  readonly appear: number[]; // 开场出现进度 0..1
  readonly sc: ScreenPos[];
  readonly visuals: (Body | null)[];
  readonly labels: (HTMLDivElement | null)[];
  readonly labelW: number[]; // 标签宽度缓存（0 = 待测量）
  readonly labelVis: number[]; // 标签避让后的可见度（缓动中）
  readonly labelText: (HTMLSpanElement | null)[]; // 标签里的名字部分（开场打字用）
  readonly typed: number[]; // 每个标签已打出的字数
  readonly edgeDraw: number[]; // 每条连线的绘制进度 0..1
  coordsEl: HTMLElement | null = null;
  bloom: BloomEffect | null = null;
  composer: EffectComposer | null = null;
  dithered = false; // 是否已给后期管线开启抖动（消除暗部色带）

  hover = -1;
  alpha = 1;
  portrait = false;
  acc = 0; // 模拟步进累计时间

  camS = { th: CONFIG.camera.theta, ph: CONFIG.camera.phi, r: 190, tx: new THREE.Vector3() };
  camG = { th: CONFIG.camera.theta, ph: CONFIG.camera.phi, r: 90, tx: new THREE.Vector3() };
  off = { x: 0, y: 0, gx: 0, gy: 0 };
  tilt = { x: 0, y: 0, gx: 0, gy: 0 }; // 视差倾斜 -1..1（鼠标位置或陀螺仪）
  mouse = Object.assign(new THREE.Vector2(9, 9), { t: -1e9 }); // 背景交互：鼠标位置（NDC）与最近一次移动时刻
  wave = { x: 0, y: 0, t: -1e9 }; // 背景交互：最近一次点击空白处（NDC）与时刻
  lastInteract = 0;
  dragging = false;
  userZoomed = false; // 用户手动缩放过：不再自动适配镜头距离
  fitOff = { x: 0, y: 0 }; // 自动适配的视口平移（像素），让布局包围盒居中在可用区域

  introT = 0; // 当前开场时间：按渲染帧累加（每帧最多 1/30 秒），页面卡住时开场也暂停，不会被跳过
  introId = 0; // 第几次开场（重放时 +1，其他组件据此重置）
  warm = { frames: 0, elapsed: 0, ready: false, compiled: false }; // 预热：着色器编译完、连续几帧流畅后才开始开场
  introSpike = 0; // 开场爆发带来的辉光倍数（Intro 写）
  selectGlow = 0; // 选中到达时的额外辉光（Ripple 写）
  lastSel = -1; // 上一帧的选中节点，用来发现"刚选中/刚取消"
  selAt = 0; // 最近一次选中的时刻（performance.now）
  timeScale = 1; // 开发调试：?timeScale=0.1 让飞行和涟漪慢放
  /** 飞行/涟漪用的时钟（毫秒），开发时可慢放 */
  ms() {
    return performance.now() * this.timeScale;
  }
  flight: { start: number; dur: number; punch: number; r: number; tx: THREE.Vector3 } | null = null;
  introStart = 0;
  introSpeed = 1;
  introDone = false;
  pendingSelect = -1;
  resumed = false; // 这次不是从开场进来的，而是恢复了离开前的画面（从文章页回来）
  resumeSnap = false; // 恢复后卡片第一次量出尺寸时，视口偏移直接到位，不再滑过去

  private rng: () => number;
  private tmp = new THREE.Vector3();

  constructor(data: GraphData) {
    this.nodes = data.nodes;
    this.n = data.nodes.length;
    const idx = new Map(data.nodes.map((n, i) => [n.slug, i]));
    this.nb = data.nodes.map(() => new Set<number>());
    this.edges = data.edges.map(([a, b]) => {
      const s = idx.get(a)!;
      const t = idx.get(b)!;
      this.nb[s].add(t);
      this.nb[t].add(s);
      const core = data.nodes[s].cat === 'core' || data.nodes[t].cat === 'core';
      return { s, t, len: core ? CONFIG.sim.coreLinkLen : CONFIG.sim.linkLen, from: s, to: t, drawAt: 0 };
    });

    // 从核心做广度优先遍历，得到每个节点的层级；开场按层级由内向外画线、打字
    this.level = data.nodes.map(() => Infinity);
    const coreIdx = data.nodes.findIndex((n) => n.cat === 'core');
    const queue = [coreIdx];
    this.level[coreIdx] = 0;
    while (queue.length) {
      const a = queue.shift()!;
      this.nb[a].forEach((b) => {
        if (this.level[b] === Infinity) {
          this.level[b] = this.level[a] + 1;
          queue.push(b);
        }
      });
    }
    const maxLv = Math.max(0, ...this.level.filter(Number.isFinite));
    this.level = this.level.map((l) => (Number.isFinite(l) ? l : maxLv + 1)); // 孤立节点排最后
    const lv = this.level;
    this.edges.forEach((e) => {
      if (lv[e.t] < lv[e.s]) [e.from, e.to] = [e.t, e.s];
    });
    const ranked = [...this.edges].sort(
      (a, b) => lv[a.from] - lv[b.from] || lv[a.to] - lv[b.to] || a.from - b.from || a.to - b.to,
    );
    ranked.forEach((e, k) => (e.drawAt = ranked.length > 1 ? k / (ranked.length - 1) : 0));
    this.labelOrder = data.nodes
      .map((_, i) => i)
      .sort((a, b) => lv[a] - lv[b] || a - b);
    this.labelRank = data.nodes.map(() => 0);
    this.labelOrder.forEach((i, j) => (this.labelRank[i] = j));
    const now = Date.now();
    this.recent = data.nodes.map(
      (n) => !!n.updated && (now - Date.parse(n.updated)) / 864e5 <= CONFIG.nodes.recentDays,
    );

    this.rng = seededRandom(CONFIG.sim.seed);
    const vec = () => new THREE.Vector3();
    this.P = data.nodes.map(vec);
    this.V = data.nodes.map(vec);
    this.R = data.nodes.map(vec);
    this.phase = data.nodes.map(() => this.rng() * Math.PI * 2);
    this.dim = data.nodes.map(() => 1);
    this.appear = data.nodes.map(() => 0);
    this.sc = data.nodes.map(() => ({ x: 0, y: 0, z: 0, ppu: 1, dist: 1 }));
    this.visuals = data.nodes.map(() => null);
    this.labels = data.nodes.map(() => null);
    this.labelW = data.nodes.map(() => 0);
    this.labelVis = data.nodes.map(() => 0);
    this.labelText = data.nodes.map(() => null);
    this.typed = data.nodes.map(() => -1);
    this.edgeDraw = this.edges.map(() => 0);
    // 预演两次最终布局，量出外接球半径（用来自动算镜头距离）；之后开场会重新播种
    this.ext = { land: this.measureExtent(false), port: this.measureExtent(true) };
  }

  isCore(i: number) {
    return this.nodes[i].cat === 'core';
  }

  /** 重置位置。explode=true：全部挤在中心带初速度（开场爆炸）；false：散开静置 */
  seed(explode: boolean) {
    this.rng = seededRandom(CONFIG.sim.seed);
    const d = this.tmp;
    for (let i = 0; i < this.n; i++) {
      d.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).normalize();
      const r = this.rng();
      if (this.isCore(i)) {
        this.P[i].set(0, 0, 0);
        this.V[i].set(0, 0, 0);
        continue;
      }
      this.P[i].copy(d).multiplyScalar(explode ? 0.3 : 12 + r * 10);
      this.V[i].copy(d).multiplyScalar(explode ? 2.2 + r * 1.6 : 0);
    }
    this.alpha = 1;
  }

  /** 力导向模拟走一步。hot = 当前悬停/选中的节点（把邻居轻轻拉近） */
  step(hot: number) {
    const { repulsion, spring, centering, damping, minDist2, hotPull, centerYLandscape, centerYPortrait, centerXZPortrait } = CONFIG.sim;
    const { P, V, n, alpha } = this;
    const tmp = this.tmp;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        tmp.subVectors(P[i], P[j]);
        let d2 = tmp.lengthSq();
        if (d2 < 1e-4) tmp.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5);
        d2 = Math.max(d2, minDist2);
        tmp.multiplyScalar((repulsion * alpha) / (d2 * Math.sqrt(d2)));
        V[i].add(tmp);
        V[j].sub(tmp);
      }
    for (const e of this.edges) {
      tmp.subVectors(P[e.t], P[e.s]);
      const d = tmp.length() || 0.01;
      tmp.multiplyScalar(((d - e.len) / d) * spring * alpha);
      V[e.s].add(tmp);
      V[e.t].sub(tmp);
    }
    if (hot >= 0)
      this.nb[hot].forEach((j) => {
        tmp.subVectors(P[hot], P[j]);
        if (tmp.length() > 9) V[j].addScaledVector(tmp, hotPull);
      });
    const cy = this.portrait ? centerYPortrait : centerYLandscape;
    const cxz = this.portrait ? centerXZPortrait : 1;
    for (let i = 0; i < n; i++) {
      if (this.isCore(i)) {
        P[i].set(0, 0, 0);
        V[i].set(0, 0, 0);
        continue;
      }
      const k = centering * alpha;
      V[i].x -= P[i].x * k * cxz;
      V[i].y -= P[i].y * k * cy;
      V[i].z -= P[i].z * k * cxz;
      V[i].multiplyScalar(damping);
      P[i].add(V[i]);
    }
    this.alpha = Math.max(hot >= 0 ? 0.12 : 0.03, alpha * 0.99);
  }

  /** 屏幕坐标拾取：离指针最近、且在命中半径内的节点 */
  pick(x: number, y: number, touch: boolean): number {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const s = this.sc[i];
      if (s.z > 1 || this.appear[i] < 0.5) continue;
      const rad = Math.max(touch ? 22 : 16, (this.isCore(i) ? 5.5 : 3.2) * s.ppu);
      if (Math.hypot(s.x - x, s.y - y) < rad && s.dist < bd) {
        bd = s.dist;
        best = i;
      }
    }
    return best;
  }

  /** 方向键导航：在相邻节点里找屏幕上最接近该方向的一个 */
  neighborInDirection(from: number, dx: number, dy: number): number {
    const a = this.sc[from];
    let best = -1;
    let bestScore = 0.3; // 至少要大致朝那个方向
    this.nb[from].forEach((j) => {
      const b = this.sc[j];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len = Math.hypot(vx, vy) || 1;
      const score = (vx * dx + vy * dy) / len - len / 4000;
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    });
    return best;
  }

  /** 布局在屏幕上的横向 / 纵向范围（横屏、竖屏各预演一次，构造时算好） */
  ext = { land: { h: 30, v: 30 }, port: { h: 30, v: 30 } };

  private measureExtent(portrait: boolean) {
    const was = this.portrait;
    this.portrait = portrait;
    this.seed(false);
    for (let k = 0; k < 600; k++) this.step(-1);
    this.portrait = was;
    // 镜头俯仰角 ph：屏幕纵向 ≈ y·sin(ph) + 水平半径·cos(ph)；横向 ≈ 水平半径
    const ph = CONFIG.camera.phi;
    let h = 0, v = 0;
    for (const p of this.P) {
      const rxz = Math.hypot(p.x, p.z);
      h = Math.max(h, rxz);
      const ys = portrait ? CONFIG.sim.portraitYScale : 1;
      v = Math.max(v, Math.abs(p.y) * ys * Math.sin(ph) + rxz * Math.cos(ph));
    }
    return { h, v };
  }

  /** 默认镜头距离：让整个布局正好填满视口（横、纵分别按视角适配，取更远的那个） */
  baseRadius(W: number, H: number): number {
    const e = H > W * 1.2 ? this.ext.port : this.ext.land;
    const { fov, fit } = CONFIG.camera;
    const tV = Math.tan(((fov * Math.PI) / 180) / 2);
    const tH = tV * (W / H);
    const margin = W < CONFIG.layout.compactWidth ? fit.compact : fit.wide;
    const d = Math.max(e.h / tH, e.v / tV) * margin + e.h * 0.25; // 近处的节点看起来更大，留一点余量
    return clamp(d, CONFIG.camera.minR, CONFIG.camera.maxR);
  }
}
