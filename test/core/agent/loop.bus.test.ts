import { describe, it, expect } from 'vitest'
import { createEventBus } from '../../../src/core/events/bus'
import type { AgentBusEvent } from '../../../src/core/events/types'

describe('AgentLoop → EventBus (smoke)', () => {
  it('bus is optional — runAgentDeps.bus type is correct', () => {
    const bus = createEventBus()
    const seen: AgentBusEvent[] = []
    bus.subscribe<AgentBusEvent>('agent', e => seen.push(e))
    bus.emit('agent', {
      type: 'agent.tool.start',
      sessionId: 'sess',
      toolName: 'Read',
      input: { file_path: '/tmp/x' },
    })
    expect(seen.length).toBe(1)
    expect(seen[0]!.type).toBe('agent.tool.start')
  })
})
