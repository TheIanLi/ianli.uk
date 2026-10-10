// 带保护的 useFrame：逐帧逻辑里一旦抛错，不会让画面卡死在那一帧，而是记录错误并退回 2D 列表。
// （React 的错误边界抓不到渲染循环里的异常，所以要自己包一层。）
import { useFrame } from '@react-three/fiber';

type FrameCallback = Parameters<typeof useFrame>[0];

let onFatal: ((e: unknown) => void) | null = null;
let failed = false;

/** StarMap 挂载时登记：出错后做什么（退回 2D） */
export function setFatalHandler(fn: ((e: unknown) => void) | null) {
  onFatal = fn;
  failed = false;
}

export function useSafeFrame(cb: FrameCallback, priority?: number) {
  useFrame((state, delta, frame) => {
    if (failed) return;
    try {
      cb(state, delta, frame);
    } catch (e) {
      failed = true;
      console.error('[星图] 逐帧逻辑出错，退回 2D 列表', e);
      onFatal?.(e);
    }
  }, priority);
}
