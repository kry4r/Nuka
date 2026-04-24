import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { ElicitationDialog } from '../../src/tui/dialogs/ElicitationDialog'

describe('ElicitationDialog (form mode)', () => {
  it('renders the message and field labels', () => {
    const { lastFrame } = render(
      <ElicitationDialog
        payload={{
          mode: 'form',
          message: 'Please supply your name',
          requestedSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Your Name' },
            },
          },
        }}
        onResolve={() => {}}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('MCP elicitation')
    expect(f).toContain('Please supply your name')
    expect(f).toContain('Your Name')
  })

  it('typing then pressing enter resolves with accept + content', () => {
    const onResolve = vi.fn()
    const { stdin } = render(
      <ElicitationDialog
        payload={{
          mode: 'form',
          message: 'name?',
          requestedSchema: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
        }}
        onResolve={onResolve}
      />,
    )
    stdin.write('abc')
    stdin.write('\r')
    expect(onResolve).toHaveBeenCalledWith({ action: 'accept', content: { name: 'abc' } })
  })

  it('escape cancels', async () => {
    const onResolve = vi.fn()
    const { stdin } = render(
      <ElicitationDialog
        payload={{
          mode: 'form',
          message: 'm',
          requestedSchema: { type: 'object', properties: {} },
        }}
        onResolve={onResolve}
      />,
    )
    stdin.write('\u001B') // ESC
    // ink debounces escape a few ms to disambiguate from CSI sequences.
    await new Promise(r => setTimeout(r, 100))
    expect(onResolve).toHaveBeenCalledWith({ action: 'cancel' })
  })

  it('ctrl-d declines', () => {
    const onResolve = vi.fn()
    const { stdin } = render(
      <ElicitationDialog
        payload={{
          mode: 'form',
          message: 'm',
          requestedSchema: { type: 'object', properties: {} },
        }}
        onResolve={onResolve}
      />,
    )
    stdin.write('\u0004') // Ctrl-D
    expect(onResolve).toHaveBeenCalledWith({ action: 'decline' })
  })
})

describe('ElicitationDialog (url mode)', () => {
  it('renders the URL and accepts on enter with empty content', () => {
    const onResolve = vi.fn()
    const { lastFrame, stdin } = render(
      <ElicitationDialog
        payload={{
          mode: 'url',
          message: 'sign in',
          url: 'https://auth.example.com/',
          requestedSchema: {},
        }}
        onResolve={onResolve}
      />,
    )
    const f = lastFrame() ?? ''
    expect(f).toContain('https://auth.example.com/')
    stdin.write('\r')
    expect(onResolve).toHaveBeenCalledWith({ action: 'accept', content: {} })
  })
})
