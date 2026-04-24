/**
 * /plugin slash command — interactive plugin management from the TUI.
 *
 * Usage:
 *   /plugin list
 *   /plugin search <query>
 *   /plugin install <name>
 *   /plugin uninstall <name>
 *   /plugin enable <name>
 *   /plugin disable <name>
 *   /plugin update <name>
 *
 * The marketplace/installer layers are injected via `PluginSubcmdDeps` so that:
 *  - Tests can mock without the M4-install stream being merged.
 *  - Post-rebase, production wiring simply passes real implementations.
 */
import type { SlashCommand, SlashResult } from '../types'
import { pluginSearch } from './search'
import { pluginInstall } from './install'
import { pluginUninstall } from './uninstall'
import { pluginList } from './list'
import { pluginEnable } from './enable'
import { pluginDisable } from './disable'
import { pluginUpdate } from './update'
import type { PluginSubcmdDeps, SubcmdResult } from './types'

const HELP_TEXT = `Plugin management commands:
  /plugin list                List installed plugins
  /plugin search <query>      Search the marketplace
  /plugin install <name>      Install a plugin
  /plugin uninstall <name>    Uninstall a plugin
  /plugin enable <name>       Enable a disabled plugin
  /plugin disable <name>      Disable a plugin
  /plugin update <name>       Update a plugin`

function subcmdToSlashResult(r: SubcmdResult): SlashResult {
  return { type: 'text', text: r.text }
}

/**
 * Create the /plugin SlashCommand with the given dependency implementations.
 * In tests, pass mocks. In production, pass real marketplace/installer fns.
 */
export function createPluginCommand(deps: PluginSubcmdDeps): SlashCommand {
  return {
    name: 'plugin',
    description: 'Manage plugins: list, search, install, uninstall, enable, disable, update',
    usage: '/plugin <subcommand> [args]',
    run: async (args: string): Promise<SlashResult> => {
      const trimmed = args.trim()
      const spaceIdx = trimmed.indexOf(' ')
      const subcmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
      const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1)

      let result: SubcmdResult

      switch (subcmd) {
        case 'list':
          result = await pluginList(rest, deps)
          break
        case 'search':
          result = await pluginSearch(rest, deps)
          break
        case 'install':
          result = await pluginInstall(rest, deps)
          break
        case 'uninstall':
          result = await pluginUninstall(rest, deps)
          break
        case 'enable':
          result = await pluginEnable(rest, deps)
          break
        case 'disable':
          result = await pluginDisable(rest, deps)
          break
        case 'update':
          result = await pluginUpdate(rest, deps)
          break
        default:
          result = { text: HELP_TEXT }
          break
      }

      return subcmdToSlashResult(result)
    },
  }
}
