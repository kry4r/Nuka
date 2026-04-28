import { execa } from 'execa'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from './define'

type GrepInput = {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: 'files_with_matches' | 'content' | 'count'
}

async function haveRg(): Promise<boolean> {
  try {
    const result = await execa('rg', ['--version'], { reject: false })
    return !result.failed
  } catch {
    return false
  }
}

async function fallback(input: GrepInput, cwd: string): Promise<{ output: string; isError: boolean }> {
  const root = input.path ?? cwd
  const re = new RegExp(input.pattern)
  const matches: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: string[] = []
    try { entries = await readdir(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.git')) continue
      const full = join(dir, name)
      let st
      try { st = await stat(full) } catch { continue }
      if (st.isDirectory()) await walk(full)
      else {
        try {
          const text = await readFile(full, 'utf8')
          const hits = text.split('\n').map((line, i) => ({ line, i: i + 1 })).filter(r => re.test(r.line))
          if (hits.length > 0) {
            if (input.output_mode === 'content') {
              for (const h of hits) matches.push(`${full}:${h.i}: ${h.line}`)
            } else if (input.output_mode === 'count') {
              matches.push(`${full}:${hits.length}`)
            } else {
              matches.push(full)
            }
          }
        } catch { /* not utf8 */ }
      }
    }
  }
  await walk(root)
  return { isError: false, output: matches.join('\n') }
}

export const GrepTool = defineTool<GrepInput>({
  name: 'Grep',
  description: 'Search file contents using ripgrep (falls back to a naive scanner).',
  parameters: {
    type: 'object',
    required: ['pattern'],
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
      glob: { type: 'string' },
      type: { type: 'string' },
      output_mode: { type: 'string', enum: ['files_with_matches', 'content', 'count'] },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read'],
  needsPermission: () => 'none',
  async run(input, ctx) {
    const root = input.path ?? ctx.cwd
    try {
      if (!(await haveRg())) return fallback(input, ctx.cwd)
      const args: string[] = []
      if (input.output_mode === 'files_with_matches' || !input.output_mode) args.push('-l')
      else if (input.output_mode === 'count') args.push('-c')
      if (input.glob) args.push('--glob', input.glob)
      if (input.type) args.push('--type', input.type)
      args.push(input.pattern, root)
      const res = await execa('rg', args, { reject: false, cancelSignal: ctx.signal })
      if (res.exitCode !== 0 && res.exitCode !== 1) {
        return { isError: true, output: res.stderr || `rg exit ${res.exitCode}` }
      }
      return { isError: false, output: res.stdout }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
})
