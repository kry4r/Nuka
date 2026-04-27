// src/core/doctor/checks/providers.ts
// Phase 10 §4.4 — providers check.
//
// When `deps.providers` is absent (e.g. CI), returns a single warn check
// so the report is honest rather than silently empty.

import type { Check, DoctorDeps } from '../run'

export async function providersCheck(deps: DoctorDeps): Promise<Check[]> {
  if (!deps.providers) {
    return [
      {
        name: 'providers',
        status: 'warn',
        detail: 'skipped (no resolver supplied)',
        remedy: 'Pass a ProviderResolver when calling runDoctor() for real connectivity checks.',
      },
    ]
  }

  const cfgs = deps.providers.listProviders()
  if (cfgs.length === 0) {
    return [
      {
        name: 'providers',
        status: 'warn',
        detail: 'No providers configured',
        remedy: 'Run `nuka init` or edit ~/.nuka/config.yaml to add a provider.',
      },
    ]
  }

  const checks: Check[] = []
  for (const cfg of cfgs) {
    // Lightweight reachability: resolve the provider instance (no network call).
    // A full probe (probeProvider) hits the network — we skip that in doctor to
    // avoid unexpected latency/costs; status is 'ok' when a config exists.
    checks.push({
      name: `providers:${cfg.id}`,
      status: 'ok',
      detail: `${cfg.name} (${cfg.format}) — configured with ${cfg.models.length} model(s)`,
    })
  }
  return checks
}
