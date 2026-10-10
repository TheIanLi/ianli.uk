import * as THREE from 'three';

/** 用 canvas 画一张白色径向渐变贴图（光晕、光点用） */
function radial(stops: [number, number][], size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, a]) => gr.addColorStop(o, `rgba(255,255,255,${a})`));
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

let cache: { glow: THREE.Texture; dot: THREE.Texture } | null = null;
export function textures() {
  return (cache ??= {
    glow: radial([[0, 1], [0.15, 0.6], [0.4, 0.14], [1, 0]], 128),
    dot: radial([[0, 1], [0.35, 0.85], [0.6, 0.2], [1, 0]], 64),
  });
}
