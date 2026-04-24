import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginEnable(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const name = args.trim()
  if (!name) {
    return { text: 'Usage: /plugin enable <name>', isError: true }
  }

  try {
    await deps.enable(name, true)
    return { text: `Plugin '${name}' enabled. Restart Nuka to activate.` }
  } catch (err: unknown) {
    return { text: `Failed to enable '${name}': ${(err as Error).message}`, isError: true }
  }
}
