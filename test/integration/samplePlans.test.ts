// test/integration/samplePlans.test.ts
//
// Phase 9 §9.6 — integration tests that run each sample plan under
// expectPlanToPass. Plans live in test-plans/ at the project root.
// Each plan is run with cwd set to the project root so snapshot and
// plan-relative paths resolve correctly.

import { describe, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expectPlanToPass } from '../../src/core/testing/vitest'

const ROOT = join(__dirname, '..', '..')

const PLANS = [
  '01-offline-boot.yaml',
  '02-onboarding.yaml',
  '03-theme-switch.yaml',
  '04-stats-view.yaml',
  '05-plan-mode-lockout.yaml',
  '06-slash-text-output.yaml',
]

describe('sample plans', () => {
  for (const planFile of PLANS) {
    it(`passes: ${planFile}`, async () => {
      const yaml = await readFile(join(ROOT, 'test-plans', planFile), 'utf8')
      await expectPlanToPass(yaml, { cwd: ROOT })
    }, 15_000)
  }
})
