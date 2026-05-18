// test/tui/hooks/useAgentStream.image.test.tsx
//
// Verifies the `send` callback returned by `useAgentStream` forwards an
// optional `{ images }` option through to the wrapped `runAgent`. The
// existing text-only call signature must keep working unchanged.

import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'

import { useAgentStream, type AgentStreamDeps } from '../../../src/tui/hooks/useAgentStream'
import type { AgentEvent } from '../../../src/core/agent/events'
import type { ImageContentBlock } from '../../../src/core/message/types'

type Probe = {
  current: ((text: string, opts?: { images?: readonly ImageContentBlock[] }) => Promise<void>) | null
}

function makeProbe(deps: AgentStreamDeps): Probe {
  const probe: Probe = { current: null }
  function P(): React.JSX.Element {
    const { send } = useAgentStream(deps)
    probe.current = send
    return <></>
  }
  render(<P />)
  return probe
}

async function* drainEmpty(): AsyncIterable<AgentEvent> {
  // emit nothing; mirrors the cheapest possible runAgent return
  yield* []
}

describe('useAgentStream.send — image forwarding', () => {
  it('forwards images through to the wrapped runAgent', async () => {
    const seen: Array<{ text: string; images?: readonly ImageContentBlock[] }> = []
    const runAgent = vi.fn(
      (input: { text: string; images?: readonly ImageContentBlock[] }) => {
        seen.push({ text: input.text, images: input.images })
        return drainEmpty()
      },
    )
    const probe = makeProbe({ runAgent })
    await probe.current!('look', {
      images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      text: 'look',
      images: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAA=' }],
    })
  })

  it('keeps the text-only call shape working when no opts are passed', async () => {
    const seen: Array<{ text: string; images?: readonly ImageContentBlock[] }> = []
    const runAgent = vi.fn(
      (input: { text: string; images?: readonly ImageContentBlock[] }) => {
        seen.push({ text: input.text, images: input.images })
        return drainEmpty()
      },
    )
    const probe = makeProbe({ runAgent })
    await probe.current!('hi')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe('hi')
    expect(seen[0]?.images).toBeUndefined()
  })
})
