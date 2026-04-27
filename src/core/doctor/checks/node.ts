// src/core/doctor/checks/node.ts
// Checks that the Node.js version is ≥ 20.

import type { Check } from '../run'
import type { DoctorDeps } from '../run'

export async function nodeCheck(_deps: DoctorDeps): Promise<Check> {
  const version = process.version // e.g. "v20.11.0"
  const match = version.match(/^v(\d+)/)
  const major = match ? parseInt(match[1]!, 10) : 0

  if (major >= 20) {
    return {
      name: 'node',
      status: 'ok',
      detail: `Node ${version} (≥ 20 required)`,
    }
  }

  return {
    name: 'node',
    status: 'fail',
    detail: `Node ${version} — version 20 or newer required`,
    remedy: 'Install Node.js 20+ from https://nodejs.org',
  }
}
