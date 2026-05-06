// src/core/notices/emergencyTip.ts
//
// Phase D2 — config-driven source for the EmergencyTip notice.  Reads from
// `config.notices.emergency`; remote fetch left as a TODO for a later phase.

import type { Config } from '../config/schema'

export type EmergencyTip = {
  /** The tip text to display below the welcome box. */
  tip: string
  /** Optional emphasis: `warning`/`error` colors the line; otherwise dim. */
  color?: 'dim' | 'warning' | 'error'
}

/**
 * Resolves the active emergency tip from `config.notices.emergency`.
 * Pure function — caller passes the Config it already loaded.  Returns
 * null when not configured.
 */
export function getEmergencyTipFromConfig(config: Config): EmergencyTip | null {
  const e = config.notices?.emergency
  if (!e || !e.tip) return null
  return e.color === undefined ? { tip: e.tip } : { tip: e.tip, color: e.color }
}

/**
 * Back-compat: legacy callers that don't have the Config in scope still get
 * null until they migrate to `getEmergencyTipFromConfig`.  The Welcome
 * pipeline now passes `tip` explicitly via props from cli.tsx.
 */
export function getEmergencyTip(): EmergencyTip | null {
  return null
}
