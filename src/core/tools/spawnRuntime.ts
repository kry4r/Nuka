// src/core/tools/spawnRuntime.ts
import { spawn } from 'node:child_process'
import type { Tool, ToolContext, ToolResult, ToolRuntime } from './types'

/**
 * Execute a {@link Tool} that declares `runtime: { kind: 'spawn', ... }`.
 *
 * Resolves args via `runtime.args(input)`, spawns `runtime.command` via
 * `node:child_process`, captures stdout/stderr fully, and adapts the result
 * to a {@link ToolResult}. A non-zero exit code yields `isError: true`. If
 * `ctx.signal` aborts before the child exits we kill it and report
 * `aborted by user`.
 *
 * If `runtime.parseOutput` is provided, it is invoked on the captured
 * stdout and its return value becomes `output` (string returns flow
 * through unchanged; non-string returns are JSON-stringified to keep
 * compatibility with the `string | ContentBlock[]` shape — non-string
 * objects pretty-print so the tool can return structured data without
 * breaking the existing surface).
 *
 * See spec §4.1 (External tool execution).
 */
export async function executeSpawn<I>(
  spec: Tool<I>,
  input: I,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!spec.runtime || spec.runtime.kind !== 'spawn') {
    return {
      isError: true,
      output: `executeSpawn called for tool ${spec.name} without spawn runtime`,
    }
  }

  const rt: Extract<ToolRuntime, { kind: 'spawn' }> = spec.runtime
  let args: string[]
  try {
    args = rt.args ? rt.args(input as unknown) : []
  } catch (err) {
    return { isError: true, output: `args() threw: ${(err as Error).message}` }
  }

  const env = rt.env ? { ...process.env, ...rt.env } : process.env

  return new Promise<ToolResult>((resolve) => {
    let proc
    try {
      proc = spawn(rt.command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: ctx.cwd,
        env,
      })
    } catch (err) {
      resolve({ isError: true, output: (err as Error).message })
      return
    }

    let stdout = ''
    let stderr = ''
    let aborted = false

    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const onAbort = () => {
      aborted = true
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
    }
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        onAbort()
      } else {
        ctx.signal.addEventListener('abort', onAbort, { once: true })
      }
    }

    proc.on('error', (err: Error) => {
      ctx.signal?.removeEventListener('abort', onAbort)
      resolve({ isError: true, output: err.message })
    })

    proc.on('close', (code: number | null) => {
      ctx.signal?.removeEventListener('abort', onAbort)
      if (aborted) {
        resolve({ isError: true, output: 'aborted by user' })
        return
      }
      if (code !== 0) {
        const tail = stderr || stdout
        resolve({ isError: true, output: `exit ${code}\n${tail}` })
        return
      }
      if (rt.parseOutput) {
        try {
          const parsed = rt.parseOutput(stdout)
          if (typeof parsed === 'string') {
            resolve({ isError: false, output: parsed })
          } else if (parsed && typeof parsed === 'object' && 'text' in (parsed as Record<string, unknown>) && typeof (parsed as { text: unknown }).text === 'string') {
            resolve({ isError: false, output: (parsed as { text: string }).text })
          } else {
            resolve({ isError: false, output: JSON.stringify(parsed) })
          }
        } catch (err) {
          resolve({ isError: true, output: `parseOutput threw: ${(err as Error).message}` })
        }
        return
      }
      resolve({ isError: false, output: stdout })
    })
  })
}
