// 节点名字标签。只渲染一次，位置和透明度由 Driver 每帧直接改 style。
import type { CSSProperties } from 'react';
import { CATS } from '../../lib/meta';
import type { World } from '../world';

export function Labels({ world }: { world: World }) {
  return (
    <div className="sm-labels" aria-hidden="true">
      {world.nodes.map((n, i) => (
        <div
          key={n.slug}
          className="lab"
          style={{ '--c': CATS[n.cat].color } as CSSProperties}
          ref={(el) => {
            world.labels[i] = el;
          }}
        >
          <small>{n.code}</small>
          {/* 名字由 Driver 逐字写入（开场打字），React 不管它的内容 */}
          <span
            ref={(el) => {
              world.labelText[i] = el;
            }}
          />
          {world.recent[i] && <em className="new">新</em>}
        </div>
      ))}
    </div>
  );
}
