import os from 'node:os'
import type { SlashCommand, SlashResult } from './types'
import { saveStatusBarHidden } from '../core/config/save'

const SEGMENTS = [
  'model', 'cwd', 'git',
  'ctx', 'cost', 'mcp',
  'auto', 'queue', 'tasks', 'plugins',
  'hint',
] as const

export type SegmentName = typeof SEGMENTS[number]

export const StatusBarCommand: SlashCommand = {
  name: 'status-bar',
  description: 'Toggle which status bar segments are visible',
  async run(args, ctx): Promise<SlashResult> {
    const hidden = ctx.config?.statusBar?.hidden ?? []
    const home = os.homedir()
    const trimmed = args.trim()

    if (!trimmed) {
      const lines = ['Status bar segments:']
      for (const s of SEGMENTS) {
        const on = !hidden.includes(s)
        lines.push(`  ${on ? '✓' : '·'} ${s}`)
      }
      lines.push('')
      lines.push('Usage:')
      lines.push('  /status-bar hide <name>   hide a segment')
      lines.push('  /status-bar show <name>   re-show a hidden segment')
      lines.push('  /status-bar reset         show every segment')
      return { type: 'text', text: lines.join('\n') }
    }

    const [verb, name] = trimmed.split(/\s+/, 2)
    if (verb === 'reset') {
      await saveStatusBarHidden(home, [])
      return { type: 'text', text: 'status bar: all segments visible' }
    }
    if (verb !== 'hide' && verb !== 'show') {
      return { type: 'text', text: `unknown verb: ${verb}` }
    }
    if (!name || !(SEGMENTS as readonly string[]).includes(name)) {
      return {
        type: 'text',
        text: `unknown segment: ${name ?? '(none)'}\nknown: ${SEGMENTS.join(', ')}`,
      }
    }
    let next: string[]
    if (verb === 'hide') {
      next = hidden.includes(name) ? hidden : [...hidden, name]
    } else {
      next = hidden.filter(h => h !== name)
    }
    await saveStatusBarHidden(home, next)
    return { type: 'text', text: `status bar: ${verb} ${name}` }
  },
}
