export type PipelineNode = { id: string; agent: string; prompt: string; next: string[]; timeoutMs: number; team?: string }
export type PipelineInput = { nodes: PipelineNode[]; entry: string; ephemeralTeamName?: string }
export type StageResult = { nodeId: string; agentName: string; status: 'completed' | 'failed'; output: string; durationMs: number }
export type PipelineResult = { ok: boolean; failedAt?: string; stages: StageResult[] }

export function topoLevels(nodes: PipelineNode[], entry: string): string[][] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const levels: string[][] = []
  let frontier = [entry]
  const seen = new Set<string>()

  while (frontier.length) {
    levels.push([...frontier])
    for (const id of frontier) seen.add(id)
    const nextFrontier: string[] = []
    for (const id of frontier) {
      const n = byId.get(id)
      if (!n) throw new Error(`unknown node ${id}`)
      for (const m of n.next) {
        if (seen.has(m)) throw new Error(`cycle detected in pipeline (${id} → ${m})`)
        if (!nextFrontier.includes(m)) nextFrontier.push(m)
      }
    }
    frontier = nextFrontier
  }
  return levels
}

export type RunPipelineOpts = {
  input: PipelineInput
  runStage: (nodeId: string, prompt: string) => Promise<string>
}

export async function runPipeline(opts: RunPipelineOpts): Promise<PipelineResult> {
  const { nodes, entry } = opts.input
  const byId = new Map(nodes.map(n => [n.id, n]))
  const levels = topoLevels(nodes, entry)
  const stages: StageResult[] = []
  let prev = ''
  for (const level of levels) {
    const promises = level.map(async id => {
      const n = byId.get(id)!
      const prompt = n.prompt.replaceAll('{{prev}}', prev)
      const t0 = Date.now()
      try {
        const output = await opts.runStage(id, prompt)
        stages.push({ nodeId: id, agentName: n.agent, status: 'completed', output, durationMs: Date.now() - t0 })
        return output
      } catch (e) {
        stages.push({ nodeId: id, agentName: n.agent, status: 'failed', output: (e as Error).message, durationMs: Date.now() - t0 })
        throw e
      }
    })
    try {
      const outputs = await Promise.all(promises)
      prev = outputs.join('\n').slice(0, 16_384)
    } catch {
      return { ok: false, failedAt: stages.find(s => s.status === 'failed')?.nodeId, stages }
    }
  }
  return { ok: true, stages }
}
