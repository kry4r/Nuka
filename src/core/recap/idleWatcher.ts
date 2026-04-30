// src/core/recap/idleWatcher.ts — Phase 14c §6.3
export type IdleWatcherOpts = {
  thresholdMs: number
  onAway: () => void
  onReturn: (idleMs: number) => void
}

export function startIdleWatcher(opts: IdleWatcherOpts): { poke: () => void; stop: () => void } {
  let lastInputAt = Date.now()
  let isAway = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = (): void => {
    const idle = Date.now() - lastInputAt
    if (!isAway && idle >= opts.thresholdMs) {
      isAway = true
      opts.onAway()
    }
    timer = setTimeout(tick, Math.min(opts.thresholdMs / 2, 5000))
  }

  timer = setTimeout(tick, opts.thresholdMs / 2)

  return {
    poke: () => {
      const idle = Date.now() - lastInputAt
      lastInputAt = Date.now()
      if (isAway) {
        isAway = false
        opts.onReturn(idle)
      }
    },
    stop: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
