import type { ProgressTracker } from '../tasks/progressTracker'

export type SummarizerOpts = {
  taskId: string
  tracker: ProgressTracker
  intervalMs?: number
  runFork: (prompt: string) => Promise<{ text: string }>
  buildPrompt: (previous: string | null) => string
}

const DEFAULT_INTERVAL = 30_000

export function startAgentSummarizer(opts: SummarizerOpts): { stop: () => void } {
  let prev: string | null = null
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const { text } = await opts.runFork(opts.buildPrompt(prev))
      const trimmed = text.trim().slice(0, 80)
      if (trimmed && trimmed !== prev) {
        prev = trimmed
        opts.tracker.setSummary(trimmed)
      }
    } catch { /* swallow — summary is best-effort */ }
    if (!stopped) timer = setTimeout(tick, opts.intervalMs ?? DEFAULT_INTERVAL)
  }
  timer = setTimeout(tick, opts.intervalMs ?? DEFAULT_INTERVAL)
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer) } }
}

export function buildSummaryPrompt(prev: string | null): string {
  const prevLine = prev ? `\nPrevious: "${prev}" — say something NEW.\n` : ''
  return `Describe your most recent action in 3-5 words using present tense (-ing). Name the file or function, not the branch. Do not use tools.${prevLine}
Good: "Reading runAgent.ts", "Fixing null check", "Running auth tests"
Bad: past tense, vague, branch names.`
}
