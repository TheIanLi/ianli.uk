// 首页启动器（很小，最先加载）：下载 3D 部分时显示真实进度，下完再启动星图。
// - 网速慢时不强制切 2D：10 秒后出现"先看列表"按钮，由访客自己选；选了列表，3D 在后台继续下载，下完给一个"进入 3D 星图"按钮
// - 只有真的失败（断网、脚本出错）才自动显示 2D 列表
// 不要在这里 import 其他模块：这个文件要保持很小，才能最先跑起来。
interface Manifest {
  files: { url: string; size: number }[];
}

const SLOW_MS = 10000;

export function boot() {
  const h = document.documentElement;
  const root = document.getElementById('sm-root');
  if (!root || !h.classList.contains('has-3d')) return; // 不支持 WebGL：直接是列表
  const $ = (id: string) => document.getElementById(id);
  const bar = $('sm-bar');
  const pct = $('sm-pct');
  const msg = $('sm-msg');
  const skip = $('sm-skip') as HTMLButtonElement | null;
  const chip = $('sm-chip');
  const enter = $('sm-enter') as HTMLButtonElement | null;
  let listMode = false;
  let loaded = false;
  let graph: unknown;
  let manifest: Manifest | null = null;
  try {
    graph = JSON.parse($('sm-graph')!.textContent!);
    manifest = JSON.parse($('sm-manifest')?.textContent || 'null');
  } catch {
    return fail();
  }

  const show = (p: number) => {
    const v = Math.round(p * 100);
    if (bar) bar.style.transform = `scaleX(${p})`;
    if (pct) pct.textContent = v + '%';
    if (chip) chip.textContent = `星图加载中 ${v}%`;
  };

  function fail() {
    h.classList.remove('has-3d');
    if (chip) chip.hidden = true;
  }

  const slow = setTimeout(() => {
    if (!loaded && skip) skip.hidden = false;
  }, SLOW_MS);
  skip?.addEventListener('click', () => {
    listMode = true;
    h.classList.remove('has-3d');
    if (chip) chip.hidden = false;
  });

  const start = async () => {
    const { mount } = await import('./mount');
    h.classList.add('has-3d');
    mount(root, graph as Parameters<typeof mount>[1]);
  };
  enter?.addEventListener('click', () => {
    enter.hidden = true;
    scrollTo(0, 0);
    start().catch(fail);
  });

  (async () => {
    // 先用 fetch 把所有脚本下载进浏览器缓存（边下边算进度），之后的 import 直接读缓存
    if (manifest?.files.length) {
      const total = manifest.files.reduce((s, f) => s + f.size, 0);
      let got = 0;
      await Promise.all(
        manifest.files.map(async (f) => {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`${f.url} ${res.status}`);
          if (!res.body) {
            got += (await res.arrayBuffer()).byteLength;
            return show(Math.min(1, got / total));
          }
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            got += value.byteLength;
            show(Math.min(1, got / total));
          }
        }),
      );
    }
    loaded = true;
    clearTimeout(slow);
    show(1);
    if (skip) skip.hidden = true;
    if (listMode) {
      if (chip) chip.hidden = true;
      if (enter) enter.hidden = false;
      return;
    }
    if (msg) msg.textContent = '启动 3D…';
    await start();
  })().catch((e) => {
    console.error('[星图] 加载失败，显示列表', e);
    clearTimeout(slow);
    fail();
  });
}
