// src/core/recap/renderMarkdown.ts — Phase 14c §5.2
import type { RecapDoc } from './types'

export function renderMarkdown(doc: RecapDoc): string {
  const lines: string[] = []
  lines.push('---')
  lines.push(`session: ${doc.session}`)
  lines.push(`generatedAt: ${new Date(doc.generatedAt).toISOString()}`)
  lines.push(`scope: ${doc.scope.kind}`)
  lines.push('---')
  lines.push('')
  lines.push(`# Recap — ${doc.session}`)
  lines.push('')

  // Completed
  lines.push(`## ✅ Completed (${doc.fields.completed.length})`)
  for (const c of doc.fields.completed.slice(0, 50)) {
    lines.push(`- ${c.id} · ${c.description} · ${(c.durationMs / 1000).toFixed(1)}s${c.agentName ? ' · ' + c.agentName : ''}`)
  }
  lines.push('')

  // In-flight
  lines.push(`## ⏳ In-flight (${doc.fields.inFlight.length})`)
  for (const i of doc.fields.inFlight.slice(0, 50)) {
    lines.push(`- ${i.id} · ${i.state} · ${i.description}`)
  }
  lines.push('')

  // File diffs
  lines.push('## 📝 File diffs')
  for (const f of doc.fields.fileDiffs.slice(0, 50)) {
    lines.push(`- **${f.agentName}**: ${f.path} (+${f.added} −${f.removed})`)
  }
  lines.push('')

  // Tool timeline
  lines.push('## 🔧 Tool timeline')
  for (const t of doc.fields.toolTimeline.slice(0, 50)) {
    const time = new Date(t.t).toISOString().slice(11, 16)
    lines.push(`- ${time} · ${t.toolName}${t.collapsedCount > 1 ? ` ×${t.collapsedCount}` : ''}`)
  }
  lines.push('')

  // Messages
  lines.push(`## 💬 Messages (top ${Math.min(10, doc.fields.messages.length)})`)
  for (const m of doc.fields.messages) {
    const time = new Date(m.t).toISOString().slice(11, 16)
    lines.push(`- ${time} · ${m.from} → ${m.to} · ${m.summary}`)
  }
  lines.push('')

  // Pipelines
  lines.push('## 🪢 Pipelines')
  for (const p of doc.fields.pipelines) {
    const symbols = p.nodes
      .map(n => `${n.id}${n.status === 'completed' ? '✅' : n.status === 'failed' ? '✗' : '⏳'}`)
      .join(' → ')
    lines.push(`- ${p.pipelineId}: ${symbols}`)
  }
  lines.push('')

  // Tokens
  lines.push('## 💲 Tokens')
  for (const [name, t] of Object.entries(doc.fields.tokens.perAgent)) {
    lines.push(`- ${name}: ${t.in} in / ${t.out} out`)
  }
  if (doc.fields.tokens.cost !== undefined) {
    lines.push(`- estimated cost: $${doc.fields.tokens.cost.toFixed(2)}`)
  }
  lines.push('')

  // Next step
  lines.push('## 👉 Next step')
  lines.push(`> ${doc.fields.nextStep}`)
  lines.push('')

  // Key decisions
  lines.push('## 🧭 Key decisions')
  for (const k of doc.fields.keyDecisions) {
    lines.push(`- **${k.source}**: ${k.text}`)
  }
  lines.push('')

  return lines.join('\n')
}
