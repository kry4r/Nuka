import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginUninstall(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const name = args.trim()
  if (!name) {
    return { text: 'Usage: /plugin uninstall <name>', isError: true }
  }

  try {
    await deps.uninstall(name)
    return { text: `Uninstalled plugin '${name}'. Restart Nuka to complete removal.` }
  } catch (err: unknown) {
    return { text: `Failed to uninstall '${name}': ${(err as Error).message}`, isError: true }
  }
}
