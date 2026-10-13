// 四角仪表：品牌、操作按钮、图例、坐标读数。手机式布局（compact）时重排到顶部 + 底部工具栏。
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CATS, CAT_ORDER } from '../../lib/meta';
import { useUI } from '../store';
import type { World } from '../world';

const NAME = 'IAN LI';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+/<>';

/** 品牌标题：Syne 字体 + 渐变。出现时字母从乱码里逐个"解出来"；鼠标移上去再解码一次 */
function Brand({ still, quiet }: { still: boolean; quiet: boolean }) {
  const [text, setText] = useState(NAME);
  const nameIn = useUI((s) => s.nameIn);
  const shown = still || nameIn;
  const busy = useRef(false);
  const decode = useCallback(() => {
    if (busy.current || still) return;
    busy.current = true;
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 700;
      const done = Math.floor(t * NAME.length);
      setText(NAME.split('').map((c, i) => (c === ' ' || i < done ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(''));
      if (t < 1) requestAnimationFrame(step);
      else {
        setText(NAME);
        busy.current = false;
      }
    };
    requestAnimationFrame(step);
  }, [still]);
  // 开场时钟走到 nameAt（星尘快落地）时解码出现
  useEffect(() => {
    if (nameIn && !still && !quiet) decode(); // quiet：恢复画面时名字直接在那，不再解码一遍
  }, [nameIn, still, quiet, decode]);
  return (
    <div className="brand">
      <div className="domain reveal">ianli.uk · 星图</div>
      <h1 aria-label={NAME} className={shown ? 'on' : undefined} onPointerEnter={decode}>
        {text.split('').map((c, k) => (
          <span key={k} className={c === NAME[k] ? undefined : 'scr'}>
            {c === ' ' ? '\u00a0' : c}
          </span>
        ))}
      </h1>
      <p className="reveal">折腾记录与个人笔记</p>
    </div>
  );
}

function Legend({ world }: { world: World }) {
  const focusCat = useUI((s) => s.focusCat);
  const toggleCat = useUI((s) => s.toggleCat);
  return (
    <nav className={`legend reveal${focusCat ? ' filtering' : ''}`} aria-label="分类">
      <div className="cap">
        {world.n} 节点 · {world.edges.length} 连接
      </div>
      <div className="legs">
        {CAT_ORDER.map((k) => {
          const cnt = world.nodes.filter((n) => n.cat === k).length;
          if (!cnt) return null;
          return (
            <button
              key={k}
              type="button"
              className="leg"
              aria-pressed={focusCat === k}
              style={{ '--c': CATS[k].color } as CSSProperties}
              onClick={() => toggleCat(k)}
            >
              <i />
              <b>{CATS[k].name}</b>
              <em>{String(cnt).padStart(2, '0')}</em>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

const GitHubLink = ({ short }: { short?: boolean }) => (
  <a className="btn" href="https://github.com/TheIanLi" target="_blank" rel="noopener">
    {short ? 'GitHub' : 'GitHub ↗'}
  </a>
);

export function Hud({ world, reduce }: { world: World; reduce: boolean }) {
  const compact = useUI((s) => s.compact);
  const nonce = useUI((s) => s.replayNonce);
  const setPalette = useUI((s) => s.setPalette);
  const replay = useUI((s) => s.replay);
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  const searchBtn = (
    <button className="btn search" type="button" onClick={() => setPalette(true)} aria-label="搜索节点">
      <span className="lbl">搜索节点</span>
      <span className="kbd">/</span>
    </button>
  );
  const replayBtn = (
    <button className="btn replay" type="button" onClick={replay}>
      重放开场
    </button>
  );

  // key={nonce}：重放时重建这些元素，让入场动画重新播放
  return (
    <div className="hud-layer" key={nonce}>
      <header className="hud top">
        <Brand still={reduce} quiet={world.resumed} />
        <div className="actions reveal">
          {compact ? replayBtn : searchBtn}
          <GitHubLink short={compact} />
        </div>
      </header>

      {compact ? (
        <div className="hud bottom-bar reveal">
          <Legend world={world} />
          {searchBtn}
        </div>
      ) : (
        <>
          <div className="hud legend-wrap">
            <Legend world={world} />
          </div>
          <div className="hud readout reveal">
            <div className="coords" ref={(el) => void (world.coordsEl = el)}>
              θ 0.0° · φ 0.0° · r 0
            </div>
            <div className="hint">{touch ? '拖动旋转 · 双指缩放 · 点按节点' : '拖动旋转 · 滚轮缩放 · 点击节点 · / 搜索 · 方向键跳转'}</div>
            {replayBtn}
          </div>
        </>
      )}
    </div>
  );
}
