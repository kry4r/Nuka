// src/core/testing/vitest.ts
//
// Phase 9 §6 — vitest binding helper. A single function `expectPlanToPass`
// parses YAML, runs the plan, and routes failure to vitest's `expect.fail`
// with a flattened message that lists each failing step's index/kind/message.
//
// We import `expect` from 'vitest' so this works cleanly from a test file
// regardless of whether the suite enables `globals:true`.

import { expect } from 'vitest'
import { parsePlan } from './plan'
import { runPlan, type RunOpts, type RunResult } from './runner'

export type ExpectPlanOpts = RunOpts

/**
 * Parse the YAML, run the plan, and assert it passed. On failure, calls
 * `expect.fail` with a multi-line message describing each failing step:
 *   step 1 (assert): expected last frame to contain "Welcome"
 *   step 3 (snapshot): snapshot mismatch (first diff at line 4)
 */
export async function expectPlanToPass(
  yamlText: string,
  opts: ExpectPlanOpts = {},
): Promise<RunResult> {
  const plan = parsePlan(yamlText)
  const result = await runPlan(plan, opts)
  if (!result.ok) {
    const failures = result.steps.filter(s => !s.ok)
    const lines = failures.map(s => `step ${s.index} (${s.kind}): ${s.message ?? '<no message>'}`)
    expect.fail(`plan "${plan.name}" failed:\n${lines.join('\n')}`)
  }
  return result
}
