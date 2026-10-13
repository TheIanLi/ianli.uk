---
title: "手机上动画快了 1000 倍：advance() 传了毫秒"
cat: proj
status: ok
summary: "网站上线 5 分钟后，手机上整个星图在抽搐，电脑上正常。React Three Fiber 的 frameloop 设成 never 以后，advance() 要的是秒，代码传的是毫秒。"
date: 2026-10-10
updated: 2026-10-13
parent: bugs
links: [site]
cmd: "advance(t / 1000)"
aliases: ["advance", "frameloop never", "手机抖动", "requestAnimationFrame", "R3F"]
---

React Three Fiber 的 `frameloop` 设成 `never` 以后，`advance()` 要的时间是秒。代码里传的是 `requestAnimationFrame` 给的毫秒，于是手机上所有动画快了 1000 倍，看起来是整个画面在抽搐。电脑上完全正常。改一行就好了。

当时的版本是 @react-three/fiber 9.8，three 0.186。

## 现象

网站上线 5 分钟后我用手机打开，整个星系一直在抖，每个节点都在疯转。同一个网址，电脑上一切正常。

## 第一次猜错了

Claude 第一反应是陀螺仪。手机上画面会跟着陀螺仪倾斜，电脑没有陀螺仪，"只有手机有问题"刚好对得上。它说是手的细微抖动被放大了，让我把手机平放在桌上，看抖动停不停。它同时已经准备动手改：给陀螺仪加一个 2° 的死区，再把小星系的转速降到四分之一左右。

我放了，照样抖：节点还在上下乱跳，星系还在疯转。我告诉它应该不是陀螺仪。

那两样最后都没改。

## 原因

陀螺仪排除以后，只有手机会走的代码就剩一段：帧率封顶。这段是当天下午才加的。Claude 查资料时查到旗舰手机的 120Hz 屏全速跑会发热降频，就给触屏设备加了 60 帧的上限。做法是把 `frameloop` 设成 `never`，让库别自己画，再用 `requestAnimationFrame` 一帧一帧地推：

```ts
const loop = (t: number) => {
  raf = requestAnimationFrame(loop);
  if (t - last < interval) return;
  last = t;
  advance(t); // 问题在这一行
};
```

`requestAnimationFrame` 给的 `t` 是毫秒。Claude 去翻了库的源码，`advance()` 在 `never` 模式下是这么用这个数的：

```js
if (state.frameloop === 'never' && typeof timestamp === 'number') {
  delta = timestamp - state.clock.elapsedTime;
  state.clock.oldTime = state.clock.elapsedTime;
  state.clock.elapsedTime = timestamp;
}
```

传进去的数直接成了时钟的读数。three.js 的时钟按秒算，场景里的动画也都按秒来用它。类型声明里这个参数叫 `timestamp`，没写单位，和 `requestAnimationFrame` 回调的参数一个名字，很容易直接传过去。

算一下就知道为什么看着是抽搐。节点上下浮动本来是 9 秒一个来回，快 1000 倍就是一秒 111 个来回。屏幕一秒才画 60 帧，每一帧节点都落在一个不相干的位置上，看着就是乱抖。行星本来 52 秒自转一圈，变成一秒 19 圈。

也不是所有东西都快了 1000 倍。镜头的缓动用的是"这一帧隔了多久"，代码里给它设了 0.1 秒的上限，所以最多快到 6 倍。疯掉的是按"总共过了多久"来算的那些：自转、浮动、小星系的旋转。

## 为什么电脑上看不出来

电脑不封顶帧率，`frameloop` 是默认的 `always`，库用自己的时钟，`advance()` 根本不会被调到。出问题的这段只在触屏设备上跑。上线之前，这个站我只在电脑上看过。Claude 那边没有显卡，只能靠截图自查，速度不对在截图上看不出来。

## 修法

```ts
advance(t / 1000);
```

从我说抖到修好的版本上线，不到 6 分钟：15:34 我发消息，15:38 提交，15:39 Cloudflare 构建完。其中一分多钟花在那个错的猜测上。
