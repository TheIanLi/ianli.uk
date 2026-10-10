// 节点外壳：创建天体（见 bodies.ts），登记到 world.visuals，由 Driver 每帧驱动。
import { useLayoutEffect, useMemo } from 'react';
import type { Tier } from '../config';
import type { World } from '../world';
import { makeBody } from './bodies';

export function NodeShape({ world, i, tier }: { world: World; i: number; tier: Tier }) {
  const body = useMemo(() => makeBody(world.nodes[i], i, world.nb[i].size, tier), [world, i, tier]);

  useLayoutEffect(() => {
    body.group.scale.setScalar(0.0001);
    world.visuals[i] = body;
    return () => {
      if (world.visuals[i] === body) world.visuals[i] = null;
    };
  }, [world, i, body]);

  return <primitive object={body.group} />;
}
