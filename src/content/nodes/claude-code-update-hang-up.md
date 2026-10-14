---
title: "Claude Code 自动更新失败：socket hang up"
cat: ai
status: wip
summary: "9 月 Claude Code 一直更新失败，模型列表里没有新模型。当时的结论是更新程序不走代理，手动下载装上了。到了 10 月，去掉代理反而更新成功，跟当时的结论正好相反。"
date: 2026-10-14
parent: bugs
links: [claude-code, wsl]
cmd: "claude update"
aliases: ["claude update", "socket hang up", "自动更新", "Auto-update failed", "TUN", "代理", "https_proxy"]
---

Claude Code 的自动更新在我这里失败过好几次，报错都是 `socket hang up`。9 月那次，Claude 查出来的原因是更新程序不走代理，直接连下载服务器被挡了，最后手动下载装上的。10 月 14 日写这篇的时候又失败了一次，这回是把代理去掉才更新成功。两次的结论正好相反，我也没完全搞懂。

## 9 月：卡在旧版本

9 月 12 日晚上我刚重新用回 Claude Code，发现模型列表里没有 Opus 5。查下来是客户端太旧，还停在 2.1.218，自动更新一直失败，界面上挂着一条红色的 Auto-update failed。

我自己在终端里跑了好几遍 `claude update`，每次都是：

```
TelemetrySafeError: Failed to fetch version from https://downloads.claude.ai/… socket hang up
```

`claude doctor` 显示上一次更新尝试是 `failed (install_failed)`。版本目录里还多了一个 0 字节的 2.1.269，是更新失败留下的空文件。

## Claude 当时的判断

我的电脑在国内，Anthropic 的服务不走代理是连不上的。终端里设了代理环境变量，平时 Claude Code 跟服务器通信都没问题。

Claude 拿 curl 分别测了下载服务器：走代理返回 200，不走代理超时。它的结论是 Claude Code 的更新程序不认终端里的代理设置，自己直接去连下载服务器，被挡了，于是 socket hang up。它试着加了一个让 Node 读代理变量的开关，也没用。

官方的安装脚本也试了，同样失败。Claude 读了脚本才弄明白：前面几步是 curl 下载，走代理，都成功了，最后一步是调用 `claude install`，这一步又是更新程序自己去联网，又挂了。

## 手动装

最后绕开了更新程序。安装脚本里写着一个 Google 云存储的下载地址，Claude 通过代理从那里拿到最新版本号和校验文件，下载 2.1.269 的程序本体，大约 209MB，核对 SHA256 一致以后放进版本目录，再把 `claude` 命令指向的链接改到新版本。旧版本留着，出问题可以切回去。

重开 Claude Code，版本变成了 2.1.269，Opus 5 也出来了。

它最后建议我在 Windows 的代理软件里开 TUN 模式，说这是根治的办法：TUN 在网络层接管所有流量，不认代理设置的程序也会被接管。它以为我用的是 Clash Verge，其实我用的是 v2rayN。我拿这个去问渡鸦，开了 TUN，我服务器上的分流规则还会不会正常生效。渡鸦说先别开，TUN 会影响 DNS 和域名识别，规则不一定都能认出来。同一次排查里 Claude 还说我平时的流量全在走美国，渡鸦实测是香港。两个 AI 说法对不上，我当时也没再追究。

TUN 后来还是开了，9 月 17 日我已经在用了，开着它还出过别的毛病。具体哪天开的，记录里没找到。

## 10 月：反过来了

10 月 9 日和 11 日 Claude Code 又各升过一次版本，到了 2.1.296。这两次是怎么升上去的，记录里没有。

10 月 14 日晚上写这篇的时候，版本目录里又出现了一个 0 字节的 2.1.299，自动更新又失败了。我让 Claude 手动跑了两次 `claude update`，两次都失败了，报错分别是：

```
Error: Failed to install native update
AxiosError: stream has been aborted
```

```
Error: Failed to install native update
Error: socket hang up
```

跟 9 月不一样的是，这次版本号是查到了的，失败在下载那一步。

它又用 curl 测了一遍。现在 TUN 开着，不走代理也能连上下载服务器，出口显示在洛杉矶。用 curl 下载完整的 265MB 程序，走代理和不走代理都能下完，大概每秒 16MB。

然后它把终端里的代理环境变量去掉，再跑一次 `claude update`：

```
Successfully updated from 2.1.296 to version 2.1.299
```

成功了。

## 还没搞懂的

9 月的结论是更新程序不走代理，所以失败。10 月是把代理设置去掉才成功，说明它至少现在是读了代理设置的，而且走代理下载会断。中间我开了 TUN，Claude Code 也升了好几个版本，到底是哪个变化让情况反过来，我不知道。

curl 走同一个代理能完整下完，更新程序走代理就断，这点也没查明白。

现在的做法是：自动更新失败了，就去掉代理环境变量手动跑一次 `claude update`。前提是 TUN 开着，不然不走代理是连不上的。
