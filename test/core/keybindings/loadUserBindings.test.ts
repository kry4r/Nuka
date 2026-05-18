import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { readUserBindings } from '../../../src/core/keybindings/loadUserBindings'

function tmpHome(): string {
  return mkdtempSync(join(os.tmpdir(), 'nuka-keybindings-'))
}

describe('readUserBindings', () => {
  it('returns null when the file is absent (ENOENT)', async () => {
    const h = tmpHome()
    const blocks = await readUserBindings(h)
    expect(blocks).toBeNull()
  })

  it('parses a valid keybindings.yaml', async () => {
    const h = tmpHome()
    mkdirSync(join(h, '.nuka'))
    writeFileSync(
      join(h, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Chat\n    bindings:\n      enter: chat:submit\n',
    )
    const blocks = await readUserBindings(h)
    expect(blocks).not.toBeNull()
    expect(blocks?.[0]?.context).toBe('Chat')
    expect(blocks?.[0]?.bindings.enter).toBe('chat:submit')
  })

  it('throws on schema-invalid YAML (loud surface)', async () => {
    const h = tmpHome()
    mkdirSync(join(h, '.nuka'))
    writeFileSync(
      join(h, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Bogus\n    bindings: { enter: chat:submit }\n',
    )
    await expect(readUserBindings(h)).rejects.toThrow()
  })
})
