// src/tui/Status/statusLine.ts
//
// Phase 12 §4.10 — the legacy `config.statusLine` format-string +
// spawn-command interpolation logic, lifted out of the deleted
// `StatusLine.tsx` component so the new StatusPanel can render it as
// an optional 7th row. This module is intentionally render-free; it
// only renders strings + manages the polling timer.

import { exec } from 'node:child_process'
import { template, type StatusLineCtx } from '../StatusLine/template'
import type { StatusLineConfig } from '../../core/config/schema'

export type { StatusLineCtx } from '../StatusLine/template'
export { template, DEFAULT_FORMAT } from '../StatusLine/template'

/**
 * Render the current `statusLine` line — template with no command output
 * appended. Used by the renderer; command output is appended separately
 * via `pollStatusLineCommand`.
 */
export function renderStatusLine(
  config: StatusLineConfig,
  ctx: StatusLineCtx,
): string {
  return template(config?.format, ctx)
}

/**
 * Run the configured `command` once and return its first stdout line,
 * or '?' on error/timeout. The exec timeout is fixed at 1 s.
 *
 * Exposed as a small async helper so the React component can manage the
 * interval without re-implementing process spawning.
 */
export function execFirstLine(cmd: string): Promise<string> {
  return new Promise(resolve => {
    const child = exec(cmd, { timeout: 1000 }, (err, stdout) => {
      if (err) {
        resolve('?')
        return
      }
      const line = stdout.split('\n')[0]?.trim() ?? ''
      resolve(line)
    })
    void child
  })
}
