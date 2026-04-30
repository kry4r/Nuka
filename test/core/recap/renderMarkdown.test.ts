import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../../src/core/recap/renderMarkdown'

describe('renderMarkdown', () => {
  it('renders all 9 sections in order', () => {
    const md = renderMarkdown({
      session: 's1', generatedAt: 0, scope: { kind: 'full' },
      fields: {
        completed: [{ id: 't1', description: 'd', durationMs: 1000, agentName: 'a' }],
        inFlight: [], fileDiffs: [], toolTimeline: [], messages: [], pipelines: [],
        tokens: { perAgent: {} }, nextStep: 'do x', keyDecisions: [],
      },
    })
    expect(md).toContain('## ✅ Completed')
    expect(md).toContain('## ⏳ In-flight')
    expect(md).toContain('## 📝 File diffs')
    expect(md).toContain('## 🔧 Tool timeline')
    expect(md).toContain('## 💬 Messages')
    expect(md).toContain('## 🪢 Pipelines')
    expect(md).toContain('## 💲 Tokens')
    expect(md).toContain('## 👉 Next step')
    expect(md).toContain('## 🧭 Key decisions')
  })

  it('includes task details in completed section', () => {
    const md = renderMarkdown({
      session: 's1', generatedAt: 0, scope: { kind: 'full' },
      fields: {
        completed: [{ id: 't42', description: 'refactor registry', durationMs: 5000, agentName: 'alice' }],
        inFlight: [], fileDiffs: [], toolTimeline: [], messages: [], pipelines: [],
        tokens: { perAgent: {} }, nextStep: 'done', keyDecisions: [],
      },
    })
    expect(md).toContain('t42')
    expect(md).toContain('refactor registry')
    expect(md).toContain('alice')
  })
})
