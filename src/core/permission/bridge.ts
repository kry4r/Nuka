// src/core/permission/bridge.ts
import type { PermissionCall, PermissionDecision } from './types'
import type { LoadedPlugin, PluginUserConfigField } from '../plugin/manifest'

export type AnnotationBadge = 'read-only' | 'destructive' | 'network'

export type PermissionPayload = {
  call: PermissionCall
  suggestedPattern?: string
  /** Badges derived from the tool's annotations, shown in the permission UI. */
  annotationBadges?: AnnotationBadge[]
}

export type PermissionHandler = (
  payload: PermissionPayload,
  resolve: (d: PermissionDecision) => void,
) => void

export type PluginConfigPayload = {
  plugin: LoadedPlugin
  fields: PluginUserConfigField[]
}

export type PluginConfigHandler = (
  payload: PluginConfigPayload,
  /** Resolve with config values on submit, or null if the user cancels */
  resolve: (result: Record<string, unknown> | null) => void,
) => void

export class PermissionBridge {
  private handler: PermissionHandler | null = null
  private pluginConfigHandler: PluginConfigHandler | null = null

  setHandler(h: PermissionHandler | null): void {
    this.handler = h
  }

  setPluginConfigHandler(h: PluginConfigHandler | null): void {
    this.pluginConfigHandler = h
  }

  ask(payload: PermissionPayload): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      if (!this.handler) {
        resolve({ allowed: false, reason: 'no permission UI attached' })
        return
      }
      this.handler(payload, resolve)
    })
  }

  /**
   * Open a plugin config dialog for the given plugin.
   * Resolves with the submitted config values, or null if the user cancelled.
   * When no plugin config UI is attached (e.g., non-interactive mode), resolves
   * with null so the plugin is skipped for this session.
   */
  promptPluginConfig(payload: PluginConfigPayload): Promise<Record<string, unknown> | null> {
    return new Promise<Record<string, unknown> | null>((resolve) => {
      if (!this.pluginConfigHandler) {
        resolve(null)
        return
      }
      this.pluginConfigHandler(payload, resolve)
    })
  }
}
