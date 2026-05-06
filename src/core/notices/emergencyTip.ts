// src/core/notices/emergencyTip.ts
//
// Phase C — stub source for the EmergencyTip notice.  Nuka-Code reads this
// from a remote feature-flag service (growthbook); Nuka has no equivalent
// yet, so this returns `null` by default.  When a real config / remote
// source lands, swap the body without touching the EmergencyTip component.

export type EmergencyTip = {
  /** The tip text to display below the welcome box. */
  tip: string
  /** Optional emphasis: `warning`/`error` colors the line; otherwise dim. */
  color?: 'dim' | 'warning' | 'error'
}

/**
 * Returns the active emergency tip, or `null` when none is configured.
 * Always returns `null` in this build — the slot is reserved for a future
 * notice-source wiring (config flag, remote fetch, etc.).
 */
export function getEmergencyTip(): EmergencyTip | null {
  return null
}
