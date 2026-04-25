// test/tui/Status/useUsage.test.tsx
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { useUsage } from '../../../src/tui/Status/useUsage'

function Probe(props: { source: () => any }) {
  const snap = useUsage(props.source)
  return <Text>{`in=${snap.inputTokens} out=${snap.outputTokens}`}</Text>
}

describe('useUsage', () => {
  it('renders the initial snapshot synchronously', () => {
    const source = () => ({
      inputTokens: 100,
      outputTokens: 50,
      contextUsed: 0,
      contextMax: 200000,
      costUsd: undefined,
    })
    const { lastFrame } = render(<Probe source={source} />)
    expect(lastFrame() ?? '').toContain('in=100 out=50')
  })

  it('coalesces rapid updates (debounce smoke test)', () => {
    let i = 0
    const source = vi.fn(() => {
      i++
      return {
        inputTokens: i,
        outputTokens: 0,
        contextUsed: 0,
        contextMax: 200000,
        costUsd: undefined,
      }
    })
    render(<Probe source={source} />)
    // The source is called eagerly once on mount and once during effect setup.
    // In tight render loops the hook avoids exceeding 60Hz; we just assert
    // no runaway calls happened on mount.
    expect(source.mock.calls.length).toBeLessThan(10)
  })
})
