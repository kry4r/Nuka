// src/core/tools/glob.ts
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import picomatch from 'picomatch'
import { defineTool } from './define'

type GlobInput = { pattern: string; path?: string }

async function walk(root: string, signal: AbortSignal): Promise<{ p: string; mtime: number }[]> {
  const out: { p: string; mtime: number }[] = []
  async function go(dir: string): Promise<void> {
    if (signal.aborted) return
    let entries: string[] = []
    try { entries = await readdir(dir) } catch { return }
    for (const name of entries) {
      if (signal.aborted) return
      if (name === 'node_modules' || name.startsWith('.git')) continue
      const full = join(dir, name)
      let st
      try { st = await stat(full) } catch { continue }
      if (st.isDirectory()) await go(full)
      else out.push({ p: full, mtime: st.mtimeMs })
    }
  }
  await go(root)
  return out
}

export const GlobTool = defineTool<GlobInput>({
  name: 'Glob',
  description: 'List files matching a glob pattern, sorted by mtime desc.',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read'],
  needsPermission: () => 'none',
  async run(input, ctx) {
    const root = input.path ?? ctx.cwd
    try {
      const entries = await walk(root, ctx.signal)
      const isMatch = picomatch(input.pattern, { dot: false })
      const matched = entries
        .filter(e => isMatch(e.p.slice(root.length + 1).replace(/\\/g, '/')))
        .sort((a, b) => b.mtime - a.mtime)
        .map(e => e.p)
      return { isError: false, output: matched.join('\n') }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
})
