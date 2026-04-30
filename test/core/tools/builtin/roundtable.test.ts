import { describe, it, expect } from 'vitest'
import { makeRoundtableTool } from '../../../../src/core/tools/builtin/roundtable'

describe('roundtable', () => {
  it('invokes runRoundtable', async () => {
    const tool = makeRoundtableTool({
      runRoundtable: async () => ({ artifact: 'x', rounds: 1, transcript: 't' }),
    } as never)
    const r = await tool.run({
      team: 'demo', topic: 'plan',
      members: [{ agent: 'core:planner', name: 'p', role: 'planner' }, { agent: 'core:skeptic', name: 's', role: 'skeptic' }],
      synthesizer: 'p', rounds: 1,
    } as never, {} as never)
    expect(r.isError).toBe(false)
  })
})
