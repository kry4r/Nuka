// test/tui/Submenu/settings/Field.test.tsx
import React from 'react'
import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import stripAnsi from 'strip-ansi'
import { Field } from '../../../../src/tui/Submenu/settings/Field'

describe('Field — text overflow discipline', () => {
  it('keeps a long URL value on a single row (truncate-end)', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const url =
        'https://very-long-api-endpoint.example.com/v1/some/long/path?with=query&params=many&extra=' +
        'a'.repeat(100)
      const { lastFrame } = render(
        <Field type="text" label="API URL" value={url} focused={false} />,
      )
      const f = stripAnsi(lastFrame() ?? '')
      // Strip a trailing newline that ink may emit, then count rows.
      const lines = f.replace(/\n$/, '').split('\n')
      // Expect: top border, single content row, bottom border = 3 rows total.
      expect(lines.length).toBe(3)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })

  it('shows the label on the single content row', () => {
    const { lastFrame } = render(
      <Field type="text" label="Endpoint" value="https://example.com/very/long/path" focused={false} />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    expect(f).toContain('Endpoint')
  })

  it('renders a 1-row content area for short text values too', () => {
    const { lastFrame } = render(
      <Field type="text" label="Name" value="Nuka" focused={false} />,
    )
    const f = stripAnsi(lastFrame() ?? '')
    const lines = f.replace(/\n$/, '').split('\n')
    expect(lines.length).toBe(3)
    expect(f).toContain('Nuka')
  })

  it('keeps list-type choice + description rows within column-aware width', () => {
    const orig = process.stdout.columns
    Object.defineProperty(process.stdout, 'columns', { value: 60, configurable: true })
    try {
      const huge = 'a'.repeat(5000)
      const url = 'https://example.com/' + 'x'.repeat(300)
      const choices = ['choice-A', 'choice-B', huge.slice(0, 200)]
      const descriptions = [huge, url, undefined]
      const { lastFrame } = render(
        <Field
          type="list"
          label="Many things"
          value={['choice-A']}
          choices={choices}
          descriptions={descriptions}
          focused={false}
        />,
      )
      const f = stripAnsi(lastFrame() ?? '')
      const maxLine = Math.max(...f.split('\n').map(s => s.length))
      expect(maxLine).toBeLessThanOrEqual(60)
    } finally {
      Object.defineProperty(process.stdout, 'columns', { value: orig, configurable: true })
    }
  })
})
