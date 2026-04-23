// test/tui/permissionDialog.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { PermissionDialog } from '../../src/tui/dialogs/PermissionDialog'

describe('PermissionDialog', () => {
  it('renders tool call details and 4 options', () => {
    const { lastFrame } = render(
      <PermissionDialog
        call={{ toolName: 'Write', hint: 'write', input: { path: 'src/a.ts', content: 'x' } }}
        suggestedPattern="src/**"
        onDecide={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('Write')
    expect(f).toContain('src/a.ts')
    expect(f).toContain('Yes, once')
    expect(f).toContain('this session')
    expect(f).toContain('src/**')
  })

  it('pressing 1 then enter fires onDecide with once', () => {
    const onDecide = vi.fn()
    const { stdin } = render(
      <PermissionDialog
        call={{ toolName: 'Bash', hint: 'exec', input: { command: 'echo hi' } }}
        suggestedPattern="echo *"
        onDecide={onDecide}
      />,
    )
    stdin.write('\r') // default first option = once
    expect(onDecide).toHaveBeenCalled()
    const arg = onDecide.mock.calls[0][0]
    expect(arg.allowed).toBe(true)
    expect(arg.remember).toBeUndefined()
  })
})
