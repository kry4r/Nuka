// src/tui/Status/useUsage.ts
//
// React hook that returns the current per-session usage snapshot, debounced
// so we don't re-render faster than ~60Hz under streaming load.

import { useEffect, useState } from 'react'

export type UsageSnapshot = {
  inputTokens: number
  outputTokens: number
  contextUsed: number
  contextMax: number
  costUsd: number | undefined
}

export type UsageSource = () => UsageSnapshot

const FRAME_MS = 1000 / 60 // ~16.7ms

export function useUsage(source: UsageSource, tickHint?: unknown): UsageSnapshot {
  const [snap, setSnap] = useState<UsageSnapshot>(() => source())
  useEffect(() => {
    let pending = false
    let last = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const update = () => {
      const now = Date.now()
      if (now - last < FRAME_MS) {
        if (!pending) {
          pending = true
          timer = setTimeout(() => {
            pending = false
            last = Date.now()
            setSnap(source())
          }, FRAME_MS - (now - last))
        }
        return
      }
      last = now
      setSnap(source())
    }
    update()
    // 1 Hz tick to refresh even when nothing else is changing.
    const interval = setInterval(update, 1000)
    return () => {
      clearInterval(interval)
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickHint])
  return snap
}
