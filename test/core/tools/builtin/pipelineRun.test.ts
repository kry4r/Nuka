import { describe, it, expect } from 'vitest'
import { makePipelineRunTool } from '../../../../src/core/tools/builtin/pipelineRun'

describe('pipeline_run', () => {
  it('invokes runPipeline and returns stages', async () => {
    const tool = makePipelineRunTool({
      runPipeline: async (input) => ({ ok: true, stages: input.nodes.map((n: { id: string; agent: string }) => ({ nodeId: n.id, agentName: n.agent, status: 'completed' as const, output: `out-${n.id}`, durationMs: 1 })) }),
    } as never)
    const r = await tool.run({
      entry: 'a',
      nodes: [{ id: 'a', agent: 'core:planner', prompt: 'p', next: [], timeoutMs: 1000 }],
    } as never, {} as never)
    expect(r.isError).toBe(false)
    const parsed = JSON.parse(r.output as string)
    expect(parsed.stages.length).toBe(1)
  })

  it('rejects duplicate node ids', async () => {
    const tool = makePipelineRunTool({ runPipeline: async () => ({ ok: true, stages: [] }) })
    const r = await tool.run({
      entry: 'a',
      nodes: [
        { id: 'a', agent: 'core:x', prompt: 'p', next: [], timeoutMs: 1000 },
        { id: 'a', agent: 'core:y', prompt: 'q', next: [], timeoutMs: 1000 },
      ],
    } as never, {} as never)
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/duplicate node id/i)
  })

  it('rejects entry not in node id set', async () => {
    const tool = makePipelineRunTool({ runPipeline: async () => ({ ok: true, stages: [] }) })
    const r = await tool.run({
      entry: 'missing',
      nodes: [{ id: 'a', agent: 'core:x', prompt: 'p', next: [], timeoutMs: 1000 }],
    } as never, {} as never)
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/entry.*not in node id set/i)
  })

  it('rejects dangling next references', async () => {
    const tool = makePipelineRunTool({ runPipeline: async () => ({ ok: true, stages: [] }) })
    const r = await tool.run({
      entry: 'a',
      nodes: [{ id: 'a', agent: 'core:x', prompt: 'p', next: ['nonexistent'], timeoutMs: 1000 }],
    } as never, {} as never)
    expect(r.isError).toBe(true)
    expect(r.output as string).toMatch(/unknown id/i)
  })
})
