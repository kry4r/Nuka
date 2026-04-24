import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginList(
  _args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  let plugins
  try {
    plugins = await deps.list()
  } catch (err: unknown) {
    return { text: `Failed to list plugins: ${(err as Error).message}`, isError: true }
  }

  if (plugins.length === 0) {
    return { text: 'No plugins installed.' }
  }

  const lines = plugins.map(p => {
    const ver = p.version ? `@${p.version}` : ''
    const status = p.enabled === false ? ' [disabled]' : ''
    const desc = p.description ? `  — ${p.description}` : ''
    return `  ${p.name}${ver}${status}${desc}`
  })

  return { text: `Installed plugins (${plugins.length}):\n${lines.join('\n')}` }
}
