// src/core/doctor/checks/disk.ts
// Phase 10 §4.4 — disk check. Verifies ~/.nuka/ is writable.

import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import type { Check, DoctorDeps } from '../run'

export async function diskCheck(deps: DoctorDeps): Promise<Check> {
  const nukaDir = join(deps.home, '.nuka')
  try {
    await access(nukaDir, constants.W_OK)
    return {
      name: 'disk',
      status: 'ok',
      detail: `${nukaDir} is writable`,
    }
  } catch {
    // Try just checking if home is writable
    try {
      await access(deps.home, constants.W_OK)
      return {
        name: 'disk',
        status: 'warn',
        detail: `${nukaDir} does not exist yet — will be created on first use`,
      }
    } catch {
      return {
        name: 'disk',
        status: 'fail',
        detail: `${deps.home} is not writable`,
        remedy: `Check permissions on ${deps.home} and ensure you own the directory.`,
      }
    }
  }
}
