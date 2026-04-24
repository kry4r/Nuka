import type { PluginSubcmdDeps, SubcmdResult } from './types'

export async function pluginInstall(
  args: string,
  deps: PluginSubcmdDeps,
): Promise<SubcmdResult> {
  const name = args.trim()
  if (!name) {
    return { text: 'Usage: /plugin install <name>', isError: true }
  }

  try {
    const result = await deps.install(name)
    const ver = result.version ? `@${result.version}` : ''
    return { text: `Installed plugin '${result.name}${ver}'. Restart Nuka to activate.` }
  } catch (err: unknown) {
    return { text: `Failed to install '${name}': ${(err as Error).message}`, isError: true }
  }
}
