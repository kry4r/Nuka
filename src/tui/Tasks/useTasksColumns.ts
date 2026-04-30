// src/tui/Tasks/useTasksColumns.ts
import { useEffect, useReducer } from 'react'
import { columnReducer, initialColumns, type ColumnsState } from './columnReducer'
import type { EventBus } from '../../core/events/bus'

type Action = { topic: string; payload: any }

export function useTasksColumns(bus: EventBus): ColumnsState {
  const [state, dispatch] = useReducer(
    (s: ColumnsState, a: Action) => columnReducer(s, a),
    null,
    () => initialColumns(),
  )
  useEffect(() => {
    const offs = ['task', 'agent', 'message', 'harness'].map(topic =>
      bus.subscribe(topic as any, (payload: any) => dispatch({ topic, payload })),
    )
    return () => offs.forEach(off => off())
  }, [bus])
  return state
}
