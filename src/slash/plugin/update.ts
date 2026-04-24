import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginUpdate(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const name = args.trim()
  if (!name) {
    return { text: 'Usage: /plugin update <name>', isError: true }
  }

  try {
    const result = await deps.update(name)
    if (result.changed) {
      return { text: `Plugin '${name}' updated. Restart Nuka to apply changes.` }
    } else {
      return { text: `Plugin '${name}' is already up to date.` }
    }
  } catch (err: unknown) {
    return { text: `Failed to update '${name}': ${(err as Error).message}`, isError: true }
  }
}
