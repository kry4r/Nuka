import { describe, it, expect } from 'vitest'
import { mountApp } from '../../../src/tui/testing/harness'
import { SlashRegistry } from '../../../src/slash/registry'
import { StatsCommand } from '../../../src/slash/stats'
import { SettingsCommand } from '../../../src/slash/settings'
import { DoctorCommand } from '../../../src/slash/doctor'

const wait = (ms = 50) => new Promise(r => setTimeout(r, ms))

describe('dialog-returning slashes', () => {
  for (const [name, cmd, expected] of [
    // StatsView always shows the tab labels (Overview / Models) regardless
    // of whether the cost-tracker has data; assert on the structural label.
    ['stats', StatsCommand, 'overview'],
    // /settings now opens the dialog directly (no `nuka init` gate); the
    // menu lists settings categories — 'providers' is the first/most-stable
    // label even when no providers are configured.
    ['settings', SettingsCommand, 'providers'],
    ['doctor', DoctorCommand, 'doctor'],
  ] as const) {
    it(`/${name} renders its dialog`, async () => {
      const slash = new SlashRegistry()
      slash.register(cmd)
      const h = mountApp({ target: 'app', slash })
      try {
        await wait()
        h.stdin.write(`/${name}`)
        await wait()
        h.stdin.write('\r')
        await wait(400)
        const allFrames = h.frames().join('\n=== FRAME ===\n').toLowerCase()
        if (!allFrames.includes(expected.toLowerCase())) {
          const frames = h.frames()
          const tail = frames.slice(-3).map((f, i) => `--- FRAME ${frames.length - 3 + i} ---\n${f}`).join('\n')
          // eslint-disable-next-line no-console
          console.error(`[/${name}] last 3 of ${frames.length} frames:\n${tail}`)
        }
        expect(allFrames).toContain(expected.toLowerCase())
      } finally {
        h.unmount()
      }
    })
  }
})
