// 下属笔记的小卫星：写了 parent 的笔记不单独成星，绕着父节点转（一圈淡淡的轨道线 + 几颗小亮点）。
// 全部卫星用一个 InstancedMesh 画完；位置、亮度每帧跟着父节点走，不用 React state。
import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CONFIG } from '../config';
import { CATS } from '../../lib/meta';
import { seededRandom, type World } from '../world';
import { useSafeFrame } from './safeFrame';

interface Moon {
  r: number; // 轨道半径
  a0: number; // 起始角度
  speed: number; // 角速度（弧度/秒）
}
interface System {
  parent: number;
  u: THREE.Vector3; // 轨道平面的两个基向量
  v: THREE.Vector3;
  moons: Moon[];
  color: THREE.Color;
  rings: THREE.Group; // 轨道线
  ringMat: THREE.MeshBasicMaterial;
}

function build(world: World): System[] {
  const M = CONFIG.moons;
  const rng = seededRandom(CONFIG.sim.seed + 77);
  const out: System[] = [];
  world.nodes.forEach((node, parent) => {
    const count = node.moons.length;
    if (!count) return;
    // 轨道平面：从水平面倾斜一点，方向每个父节点不同
    const normal = new THREE.Vector3(0, 1, 0)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), M.tilt + (rng() - 0.5) * 0.3)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
    const u = new THREE.Vector3(1, 0, 0).cross(normal).normalize();
    const v = normal.clone().cross(u).normalize();

    // 一圈放不下就往外加圈：第 j 圈最多 perRing + j * perRingGrow 颗
    const moons: Moon[] = [];
    const radii: number[] = [];
    let left = count;
    for (let j = 0; left > 0; j++) {
      const cap = Math.min(left, M.perRing + j * M.perRingGrow);
      const r = M.orbit + j * M.gap;
      const start = rng() * Math.PI * 2;
      const dir = j % 2 ? -1 : 1; // 相邻两圈反向转
      for (let k = 0; k < cap; k++)
        moons.push({
          r,
          a0: start + ((k + (rng() - 0.5) * 0.5) / cap) * Math.PI * 2, // 大致均匀，带一点错落
          speed: (dir * M.speed) / Math.sqrt(1 + j * 0.6), // 外圈慢
        });
      radii.push(r);
      left -= cap;
    }

    const color = new THREE.Color(CATS[node.cat].color);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const rings = new THREE.Group();
    for (const r of radii) rings.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 128), ringMat));
    rings.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal); // 圆环默认躺在 XY 平面
    rings.scale.setScalar(0.0001);
    out.push({ parent, u, v, moons, color, rings, ringMat });
  });
  return out;
}

export function Moons({ world, reduce }: { world: World; reduce: boolean }) {
  const systems = useMemo(() => build(world), [world]);
  const total = systems.reduce((s, sys) => s + sys.moons.length, 0);
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ toneMapped: false }),
      Math.max(total, 1),
    );
    m.count = total;
    m.frustumCulled = false; // 实例每帧都在动，不按初始包围球裁剪
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const black = new THREE.Color(0);
    for (let k = 0; k < total; k++) {
      m.setMatrixAt(k, hidden);
      m.setColorAt(k, black);
    }
    return m;
  }, [total]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), p: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), c: new THREE.Color() }), []);

  useLayoutEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      for (const sys of systems) {
        sys.rings.children.forEach((r) => (r as THREE.Mesh).geometry.dispose());
        sys.ringMat.dispose();
      }
    },
    [mesh, systems],
  );

  useSafeFrame(({ clock }) => {
    if (!total) return;
    const M = CONFIG.moons;
    const t = reduce ? 0 : clock.elapsedTime;
    let k = 0;
    for (const sys of systems) {
      const center = world.R[sys.parent];
      // 跟父节点一起出现、一起放大（悬停/选中）、一起变暗
      const scale = world.visuals[sys.parent]?.group.scale.x ?? world.appear[sys.parent];
      const dim = world.dim[sys.parent];
      sys.rings.position.copy(center);
      sys.rings.scale.setScalar(Math.max(scale, 0.0001));
      sys.ringMat.opacity = M.ringOpacity * dim * world.appear[sys.parent];
      tmp.c.copy(sys.color).lerp(WHITE, M.whiten).multiplyScalar(M.glow * dim);
      for (const moon of sys.moons) {
        const a = moon.a0 + t * moon.speed;
        tmp.p
          .copy(center)
          .addScaledVector(sys.u, Math.cos(a) * moon.r * scale)
          .addScaledVector(sys.v, Math.sin(a) * moon.r * scale);
        tmp.s.setScalar(M.size * scale);
        mesh.setMatrixAt(k, tmp.m.compose(tmp.p, tmp.q, tmp.s));
        mesh.setColorAt(k, tmp.c);
        k++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!total) return null;
  return (
    <>
      <primitive object={mesh} />
      {systems.map((sys) => (
        <primitive key={sys.parent} object={sys.rings} />
      ))}
    </>
  );
}

const WHITE = new THREE.Color(1, 1, 1);
