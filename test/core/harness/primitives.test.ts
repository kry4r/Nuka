import { describe, it, expect, vi } from 'vitest'
import { makeSequentialThinkingTool, makeSearchAndVerifyTool, makeAskUserQuestionTool } from '../../../src/core/harness/primitives'

describe('harness primitives', () => {
  it('sequential_thinking records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeSequentialThinkingTool(harness as any)
    const r = await tool.run({ thought: 'I am thinking' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('sequentialThinking')
  })

  it('search_and_verify records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeSearchAndVerifyTool(harness as any, { runResearcher: async () => 'found x' })
    const r = await tool.run({ query: 'foo' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('searchAndVerify')
  })

  it('ask_user_question records primitive', async () => {
    const harness = { recordPrimitive: vi.fn() }
    const tool = makeAskUserQuestionTool(harness as any, { askUser: async () => 'yes' })
    const r = await tool.run({ question: 'continue?' }, {} as never)
    expect(r.isError).toBe(false)
    expect(harness.recordPrimitive).toHaveBeenCalledWith('askUser')
  })
})
