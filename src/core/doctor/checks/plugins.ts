// src/core/doctor/checks/plugins.ts
// Phase 10 §4.4 — plugins check.
//
// Loads installed plugins and validates each one's manifest. Each plugin gets
// its own Check entry.

import type { Check, DoctorDeps } from '../run'
import { loadPlugins } from '../../plugin/loader'
import { validatePlugin } from '../../plugin/validate'
import { join } from 'node:path'

export async function pluginsCheck(deps: DoctorDeps): Promise<Check[]> {
  let plugins: import('../../plugin/manifest').LoadedPlugin[]
  try {
    plugins = await loadPlugins({ home: deps.home })
  } catch (err) {
    return [
      {
        name: 'plugins',
        status: 'fail',
        detail: `Failed to load plugins: ${(err as Error).message}`,
        remedy: 'Check ~/.nuka/plugins for corrupt manifests.',
      },
    ]
  }

  if (plugins.length === 0) {
    return [
      {
        name: 'plugins',
        status: 'ok',
        detail: 'No plugins installed',
      },
    ]
  }

  const checks: Check[] = []
  for (const p of plugins) {
    const dir = join(deps.home, '.nuka', 'plugins', p.manifest.name)
    let report: import('../../plugin/validate').ValidationReport
    try {
      report = await validatePlugin(dir)
    } catch (err) {
      checks.push({
        name: `plugins:${p.manifest.name}`,
        status: 'fail',
        detail: `Validation error: ${(err as Error).message}`,
        remedy: `Check plugin directory: ${dir}`,
      })
      continue
    }

    if (report.errors.length > 0) {
      checks.push({
        name: `plugins:${p.manifest.name}`,
        status: 'fail',
        detail: `${report.errors.length} error(s): ${report.errors[0]?.message ?? ''}`,
        remedy: `Fix plugin at ${dir} and reinstall.`,
      })
    } else if (report.warnings.length > 0) {
      checks.push({
        name: `plugins:${p.manifest.name}`,
        status: 'warn',
        detail: `${report.warnings.length} warning(s): ${report.warnings[0]?.message ?? ''}`,
      })
    } else {
      checks.push({
        name: `plugins:${p.manifest.name}`,
        status: 'ok',
        detail: `${p.manifest.name}@${p.manifest.version ?? 'unversioned'} valid`,
      })
    }
  }
  return checks
}
