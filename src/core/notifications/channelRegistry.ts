// src/core/notifications/channelRegistry.ts
/**
 * Module-level registry of registered ChannelDef entries.
 * Populated at plugin wire time; consumed by the agent loop.
 */
import type { ChannelDef } from './channels'

const _channels: ChannelDef[] = []

export function registerChannel(def: ChannelDef): void {
  _channels.push(def)
}

export function getChannels(): readonly ChannelDef[] {
  return _channels
}

/** Clear the registry (used in tests). */
export function clearChannels(): void {
  _channels.length = 0
}
