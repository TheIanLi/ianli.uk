// 构建时把 src/content/nodes/*.md 汇总成星图数据，并做一致性检查。
// 检查不通过就直接让构建失败，错误信息指明是哪个文件。
import { getCollection, type CollectionEntry } from 'astro:content';
import type { Cat, Status } from './meta';

export interface GraphNode {
  slug: string;
  code: string; // 显示编号 N-00、N-01…
  title: string;
  cat: Cat;
  status: Status;
  summary: string;
  cmd?: string;
  aliases: string[];
  date: string; // YYYY-MM-DD
  updated?: string;
  parent?: string;
  repo?: string;
  nb: string[]; // 相连节点 slug（双向合并后）
}
export interface Graph {
  nodes: GraphNode[];
  edges: [string, string][]; // 无向边，每条只出现一次
}

const day = (d: Date) => d.toISOString().slice(0, 10);

function build(entries: CollectionEntry<'nodes'>[]): Graph {
  const fail = (msg: string): never => {
    throw new Error(`[星图数据] ${msg}`);
  };
  const ids = new Set(entries.map((e) => e.id));
  const file = (e: CollectionEntry<'nodes'>) => `src/content/nodes/${e.id}.md`;

  const cores = entries.filter((e) => e.data.cat === 'core');
  if (cores.length !== 1) fail(`cat: core 必须恰好有 1 个，现在有 ${cores.length} 个`);

  // 合并双向连线：A 写了 B 或 B 写了 A 都算一条
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  for (const e of entries) {
    for (const t of e.data.links) {
      if (!ids.has(t)) fail(`${file(e)} 的 links 里有 "${t}"，但没有这个节点`);
      if (t === e.id) fail(`${file(e)} 的 links 连到了自己`);
      const key = [e.id, t].sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([e.id, t]);
      }
    }
    if (e.data.parent && !ids.has(e.data.parent)) fail(`${file(e)} 的 parent "${e.data.parent}" 不存在`);
  }

  // 编号：本站固定 N-00；其余按创建日期，再按 slug。新笔记会排在后面，不打乱旧编号。
  const sorted = [...entries].sort((a, b) => {
    if (a.data.cat === 'core') return -1;
    if (b.data.cat === 'core') return 1;
    return a.data.date.getTime() - b.data.date.getTime() || a.id.localeCompare(b.id);
  });

  const nb = new Map<string, string[]>(entries.map((e) => [e.id, []]));
  for (const [a, b] of edges) {
    nb.get(a)!.push(b);
    nb.get(b)!.push(a);
  }

  const nodes = sorted.map((e, i): GraphNode => ({
    slug: e.id,
    code: 'N-' + String(i).padStart(2, '0'),
    title: e.data.title,
    cat: e.data.cat,
    status: e.data.status,
    summary: e.data.summary,
    cmd: e.data.cmd,
    aliases: e.data.aliases,
    date: day(e.data.date),
    updated: e.data.updated && day(e.data.updated),
    parent: e.data.parent,
    repo: e.data.repo,
    nb: nb.get(e.id)!,
  }));
  return { nodes, edges };
}

let cached: Promise<Graph> | undefined;
export function getGraph(): Promise<Graph> {
  return (cached ??= getCollection('nodes').then(build));
}
