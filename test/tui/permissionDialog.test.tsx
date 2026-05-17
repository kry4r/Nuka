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

  it('renders read-only badge when annotationBadges includes read-only', () => {
    const { lastFrame } = render(
      <PermissionDialog
        call={{ toolName: 'ReadFile', hint: 'write', input: {} }}
        annotationBadges={['read-only']}
        onDecide={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('read-only')
  })

  it('renders destructive warning banner when annotationBadges includes destructive', () => {
    const { lastFrame } = render(
      <PermissionDialog
        call={{ toolName: 'Delete', hint: 'write', input: {} }}
        annotationBadges={['destructive']}
        onDecide={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('WARNING')
    expect(f).toContain('destructive')
  })

  it('defaults cursor to Deny (last option) when destructive', () => {
    const onDecide = vi.fn()
    const { stdin } = render(
      <PermissionDialog
        call={{ toolName: 'Delete', hint: 'write', input: {} }}
        annotationBadges={['destructive']}
        onDecide={onDecide}
      />,
    )
    stdin.write('\r') // pressing enter with default cursor
    expect(onDecide).toHaveBeenCalled()
    const arg = onDecide.mock.calls[0][0]
    // Default cursor should be on No/Deny
    expect(arg.allowed).toBe(false)
  })

  it('defaults cursor to Allow (first option) when readOnly and not destructive', () => {
    const onDecide = vi.fn()
    const { stdin } = render(
      <PermissionDialog
        call={{ toolName: 'ReadFile', hint: 'write', input: {} }}
        annotationBadges={['read-only']}
        onDecide={onDecide}
      />,
    )
    stdin.write('\r') // pressing enter with default cursor
    expect(onDecide).toHaveBeenCalled()
    const arg = onDecide.mock.calls[0][0]
    expect(arg.allowed).toBe(true)
    expect(arg.remember).toBeUndefined()
  })

  it('renders network badge', () => {
    const { lastFrame } = render(
      <PermissionDialog
        call={{ toolName: 'Fetch', hint: 'network', input: {} }}
        annotationBadges={['network']}
        onDecide={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('network')
  })

  // ── P1 #8 — planMode variant ──────────────────────────────────────────
  describe('variant=planMode', () => {
    it('renders the [PLAN MODE] badge, bespoke title and subtitle', () => {
      const { lastFrame } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          variant="planMode"
          onDecide={() => {}}
        />,
      )
      const f = lastFrame() ?? ''
      expect(f).toContain('[PLAN MODE]')
      expect(f).toContain('Enter Plan Mode')
      // subtitle explains the consequence
      expect(f).toMatch(/Read-only/i)
      expect(f).toMatch(/writes/i)
    })

    it('shows the Yes / Cancel options (no session-scope remember)', () => {
      const { lastFrame } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          variant="planMode"
          onDecide={() => {}}
        />,
      )
      const f = lastFrame() ?? ''
      expect(f).toContain('Yes, enter Plan Mode')
      expect(f).toContain('Cancel')
      // The default per-hint "always for ask in this session" option must
      // not appear in plan-mode variant — it would silently auto-flip
      // future EnterPlanMode requests, which is surprising.
      expect(f).not.toMatch(/always for ask/i)
    })

    it('does not render generic toolName · hint header in planMode', () => {
      const { lastFrame } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          variant="planMode"
          onDecide={() => {}}
        />,
      )
      const f = lastFrame() ?? ''
      // The generic dialog header is `EnterPlanMode · ask`; planMode swaps
      // it for `[PLAN MODE] Enter Plan Mode?`.
      expect(f).not.toContain('EnterPlanMode · ask')
    })

    it('pressing enter on default cursor accepts (allowed=true, no remember)', () => {
      const onDecide = vi.fn()
      const { stdin } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          variant="planMode"
          onDecide={onDecide}
        />,
      )
      stdin.write('\r')
      expect(onDecide).toHaveBeenCalledOnce()
      const arg = onDecide.mock.calls[0][0]
      expect(arg.allowed).toBe(true)
      expect(arg.remember).toBeUndefined()
    })

    it('pressing 2 then enter cancels', () => {
      const onDecide = vi.fn()
      const { stdin } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          variant="planMode"
          onDecide={onDecide}
        />,
      )
      stdin.write('2')
      expect(onDecide).toHaveBeenCalledOnce()
      const arg = onDecide.mock.calls[0][0]
      expect(arg.allowed).toBe(false)
    })

    it('default variant unchanged when variant is undefined', () => {
      const { lastFrame } = render(
        <PermissionDialog
          call={{ toolName: 'EnterPlanMode', hint: 'ask', input: {} }}
          onDecide={() => {}}
        />,
      )
      const f = lastFrame() ?? ''
      // Without the variant hint, the dialog falls back to the generic
      // per-tool look.
      expect(f).not.toContain('[PLAN MODE]')
      expect(f).toContain('EnterPlanMode')
      expect(f).toContain('Yes, once')
    })
  })
})
