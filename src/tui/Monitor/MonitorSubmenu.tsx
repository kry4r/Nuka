// src/tui/Monitor/MonitorSubmenu.tsx
//
// Phase 14b — thin App.tsx wrapper for MonitorView that reads from eventBus.
import * as React from 'react'
import { SubmenuFrame } from '../Submenu/SubmenuFrame'
import { MonitorView } from './MonitorView'
import { eventBus } from '../../core/events/bus'

type EventItem = { t: number; topic: 'task' | 'agent' | 'message' | 'harness' }

export function MonitorSubmenuWrapper(p: { onClose: () => void }): React.ReactNode {
  // Replay recent events from the ring buffer for initial display
  const events = React.useMemo((): EventItem[] => {
    const tasks = (eventBus.replay('task', 200) as any[]).map(e => ({ t: Date.now(), topic: 'task' as const }))
    const agents = (eventBus.replay('agent', 200) as any[]).map(e => ({ t: Date.now(), topic: 'agent' as const }))
    const messages = (eventBus.replay('message', 200) as any[]).map(e => ({ t: Date.now(), topic: 'message' as const }))
    return [...tasks, ...agents, ...messages]
  }, [])

  return (
    <SubmenuFrame mode="full" title="Monitor" focused>
      <MonitorView events={events} dagNodes={[]} />
    </SubmenuFrame>
  )
}
