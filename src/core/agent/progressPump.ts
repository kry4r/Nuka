// src/core/agent/progressPump.ts
export type ProgressPump = {
  onProgress: (msg: string) => void
  finish: () => void
  drain(): AsyncIterable<string>
}

export function createProgressPump(): ProgressPump {
  const q: string[] = []
  let waiter: ((v: string | null) => void) | null = null
  let done = false
  return {
    onProgress(msg: string) {
      if (waiter) { const w = waiter; waiter = null; w(msg) }
      else q.push(msg)
    },
    finish() {
      done = true
      if (waiter) { const w = waiter; waiter = null; w(null) }
    },
    async *drain() {
      while (true) {
        if (q.length > 0) { yield q.shift()!; continue }
        if (done) return
        const v = await new Promise<string | null>(r => { waiter = r })
        if (v === null) return
      }
    },
  }
}
