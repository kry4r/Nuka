// src/tui/Monitor/bucketTimeline.ts
export type TimelineBucket = { bucketStart: number; task: number; agent: number; message: number; harness: number }

export function bucketTimeline(
  events: Array<{ t: number; topic: 'task' | 'agent' | 'message' | 'harness' }>,
  startMs: number,
  bucketCount: number,
): TimelineBucket[] {
  const aligned = Math.floor(startMs / 60_000) * 60_000
  const out: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    bucketStart: aligned + i * 60_000, task: 0, agent: 0, message: 0, harness: 0,
  }))
  for (const e of events) {
    const idx = Math.floor((e.t - aligned) / 60_000)
    if (idx < 0 || idx >= bucketCount) continue
    ;(out[idx] as any)[e.topic]++
  }
  return out
}
