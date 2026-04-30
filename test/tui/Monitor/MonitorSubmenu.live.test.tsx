// test/tui/Monitor/MonitorSubmenu.live.test.tsx
//
// Phase 14b review fix — tests the useMonitorEvents hook via an Ink wrapper
// and verifies live bus subscription (no frozen snapshot).

import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { createEventBus } from '../../../src/core/events/bus'
import { useMonitorEvents } from '../../../src/tui/Monitor/useMonitorEvents'

// Helper: renders a component that exposes hook state as text so we can assert it.
function HookHarness({ bus }: { bus: ReturnType<typeof createEventBus> }) {
  const { events, agentUsage } = useMonitorEvents(bus)
  return (
    <Text>
      {`events:${events.length} usage:${agentUsage.length} names:${agentUsage.map(u => u.agentName).join(',')}`}
    </Text>
  )
}

describe('useMonitorEvents', () => {
  it('starts with empty events and agentUsage', () => {
    const bus = createEventBus()
    const { lastFrame } = render(<HookHarness bus={bus} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('events:0')
    expect(frame).toContain('usage:0')
  })

  it('seeds from ring buffer on mount (replay)', async () => {
    const bus = createEventBus()
    // Emit before mount — goes into ring buffer.
    bus.emit('agent', { type: 'agent.usage', sessionId: 'seeded-agent', inputTokens: 77, outputTokens: 33 })

    const { lastFrame, rerender } = render(<HookHarness bus={bus} />)
    // Allow the useEffect (replay) to fire and state to update.
    await new Promise(r => setTimeout(r, 20))
    rerender(<HookHarness bus={bus} />)

    const frame = lastFrame() ?? ''
    // After mount the hook replays ring buffer, so usage count should be 1.
    expect(frame).toContain('usage:1')
    expect(frame).toContain('seeded-agent')
  })

  it('live-updates agentUsage when agent.usage event is emitted after mount', async () => {
    const bus = createEventBus()
    const { lastFrame, rerender } = render(<HookHarness bus={bus} />)

    // Emit after mount — should trigger live subscription update.
    bus.emit('agent', { type: 'agent.usage', sessionId: 'live-agent', inputTokens: 100, outputTokens: 50 })
    // Allow Ink to re-render.
    await new Promise(r => setTimeout(r, 20))
    rerender(<HookHarness bus={bus} />)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('usage:1')
    expect(frame).toContain('live-agent')
  })

  it('all four topics are subscribed (harness events update event count)', async () => {
    const bus = createEventBus()
    const { lastFrame, rerender } = render(<HookHarness bus={bus} />)

    bus.emit('harness', { type: 'harness.stage.enter', stage: 'implement', sessionId: 's1' })
    await new Promise(r => setTimeout(r, 20))
    rerender(<HookHarness bus={bus} />)

    const frame = lastFrame() ?? ''
    // harness event should now appear in the flat events list.
    expect(frame).toContain('events:1')
  })
})
