import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginSearch(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const query = args.trim()
  if (!query) {
    return { text: 'Usage: /plugin search <query>', isError: true }
  }

  let results
  try {
    results = await deps.search(query)
  } catch (err: unknown) {
    return { text: `Search failed: ${(err as Error).message}`, isError: true }
  }

  if (results.length === 0) {
    return { text: `No plugins found matching '${query}'.` }
  }

  const lines = results.map(p => {
    const ver = p.version ? `@${p.version}` : ''
    const desc = p.description ? `  — ${p.description}` : ''
    return `  ${p.name}${ver}${desc}`
  })

  return { text: `Found ${results.length} plugin(s) for '${query}':\n${lines.join('\n')}` }
}
