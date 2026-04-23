// src/tui/hooks/useSession.ts
import { useState, useMemo, useCallback } from 'react'
import type { Session } from '../../core/session/types'
import { SessionManager } from '../../core/session/manager'

export function useSession(initial: {
  providerId: string
  model: string
}): {
  session: Session
  manager: SessionManager
  refresh: () => void
} {
  const manager = useMemo(() => {
    const m = new SessionManager()
    m.start(initial)
    return m
  }, [])
  const [, tick] = useState(0)
  const refresh = useCallback(() => tick(t => t + 1), [])
  return { session: manager.active()!, manager, refresh }
}
