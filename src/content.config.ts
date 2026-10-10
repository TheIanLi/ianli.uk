import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// slug 规则：小写字母、数字、短横线，例如 sing-box
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug 只能用小写字母、数字和短横线');

const nodes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/nodes' }),
  schema: z.object({
    title: z.string(),
    cat: z.enum(['core', 'net', 'ai', 'proj', 'base']),
    status: z.enum(['ok', 'wip', 'old']),
    summary: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    links: z.array(slug).default([]),
    cmd: z.string().optional(),
    aliases: z.array(z.string()).default([]),
    parent: slug.optional(),
    repo: z.url().optional(),
  }),
});

export const collections = { nodes };
