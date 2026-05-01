import * as crypto from 'node:crypto'
import type { TaskGraph } from './taskGraph'
import type { SubTaskId } from './types'

export type TestSpec = {
  testFile: string
  body: string
}

const PROMPT = (taskAId: string, taskBId: string, reason: string, titleA: string, titleB: string): string =>
  `Generate a Vitest test (TypeScript) that verifies the integration contract between two related sub-tasks.

Task A: ${taskAId} — ${titleA}
Task B: ${taskBId} — ${titleB}
Why they're correlated: ${reason}

Output the FULL test file content (imports + describe/it). Use vitest. Make assertions concrete enough to fail when the contract is broken; if you don't have enough info to write real assertions, leave a TODO comment but keep it valid TS.

Reply with the test file content only, no prose, no code fences.`

const FALLBACK = (a: string, b: string, reason: string, titleA: string, titleB: string): string =>
  `import { describe, it, expect } from 'vitest'

// Correlation between ${a} (${titleA}) and ${b} (${titleB}).
// Reason: ${reason}
// TODO: replace with real assertions once the contract is implementable.
describe('correlation: ${a} ↔ ${b}', () => {
  it('TODO: assert shared invariants of ${reason}', () => {
    expect(true).toBe(true)
  })
})
`

function hashPair(a: SubTaskId, b: SubTaskId, reason: string): string {
  // Sort the pair so order doesn't change the file name.
  const [x, y] = [a, b].sort()
  return crypto.createHash('sha1').update(`${x}|${y}|${reason}`).digest('hex').slice(0, 10)
}

export type CorrelationOpts = {
  graph: TaskGraph
  runFork: (prompt: string) => Promise<{ text: string }>
}

/**
 * Walk `graph.correlations` and synthesise a correlation Vitest spec for each pair.
 * Falls back to a TODO-template when the LLM fork errors.
 */
export async function generateCorrelationTests(opts: CorrelationOpts): Promise<TestSpec[]> {
  const snap = opts.graph.snapshot()
  const out: TestSpec[] = []
  for (const corr of snap.correlations) {
    const [a, b] = corr.between
    const titleA = snap.nodes[a]?.title ?? a
    const titleB = snap.nodes[b]?.title ?? b
    let body: string
    try {
      const r = await opts.runFork(PROMPT(a, b, corr.reason, titleA, titleB))
      body = r.text.trim() || FALLBACK(a, b, corr.reason, titleA, titleB)
    } catch {
      body = FALLBACK(a, b, corr.reason, titleA, titleB)
    }
    const hash = hashPair(a, b, corr.reason)
    out.push({ testFile: `test/correlation/${hash}.test.ts`, body })
  }
  return out
}
