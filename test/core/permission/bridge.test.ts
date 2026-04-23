// test/core/permission/bridge.test.ts
import { describe, it, expect, vi } from 'vitest'
import { PermissionBridge } from '../../../src/core/permission/bridge'
import type { PermissionPayload } from '../../../src/core/permission/bridge'

const payload: PermissionPayload = {
  call: { toolName: 'Bash', hint: 'shell', input: { command: 'ls' } },
  suggestedPattern: 'ls',
}

describe('PermissionBridge', () => {
  it('denies when no handler is set', async () => {
    const bridge = new PermissionBridge()
    const d = await bridge.ask(payload)
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('no permission UI attached')
  })

  it('delegates to the set handler and resolves with the handler decision', async () => {
    const bridge = new PermissionBridge()
    bridge.setHandler((_payload, resolve) => {
      resolve({ allowed: true })
    })
    const d = await bridge.ask(payload)
    expect(d.allowed).toBe(true)
  })

  it('setHandler(null) clears the handler so subsequent asks are denied', async () => {
    const bridge = new PermissionBridge()
    const handler = vi.fn((_p: PermissionPayload, resolve: (d: any) => void) => {
      resolve({ allowed: true })
    })
    bridge.setHandler(handler)
    bridge.setHandler(null)
    const d = await bridge.ask(payload)
    expect(handler).not.toHaveBeenCalled()
    expect(d.allowed).toBe(false)
  })
})
