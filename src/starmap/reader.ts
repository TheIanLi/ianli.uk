// 阅读层：在星图上面打开文章（同源 iframe），不离开首页。
// 关掉以后星图原样露出来，没有重新加载；地址栏照常变成文章的地址，浏览器后退 = 关掉文章。
// 文章页那一侧的配合代码在 src/layouts/Base.astro（发现自己被嵌在阅读层里，就向这里报告换页 / 请求关闭）。
import { useUI } from './store';

interface State {
  frame: HTMLIFrameElement;
  home: string; // 打开前首页的地址（含 #节点）
  homeTitle: string;
  hops: number; // 在阅读层里换过几次页（0 = 还停在打开的那一篇）
  slug: string; // 现在读的是哪一篇
  onClose: (slug: string) => void;
}
let cur: State | null = null;
let listening = false;

// 预载：选中一颗星后，先在后台把它的文章载好、排好版（看不见），点"阅读全文"时直接显示，不用等网络。
// 关掉文章后那一页也留着，再点开是原来读到的位置。同一时间只留一篇。
interface Slot {
  frame: HTMLIFrameElement;
  path: string;
  loaded: boolean;
  /** 还没排版的正文块；finish() 一次排完剩下的 */
  finish: () => void;
}
let pre: Slot | null = null;

function makeSlot(path: string): Slot {
  const frame = document.createElement('iframe');
  frame.className = 'sm-reader';
  frame.title = '文章';
  frame.inert = true; // 显示之前键盘和读屏器都进不去
  frame.style.display = 'none'; // 载入期间先不排版，载完再分批排（见下）
  frame.src = path;
  let rest: HTMLElement[] = [];
  const slot: Slot = {
    frame,
    path,
    loaded: false,
    finish: () => {
      for (const el of rest) el.style.removeProperty('display');
      rest = [];
    },
  };
  // 浏览器头一回排没见过的汉字很慢：长文章整页一次排完要占住主线程半秒，星图会跟着卡住。
  // 所以载完后先把页面一块块藏起来，再隔一小会儿放出一块来排，每次只占几毫秒到几十毫秒。
  frame.addEventListener(
    'load',
    () => {
      slot.loaded = true;
      if (frame.classList.contains('on')) return; // 网慢、已经先显示出来了：照常整页排，不要让读者看着一块块冒出来
      const doc = frame.contentDocument;
      rest = Array.from(doc?.querySelectorAll<HTMLElement>('main > :not(header):not(.prose), main > header > *, .prose > *') ?? []);
      for (const el of rest) el.style.display = 'none';
      frame.style.display = '';
      const step = () => {
        if (!rest.length || !frame.isConnected) return;
        const t = performance.now();
        do {
          rest.shift()!.style.removeProperty('display');
          void doc!.body.offsetHeight; // 立刻排掉这一块，才量得出花了多久
        } while (rest.length && performance.now() - t < 5);
        setTimeout(step, 40);
      };
      setTimeout(step, 40);
    },
    { once: true },
  );
  document.body.appendChild(frame);
  return slot;
}

/** 在后台预载一篇文章（阅读层开着时不动） */
export function preloadReader(path: string) {
  if (cur || pre?.path === path) return;
  pre?.frame.remove();
  pre = makeSlot(path);
}


const FADE = 180; // 淡入淡出的毫秒数，和 starmap.css 里 .sm-reader 的 transition 一致
const slugOf = (path: string) => /^\/n\/([^/]+)\/?$/.exec(path)?.[1] ?? '';

function show(path: string, onClose: State['onClose'], home: string) {
  let slot = pre;
  pre = null;
  if (slot?.path !== path) {
    slot?.frame.remove();
    slot = makeSlot(path);
  }
  const { frame } = slot;
  const state: State = { frame, home, homeTitle: document.title, hops: 0, slug: slugOf(path), onClose };
  cur = state;
  let shown = false;
  const reveal = () => {
    if (shown || cur !== state) return;
    shown = true;
    slot.finish(); // 还没排完的正文这时一次排完
    frame.style.display = '';
    frame.inert = false;
    frame.classList.add('on');
    frame.contentWindow?.focus(); // 键盘上下滚动直接作用在文章上
    const title = frame.contentDocument?.title;
    if (title) document.title = title;
    // 文章完全盖住以后再让星图停下来：淡入的这一小段星图还在动，不会像卡住了
    setTimeout(() => cur === state && useUI.setState({ reading: true }), FADE);
  };
  if (slot.loaded) reveal();
  else {
    frame.addEventListener('load', reveal, { once: true });
    setTimeout(reveal, 1200); // 网慢时也别一直空着
  }
}

function hide() {
  if (!cur) return;
  const { frame, homeTitle, slug, hops, onClose } = cur;
  const path = `/n/${slug}/`;
  cur = null;
  frame.classList.remove('on');
  frame.inert = true;
  window.focus(); // 键盘焦点从文章里拿回来
  // 没在里面换过页的话，这一页留着当预载（再点开就是刚才读到的位置）；换过页就扔掉
  if (hops === 0 && !pre) pre = { frame, path, loaded: true, finish: () => {} };
  else setTimeout(() => frame.remove(), FADE + 20);
  document.title = homeTitle;
  useUI.setState({ reading: false });
  onClose(slug);
}

function listen(onClose: State['onClose']) {
  if (listening) return;
  listening = true;
  // 浏览器前进 / 后退
  addEventListener('popstate', () => {
    const inReader = !!history.state?.smReader;
    if (cur && !inReader) hide();
    else if (!cur && inReader && slugOf(location.pathname)) show(location.pathname, onClose, '/');
  });
  // 文章页发来的消息
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !cur || e.source !== cur.frame.contentWindow) return;
    const d = e.data as { sm?: string; path?: string; title?: string };
    if (d?.sm === 'reader-nav' && typeof d.path === 'string') {
      const slug = slugOf(d.path);
      if (!slug) return closeReader(); // 阅读层里走到了不是文章的页面
      if (slug !== cur.slug) cur.hops++;
      cur.slug = slug;
      history.replaceState({ smReader: true }, '', d.path);
      if (d.title) document.title = d.title;
    } else if (d?.sm === 'reader-close') closeReader();
  });
}

/** 在星图上打开一篇文章。onClose 会拿到关掉时正在读的那篇的 slug */
export function openReader(path: string, onClose: State['onClose']) {
  listen(onClose);
  if (cur) return void (cur.frame.src = path);
  const home = location.pathname + location.search + location.hash;
  history.pushState({ smReader: true }, '', path);
  show(path, onClose, home);
}

/** 关掉阅读层，回到星图 */
export function closeReader() {
  if (!cur) return;
  if (cur.hops === 0 && history.state?.smReader) return history.back(); // 最常见的情况：退一步正好回到星图，由 popstate 收尾
  history.replaceState(null, '', cur.home); // 先把地址换回首页，hide 里选中节点时才会正确更新 #节点
  hide();
}

/** 给星图里的文章链接用：普通左键点击走阅读层；按着 Ctrl / 中键等照常让浏览器新开标签页 */
export function readerClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void }, path: string, onClose: State['onClose']) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  openReader(path, onClose);
}
