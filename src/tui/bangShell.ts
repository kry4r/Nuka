// src/tui/bangShell.ts
import { execa } from 'execa'

export async function runBangShell(
  cmd: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const result = await execa(cmd, {
      shell: true,
      cwd,
      all: true,
      reject: false,
      cancelSignal: signal as AbortSignal | undefined,
    })
    const out = result.all ?? ''
    if (result.exitCode !== 0) {
      return `[exit ${result.exitCode}]\n${out}`
    }
    return out
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return `[error] ${msg}`
  }
}
