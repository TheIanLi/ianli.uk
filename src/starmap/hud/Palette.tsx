// 终端风格搜索：按 / 打开，ian@ianli:~$ goto
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CATS } from '../../lib/meta';
import { useUI } from '../store';
import { openReader } from '../reader';
import type { World } from '../world';

export function Palette({ world }: { world: World }) {
  const open = useUI((s) => s.palette);
  const setPalette = useUI((s) => s.setPalette);
  const select = useUI((s) => s.select);
  const [q, setQ] = useState('');
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const haystack = useMemo(
    () => world.nodes.map((n) => [n.title, n.slug, n.code, CATS[n.cat].name, ...n.aliases].join(' ').toLowerCase()),
    [world],
  );
  // 下属笔记（星图上的小卫星）也能搜到：编号接在节点后面，选中后直接去文章页。不输入时不列出来，免得太长
  const moons = useMemo(() => world.nodes.flatMap((n, parent) => n.moons.map((m) => ({ ...m, parent }))), [world]);
  const moonHay = useMemo(() => moons.map((m) => [m.title, m.slug, ...m.aliases].join(' ').toLowerCase()), [moons]);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^(cd|goto)\s+/, '');
    const nodes = world.nodes.map((_, i) => i).filter((i) => !s || haystack[i].includes(s));
    return s ? [...nodes, ...moons.map((_, k) => world.n + k).filter((_, k) => moonHay[k].includes(s))] : nodes;
  }, [q, haystack, world, moons, moonHay]);

  useEffect(() => {
    if (open) {
      setQ('');
      setCur(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);
  useEffect(() => setCur(0), [q]);
  useEffect(() => {
    list.current?.children[cur]?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  if (!open) return null;
  const close = () => setPalette(false);
  const go = (i: number) => {
    close();
    if (i >= world.n) openReader(`/n/${moons[i - world.n].slug}/`, useUI.getState().landOn);
    else select(i);
  };

  return (
    <div className="sm-palette" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="term" role="dialog" aria-label="搜索节点">
        <div className="term-bar">
          <i />
          <i />
          <i />
          <span>ian@ianli — goto</span>
        </div>
        <div className="prompt">
          <label htmlFor="sm-q">
            ian@ianli<b>:~$</b> goto
          </label>
          <input
            id="sm-q"
            ref={input}
            value={q}
            autoComplete="off"
            spellCheck={false}
            placeholder="输入名字，比如 sing / ollama / 项目"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && hits.length) {
                e.preventDefault();
                setCur((c) => (c + 1) % hits.length);
              } else if (e.key === 'ArrowUp' && hits.length) {
                e.preventDefault();
                setCur((c) => (c - 1 + hits.length) % hits.length);
              } else if (e.key === 'Enter' && hits[cur] !== undefined) {
                go(hits[cur]);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
          />
        </div>
        <ul className="res" role="listbox" ref={list}>
          {hits.length === 0 && <li className="empty">goto: {q}: 没有这个节点</li>}
          {hits.map((i, k) => {
            if (i >= world.n) {
              const m = moons[i - world.n];
              const p = world.nodes[m.parent];
              return (
                <li key={m.slug} role="option" aria-selected={k === cur} className={k === cur ? 'on' : undefined}>
                  <button type="button" style={{ '--c': CATS[p.cat].color } as CSSProperties} onClick={() => go(i)}>
                    <i />
                    <span>{m.title}</span>
                    <em>{p.title} →</em>
                  </button>
                </li>
              );
            }
            const n = world.nodes[i];
            return (
              <li key={n.slug} role="option" aria-selected={k === cur} className={k === cur ? 'on' : undefined}>
                <button type="button" style={{ '--c': CATS[n.cat].color } as CSSProperties} onClick={() => go(i)}>
                  <i />
                  <span>{n.title}</span>
                  <em>
                    {n.code} · {CATS[n.cat].name}
                  </em>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
