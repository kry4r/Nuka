import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { TaskManager } from '../../src/core/tasks/manager'
import { createEventBus } from '../../src/core/events/bus'

describe('phase14 migration', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-mig-'))
    // Pre-create a phase13-shaped tasks dir with one orphan log file (no sidecar).
    const tasks = path.join(home, '.nuka', 'tasks')
    fs.mkdirSync(tasks, { recursive: true })
    fs.writeFileSync(path.join(tasks, 'legacy-1.log'), 'old output')
  })

  it('TaskManager constructs cleanly when only a legacy log exists', () => {
    const bus = createEventBus()
    expect(() => new TaskManager({ home, bus })).not.toThrow()
  })

  it('legacy log file is not deleted by the new manager', async () => {
    const bus = createEventBus()
    const _mgr = new TaskManager({ home, bus })
    // Wait a tick — meta sidecar writes are not retroactive.
    await new Promise(res => setTimeout(res, 20))
    expect(fs.existsSync(path.join(home, '.nuka', 'tasks', 'legacy-1.log'))).toBe(true)
  })

  it('an in-flight bash task still completes and writes its log', async () => {
    const bus = createEventBus()
    const mgr = new TaskManager({ home, bus })
    const t = mgr.enqueue({ kind: 'local_bash', description: 'd', command: 'echo', args: ['ok'] })
    await new Promise(res => setTimeout(res, 100))
    expect(fs.existsSync(t.outputFile)).toBe(true)
  })
})
