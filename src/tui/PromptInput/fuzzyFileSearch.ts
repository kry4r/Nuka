// src/tui/PromptInput/fuzzyFileSearch.ts
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { Dirent } from 'node:fs'

const SKIP = new Set(['node_modules', '.git', 'dist'])

async function walk(dir: string, base: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0) return
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true }) as unknown as Dirent[]
  } catch {
    return
  }
  for (const e of entries) {
    const name = e.name as unknown as string
    if (SKIP.has(name)) continue
    const rel = path.join(path.relative(base, dir), name)
    if (e.isDirectory()) {
      await walk(path.join(dir, name), base, depth - 1, out)
    } else {
      out.push(rel)
    }
  }
}

function score(query: string, p: string): number {
  const lower = p.toLowerCase()
  const q = query.toLowerCase()
  if (lower.includes(q)) return 2
  // subsequence check
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  if (qi === q.length) return 1
  return 0
}

export async function fuzzyFileSearch(opts: {
  query: string
  cwd: string
  limit?: number
}): Promise<string[]> {
  const { query, cwd, limit = 10 } = opts
  const paths: string[] = []
  await walk(cwd, cwd, 4, paths)

  if (!query) return paths.slice(0, limit)

  const scored = paths
    .map(p => ({ p, s: score(query, p) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)

  return scored.slice(0, limit).map(x => x.p)
}
