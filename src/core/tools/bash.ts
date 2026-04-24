// src/core/tools/bash.ts
import { spawn } from 'node:child_process'
import type { Tool } from './types'

type BashInput = { command: string; timeout?: number; cwd?: string }
const DEFAULT_TIMEOUT = 120_000

export const BashTool: Tool<BashInput> = {
  name: 'Bash',
  description: 'Run a shell command and capture its output.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string' },
      timeout: { type: 'integer', minimum: 1 },
      cwd: { type: 'string' },
    },
  },
  source: 'builtin',
  needsPermission: () => 'exec',
  async run(input, ctx) {
    const timeout = input.timeout ?? DEFAULT_TIMEOUT
    return new Promise((resolve) => {
      const proc = spawn('sh', ['-c', input.command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: input.cwd ?? ctx.cwd,
        detached: true,
      })

      let output = ''
      let lineBuf = ''

      const handleData = (d: Buffer) => {
        const chunk = d.toString()
        output += chunk
        lineBuf += chunk
        let idx: number
        while ((idx = lineBuf.indexOf('\n')) !== -1) {
          ctx.onProgress?.(lineBuf.slice(0, idx))
          lineBuf = lineBuf.slice(idx + 1)
        }
      }

      proc.stdout?.on('data', handleData)
      proc.stderr?.on('data', handleData)

      let timedOut = false
      let aborted = false

      const killProc = () => {
        try { process.kill(-(proc.pid as number), 'SIGKILL') } catch { /* ignore */ }
      }

      const timer = setTimeout(() => {
        timedOut = true
        killProc()
      }, timeout)

      const onAbort = () => {
        aborted = true
        killProc()
      }
      ctx.signal?.addEventListener('abort', onAbort, { once: true })

      proc.on('close', (code: number | null) => {
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        if (lineBuf.length > 0) { ctx.onProgress?.(lineBuf); lineBuf = '' }
        if (timedOut) {
          resolve({ isError: true, output: `timed out after ${timeout}ms\n${output}` })
        } else if (aborted) {
          resolve({ isError: true, output: 'aborted by user' })
        } else if (code !== 0) {
          resolve({ isError: true, output: `exit ${code}\n${output}` })
        } else {
          resolve({ isError: false, output })
        }
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timer)
        ctx.signal?.removeEventListener('abort', onAbort)
        resolve({ isError: true, output: err.message })
      })
    })
  },
}
