// src/tui/Tasks/dagLayout.ts
export type DagInputNode = { id: string; parents: string[] }
export type DagPlacedNode = { id: string; level: number; column: number; parents: string[] }

export function dagLayout(nodes: DagInputNode[]): DagPlacedNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const compute = (id: string): number => {
    if (level.has(id)) return level.get(id)!
    if (visiting.has(id)) throw new Error(`cycle through ${id}`)
    visiting.add(id)
    const n = byId.get(id); if (!n) throw new Error(`missing ${id}`)
    const lv = n.parents.length === 0 ? 0 : 1 + Math.max(...n.parents.map(compute))
    visiting.delete(id); level.set(id, lv)
    return lv
  }
  for (const n of nodes) compute(n.id)
  // Pack columns within a level by insertion order
  const byLevel = new Map<number, string[]>()
  for (const n of nodes) {
    const lv = level.get(n.id)!
    const arr = byLevel.get(lv) ?? []
    arr.push(n.id); byLevel.set(lv, arr)
  }
  const out: DagPlacedNode[] = []
  for (const [lv, ids] of byLevel) {
    ids.forEach((id, col) => out.push({ id, level: lv, column: col, parents: byId.get(id)!.parents }))
  }
  return out
}
