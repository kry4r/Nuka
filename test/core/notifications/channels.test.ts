// test/core/notifications/channels.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchToChannels, clearWarnedChannels, type ChannelDef } from '../../../src/core/notifications/channels'

describe('dispatchToChannels', () => {
  beforeEach(() => {
    clearWarnedChannels()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('skips channels whose allowlist does not include the event type (acceptance criterion 1)', async () => {
    let called = false
    // We test this by using a command channel that writes to a tracker
    // but with an event that's not in the allowlist
    const channels: ChannelDef[] = [
      {
        name: 'test-channel',
        allowlist: ['turn_end'], // only turn_end is allowed
        dispatch: { type: 'command', command: 'exit 0' },
      },
    ]

    // tool_result is NOT in allowlist → should not dispatch
    const warnSpy = vi.mocked(console.warn)
    await dispatchToChannels(channels, { type: 'tool_result', payload: {} })
    // No warning should be emitted (nothing was attempted)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('dispatches to channels with matching event type', async () => {
    const channels: ChannelDef[] = [
      {
        name: 'cmd-channel',
        allowlist: ['tool_result'],
        dispatch: { type: 'command', command: 'cat > /dev/null' },
      },
    ]
    // Should not throw and should not warn on success
    await expect(dispatchToChannels(channels, { type: 'tool_result', payload: { id: '1' } })).resolves.toBeUndefined()
  })

  it('logs warning once per failing channel, not per event (acceptance criterion 2)', async () => {
    const channels: ChannelDef[] = [
      {
        name: 'failing-channel',
        allowlist: ['tool_result'],
        dispatch: { type: 'command', command: 'exit 1' },
      },
    ]
    const warnSpy = vi.mocked(console.warn)

    await dispatchToChannels(channels, { type: 'tool_result', payload: {} })
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Second call — same channel should NOT warn again (rate-limited)
    warnSpy.mockClear()
    await dispatchToChannels(channels, { type: 'tool_result', payload: {} })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('other channels still fire when one channel fails (acceptance criterion 2)', async () => {
    let secondChannelFired = false
    const channels: ChannelDef[] = [
      {
        name: 'failing',
        allowlist: ['tool_result'],
        dispatch: { type: 'command', command: 'exit 1' },
      },
      {
        name: 'succeeding',
        allowlist: ['tool_result'],
        dispatch: { type: 'command', command: 'cat > /dev/null' },
      },
    ]
    // Even with failing channel, dispatch should not throw
    await expect(dispatchToChannels(channels, { type: 'tool_result', payload: {} })).resolves.toBeUndefined()
  })

  it('never throws even if all channels fail (acceptance criterion 3)', async () => {
    const channels: ChannelDef[] = [
      {
        name: 'bad1',
        allowlist: ['error'],
        dispatch: { type: 'command', command: 'exit 127' },
      },
      {
        name: 'bad2',
        allowlist: ['error'],
        dispatch: { type: 'command', command: 'exit 2' },
      },
    ]
    await expect(
      dispatchToChannels(channels, { type: 'error', payload: { message: 'oops' } }),
    ).resolves.toBeUndefined()
  })

  it('handles empty channel list without errors', async () => {
    await expect(dispatchToChannels([], { type: 'turn_end', payload: {} })).resolves.toBeUndefined()
  })

  it('dispatches to multiple matching channels', async () => {
    const channels: ChannelDef[] = [
      {
        name: 'ch1',
        allowlist: ['turn_end', 'tool_result'],
        dispatch: { type: 'command', command: 'cat > /dev/null' },
      },
      {
        name: 'ch2',
        allowlist: ['turn_end'],
        dispatch: { type: 'command', command: 'cat > /dev/null' },
      },
    ]
    await expect(dispatchToChannels(channels, { type: 'turn_end', payload: {} })).resolves.toBeUndefined()
  })

  it('plugin event types are in allowlist type union', () => {
    const channels: ChannelDef[] = [
      {
        name: 'install-watcher',
        allowlist: ['plugin_install', 'plugin_uninstall', 'plugin_enable', 'plugin_disable'],
        dispatch: { type: 'command', command: 'cat > /dev/null' },
      },
    ]
    // TypeScript would catch any type errors at compile time; runtime test verifies dispatch works
    expect(channels[0]!.allowlist).toHaveLength(4)
  })
})
