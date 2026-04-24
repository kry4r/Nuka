// src/core/notifications/channels.ts
/**
 * Channel-based notification routing for Nuka.
 * Channels receive events from the agent loop and forward them via HTTP webhook
 * or shell command. Failures are non-fatal and rate-limited to one warning per
 * channel (not per event) to prevent log spam.
 */
import { execa } from 'execa'

export type ChannelEventType =
  | 'tool_result'
  | 'turn_end'
  | 'error'
  | 'plugin_install'
  | 'plugin_uninstall'
  | 'plugin_enable'
  | 'plugin_disable'

export type ChannelDef = {
  name: string
  allowlist: Array<ChannelEventType>
  dispatch: { type: 'webhook'; url: string } | { type: 'command'; command: string }
}

export type ChannelEvent = {
  type: string
  payload: unknown
}

const TIMEOUT_MS = 10_000

/** Module-level failure tracker — keys are channel names that already logged. */
const _warnedChannels = new Set<string>()

/** Reset warned channels (used in tests). */
export function clearWarnedChannels(): void {
  _warnedChannels.clear()
}

async function dispatchWebhook(channel: ChannelDef & { dispatch: { type: 'webhook'; url: string } }, event: ChannelEvent): Promise<void> {
  const body = JSON.stringify({ type: event.type, payload: event.payload, ts: new Date().toISOString() })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(channel.dispatch.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function dispatchCommand(channel: ChannelDef & { dispatch: { type: 'command'; command: string } }, event: ChannelEvent): Promise<void> {
  const payload = JSON.stringify({ type: event.type, payload: event.payload, ts: new Date().toISOString() })
  await execa('sh', ['-c', channel.dispatch.command], {
    input: payload,
    timeout: TIMEOUT_MS,
    reject: true,
  })
}

/**
 * Dispatch an event to all channels whose allowlist includes the event type.
 * Never throws. Logs one warning per failing channel (rate-limited).
 */
export async function dispatchToChannels(
  channels: ChannelDef[],
  event: ChannelEvent,
): Promise<void> {
  const matching = channels.filter(c => c.allowlist.includes(event.type as ChannelEventType))
  if (matching.length === 0) return

  await Promise.allSettled(
    matching.map(async channel => {
      try {
        if (channel.dispatch.type === 'webhook') {
          await dispatchWebhook(channel as ChannelDef & { dispatch: { type: 'webhook'; url: string } }, event)
        } else {
          await dispatchCommand(channel as ChannelDef & { dispatch: { type: 'command'; command: string } }, event)
        }
      } catch (err) {
        // Rate-limit: warn once per channel
        if (!_warnedChannels.has(channel.name)) {
          _warnedChannels.add(channel.name)
          console.warn(`[channels] channel '${channel.name}' dispatch failed: ${(err as Error).message}`)
        }
      }
    }),
  )
}
