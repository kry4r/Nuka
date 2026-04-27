// src/core/doctor/checks/config.ts
// Phase 10 §4.4 — config check. Validates config loads successfully.

import type { Check, DoctorDeps } from '../run'
import { loadConfig } from '../../config/load'

export async function configCheck(deps: DoctorDeps): Promise<Check> {
  try {
    await loadConfig({ home: deps.home, cwd: deps.cwd })
    return {
      name: 'config',
      status: 'ok',
      detail: 'Config loaded and validated successfully',
    }
  } catch (err) {
    return {
      name: 'config',
      status: 'fail',
      detail: `Config error: ${(err as Error).message}`,
      remedy: 'Edit ~/.nuka/config.yaml or run `nuka init` to recreate it.',
    }
  }
}
