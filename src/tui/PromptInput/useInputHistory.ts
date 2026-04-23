// src/tui/PromptInput/useInputHistory.ts
import { useCallback, useRef, useState } from 'react'

export function useInputHistory(): {
  push: (v: string) => void
  prev: (current: string) => string | null
  next: () => string | null
  reset: () => void
} {
  const buf = useRef<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)

  const push = useCallback((v: string) => {
    if (!v.trim()) return
    buf.current.push(v)
    setCursor(null)
  }, [])
  const prev = useCallback((_current: string) => {
    if (buf.current.length === 0) return null
    const next = cursor === null ? buf.current.length - 1 : Math.max(0, cursor - 1)
    setCursor(next)
    return buf.current[next] ?? null
  }, [cursor])
  const next = useCallback(() => {
    if (cursor === null) return null
    const n = cursor + 1
    if (n >= buf.current.length) {
      setCursor(null)
      return ''
    }
    setCursor(n)
    return buf.current[n] ?? null
  }, [cursor])
  const reset = useCallback(() => setCursor(null), [])

  return { push, prev, next, reset }
}
