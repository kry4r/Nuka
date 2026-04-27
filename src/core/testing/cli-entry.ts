// src/core/testing/cli-entry.ts
//
// Phase 10 §4.1 — entrypoint for the lazy-loaded test-runner bundle.
// Re-exports the testing API surface and provides `runTestPlanCli(argv)`
// which encapsulates the original `--test-plan` reporter logic so cli.tsx
// stays small in the production bundle.
//
// Only loaded when `nuka --test-plan ...` is invoked. The production bundle
// (`dist/cli.js`) does NOT statically reference this module — `cli.tsx`
// imports it via `new URL('./test-runner.js', import.meta.url)` so esbuild
// cannot resolve it at build time.

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { parsePlan, PlanError } from './plan'
import { runPlan } from './runner'
import type { Plan } from './plan'

export { parsePlan, PlanError, runPlan }
export type { Plan }

type Reporter = 'tap' | 'json' | 'pretty'

/**
 * Drive the `--test-plan <path>` CLI: parse argv, read+parse the plan,
 * run it, and emit a tap/json/pretty report. Returns the desired exit code.
 */
export async function runTestPlanCli(argv: string[]): Promise<number> {
  const testPlanIdx = argv.findIndex(a => a === '--test-plan' || a.startsWith('--test-plan='))
  if (testPlanIdx === -1) return 2

  let planPath: string
  const flag = argv[testPlanIdx]!
  if (flag.startsWith('--test-plan=')) {
    planPath = flag.slice('--test-plan='.length)
  } else {
    planPath = argv[testPlanIdx + 1] ?? ''
  }
  if (!planPath) {
    process.stderr.write('--test-plan requires a file path\n')
    return 2
  }
  planPath = path.resolve(planPath)

  const updateSnapshots = argv.includes('--update-snapshots')

  const reporterArg = argv.find(a => a.startsWith('--reporter='))
  let reporter: Reporter = 'pretty'
  if (reporterArg) {
    const val = reporterArg.slice('--reporter='.length)
    if (val === 'tap' || val === 'json' || val === 'pretty') reporter = val
    else {
      process.stderr.write(`unknown reporter ${JSON.stringify(val)}; expected tap, json, or pretty\n`)
      return 2
    }
  }

  let yamlText: string
  try {
    yamlText = await readFile(planPath, 'utf8')
  } catch (err) {
    process.stderr.write(`cannot read plan file: ${(err as Error).message}\n`)
    return 2
  }

  let plan: Plan
  try {
    plan = parsePlan(yamlText)
  } catch (err) {
    if (err instanceof PlanError) {
      const loc = err.line ? ` (line ${err.line}${err.column ? `:${err.column}` : ''})` : ''
      process.stderr.write(`plan parse error${loc}: ${err.message}\n`)
    } else {
      process.stderr.write(`plan parse error: ${(err as Error).message}\n`)
    }
    return 2
  }

  const result = await runPlan(plan, { cwd: path.dirname(planPath), updateSnapshots })

  if (reporter === 'json') {
    process.stdout.write(JSON.stringify(result) + '\n')
    return result.ok ? 0 : 1
  }

  if (reporter === 'tap') {
    const n = result.steps.length
    process.stdout.write(`TAP version 13\n1..${n}\n`)
    for (const s of result.steps) {
      const num = s.index + 1
      if (s.ok) {
        process.stdout.write(`ok ${num} - step ${s.index} (${s.kind})\n`)
      } else {
        process.stdout.write(`not ok ${num} - step ${s.index} (${s.kind})\n`)
        if (s.message) {
          for (const line of s.message.split('\n')) {
            process.stdout.write(`  # ${line}\n`)
          }
        }
      }
    }
    return result.ok ? 0 : 1
  }

  // pretty (default)
  const GREEN = '\x1b[32m'
  const RED = '\x1b[31m'
  const RESET = '\x1b[0m'
  let passed = 0
  let failed = 0
  for (const s of result.steps) {
    if (s.ok) {
      process.stdout.write(`  ${GREEN}\u2713${RESET} step ${s.index} (${s.kind})\n`)
      passed++
    } else {
      process.stdout.write(`  ${RED}\u2717${RESET} step ${s.index} (${s.kind})\n`)
      if (s.message) {
        for (const line of s.message.split('\n')) {
          process.stdout.write(`    ${line}\n`)
        }
      }
      failed++
    }
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  return result.ok ? 0 : 1
}
