/**
 * Shared types and helpers for /plugin subcommands.
 *
 * The marketplace/installer layers are not merged yet (M4-install stream).
 * Each handler accepts injectable deps so tests can mock these layers.
 */

export type PluginInfo = {
  name: string
  version?: string
  description?: string
  enabled?: boolean
}

/** Minimal injectable marketplace search interface. */
export type MarketplaceSearchFn = (query: string) => Promise<PluginInfo[]>

/** Minimal injectable installer interface. */
export type PluginInstallerFn = (name: string) => Promise<{ name: string; version?: string }>
export type PluginUninstallerFn = (name: string) => Promise<void>
export type PluginEnablerFn = (name: string, enabled: boolean) => Promise<void>
export type PluginUpdaterFn = (name: string) => Promise<{ changed: boolean }>
export type PluginListerFn = () => Promise<PluginInfo[]>

export type PluginSubcmdDeps = {
  search: MarketplaceSearchFn
  install: PluginInstallerFn
  uninstall: PluginUninstallerFn
  enable: PluginEnablerFn
  update: PluginUpdaterFn
  list: PluginListerFn
}

export type SubcmdResult =
  | { text: string }
  | { text: string; isError: true }
