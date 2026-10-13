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

const slugOf = (path: string) => /^\/n\/([^/]+)\/?$/.exec(path)?.[1] ?? '';

function show(path: string, onClose: State['onClose'], home: string) {
  const frame = document.createElement('iframe');
  frame.className = 'sm-reader';
  frame.title = '文章';
  frame.src = path;
  const reveal = () => {
    frame.classList.add('on');
    frame.contentWindow?.focus(); // 键盘上下滚动直接作用在文章上
  };
  frame.addEventListener('load', reveal, { once: true });
  setTimeout(reveal, 1200); // 网慢时也别一直空着
  document.body.appendChild(frame);
  cur = { frame, home, homeTitle: document.title, hops: 0, slug: slugOf(path), onClose };
  useUI.setState({ reading: true });
}

function hide() {
  if (!cur) return;
  const { frame, homeTitle, slug, onClose } = cur;
  cur = null;
  frame.classList.remove('on');
  setTimeout(() => frame.remove(), 200);
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
