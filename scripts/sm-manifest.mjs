// Astro 构建完成后：找到 3D 入口 mount.*.js，顺着 import 收集它依赖的所有脚本和大小，
// 写进 dist/index.html 的 #sm-manifest，首页启动器（src/starmap/boot.ts）据此显示真实下载进度。
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = '<script type="application/json" id="sm-manifest">null</script>';

export function smManifest() {
  return {
    name: 'sm-manifest',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const astroDir = join(dist, '_astro');
        const entry = readdirSync(astroDir).find((f) => /^mount\.[\w-]+\.js$/.test(f));
        if (!entry) throw new Error('[sm-manifest] 找不到 mount.*.js，3D 入口改名了？');
        const seen = new Set();
        const walk = (f) => {
          if (seen.has(f)) return;
          seen.add(f);
          const code = readFileSync(join(astroDir, f), 'utf8');
          // 只跟静态 import（from"./x.js" 或 import"./x.js"）；动态 import 的懒加载块不算进首屏
          for (const m of code.matchAll(/(?:\bfrom|\bimport)\s*["'`]\.\/([\w.-]+\.js)["'`]/g)) walk(m[1]);
        };
        walk(entry);
        const files = [...seen].map((f) => ({ url: `/_astro/${f}`, size: statSync(join(astroDir, f)).size }));
        const html = join(dist, 'index.html');
        const src = readFileSync(html, 'utf8');
        if (!src.includes(PLACEHOLDER)) throw new Error('[sm-manifest] index.html 里找不到 #sm-manifest 占位');
        const json = JSON.stringify({ files }).replace(/</g, '\\u003c');
        writeFileSync(html, src.replace(PLACEHOLDER, PLACEHOLDER.replace('>null<', `>${json}<`)));
        const kb = Math.round(files.reduce((s, f) => s + f.size, 0) / 1024);
        logger.info(`3D 首屏脚本 ${files.length} 个，共 ${kb} KB（未压缩）`);
      },
    },
  };
}
