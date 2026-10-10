#!/usr/bin/env node
// 提交前扫描：IP 地址、私钥、常见 API 密钥、非 noreply 邮箱。
//   node scripts/check-secrets.mjs           扫描仓库里所有会被提交的文件
//   node scripts/check-secrets.mjs --staged  只扫暂存区（pre-commit hook 用）
// 某一行确实没问题（比如文档里的示例），在行尾写 secrets-ignore 即可跳过。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const staged = process.argv.includes('--staged');
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 << 20 });

const files = (staged ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR') : git('ls-files', '-co', '--exclude-standard'))
  .split('\n')
  .filter(Boolean)
  .filter((f) => !/(^|\/)package-lock\.json$|\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|zip)$/i.test(f))
  .filter((f) => f !== 'scripts/check-secrets.mjs' && f !== '.secrets-terms');

const ALLOWED_IPS = new Set(['127.0.0.1', '0.0.0.0', '255.255.255.255']);
const RULES = [
  {
    name: 'IP 地址',
    re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.])/g,
    skip: (m) => ALLOWED_IPS.has(m),
  },
  { name: '私钥', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'API 密钥', re: /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/g },
  { name: '疑似密钥赋值', re: /\b(?:api[_-]?key|secret|token|passw(?:or)?d)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/gi },
  {
    name: '邮箱',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    skip: (m) => /@(users\.noreply\.github\.com|example\.(com|org)|anthropic\.com)$/i.test(m),
  },
];

// 本机私有敏感词（不进仓库）：每行一个，比如服务器的子域名。文件不存在就跳过。
let privateTerms = [];
try {
  privateTerms = readFileSync('.secrets-terms', 'utf8').split('\n').map((t) => t.trim()).filter(Boolean);
} catch {}
if (privateTerms.length)
  RULES.push({ name: '私有敏感词', re: new RegExp(privateTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi') });

const hits = [];
for (const f of files) {
  let text;
  try {
    text = staged ? git('show', `:${f}`) : readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (line.includes('secrets-ignore')) return;
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) {
        if (r.skip?.(m[0])) continue;
        hits.push(`${f}:${i + 1}  [${r.name}]  ${m[0].slice(0, 60)}`);
      }
    }
  });
}

if (hits.length) {
  console.error(`\n✗ 发现 ${hits.length} 处疑似敏感信息，已阻止：\n`);
  hits.forEach((h) => console.error('  ' + h));
  console.error('\n确认无害的行，在行尾加注释 secrets-ignore 后重试。\n');
  process.exit(1);
}
console.log(`✓ 敏感信息扫描通过（${files.length} 个文件）`);
