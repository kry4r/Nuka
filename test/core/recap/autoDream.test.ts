import { describe, it, expect, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { initAutoDream } from '../../../src/core/recap/autoDream'

describe('initAutoDream', () => {
  it('does not fire when below thresholds', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-ad-'))
    const enqueue = vi.fn()
    const ad = initAutoDream({
      home,
      tasks: { enqueue } as any,
      config: { minHours: 6, minSessions: 3 },
      now: () => Date.now(),
      newSessionsCount: () => 1,
      lastConsolidatedAt: () => Date.now() - 1 * 3600_000,
    })
    await ad.tick()
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('fires when both gates open', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-ad-'))
    fs.mkdirSync(path.join(home, '.nuka', 'memdir'), { recursive: true })
    const enqueue = vi.fn()
    const ad = initAutoDream({
      home,
      tasks: { enqueue } as any,
      config: { minHours: 6, minSessions: 3 },
      now: () => Date.now(),
      newSessionsCount: () => 5,
      lastConsolidatedAt: () => Date.now() - 10 * 3600_000,
    })
    await ad.tick()
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('stop() prevents subsequent ticks from firing', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-ad-'))
    fs.mkdirSync(path.join(home, '.nuka', 'memdir'), { recursive: true })
    const enqueue = vi.fn()
    const ad = initAutoDream({
      home,
      tasks: { enqueue } as any,
      config: { minHours: 6, minSessions: 3 },
      now: () => Date.now(),
      newSessionsCount: () => 5,
      lastConsolidatedAt: () => Date.now() - 10 * 3600_000,
    })
    ad.stop()
    await ad.tick()
    expect(enqueue).not.toHaveBeenCalled()
  })
})
