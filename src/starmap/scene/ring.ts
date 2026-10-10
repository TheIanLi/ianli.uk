// 细光环：一个永远面向镜头的方片，片元着色器画一圈高斯衰减的环。
// 开场冲击波和选中涟漪都用它。半径 0..1 由 uniform 控制，环宽不会随放大变粗。
import * as THREE from 'three';

const vert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
uniform float uWidth;
uniform float uOpacity;
uniform float uFill;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float ring = exp(-pow((d - uRadius) / uWidth, 2.0));
  float inner = uFill * smoothstep(uRadius, 0.0, d) * step(d, uRadius); // 环内很淡的一层压力波
  float a = (ring + inner) * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`;

export type RingMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

export function makeRing(color: THREE.ColorRepresentation, glow: number, width: number, fill = 0): RingMesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uColor: { value: new THREE.Color(color).multiplyScalar(glow) },
      uRadius: { value: 0 },
      uWidth: { value: width },
      uOpacity: { value: 0 },
      uFill: { value: fill },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/** 设置一帧的环状态：radius 0..1，opacity 0..1 */
export function setRing(m: RingMesh, radius: number, opacity: number) {
  m.visible = opacity > 0.001;
  m.material.uniforms.uRadius.value = radius;
  m.material.uniforms.uOpacity.value = opacity;
}
