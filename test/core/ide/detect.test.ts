import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { EventEmitter } from 'node:events'

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any imports that reference the modules.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Tracks calls: { cmd, args, exitCode }
  const spawnCalls: Array<{ cmd: string; args: string[]; exitCode: number }> = []
  // Map cmd -> exit code for `which` and direct invocations.
  const exitCodes = new Map<string, number>()
  // Map dir -> entries returned by readdir.
  const readdirMap = new Map<string, string[]>()

  /** Set the exit code for `which <cmd>` calls. */
  function setWhich(cmd: string, code: number) {
    exitCodes.set(`which::${cmd}`, code)
  }
  /** Set the exit code for direct `<cmd>` invocations (e.g. `code --status`). */
  function setCmd(cmd: string, ...args: string[]) {
    return {
      exits(code: number) {
        exitCodes.set(`${cmd}::${args.join(' ')}`, code)
      },
    }
  }
  function setReaddir(dir: string, entries: string[]) {
    readdirMap.set(dir, entries)
  }
  function reset() {
    spawnCalls.length = 0
    exitCodes.clear()
    readdirMap.clear()
  }

  return { spawnCalls, exitCodes, readdirMap, setWhich, setCmd, setReaddir, reset }
})

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    mocks.spawnCalls.push({ cmd, args, exitCode: 0 })

    // Determine which exit code to use.
    const directKey = `${cmd}::${args.join(' ')}`
    const whichKey = `which::${args[0] ?? ''}`

    let code: number
    if (cmd === 'which') {
      code = mocks.exitCodes.get(whichKey) ?? 1
    } else {
      code = mocks.exitCodes.get(directKey) ?? 1
    }

    // Build a minimal fake child-process EventEmitter.
    const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
    const child = {
      on(event: string, cb: (...a: unknown[]) => void) {
        if (!listeners[event]) listeners[event] = []
        listeners[event]!.push(cb)
        return child
      },
    } as unknown as ChildProcess & EventEmitter

    // Fire events asynchronously so callers attach listeners first.
    Promise.resolve().then(() => {
      listeners['close']?.forEach(cb => cb(code))
    })

    return child
  }),
}))

// Mock fs (only promises.readdir needed).
vi.mock('node:fs', () => {
  return {
    default: {
      promises: {
        readdir: vi.fn(async (dir: string) => {
          const entries = mocks.readdirMap.get(dir)
          if (entries === undefined) {
            const err = Object.assign(new Error(`ENOENT: no such file or directory, scandir '${dir}'`), { code: 'ENOENT' })
            throw err
          }
          return entries
        }),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are registered.
// ---------------------------------------------------------------------------
import { detectIdes, IDE_PORTS } from '../../../src/core/ide/detect'
import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectIdes', () => {
  beforeEach(() => {
    mocks.reset()
  })

  it('returns empty array when no IDE probes succeed', async () => {
    // All `which` calls return 1 (not found), readdir dirs not mapped.
    const ides = await detectIdes()
    expect(ides).toEqual([])
  })

  it('detects VS Code when `which code` and `code --status` both succeed', async () => {
    mocks.setWhich('code', 0)
    mocks.setCmd('code', '--status').exits(0)

    const ides = await detectIdes()
    expect(ides).toContainEqual({ family: 'vscode', port: IDE_PORTS.vscode })
  })

  it('does NOT detect VS Code when `code --status` returns non-zero', async () => {
    mocks.setWhich('code', 0)
    mocks.setCmd('code', '--status').exits(1)

    const ides = await detectIdes()
    expect(ides.find(i => i.family === 'vscode')).toBeUndefined()
  })

  it('does NOT detect VS Code when `which code` is not found', async () => {
    // which code -> not found (default 1), don't bother with --status
    const ides = await detectIdes()
    expect(ides.find(i => i.family === 'vscode')).toBeUndefined()
  })

  it('detects JetBrains when ~/.config/JetBrains/ contains a .lock file', async () => {
    const dir = path.join(os.homedir(), '.config', 'JetBrains')
    mocks.setReaddir(dir, ['idea.lock', 'config.xml'])

    const ides = await detectIdes()
    expect(ides).toContainEqual({ family: 'jetbrains', port: IDE_PORTS.jetbrains })
  })

  it('detects JetBrains via macOS Library path', async () => {
    const dir = path.join(os.homedir(), 'Library', 'Application Support', 'JetBrains')
    mocks.setReaddir(dir, ['webstorm.lock'])

    const ides = await detectIdes()
    expect(ides).toContainEqual({ family: 'jetbrains', port: IDE_PORTS.jetbrains })
  })

  it('does NOT detect JetBrains when lock dir exists but contains no .lock files', async () => {
    const dir = path.join(os.homedir(), '.config', 'JetBrains')
    mocks.setReaddir(dir, ['some-dir', 'config.xml'])

    const ides = await detectIdes()
    expect(ides.find(i => i.family === 'jetbrains')).toBeUndefined()
  })

  it('detects Cursor when `which cursor` succeeds', async () => {
    mocks.setWhich('cursor', 0)

    const ides = await detectIdes()
    expect(ides).toContainEqual({ family: 'cursor', port: IDE_PORTS.cursor })
  })

  it('does NOT detect Cursor when `which cursor` fails', async () => {
    const ides = await detectIdes()
    expect(ides.find(i => i.family === 'cursor')).toBeUndefined()
  })

  it('detects Windsurf when `which windsurf` succeeds', async () => {
    mocks.setWhich('windsurf', 0)

    const ides = await detectIdes()
    expect(ides).toContainEqual({ family: 'windsurf', port: IDE_PORTS.windsurf })
  })

  it('detects multiple IDEs simultaneously', async () => {
    mocks.setWhich('code', 0)
    mocks.setCmd('code', '--status').exits(0)
    mocks.setWhich('cursor', 0)

    const ides = await detectIdes()
    expect(ides.find(i => i.family === 'vscode')).toBeDefined()
    expect(ides.find(i => i.family === 'cursor')).toBeDefined()
  })

  it('never throws even when spawn errors', async () => {
    // Make `which` call throw (spawn error event).
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockImplementationOnce(() => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {}
      const child = {
        on(event: string, cb: (...a: unknown[]) => void) {
          if (!listeners[event]) listeners[event] = []
          listeners[event]!.push(cb)
          return child
        },
      }
      Promise.resolve().then(() => {
        listeners['error']?.forEach(cb => cb(new Error('spawn ENOENT')))
        listeners['close']?.forEach(cb => cb(null))
      })
      return child as unknown as ReturnType<typeof spawn>
    })

    await expect(detectIdes()).resolves.toBeDefined()
  })
})
