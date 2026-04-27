// src/slash/rewind.ts
//
// Phase 8 §4.3 — `/rewind` slash command.
//
// Lists the last 10 assistant messages with a one-line preview. If the user
// supplies an index (1 = newest), we truncate the session transcript at the
// corresponding message (drops that message and everything after). No args
// → returns a numbered list the user can read and then invoke `/rewind <n>`.
//
// The TUI layer wraps this with an interactive `<MessageSelector>` component
// (see src/tui/Rewind/MessageSelector.tsx); this slash keeps the logic
// headless so the core behaviour is testable without Ink.

import type { SlashCommand, SlashContext } from './types'
import type { AssistantMessage } from '../core/message/types'

/** Return the last `n` assistant messages from a session, newest first. */
export function recentAssistantMessages(messages: readonly { role: string }[], n = 10): AssistantMessage[] {
  const out: AssistantMessage[] = []
  for (let i = messages.length - 1; i >= 0 && out.length < n; i--) {
    const m = messages[i] as AssistantMessage
    if (m.role === 'assistant') out.push(m)
  }
  return out
}

/** Extract a one-line preview (trimmed, ≤80 chars) of an assistant message. */
export function firstLinePreview(m: AssistantMessage, max = 80): string {
  for (const block of m.content) {
    if (block.type === 'text') {
      const firstLine = block.text.split('\n').find(l => l.trim().length > 0) ?? ''
      const trimmed = firstLine.trim()
      return trimmed.length > max ? trimmed.slice(0, max - 1) + '…' : trimmed
    }
    if (block.type === 'tool_use') {
      return `[tool_use ${block.name}]`
    }
  }
  return '(empty)'
}

export const RewindCommand: SlashCommand = {
  name: 'rewind',
  description: 'Rewind session transcript to an earlier assistant message',
  usage: '/rewind [<n>]  (n = 1 is newest; omit to list last 10)',
  async run(args: string, ctx: SlashContext) {
    const session = ctx.sessions.active()
    if (!session) return { type: 'text', text: 'No active session.' }

    const recent = recentAssistantMessages(session.messages, 10)
    if (recent.length === 0) {
      return { type: 'text', text: 'No assistant messages to rewind to yet.' }
    }

    const trimmed = args.trim()
    if (trimmed === '') {
      // No args → open interactive message-selector dialog in TUI
      return {
        type: 'dialog' as const,
        dialog: { kind: 'message-selector' as const, messages: recent },
      }
    }

    const n = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(n) || n < 1 || n > recent.length) {
      return { type: 'text', text: `Invalid index: ${trimmed}. Must be 1..${recent.length}.` }
    }

    const picked = recent[n - 1]!
    try {
      const removed = await ctx.sessions.truncateAfter(picked.id)
      return {
        type: 'text',
        text: `Rewound: dropped ${removed} message(s) from "${firstLinePreview(picked, 40)}" onward.`,
      }
    } catch (err) {
      return { type: 'text', text: `Rewind failed: ${(err as Error).message}` }
    }
  },
}
