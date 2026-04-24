import { describe, it, expect } from 'vitest'
import { runHooks } from '../../../src/core/hooks/runner'
import type { HookEntry } from '../../../src/core/hooks/types'

describe('runHooks', () => {
  it('returns cancel=false when no hooks match the event', async () => {
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo hi' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {}, { tool: 'Bash' })
    expect(result.cancel).toBe(false)
  })

  it('returns cancel=false when hooks array is empty', async () => {
    const result = await runHooks([], 'beforeToolCall', {})
    expect(result.cancel).toBe(false)
  })

  it('runs afterTurn hook and returns cancel=false (non-cancelable)', async () => {
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'echo {}' },
    ]
    const result = await runHooks(hooks, 'afterTurn', { event: 'afterTurn' })
    expect(result.cancel).toBe(false)
  })

  it('fires beforeToolCall hook and returns cancel=false when exit 0', async () => {
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', tool: 'Bash', command: 'echo \'{"ok":true}\'' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', { tool: 'Bash' }, { tool: 'Bash' })
    expect(result.cancel).toBe(false)
  })

  it('cancels when beforeToolCall hook exits non-zero and outputs cancel=true', async () => {
    // Script: exit 1 and output JSON with cancel:true
    const hooks: HookEntry[] = [
      {
        event: 'beforeToolCall',
        tool: 'Bash',
        command: 'echo \'{"cancel":true,"reason":"audited"}\' && exit 1',
      },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', { tool: 'Bash', input: {} }, { tool: 'Bash' })
    expect(result.cancel).toBe(true)
    expect(result.reason).toBe('audited')
  })

  it('does NOT cancel when hook exits non-zero but cancel is false in output', async () => {
    const hooks: HookEntry[] = [
      {
        event: 'beforeToolCall',
        tool: 'Bash',
        command: 'echo \'{"cancel":false}\' && exit 1',
      },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {}, { tool: 'Bash' })
    expect(result.cancel).toBe(false)
  })

  it('does NOT cancel when hook exits non-zero with non-JSON stdout', async () => {
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo "oops" && exit 1' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {})
    expect(result.cancel).toBe(false)
  })

  it('filters by tool name — does not run if tool does not match', async () => {
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', tool: 'Read', command: 'echo \'{"cancel":true}\' && exit 1' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {}, { tool: 'Bash' })
    expect(result.cancel).toBe(false)
  })

  it('runs hook without tool filter for any tool', async () => {
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true}\' && exit 1' },
    ]
    // No tool filter on the hook entry → fires for any tool
    const result = await runHooks(hooks, 'beforeToolCall', {}, { tool: 'Bash' })
    expect(result.cancel).toBe(true)
  })

  it('swallows failed hook (non-zero, no cancel JSON) and continues — returns cancel=false', async () => {
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: 'exit 2' },
    ]
    const result = await runHooks(hooks, 'afterTurn', {})
    expect(result.cancel).toBe(false)
  })

  it('stops at first cancel=true from multiple hooks', async () => {
    const hooks: HookEntry[] = [
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"first"}\' && exit 1' },
      { event: 'beforeToolCall', command: 'echo \'{"cancel":true,"reason":"second"}\' && exit 1' },
    ]
    const result = await runHooks(hooks, 'beforeToolCall', {})
    expect(result.cancel).toBe(true)
    expect(result.reason).toBe('first')
  })

  it('handles spawn failure (bad command) gracefully — returns cancel=false', async () => {
    // An absolute path that does not exist causes ENOENT in 'sh -c' → sh itself exits non-zero
    // but with no JSON output, so cancel stays false
    const hooks: HookEntry[] = [
      { event: 'afterTurn', command: '/nonexistent-binary-xyz-12345' },
    ]
    const result = await runHooks(hooks, 'afterTurn', {})
    expect(result.cancel).toBe(false)
  })
})
