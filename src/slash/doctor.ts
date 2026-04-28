// src/slash/doctor.ts
// Phase 10 §4.4 — /doctor slash command.
//
// Runs doctor diagnostics and returns a dialog result carrying the report.
// The TUI renders it via the <DoctorReport> component in App.tsx.

import type { SlashCommand, SlashContext } from './types'
import type { DoctorReport } from '../core/doctor/run'
import os from 'node:os'

export { type DoctorReport }

export const DoctorCommand: SlashCommand = {
  name: 'doctor',
  description: 'Run environment diagnostics (node, providers, plugins, LSP, config, disk)',
  source: 'builtin',
  usage: '/doctor',
  examples: ['/doctor'],
  async run(_args: string, ctx: SlashContext) {
    const { runDoctor } = await import('../core/doctor/run')
    const report = await runDoctor({
      home: os.homedir(),
      cwd: process.cwd(),
      providers: ctx.providers,
    })
    return {
      type: 'dialog' as const,
      dialog: { kind: 'doctor' as const, report },
    }
  },
}
