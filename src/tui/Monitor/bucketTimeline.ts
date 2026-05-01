// src/tui/Monitor/bucketTimeline.ts
//
// T8.4 — Adds a 5th `coordination` lane so coordination.* harness events get
// their own visual bar in the timeline. The harness lane keeps counting all
// non-coordination harness events.
export type TimelineLane = 'task' | 'agent' | 'message' | 'harness' | 'coordination'

export type TimelineBucket = {
  bucketStart: number
  task: number
  agent: number
  message: number
  harness: number
  coordination: number
}

export function bucketTimeline(
  events: Array<{ t: number; topic: TimelineLane }>,
  startMs: number,
  bucketCount: number,
): TimelineBucket[] {
  const aligned = Math.floor(startMs / 60_000) * 60_000
  const out: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucketStart: aligned + i * 60_000,
    task: 0,
    agent: 0,
    message: 0,
    harness: 0,
    coordination: 0,
  }))
  for (const e of events) {
    const idx = Math.floor((e.t - aligned) / 60_000)
    if (idx < 0 || idx >= bucketCount) continue
    ;(out[idx] as Record<string, unknown>)[e.topic] = ((out[idx] as Record<string, number>)[e.topic] ?? 0) + 1
  }
  return out
}
