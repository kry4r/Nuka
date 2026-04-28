/**
 * git-log — spawn-runtime tool wrapping `git log --oneline -n 5`.
 *
 * Demonstrates the Phase 11 spawn runtime: the tool declares a command + args
 * + parseOutput; Nuka synthesises the run() body automatically.
 *
 * Because plugin .js files are loaded via dynamic import in wire.ts, the
 * spawn runtime is declared but Nuka's defineTool factory is not available
 * here. Instead we provide a full run() that uses child_process.spawn
 * directly — matching the contract executeSpawn would produce.
 *
 * Tags: ['git', 'vcs.read'] — matched by skills with requires: ['git'] or
 * requires: ['vcs.read'].
 */
import { spawn } from 'node:child_process'

function spawnGitLog(cwd, signal) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn('git', ['log', '--oneline', '-n', '5'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd,
        detached: true,
      })
    } catch (err) {
      resolve({ isError: true, output: err.message })
      return
    }

    let stdout = ''
    let stderr = ''
    let aborted = false

    proc.stdout?.on('data', (d) => { stdout += d.toString() })
    proc.stderr?.on('data', (d) => { stderr += d.toString() })

    const onAbort = () => {
      aborted = true
      try {
        if (typeof proc.pid === 'number') process.kill(-proc.pid, 'SIGKILL')
        else proc.kill('SIGKILL')
      } catch {
        try { proc.kill('SIGKILL') } catch { /* ignore */ }
      }
    }

    if (signal) {
      if (signal.aborted) {
        onAbort()
      } else {
        signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ isError: true, output: err.message })
    })

    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        resolve({ isError: true, output: 'aborted by user' })
        return
      }
      if (code !== 0) {
        resolve({ isError: true, output: `exit ${code}\n${stderr || stdout}` })
        return
      }
      const commits = stdout.trim().split('\n').filter(Boolean)
      resolve({ isError: false, output: JSON.stringify({ commits }) })
    })
  })
}

export default {
  name: 'git-log',
  description: 'Last 5 git commits as a list',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  source: 'plugin',
  tags: ['git', 'vcs.read'],
  runtime: {
    kind: 'spawn',
    command: 'git',
    args: () => ['log', '--oneline', '-n', '5'],
    parseOutput: (stdout) => ({ commits: stdout.trim().split('\n').filter(Boolean) }),
  },
  needsPermission: () => 'none',
  async run(_input, ctx) {
    return spawnGitLog(ctx.cwd, ctx.signal)
  },
}
