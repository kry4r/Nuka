import os from 'node:os'
import { saveConfigPatch } from '../core/config/save'
import { effortCapabilityMessage } from '../core/config/effort'
import type { Effort } from '../core/config/schema'
import type { SlashCommand, SlashContext } from './types'

const LEVELS: readonly Effort[] = ['low', 'medium', 'high'] as const

function isEffort(v: string): v is Effort & string {
  return v === 'low' || v === 'medium' || v === 'high'
}

/**
 * Models that support reasoning/thinking. Used only for the warning hint;
 * the setting is saved either way so it activates when the user switches
 * to a thinking-capable model.
 */
function modelSupportsThinking(model: string): boolean {
  if (/^claude-(opus|sonnet)-4/.test(model)) return true
  if (/^o\d/.test(model)) return true
  if (/gpt-5/.test(model)) return true
  return false
}

export const EffortCommand: SlashCommand = {
  name: 'effort',
  description: 'Pick reasoning effort (low / medium / high)',
  source: 'builtin',
  usage: '/effort [low|medium|high]',
  args: [{ name: 'level', choices: ['low', 'medium', 'high'] }],
  examples: ['/effort', '/effort high'],
  run: async (args: string, ctx: SlashContext) => {
    const arg = args.trim().toLowerCase()

    if (arg === '') {
      return { type: 'dialog', dialog: { kind: 'effort-picker' } }
    }

    if (!isEffort(arg)) {
      return {
        type: 'text',
        text: `Invalid effort: "${arg}". Valid: ${LEVELS.join(', ')}.`,
      }
    }

    try {
      await saveConfigPatch(os.homedir(), (obj: any) => {
        obj.effort = arg
      })
    } catch (err) {
      return {
        type: 'text',
        text: `Failed to save effort: ${(err as Error).message}`,
      }
    }
    ;(ctx.config as any).effort = arg

    const session = ctx.sessions.active()
    const model = session?.model ?? ''
    const providerConfig = session ? ctx.providers.getProviderConfig(session.providerId) : undefined
    const capabilityMessage = effortCapabilityMessage(arg, providerConfig, model)
    const supports = model ? modelSupportsThinking(model) : true
    const fallbackMessage = !capabilityMessage && !supports
      ? `${model} does not support reasoning/thinking`
      : undefined
    const noteMessage = capabilityMessage ?? fallbackMessage
    const note = noteMessage
      ? `\nNote: ${noteMessage} — value saved and will apply when supported.`
      : ''
    return { type: 'text', text: `Effort set to ${arg}.${note}` }
  },
}
