// src/slash/taskRun.ts
//
// 2026-05-18 — first production caller of `LocalAgentSpec`. Without this
// command, `runAgent`'s lifecycle wiring is dead code. The command takes
// a free-form prompt, builds a streaming `agentRunner` that consumes the
// active provider, and hands it to `TaskManager.enqueue` so the work
// runs in the background. The returned task id is rendered back to the
// user; they then track progress via `/tasks show <id>`.
//
// Scope is deliberately narrow: no tool use (the runner just streams
// text from a single provider call). Anything richer belongs in
// `dispatch_agent` / sub-agents — `/task run` is the foreground-friendly
// fire-and-forget hook for ad-hoc background prompts.

import type { SlashCommand, SlashContext, SlashResult } from './types'
import type { LocalAgentSpec, AgentChunk } from '../core/tasks/types'
import type { UserMessage } from '../core/message/types'
import { randomUUID } from 'node:crypto'

async function* streamTextChunks(
  ctx: SlashContext,
  prompt: string,
  signal: AbortSignal,
): AsyncIterable<AgentChunk> {
  const session = ctx.sessions.active()
  if (!session) return

  const { provider, model } = ctx.providers.resolveFor(session)

  const userMsg: UserMessage = {
    role: 'user',
    content: [{ type: 'text', text: prompt }],
    id: randomUUID(),
    ts: Date.now(),
  }

  const events = provider.stream(
    {
      model,
      system: 'You are a background task agent. Respond concisely to the user prompt.',
      messages: [userMsg],
      tools: [],
      maxTokens: 2048,
    },
    signal,
  )
  for await (const ev of events) {
    if (signal.aborted) return
    if (ev.type === 'text_delta') {
      const text = ev.text
      if (text.length > 0) yield { text }
    }
  }
}

export const TaskRunCommand: SlashCommand = {
  name: 'task',
  description: 'Run a prompt as a background agent task',
  source: 'builtin',
  usage: '/task run <prompt>',
  args: [
    { name: 'subcommand', choices: ['run'], description: 'Action' },
    { name: 'prompt', description: 'Free-form prompt for the background agent' },
  ],
  examples: ['/task run summarize the repo', '/task run audit the test suite for skipped tests'],
  run: async (args: string, ctx: SlashContext): Promise<SlashResult> => {
    if (!ctx.taskManager) {
      return { type: 'text', text: 'Task system is not enabled in this session.' }
    }
    const trimmed = args.trim()
    if (trimmed === '') {
      return { type: 'text', text: 'Usage: /task run <prompt>' }
    }
    // Accept both `/task run <prompt>` and bare `/task <prompt>` for ergonomics.
    const m = trimmed.match(/^(?:run\s+)?(.+)$/)
    const prompt = m?.[1]?.trim() ?? ''
    if (prompt.length === 0) {
      return { type: 'text', text: 'Usage: /task run <prompt>' }
    }

    const session = ctx.sessions.active()
    const providerId = session?.providerId ?? 'unknown'
    const model = session?.model ?? 'unknown'
    const taskSessionId = `task-${randomUUID().slice(0, 8)}`
    const spec: LocalAgentSpec = {
      kind: 'local_agent',
      description: prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt,
      hookRegistry: ctx.hookRegistry,
      taskSessionId,
      providerId,
      model,
      agentRunner: (signal) => streamTextChunks(ctx, prompt, signal),
    }
    const task = ctx.taskManager.enqueue(spec)
    return {
      type: 'text',
      text: `Queued background task ${task.id}. Use \`/tasks show ${task.id}\` to tail output.`,
    }
  },
}
