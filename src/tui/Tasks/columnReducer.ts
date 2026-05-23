// src/tui/Tasks/columnReducer.ts
import type { Task } from '../../core/tasks/types'

export type ColumnKind = 'plan' | 'subagent' | 'pipeline' | 'background' | 'message'

export type Row = {
  id: string
  primary: string
  secondary: string
  status: string
  tokens?: { in: number; out: number }
  startedAt?: number
}

export type ColumnsState = Record<ColumnKind, { rows: Row[] }>

const CAP = 16

export function initialColumns(): ColumnsState {
  return { plan: { rows: [] }, subagent: { rows: [] }, pipeline: { rows: [] }, background: { rows: [] }, message: { rows: [] } }
}

function classify(kind: Task['kind']): ColumnKind {
  switch (kind) {
    case 'in_process_teammate': return 'subagent'
    case 'remote_agent': return 'subagent'
    case 'local_agent': return 'subagent'
    case 'local_bash':
    case 'local_shell':
    case 'dream':
    default: return 'background'
  }
}

function addRow(state: ColumnsState, col: ColumnKind, row: Row): ColumnsState {
  const next = { ...state[col] }
  next.rows = [row, ...state[col].rows.filter(r => r.id !== row.id)].slice(0, CAP)
  return { ...state, [col]: next }
}

function updateRow(state: ColumnsState, col: ColumnKind, id: string, patch: Partial<Row>): ColumnsState {
  const next = { ...state[col] }
  next.rows = state[col].rows.map(r => r.id === id ? { ...r, ...patch } : r)
  return { ...state, [col]: next }
}

function removeRow(state: ColumnsState, col: ColumnKind, id: string): ColumnsState {
  const next = { ...state[col] }
  next.rows = state[col].rows.filter(r => r.id !== id)
  return { ...state, [col]: next }
}

export function columnReducer(state: ColumnsState, rec: { topic: string; payload: any }): ColumnsState {
  const p = rec.payload
  if (rec.topic === 'task' && p.type === 'task.created') {
    const col = classify(p.task.kind)
    return addRow(state, col, {
      id: p.task.id,
      primary: p.task.agentName ?? p.task.description,
      secondary: p.task.teamName ?? p.task.agentId ?? p.task.kind,
      status: p.task.state,
      startedAt: p.task.startedAt,
    })
  }
  if (rec.topic === 'task' && p.type === 'task.state') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) return updateRow(state, col, p.id, { status: p.to })
    }
    return state
  }
  if (rec.topic === 'task' && p.type === 'task.progress') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) {
        return updateRow(state, col, p.id, { tokens: { in: p.snapshot.latestInputTokens, out: p.snapshot.cumulativeOutputTokens } })
      }
    }
    return state
  }
  if (rec.topic === 'task' && p.type === 'task.evicted') {
    for (const col of ['subagent', 'background', 'pipeline'] as ColumnKind[]) {
      if (state[col].rows.find(r => r.id === p.id)) return removeRow(state, col, p.id)
    }
    return state
  }
  if (rec.topic === 'message' && p.type === 'message.sent') {
    return addRow(state, 'message', {
      id: p.envelope.id,
      primary: `${p.envelope.from} → ${p.envelope.to}`,
      secondary: p.envelope.summary,
      status: 'sent',
      startedAt: p.envelope.sentAt,
    })
  }
  if (rec.topic === 'message' && p.type === 'message.delivered') {
    return updateRow(state, 'message', p.envelopeId, { status: 'delivered' })
  }
  return state
}
