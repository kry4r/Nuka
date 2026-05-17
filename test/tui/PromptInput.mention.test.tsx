// test/tui/PromptInput.mention.test.tsx
//
// Iter 3b integration test — verifies the promptMentions hook + palette is
// wired into PromptInput's `@` keypath:
//
//   1. typing `@` opens the palette overlay (types pane shown)
//   2. typing `@<query>` opens the palette in results focus and
//      shows file matches from the cwd via fuzzyFileSearch
//   3. accepting a file option:
//        - inserts the @{path} placeholder into the controlled value
//        - notifies onAttachFile so App.tsx's submit-time inlining keeps working
//   4. Escape dismisses the palette without clearing the typed text
//
// We use a temp-dir cwd seeded with a handful of plain files so
// fuzzyFileSearch returns a deterministic small set without touching the
// real repo tree (which would walk node_modules / dist / .git).

import React, { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'ink-testing-library'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PromptInput } from '../../src/tui/PromptInput/PromptInput'

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0))
const settle = async (steps = 6): Promise<void> => {
  for (let i = 0; i < steps; i++) {
    await flush()
  }
}

async function makeFixtureCwd(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'prompt-mention-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(path.join(root, 'src', 'alpha.ts'), 'export {}\n')
  await writeFile(path.join(root, 'src', 'beta.ts'), 'export {}\n')
  await writeFile(path.join(root, 'README.md'), '# tmp\n')
  return root
}

function Controlled(props: {
  initial?: string
  cwd: string
  onSubmit?: (s: string) => void
  onAttachFile?: (p: string) => void
  onAttachReference?: (
    t: import('../../src/promptContextReferences/types').PromptReferenceToken,
  ) => void
}): React.JSX.Element {
  const [v, setV] = useState(props.initial ?? '')
  return (
    <PromptInput
      value={v}
      onChange={setV}
      onSubmit={s => props.onSubmit?.(s)}
      disabled={false}
      cwd={props.cwd}
      onAttachFile={props.onAttachFile}
      onAttachReference={props.onAttachReference}
    />
  )
}

describe('PromptInput @-mention palette integration', () => {
  it('typing "@" opens the palette with the types pane', async () => {
    const cwd = await makeFixtureCwd()
    const { stdin, lastFrame } = render(<Controlled cwd={cwd} />)
    await settle()
    stdin.write('@')
    await settle()
    // The types pane lists the canonical PROMPT_MENTION_TYPES — we check
    // a couple of visible labels to confirm the palette mounted.
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/file/)
    expect(frame).toMatch(/folder/)
    expect(frame).toMatch(/diff/)
  })

  it('typing "@alph" opens the palette and surfaces matching files', async () => {
    const cwd = await makeFixtureCwd()
    const { stdin, lastFrame } = render(<Controlled cwd={cwd} />)
    await settle()
    stdin.write('@')
    await settle()
    // 'alph' is a unique-enough substring that fuzzyFileSearch ranks
    // alpha.ts at index 0 even though README.md / beta.ts both contain
    // some of the letters.
    stdin.write('alph')
    // 8 settle steps: hook chain is trigger → activeType/focus → loader →
    // options. fuzzyFileSearch is a real fs walk so we need a generous
    // budget.
    await settle(8)
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/alpha\.ts/)
  })

  it('Enter on a file option inserts @{path} into value and pushes to onAttachFile', async () => {
    const cwd = await makeFixtureCwd()
    const onAttach = vi.fn()
    const { stdin, lastFrame } = render(
      <Controlled cwd={cwd} onAttachFile={onAttach} />,
    )
    await settle()
    stdin.write('@')
    await settle()
    stdin.write('alph')
    await settle(8)
    // Sanity check — the palette should now have ranked alpha.ts at index 0.
    expect(lastFrame() ?? '').toMatch(/alpha\.ts/)
    // Accept the selection.
    stdin.write('\r')
    await settle(6)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('@src/alpha.ts')
    expect(onAttach).toHaveBeenCalled()
    // The path that gets attached should be a relative path under the cwd.
    const attached = onAttach.mock.calls[0]?.[0] as string | undefined
    expect(attached).toMatch(/alpha\.ts$/)
  })

  it('Enter on @diff routes through onAttachReference (not onAttachFile)', async () => {
    const cwd = await makeFixtureCwd()
    const onAttachFile = vi.fn()
    const onAttachReference = vi.fn()
    const { stdin, lastFrame } = render(
      <Controlled
        cwd={cwd}
        onAttachFile={onAttachFile}
        onAttachReference={onAttachReference}
      />,
    )
    await settle()
    // `@diff` is an explicit-trigger mention — the hook switches the
    // active type to `diff` and surfaces a single "Current diff" option.
    stdin.write('@diff')
    await settle(8)
    expect(lastFrame() ?? '').toMatch(/Current diff/)
    stdin.write('\r')
    await settle(6)
    expect(onAttachFile).not.toHaveBeenCalled()
    expect(onAttachReference).toHaveBeenCalledTimes(1)
    const token = onAttachReference.mock.calls[0]?.[0]
    expect(token).toBeDefined()
    expect(token.kind).toBe('diff')
    expect(token.target.kind).toBe('diff')
    // The placeholder text replaces the @diff trigger in the controlled
    // value so the user sees the chip rendered inline.
    expect(lastFrame() ?? '').toContain('@diff')
  })

  it('Escape closes the palette without clearing typed text', async () => {
    const cwd = await makeFixtureCwd()
    const { stdin, lastFrame } = render(<Controlled cwd={cwd} />)
    await settle()
    stdin.write('@')
    await settle()
    stdin.write('a')
    await settle(8)
    // Palette is visible.
    expect(lastFrame() ?? '').toMatch(/file/)
    stdin.write('\u001b') // Esc
    await settle()
    // Palette gone, value still has "@a".
    expect(lastFrame() ?? '').toContain('@a')
  })
})
