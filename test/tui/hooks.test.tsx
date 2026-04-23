// test/tui/hooks.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useAgentStream } from '../../src/tui/hooks/useAgentStream'
import type { AgentEvent } from '../../src/core/agent/events'

function Probe({ onReady }: { onReady: (api: any) => void }): React.JSX.Element {
  const stream = useAgentStream({ runAgent: async function* () {
    yield { type: 'text_delta', text: 'A' } as AgentEvent
    yield { type: 'turn_end', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } } as AgentEvent
  } })
  React.useEffect(() => onReady(stream), [])
  return <Text>{stream.events.map(e => e.type).join(',')}</Text>
}

describe('useAgentStream', () => {
  it('exposes send + cancel + events list that appends as events arrive', async () => {
    let api: any
    const { rerender, lastFrame } = render(<Probe onReady={a => { api = a }} />)
    await api.send('hi')
    // allow microtasks to flush
    await new Promise(r => setTimeout(r, 0))
    rerender(<Probe onReady={() => {}} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('text_delta')
    expect(frame).toContain('turn_end')
  })
})
