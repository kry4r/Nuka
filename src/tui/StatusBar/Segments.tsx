// src/tui/StatusBar/Segments.tsx
import React from 'react'
import { Text } from 'ink'
import { defaultPalette as P } from '../theme'

export function Sep(): React.JSX.Element {
  return <Text color={P.muted}>{'   ·   '}</Text>
}

export function ModelSeg({ model }: { model: string }): React.JSX.Element {
  return <Text color={P.primary}>⬢ {model}</Text>
}

export function CwdSeg({ cwd }: { cwd: string }): React.JSX.Element {
  return <Text color={P.muted}>{cwd}</Text>
}

export function GitSeg({ branch, dirty }: { branch: string; dirty: boolean }): React.JSX.Element {
  return <Text color={dirty ? P.warn : P.muted}>{branch}{dirty ? '*' : ''}</Text>
}

export function CtxSeg({ used, max }: { used: number; max: number }): React.JSX.Element {
  const pct = used / max
  const color = pct > 0.95 ? P.error : pct > 0.8 ? P.warn : P.muted
  return (
    <Text color={color}>
      {(used / 1000).toFixed(0)}k/{(max / 1000).toFixed(0)}k
    </Text>
  )
}

export function CostSeg({ cost }: { cost: number }): React.JSX.Element {
  return <Text color={P.primary}>${cost.toFixed(2)}</Text>
}

export function McpSeg({ count, health }: { count: number; health: 'ok' | 'degraded' | 'none' }): React.JSX.Element {
  if (count === 0 && health === 'none') return <Text color={P.muted}>✓ no mcp</Text>
  const color = health === 'ok' ? P.success : P.warn
  return <Text color={color}>● {count} mcp</Text>
}

export function AutoSeg({ mode }: { mode: 'off' | `on(${number})` }): React.JSX.Element {
  return <Text color={P.muted}>auto: {mode}</Text>
}

export function QueueSeg({ n }: { n: number }): React.JSX.Element | null {
  if (n === 0) return null
  return <Text color={P.muted}>⏳ {n} queued</Text>
}

export function SessionPluginSeg({ count }: { count: number }): React.JSX.Element | null {
  if (count === 0) return null
  return <Text color={P.warn}>[session: {count}]</Text>
}
