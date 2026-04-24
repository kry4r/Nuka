import type { PluginManifest } from './manifest'

export type DepClosure = {
  /** Topological install order (post-order DFS: dependencies before dependents) */
  order: string[]
  /** Arrays of node names forming dependency cycles */
  cycles: string[][]
  /** Dependencies that could not be resolved */
  missing: Array<{ name: string; declaredBy: string[] }>
}

/**
 * Resolve the full dependency closure of a root plugin manifest using
 * DFS with three-color marking (white/gray/black).
 *
 * Algorithm:
 *   WHITE (not in colorMap) — not yet visited
 *   GRAY  — currently on the DFS stack (ancestor in current path)
 *   BLACK — fully processed
 *
 * A GRAY→GRAY re-encounter indicates a cycle. The cycle is captured as
 * the slice of the current path from the revisited node onwards.
 *
 * The `resolve` callback is called for each dependency name (not for the root).
 * It must return the PluginManifest for that name, or null if unavailable.
 */
export async function resolveDepClosure(
  root: PluginManifest,
  resolve: (name: string) => Promise<PluginManifest | null>,
): Promise<DepClosure> {
  const color = new Map<string, 'gray' | 'black'>()
  /** Pre-loaded manifests (root + any resolved deps) */
  const manifests = new Map<string, PluginManifest>()
  const order: string[] = []
  const cycles: string[][] = []
  /** name → set of declaredBy plugin names */
  const missingMap = new Map<string, Set<string>>()
  /** Current DFS path for cycle reconstruction */
  const currentPath: string[] = []

  // Seed root manifest so resolve() is never called for it
  manifests.set(root.name, root)

  async function visit(name: string, declaredBy: string | null): Promise<void> {
    const state = color.get(name)

    if (state === 'gray') {
      // Cycle detected — reconstruct from currentPath
      const cycleStart = currentPath.indexOf(name)
      if (cycleStart !== -1) {
        cycles.push([...currentPath.slice(cycleStart)])
      } else {
        // Fallback: just record the cycle endpoint
        cycles.push([name])
      }
      return
    }

    if (state === 'black') {
      // If this was a missing dep, accumulate additional declaredBy
      if (missingMap.has(name) && declaredBy !== null) {
        missingMap.get(name)!.add(declaredBy)
      }
      return
    }

    color.set(name, 'gray')
    currentPath.push(name)

    // Resolve manifest if not pre-loaded
    let manifest = manifests.get(name)
    if (manifest === undefined) {
      const resolved = await resolve(name)
      if (resolved === null) {
        // Missing dependency
        const entry = missingMap.get(name) ?? new Set<string>()
        if (declaredBy !== null) entry.add(declaredBy)
        missingMap.set(name, entry)
        // Mark black so we don't try again
        color.set(name, 'black')
        currentPath.pop()
        // Do NOT add to order
        return
      }
      manifest = resolved
      manifests.set(name, manifest)
    }

    // Recurse into dependencies
    for (const dep of manifest.dependencies ?? []) {
      await visit(dep.name, name)
    }

    // Post-order: mark black and record in order
    color.set(name, 'black')
    currentPath.pop()
    order.push(name)
  }

  await visit(root.name, null)

  // Convert missingMap to output format
  const missing = Array.from(missingMap.entries()).map(([name, declaredBySet]) => ({
    name,
    declaredBy: [...declaredBySet],
  }))

  return { order, cycles, missing }
}
