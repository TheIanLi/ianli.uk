// ========================================================================
// 星图所有可调数值都在这里。想要"再亮一点""再快一点"，改这个文件就行。
// 时间单位：秒；距离单位：three.js 世界单位（节点间距约 12）。
// ========================================================================
export const CONFIG = {
  // ---- 后期：辉光 → 色调映射 → 暗角 → 胶片颗粒 ----
  // 辉光只捕捉亮度超过 threshold 的部分；色调映射把高光柔和压缩（不再截成纯白）
  bloom: {
    intensity: 0.9, // 整体辉光强度（"再亮一点"改这里）
    threshold: 0.55, // 亮度阈值，越低越多东西发光
    smoothing: 0.35, // 阈值过渡的柔和度
    radius: 0.72, // 光晕扩散半径 0..1
  },
  post: {
    toneMapping: 'NEUTRAL' as 'AGX' | 'ACES_FILMIC' | 'NEUTRAL', // 色调映射方式（NEUTRAL 保色相饱和度，适合霓虹色）
    vignette: 0.62, // 暗角浓度（四周压暗，视线集中到中间）
    vignetteOffset: 0.28,
    grain: 0, // 胶片颗粒强度（0 = 关；开了会让星球表面显得有噪点）
  },
  glow: {
    lineBase: 0.3, // 平时连线亮度（低于辉光阈值，不会"光污染"）
    lineActive: 2.2, // 选中/悬停时相连的连线
    flow: 2.4, // 流动光点
  },

  // ---- 天体造型 ----
  bodies: {
    lightFalloff: 30, // 恒星光照衰减距离：越小，远处的星球越暗
    fillLight: 0.7, // 补光强度：背光的星球也能看清（"星球太暗"改这里）
    star: {
      deep: '#c2410c', // 恒星表面暗部
      hot: '#ffb347', // 表面亮部
      white: '#fff4e0', // 正对镜头的中心
      intensity: 2.4, // 表面亮度（"太阳太亮/太暗"改这里）
      corona: '#ffb066', // 日冕颜色
      coronaIntensity: 1, // 日冕强度
      spikes: 0.35, // 星芒强度（0 = 关）
      ringGlow: 1.3, // 两道光环亮度
    },
    net: { radius: 1.45, dark: '#163a78', light: '#7cc0ff', atmoGlow: 1.3, atmoShell: 0.55, noiseScale: 1.3, bands: 7, cityLights: 1.3 },
    base: { radius: 1.35, dark: '#3a2f72', light: '#c0b0ff', atmoGlow: 1.15, atmoShell: 0.5, noiseScale: 1.4, bands: 0 },
    galaxy: {
      particles: { high: 7000, mid: 3500, low: 1800 }, // 高档位不省；中低档位（手机）才减 // AI 节点迷你星系的粒子数
      radius: 3.2, // 星系半径
      pitch: 0.5, // 旋臂缠绕（越小缠得越紧）
      inner: '#fff1d6', // 核球颜色
      outer: '#ffab5e', // 旋臂外缘颜色
      glow: 1.5,
    },
    projStar: { radius: 0.95, deep: '#b0245a', hot: '#ff8fb1', white: '#fff0f5', intensity: 2.2, corona: '#ff7aa2', coronaIntensity: 0.8 },
    halo: { base: 0.16, hot: 0.3 }, // 节点外圈淡光晕：平时 / 悬停时增加
  },

  // ---- 力导向布局（沿用原型参数）----
  sim: {
    seed: 20261009, // 随机种子：改了它，星系形状整体换一个
    repulsion: 42, // 节点互相排斥的力度（越大越舒展）
    spring: 0.04, // 连线弹簧的力度
    centering: 0.0052, // 拉向中心的力度
    damping: 0.88, // 速度衰减（越小越"粘"）
    minDist2: 9, // 排斥力的距离平方下限，防止贴太近时力爆炸
    linkLen: 14.5, // 普通连线的目标长度
    coreLinkLen: 18, // 连到本站核心的连线长度
    centerYLandscape: 1.25, // 宽屏时纵向收紧（>1 更扁，适合横屏）
    centerYPortrait: 0.45, // 竖屏时纵向放松（<1 更高，填满手机屏幕）
    centerXZPortrait: 1.25, // 竖屏时横向收紧（>1 更窄）
    portraitYScale: 1.12, // 竖屏时显示层把纵向拉高的倍数（只影响显示，不影响模拟）
    hotPull: 0.0035, // 悬停/选中时把邻居轻轻拉近
    stepsPerSecond: 60, // 模拟固定步频，和屏幕刷新率无关
  },

  // ---- 相机 ----
  camera: {
    fov: 50,
    theta: 0.85, // 初始水平角
    phi: 1.12, // 初始俯仰角
    ease: 0.075, // 跟随缓动（每 1/60 秒逼近的比例）
    minR: 22,
    maxR: 320,
    selectR: { wide: 40, compact: 48 }, // 选中节点后的镜头距离
    fit: { wide: 1.08, compact: 1.0 },
    // 运行时自动适配：节点在屏幕上的实际范围对齐到"可用区域"（去掉顶部标题和底部工具栏）
    autoFit: {
      wide: { left: 0.2, right: 0.8, top: 0.17, bottom: 0.85 }, // 星系大约占屏幕的六七成
      compact: { left: 0.1, right: 0.9, top: 0.25, bottom: 0.83 },
      speed: 0.015, // 调整速度（每 1/60 秒逼近的比例）
    }, // 默认镜头距离自动适配布局大小；越小越"满"（节点越靠近屏幕边缘）
    autoRotate: 0.066, // 闲置自动旋转速度（弧度/秒）
    idleMs: 2500, // 多久不操作开始自动旋转
    dragSpeed: 0.0055,
    wheelSpeed: 0.0011,
  },

  // ---- 点击飞行 ----
  fly: {
    duration: 0.9, // 飞向节点的用时
    backDuration: 0.75, // 取消选中飞回的用时
    fovPunch: 14, // 飞行途中视角张开多少度（"冲过去"的速度感）
    fovPunchBack: 6, // 飞回时张开多少度
  },

  // ---- 选中涟漪 ----
  ripple: {
    size: 18, // 涟漪最大直径（世界单位）
    duration: 1.1, // 一圈扩散的用时
    gap: 0.18, // 两圈之间的间隔
    width: 0.02, // 环宽（占半径比例）
    glow: 2.6, // 亮度
    repeatEvery: 2.8, // 停留时每隔多久再扩散一圈
    repeatOpacity: 0.35, // 后续涟漪的强度
    arriveGlow: 0.9, // 到达瞬间额外的辉光
  },

  // ---- 节点外观 ----
  nodes: {
    activeScale: 1.28, // 悬停/选中节点放大倍数
    dimOthers: 0.16, // 聚焦时其余节点的亮度
    oldDim: 0.72, // status: old 的节点亮度
    wipBreathSpeed: 1.8, // status: wip 呼吸速度
    wipBreathAmount: 0.1, // status: wip 呼吸幅度（缩放）
    bob: 0.35, // 上下漂浮幅度
    recentDays: 30, // updated 在多少天内算"最近更新"
    labelGap: 4, // 标签避让：标签之间至少留多少像素
  },

  // ---- 连线与能量脉冲 ----
  edges: {
    base: 1, // 平时亮度系数（乘 glow.lineBase）
    active: 1, // 与选中节点相连时的亮度
    catFocus: 0.6, // 图例筛选时同类连线亮度
    width: 1.1, // 平时线宽（像素）
    activeWidth: 2.4, // 相连连线的线宽（像素）
    segments: 14, // 每条线细分成多少小段（脉冲和渐变的精度）
    pulses: 2, // 每条相连连线上同时有几个能量脉冲
    pulseSpeed: 0.55, // 脉冲传播速度（每秒走过线长的比例）
    pulseWidth: 0.07, // 脉冲长度（占线长的比例）
    pulseGlow: 3, // 脉冲峰值亮度（越大越亮、辉光越强）
    endFade: 2.6, // 连线在节点附近淡出的距离（世界单位），核心端再乘 1.8
    flowSize: 1.4, // 脉冲波峰上的光点大小
    drawTipGlow: 4, // 开场画线时笔尖的亮度
  },

  // ---- 开场：蓄能 → 爆发 → 画线 + 打字（单位：秒，完整版约 4 秒）----
  intro: {
    bang: 1.0, // 爆发时刻（之前是蓄能阶段）
    chargeParticles: { high: 420, mid: 300, low: 180 }, // 蓄能粒子数
    chargeRadius: [14, 40], // 蓄能粒子起始半径范围
    chargeSpin: 3.2, // 蓄能粒子汇聚时的旋转圈数（弧度倍数）
    bloomSpike: 2.2, // 爆发瞬间辉光放大倍数（太高会整屏发白）
    bloomDecay: 0.18, // 辉光回落速度（越小回落越快）
    flash: 0.55, // 爆发闪光强度
    shake: 1.3, // 镜头震动幅度
    shakeDecay: 0.22, // 震动衰减
    shockwave: { size: 260, duration: 1.3, width: 0.007, glow: 1.8, color: '#ffe0b0' },
    trailLen: 12, // 节点飞出拖尾的长度（采样点数，每 1/60 秒开场时间采一次）
    trailFadeAt: 1.6, // 拖尾开始淡出的时刻
    nodesIn: 0.28, // 节点从 0 放大到正常的用时
    linesStart: 1.6, // 开始画线
    linesSpan: 1.2, // 所有连线按层级依次画完的总时长
    lineDraw: 0.38, // 每条线从起点画到终点的用时
    labelsStart: 3.9, // 开始打字（等名字星尘飞走之后）
    labelStagger: 0.03, // 每个标签之间的间隔
    typeSpeed: 0.03, // 每个字的用时
    // 名字星尘：从中心恒星涌出，在屏幕中央拼成 IAN LI，停留后飞到左上角变成正式标题
    dustIn: 2.2, // 星尘开始涌出
    dustForm: 0.85, // 拼成名字的用时
    dustOut: 3.55, // 开始飞向左上角
    dustFly: 0.75, // 飞行用时
    dustSize: 0.17, // 中央大字的字号（占屏幕宽度比例，再受 150px 上限约束）
    nameAt: 4.15, // 左上角正式标题开始"解码"出现（星尘快落地时）
    hudAt: 4.1, // 其余界面淡入
    done: 4.8, // 开场结束
    repeatSpeed: 2.6, // 第二次访问的播放倍速（约 1.5 秒）
    hashSelectAt: 4.6, // 网址带 #节点 时，开场后多久飞过去
  },

  // ---- 背景星空：远 / 中 / 近三层 ----
  stars: {
    layers: [
      { count: 4200, r: [780, 940], size: [0.9, 1.7], bright: [0.12, 0.34] }, // 远：密、小、暗
      { count: 1600, r: [480, 640], size: [1.2, 2.3], bright: [0.18, 0.45] }, // 中
      { count: 500, r: [260, 380], size: [1.8, 3.0], bright: [0.25, 0.6] }, // 近：稀、大、亮
    ],
    tierScale: { high: 1, mid: 0.7, low: 0.45 }, // 各档位星星数量比例
    brightShare: 0.025, // 亮星（会被辉光捕捉、闪光）的比例
    twinkle: 0.7, // 闪烁幅度 0..1
    drift: [0.002, 0.004, 0.007], // 各层缓慢自转速度
    parallax: [0.25, 0.55, 1.0], // 各层视差强度（倾斜时的反向偏转比例）
    spikes: { count: 16, size: 26, glow: 1.6 }, // 带十字星芒的亮星
    dust: { count: 900, r: [14, 120], size: [0.8, 1.6], bright: [0.06, 0.18], drift: 0.01 }, // 星系周围的漂浮尘埃
  },

  // ---- 星云（开场时在 GPU 上烘焙一次）----
  nebula: {
    colors: ['#1a3fb0', '#6a22b8', '#b0205e'], // 蓝 → 紫，再混一点玫红
    scale: 1.5, // 云团细碎程度（越大越碎）
    warp: 1.6, // 域扭曲强度：越大越像丝缕
    dust: 0.6, // 暗尘带的遮挡强度
    bandWidth: 0.42, // 银河带宽度
    strength: 0.2, // 整体浓度（"星云再明显一点"改这里；深邃克制：保持低）
    nearLayer: 0.3, // 近层星云的强度（体积感）
    texSize: { high: [2048, 1024], mid: [1024, 512], low: [512, 256] },
  },

  // ---- 背景交互：鼠标拨动星星、点击空白处荡开波纹（屏幕空间计算）----
  bgInteract: {
    radius: 0.22, // 鼠标影响范围（屏幕高度的比例）
    push: [0.012, 0.022, 0.04], // 远 / 中 / 近三层星星被推开的幅度（近层动得多，有纵深）
    dustPush: 0.06, // 星系周围漂浮尘埃被推开的幅度
    glow: 1.8, // 被拨动时变亮多少
    waveSpeed: 1.15, // 波纹扩散速度
    waveWidth: 0.06, // 波前宽度
    waveAmp: 1, // 波纹强度（0 = 关）
    reveal: 1.9, // 鼠标附近星云被"照亮"的强度
    revealRadius: 0.38, // 照亮范围
    waveGlow: 1.8, // 波纹扫过星云时的亮度
  },

  // ---- 视差倾斜：电脑跟随鼠标，手机跟随陀螺仪 ----
  tilt: {
    angle: 0.09, // 最大倾斜角（弧度）
    ease: 0.05, // 跟随缓动
    gyroRange: 22, // 手机倾斜多少度算"到头"
  },

  // bloom: 是否开辉光；msaa: 后期抗锯齿采样数；bloomLevels: 辉光模糊层数（越多越柔、越贵）
  tiers: {
    high: { dpr: 2, aiParticles: 110, bloom: true, msaa: 4, bloomLevels: 8 },
    mid: { dpr: 1.5, aiParticles: 80, bloom: true, msaa: 0, bloomLevels: 6 },
    low: { dpr: 1, aiParticles: 50, bloom: false, msaa: 0, bloomLevels: 0 },
  },
  // 触屏设备（手机/平板）即使判为高档位也收一点：不开 MSAA、辉光 6 层、帧率封顶 60（120Hz 屏全速跑会发热降频）
  touch: { msaa: 0, bloomLevels: 6, fpsCap: 60 },
  // 运行中按实测帧率自动升降一级（质量阶梯：分辨率 → MSAA → 辉光层数 → 关辉光）
  adapt: {
    flipflops: 8, // 来回升降超过这么多次就锁定在当前档，避免反复横跳
    startAfterIntro: true, // 开场结束后才开始观测（开场前几秒有编译、烘焙，帧率不代表常态）
  },

  // ---- 界面 ----
  ui: {
    glassBlur: false, // 详情卡片毛玻璃模糊：好看但每帧都要模糊后面的 3D 画面，耗显卡，默认关
  },

  // ---- 布局 ----
  layout: {
    compactWidth: 720, // 窗口比这窄就用手机式布局（底部抽屉）
    touchShortSide: 820, // 触屏设备短边小于此值也用手机式布局
  },
};

export type Tier = keyof typeof CONFIG.tiers;
