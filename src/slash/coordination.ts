// src/slash/coordination.ts
//
// T8.2 — `/coordination` slash command.
//
// Surfaces the coordination layer (TaskGraph + a2a subscriptions) to the user
// as readable text and provides a manual escape hatch for pushing supplemental
// messages between agents when the event-driven a2aRouter has not fired.
//
// Two subcommands:
//   /coordination status                          — render the current graph + subs
//   /coordination a2a-send <from> <to> <body...>  — manual a2a supplement
//
// Implementation note: this command does NOT go through the builtin
// coordination_status / coordination_a2a_send tools. It speaks directly to the
// persistence layer + MessageRouter so the slash command can format text rather
// than emit JSON, matching the existing /harness output style (formatStatus).
import { ulid } from 'ulid'
import type { SlashCommand, SlashResult } from './types'
import type { MessageRouter } from '../core/messaging/router'
import type { A2ASubscription, TaskGraph as TaskGraphData } from '../core/coordination/types'
import { loadGraph } from '../core/coordination/persist'
import * as fs from 'node:fs'

export type CoordinationDeps = {
  graphPath: () => string
  subsPath: () => string
  router: MessageRouter
}

const USAGE =
  'usage:\n' +
  '  /coordination status\n' +
  '  /coordination a2a-send <fromAgent> <toAgent> <body...>'

export function makeCoordinationCommand(deps: CoordinationDeps): SlashCommand {
  return {
    name: 'coordination',
    description:
      'Inspect the harness coordination layer (TaskGraph + a2a subscriptions) and manually push supplemental messages.',
    usage: USAGE,
    args: [
      { name: 'subcommand', choices: ['status', 'a2a-send'], description: 'Operation to run' },
    ],
    examples: [
      '/coordination status',
      '/coordination a2a-send agentA agentB Heads up: I changed the auth contract.',
    ],
    async run(args: string, _ctx): Promise<SlashResult> {
      const trimmed = args.trim()
      if (!trimmed) return { type: 'text', text: USAGE }

      const tokens = trimmed.split(/\s+/)
      const sub = tokens[0]

      if (sub === 'status') {
        return { type: 'text', text: renderStatus(deps) }
      }
      if (sub === 'a2a-send') {
        // Tokens: [a2a-send, from, to, ...body]
        if (tokens.length < 4) {
          return {
            type: 'text',
            text: 'usage: /coordination a2a-send <fromAgent> <toAgent> <body...>',
          }
        }
        const from = tokens[1]!
        const to = tokens[2]!
        const body = tokens.slice(3).join(' ')
        const ok = await deps.router.send({
          id: ulid(),
          from,
          to,
          summary: `manual a2a (slash): ${from} → ${to}`.slice(0, 200),
          message: body,
          sentAt: Date.now(),
        })
        return {
          type: 'text',
          text: ok
            ? `delivered: ${from} → ${to} (${body.length} chars)`
            : `not delivered: no backend accepted the envelope`,
        }
      }
      return { type: 'text', text: `unknown subcommand: ${sub}\n${USAGE}` }
    },
  }
}

function renderStatus(deps: CoordinationDeps): string {
  const graph = loadGraph(deps.graphPath())
  const subs = readSubs(deps.subsPath())

  const lines: string[] = []
  lines.push('Coordination —')

  if (!graph) {
    lines.push('  graph: (no graph yet)')
  } else {
    const data = graph.snapshot()
    const counts = countByStatus(data)
    lines.push(`  rootMessage:   ${truncate(data.rootMessage, 80)}`)
    lines.push(`  difficulty:    ${data.difficulty}`)
    lines.push(
      `  tasks:         ${Object.keys(data.nodes).length} ` +
        `(done=${counts.done}, listening=${counts.listening}, running=${counts.running}, pending=${counts.pending}, failed=${counts.failed})`,
    )
    for (const id of Object.keys(data.nodes)) {
      lines.push(`    ─ ${formatNode(id, data.nodes[id]!)}`)
    }
    lines.push(`  correlations:  ${data.correlations.length}`)
    for (const c of data.correlations) {
      lines.push(`    ─ ${c.between[0]} ↔ ${c.between[1]} (${c.reason})`)
    }
  }

  lines.push(`  subscriptions: ${subs.length}`)
  for (const s of subs) {
    lines.push(
      `    ─ ${s.subscriberAgentId} owns ${s.ownsTaskId}, triggers on [${s.triggersOn.join(', ')}], ` +
        `count=${s.triggerCount}/3, lifecycle=${s.lifecycle}`,
    )
  }
  return lines.join('\n')
}

function readSubs(p: string): A2ASubscription[] {
  try {
    if (!fs.existsSync(p)) return []
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as A2ASubscription[]) : []
  } catch {
    return []
  }
}

function countByStatus(g: TaskGraphData): {
  done: number
  listening: number
  running: number
  pending: number
  failed: number
} {
  const out = { done: 0, listening: 0, running: 0, pending: 0, failed: 0 }
  for (const n of Object.values(g.nodes)) {
    out[n.status] = (out[n.status] ?? 0) + 1
  }
  return out
}

function formatNode(id: string, n: TaskGraphData['nodes'][string]): string {
  const dep = n.dependsOn.length ? ` deps=[${n.dependsOn.join(', ')}]` : ''
  const profile = ` profile=${n.profile}`
  const ts = ` testStrategy=${n.testStrategy}`
  const summary = n.result?.summary ? ` → ${truncate(n.result.summary, 60)}` : ''
  return `${id} [${n.status}]${profile}${ts}${dep}${summary}`
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
