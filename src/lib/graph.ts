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
  moons: { slug: string; title: string; aliases: string[] }[]; // 下属笔记（写了 parent 指向它的）。星图上不单独成星，画成绕它转的小卫星
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
    if (e.data.parent === e.id) fail(`${file(e)} 的 parent 指向了自己`);
    if (e.data.parent && e.data.cat === 'core') fail(`${file(e)} 是 cat: core，不能再写 parent`);
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

  // 下属笔记不占编号：跟父节点的编号走，写成 N-19.1、N-19.2…，这样星图上的编号始终连续
  const stars = sorted.filter((e) => !e.data.parent);
  const starCode = new Map(stars.map((e, i) => [e.id, 'N-' + String(i).padStart(2, '0')]));
  const kids = (id: string) => sorted.filter((c) => c.data.parent === id);
  const code = (e: CollectionEntry<'nodes'>) =>
    e.data.parent
      ? `${starCode.get(e.data.parent) ?? 'N-??'}.${kids(e.data.parent).indexOf(e) + 1}`
      : starCode.get(e.id)!;

  const nodes = sorted.map((e): GraphNode => ({
    slug: e.id,
    code: code(e),
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
    moons: kids(e.id).map((c) => ({ slug: c.id, title: c.data.title, aliases: c.data.aliases })),
  }));
  // 下属笔记只挂一层：它的 parent 不能自己也是下属笔记（否则星图上没有星可以绕）
  for (const n of nodes)
    if (n.parent && nodes.find((p) => p.slug === n.parent)!.parent)
      fail(`src/content/nodes/${n.slug}.md 的 parent "${n.parent}" 自己也写了 parent，下属笔记只能挂一层`);
  return { nodes, edges };
}

/**
 * 星图用的数据：写了 parent 的下属笔记不单独成星（它们在父节点的 moons 里，画成小卫星），
 * 和它们相连的线也不画。文章页、2D 列表仍用完整的 getGraph()。
 */
export function starGraph(g: Graph): Graph {
  const hidden = new Set(g.nodes.filter((n) => n.parent).map((n) => n.slug));
  return {
    nodes: g.nodes.filter((n) => !hidden.has(n.slug)).map((n) => ({ ...n, nb: n.nb.filter((s) => !hidden.has(s)) })),
    edges: g.edges.filter(([a, b]) => !hidden.has(a) && !hidden.has(b)),
  };
}

let cached: Promise<Graph> | undefined;
export function getGraph(): Promise<Graph> {
  return (cached ??= getCollection('nodes').then(build));
}
