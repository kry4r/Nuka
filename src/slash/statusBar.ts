import os from 'node:os'
import type { SlashCommand, SlashResult } from './types'
import { saveStatusBarHidden, saveConfigPatch } from '../core/config/save'

const SEGMENTS = [
  'mode', 'model', 'cwd', 'context', 'goal', 'cost', 'counts',
] as const

export type SegmentName = typeof SEGMENTS[number]

/**
 * Format a save-error as a graceful slash result instead of crashing the TUI.
 * ENOSPC, EACCES, EROFS, etc. all surface here.
 */
function saveError(err: unknown, action: string): SlashResult {
  const e = err as NodeJS.ErrnoException
  const code = e?.code ? `[${e.code}] ` : ''
  return {
    type: 'text',
    text: `Cannot ${action}: ${code}${e?.message ?? String(err)}`,
  }
}

export const StatusBarCommand: SlashCommand = {
  name: 'status-bar',
  description: 'Toggle status bar segments and icon/text mode',
  source: 'builtin',
  usage: '/status-bar [hide|show|reset|icon|text|mode] [segment]',
  args: [
    {
      name: 'verb',
      choices: ['hide', 'show', 'reset', 'icon', 'text', 'mode'],
      description: 'Action: hide/show a segment, reset all visible, or set icon/text mode',
    },
    {
      name: 'segment',
      choices: [...SEGMENTS],
      description: 'Segment id (only for hide/show)',
    },
  ],
  examples: [
    '/status-bar',
    '/status-bar hide context',
    '/status-bar show context',
    '/status-bar reset',
    '/status-bar icon',
    '/status-bar text',
    '/status-bar mode',
  ],
  async run(args, ctx): Promise<SlashResult> {
    const hidden = ctx.config?.statusBar?.hidden ?? []
    const iconMode = ctx.config?.statusBar?.iconMode ?? 'icon'
    const home = os.homedir()
    const trimmed = args.trim()

    if (!trimmed) {
      const lines = ['Status bar segments:']
      for (const s of SEGMENTS) {
        const on = !hidden.includes(s)
        lines.push(`  ${on ? '✓' : '·'} ${s}`)
      }
      lines.push('')
      lines.push(`Mode: ${iconMode}`)
      lines.push('')
      lines.push('Usage:')
      lines.push('  /status-bar hide <name>   hide a segment')
      lines.push('  /status-bar show <name>   re-show a hidden segment')
      lines.push('  /status-bar reset         show every segment')
      lines.push('  /status-bar icon|text     set icon vs text rendering')
      lines.push('  /status-bar mode          toggle icon ↔ text')
      return { type: 'text', text: lines.join('\n') }
    }

    const [verb, name] = trimmed.split(/\s+/, 2)

    // Mode toggle / set (folds the former /status-hub command).
    if (verb === 'icon' || verb === 'text' || verb === 'mode') {
      const next: 'icon' | 'text' =
        verb === 'mode' ? (iconMode === 'icon' ? 'text' : 'icon') : verb
      try {
        await saveConfigPatch(home, (obj) => {
          obj.statusBar = { ...(obj.statusBar ?? {}), iconMode: next }
          if (ctx.config.statusBar) {
            ctx.config.statusBar.iconMode = next
          } else {
            ctx.config.statusBar = { hidden: [], layout: 'dense', iconMode: next }
          }
        })
      } catch (err) {
        return saveError(err, 'set status bar mode')
      }
      return { type: 'text', text: `status bar: ${next} mode` }
    }

    if (verb === 'reset') {
      try {
        await saveStatusBarHidden(home, [])
      } catch (err) {
        return saveError(err, 'reset status bar')
      }
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
    try {
      await saveStatusBarHidden(home, next)
    } catch (err) {
      return saveError(err, `${verb} segment`)
    }
    return { type: 'text', text: `status bar: ${verb} ${name}` }
  },
}
