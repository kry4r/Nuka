import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { persistRecap } from '../../../src/core/recap/persist'

describe('persistRecap', () => {
  let home: string
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-pr-')) })

  it('writes file under recaps/<date>-<sess>.md', async () => {
    const file = await persistRecap(home, {
      session: 'sess-x',
      generatedAt: new Date('2026-04-30T12:00:00Z').getTime(),
      scope: { kind: 'full' },
      fields: {
        completed: [], inFlight: [], fileDiffs: [], toolTimeline: [],
        messages: [], pipelines: [], tokens: { perAgent: {} },
        nextStep: 'x', keyDecisions: [],
      },
    })
    expect(fs.existsSync(file)).toBe(true)
    expect(file).toContain('2026-04-30-sess-x.md')
  })

  it('content contains markdown headers', async () => {
    const file = await persistRecap(home, {
      session: 'test-sess',
      generatedAt: Date.now(),
      scope: { kind: 'full' },
      fields: {
        completed: [], inFlight: [], fileDiffs: [], toolTimeline: [],
        messages: [], pipelines: [], tokens: { perAgent: {} },
        nextStep: 'do something', keyDecisions: [],
      },
    })
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('## ✅ Completed')
  })
})
