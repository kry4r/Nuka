// src/tui/Monitor/MonitorSubmenu.tsx
//
// Phase 14b — thin App.tsx wrapper for MonitorView that reads from eventBus.
// Phase 14b review fix: live subscription via useMonitorEvents (replaces frozen useMemo snapshot).
import * as React from 'react'
import { SubmenuFrame } from '../Submenu/SubmenuFrame'
import { MonitorView } from './MonitorView'
import { eventBus } from '../../core/events/bus'
import { useMonitorEvents } from './useMonitorEvents'

export function MonitorSubmenuWrapper(p: { onClose: () => void }): React.ReactNode {
  const { events, agentUsage } = useMonitorEvents(eventBus)

  return (
    <SubmenuFrame mode="full" title="Monitor" focused>
      <MonitorView events={events} dagNodes={[]} agentUsage={agentUsage} onClose={p.onClose} />
    </SubmenuFrame>
  )
}
