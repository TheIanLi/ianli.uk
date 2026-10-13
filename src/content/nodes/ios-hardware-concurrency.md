---
title: "iPhone 上画面发糊：网页拿到的核数是假的"
cat: proj
status: ok
summary: "朋友的 iPhone 打开网站觉得糊，我的安卓一直清楚。代码按 CPU 核数给设备分档，而 iPhone 报给网页的核数不是真的，被分到了最低档。"
date: 2026-10-10
updated: 2026-10-13
parent: bugs
links: [site]
cmd: "navigator.hardwareConcurrency"
aliases: ["hardwareConcurrency", "iPhone 糊", "deviceMemory", "dpr", "Safari"]
---

iPhone 报给网页的 CPU 核数不是真的。代码拿这个数给设备分档，于是所有 iPhone 都被分到最低档：三倍屏只按一倍画，辉光也关了，看着就是糊。我的安卓手机报的是真核数，所以我自己一直看不出来。

## 现象

上线当天傍晚，朋友用苹果手机打开网站，说有点糊。我转给 Claude 的原话：

> 我朋友用苹果手机打开说感觉有点糊，是咋回事？我们设计的就没有这么高清吗？就是那种…不是特别高清，不是特别细腻的感觉，是我们写的太过于粗糙了么

我自己的手机上一直是清楚的。

## 原因

网站打开时会先判断设备的档次，再决定用什么画质。当时的判断是这样的：

```ts
const mem = nav.deviceMemory ?? 8;
const cores = nav.hardwareConcurrency ?? 8;
// ...
if (weakGpu || mem <= 2 || cores <= 4) return 'low';
if (coarsePointer() && (mem < 6 || cores < 8)) return 'mid';
return 'high';
```

核数不超过 4 就算低端机。最低档的画质是这样的：

```ts
low: { dpr: 1, aiParticles: 50, bloom: false, msaa: 0, bloomLevels: 0 },
```

`dpr: 1` 是按一倍分辨率画。iPhone 是三倍屏，一倍画出来的图要拉大三倍才铺满屏幕，这就是糊。`bloom: false` 是关掉辉光，画面会更平。

问题出在 `hardwareConcurrency` 上。Safari 为了不让网站靠硬件特征认出用户，不报真实的核数。

当时 Claude 查完告诉我的是"iPhone 一律只报 2 个核"。写这篇的时候它回去看了 WebKit 现在的源码，规则是这一行：

```cpp
static int numberOfCores = WTF::numberOfProcessorCores() < 8 ? 4 : 8;
```

真实核数不到 8 的报 4，8 个及以上的报 8。这条规则 2021 年 12 月就进了 WebKit。这几年的 iPhone 是 6 核，所以报出来是 4，不是 2。

结论没变：4 也过不了 `cores <= 4` 这一关，照样是最低档。但当时说的那个数是错的。朋友那台手机实际报了几，没人看过。

另外，`deviceMemory` 这个值 Safari 不提供，代码里拿不到就当成 8。所以内存那一条对 iPhone 不起作用，全靠核数这一条在判。

## 为什么我自己看不出来

我的手机是安卓，浏览器报的是真核数，一直在最高档。Claude 那边模拟不了 iPhone。这个问题上线前我们俩都没发现，是朋友的手机试出来的。

## 修法

改了两次。

第一次是给 iPhone 和 iPad 开一个例外：不看核数，直接从最高档开始。从我转述到修好上线，两分多钟。

三分钟后我跟它说：

> 要不全部按照最高档来？因为访问这个网站的都是我朋友，我朋友的手机都是很好的。

第二次就把整套猜设备档次的逻辑删了：

```ts
export function detectTier(): Tier {
  const forced = forcedTier();
  if (forced) return forced;
  if (/swiftshader|llvmpipe|software/i.test(gpuName())) return 'low';
  return 'high';
}
```

所有真机一律从最高档开始。跑不动的手机靠另一套东西兜底：运行时量实际的帧率，不够就一级一级往下降画质。还留着的例外只有一个，没有显卡、靠 CPU 硬算的环境。

修完以后那台 iPhone 上清楚了没有，我这里没有记录。
