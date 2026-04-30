export type PipelineNode = { id: string; agent: string; prompt: string; next: string[]; timeoutMs: number; team?: string }
export type PipelineInput = { nodes: PipelineNode[]; entry: string; ephemeralTeamName?: string }
export type StageResult = { nodeId: string; agentName: string; status: 'completed' | 'failed'; output: string; durationMs: number }
export type PipelineResult = { ok: boolean; failedAt?: string; stages: StageResult[] }

export function topoLevels(nodes: PipelineNode[], entry: string): string[][] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  if (!byId.has(entry)) throw new Error(`pipeline: entry "${entry}" not found`)
  // Build in-degree from entry's reachable subgraph.
  const reachable = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const id = stack.pop()!
    if (reachable.has(id)) continue
    reachable.add(id)
    const s = byId.get(id)
    if (s) for (const n of s.next ?? []) stack.push(n)
  }
  const inDeg = new Map<string, number>()
  for (const id of reachable) inDeg.set(id, 0)
  for (const id of reachable) {
    const s = byId.get(id)!
    for (const n of s.next ?? []) {
      if (reachable.has(n)) inDeg.set(n, (inDeg.get(n) ?? 0) + 1)
    }
  }
  const levels: string[][] = []
  let frontier = [...reachable].filter(id => inDeg.get(id) === 0)
  while (frontier.length) {
    levels.push(frontier)
    const next: string[] = []
    for (const id of frontier) {
      const s = byId.get(id)!
      for (const n of s.next ?? []) {
        if (!reachable.has(n)) continue
        const d = (inDeg.get(n) ?? 0) - 1
        inDeg.set(n, d)
        if (d === 0) next.push(n)
      }
    }
    frontier = next
  }
  const totalEmitted = levels.reduce((sum, l) => sum + l.length, 0)
  if (totalEmitted < reachable.size) {
    throw new Error(`pipeline: cycle detected (unreachable nodes after topo sort)`)
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
