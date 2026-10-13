// 节点详情：电脑上是右侧玻璃卡片，手机上是可拖动的底部抽屉。
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { CATS, STATUS } from '../../lib/meta';
import { useUI } from '../store';
import { readerClick } from '../reader';
import type { World } from '../world';
import type { GraphNode } from '../../lib/graph';

function Cmd({ cmd }: { cmd: string }) {
  return (
    <pre className="cmd">
      {cmd.split('\n').map((l, k, arr) => (
        <span key={k}>
          <span className={l.trimStart().startsWith('#') ? 'ln note' : 'ln'}>{l}</span>
          {k < arr.length - 1 && '\n'}
        </span>
      ))}
    </pre>
  );
}

function Body({ world, node, onPick }: { world: World; node: GraphNode; onPick: (i: number) => void }) {
  const deselect = useUI((s) => s.deselect);
  const landOn = useUI((s) => s.landOn);
  const i = world.nodes.indexOf(node);
  const nbs = [...world.nb[i]].sort((a, b) => a - b);
  const st = STATUS[node.status];
  return (
    <>
      <div className="p-head">
        <i />
        <span>{CATS[node.cat].name}</span>
        <span className="nid">{node.code}</span>
        <button className="close" type="button" aria-label="关闭" onClick={deselect}>
          ✕
        </button>
      </div>
      <h2>{node.title}</h2>
      <div className="p-row">
        <span className={`status ${st.cls}`}>{st.name}</span>
        {world.recent[i] && <span className="p-new">最近更新 {node.updated}</span>}
      </div>
      <p className="sum">{node.summary}</p>
      {node.cmd && <Cmd cmd={node.cmd} />}
      {nbs.length > 0 && (
        <>
          <div className="p-sub">相连节点</div>
          <div className="links">
            {nbs.map((j) => (
              <button
                key={j}
                type="button"
                className="chip"
                style={{ '--c': CATS[world.nodes[j].cat].color } as CSSProperties}
                onClick={() => onPick(j)}
              >
                <i />
                {world.nodes[j].title}
              </button>
            ))}
          </div>
        </>
      )}
      {node.moons.length > 0 && (
        <>
          <div className="p-sub">收录 · {node.moons.length}</div>
          <ul className="moons">
            {node.moons.map((m) => (
              <li key={m.slug}>
                <a href={`/n/${m.slug}/`} onClick={(e) => readerClick(e, `/n/${m.slug}/`, landOn)}>
                  <i />
                  {m.title}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="p-foot">
        <a className="read" href={`/n/${node.slug}/`} onClick={(e) => readerClick(e, `/n/${node.slug}/`, landOn)}>
          阅读全文 →
        </a>
        {node.repo && (
          <a className="repo" href={node.repo} target="_blank" rel="noopener">
            仓库 ↗
          </a>
        )}
      </div>
    </>
  );
}

/** 预热文字：把每张卡片会出现的字，用卡片的字体字号先排一遍（看不见）。
 *  浏览器头一回排没见过的汉字很慢，实测一张卡片要 150–250ms，全卡在点击后的第一帧。
 *  这里在加载画面期间一次做掉，之后点星就不再卡在排版上。
 *  末尾那块是给文章用的：同样的字按文章正文、标题、代码的字号再排一遍，
 *  阅读层头一回排文章能从 0.7 秒左右降到 0.25 秒左右（字号对应 src/pages/n/[slug].astro 的 .prose）。 */
export const PanelWarm = memo(function PanelWarm({ world }: { world: World }) {
  const text = world.nodes.map((n) => `${n.title} ${n.summary} ${n.moons.map((m) => m.title).join(' ')}`).join(' ');
  return (
    <aside className="sm-panel card sm-warm" aria-hidden="true">
      {world.nodes.map((n) => (
        <Body key={n.slug} world={world} node={n} onPick={() => {}} />
      ))}
      <div className="warm-prose">
        <p>{text}</p>
        <b>{text}</b>
        <code>{text}</code>
      </div>
    </aside>
  );
});

export function Panel({ world }: { world: World }) {
  const selected = useUI((s) => s.selected);
  const compact = useUI((s) => s.compact);
  const select = useUI((s) => s.select);
  const deselect = useUI((s) => s.deselect);
  const [full, setFull] = useState(false);
  const drag = useDragControls();
  const ref = useRef<HTMLElement>(null);

  // 关闭动画期间继续显示上一个节点的内容
  const last = useRef<GraphNode | null>(null);
  const node = selected >= 0 ? world.nodes[selected] : null;
  if (node) last.current = node;
  const shown = node ?? last.current;

  useEffect(() => {
    if (selected < 0) setFull(false);
  }, [selected]);

  // 根据卡片实际尺寸偏移视口，让选中节点不被挡住。
  // 用 ResizeObserver 自己给出的尺寸（浏览器排版后回调），不主动读 offsetWidth——
  // 主动读会强制整页立即重排，在标签每帧移动的页面上非常贵，是点击瞬间卡顿的主因。
  useEffect(() => {
    const el = ref.current;
    if (!el || selected < 0) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      const w = box ? box.inlineSize : entry.contentRect.width;
      const h = box ? box.blockSize : entry.contentRect.height;
      if (compact) {
        world.off.gx = 0;
        world.off.gy = Math.round(h / 2);
      } else {
        world.off.gx = Math.round((w + 20) / 2);
        world.off.gy = 0;
      }
      // 从文章页回来、恢复画面时：偏移直接到位，画面不滑动
      if (world.resumeSnap) {
        world.resumeSnap = false;
        world.off.x = world.off.gx;
        world.off.y = world.off.gy;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [selected >= 0, compact, world]);

  const style = shown ? ({ '--c': CATS[shown.cat].color } as CSSProperties) : undefined;

  return (
    <AnimatePresence>
      {node &&
        (compact ? (
          <motion.aside
            key="sheet"
            ref={ref}
            className={`sm-panel sheet${full ? ' full' : ''}`}
            style={style}
            aria-live="polite"
            initial={world.resumeSnap ? false : { y: '105%' }}
            animate={{ y: 0 }}
            exit={{ y: '105%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.08, bottom: 0.7 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 90 || info.velocity.y > 600) {
                if (full) setFull(false);
                else deselect();
              } else if (info.offset.y < -50 || info.velocity.y < -600) setFull(true);
            }}
          >
            <div className="grab" onPointerDown={(e) => drag.start(e)}>
              <span />
            </div>
            <div className="scroll">{shown && <Body world={world} node={shown} onPick={select} />}</div>
          </motion.aside>
        ) : (
          <motion.aside
            key="card"
            ref={ref}
            className="sm-panel card"
            style={style}
            aria-live="polite"
            initial={world.resumeSnap ? false : { x: 'calc(100% + 40px)', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 'calc(100% + 40px)', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 260 }}
          >
            {shown && <Body world={world} node={shown} onPick={select} />}
          </motion.aside>
        ))}
    </AnimatePresence>
  );
}
