import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginDisable(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const name = args.trim()
  if (!name) {
    return { text: 'Usage: /plugin disable <name>', isError: true }
  }

  try {
    await deps.enable(name, false)
    return { text: `Plugin '${name}' disabled. Restart Nuka to take effect.` }
  } catch (err: unknown) {
    return { text: `Failed to disable '${name}': ${(err as Error).message}`, isError: true }
  }
}
