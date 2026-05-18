import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { buildResolver, readUserBindings } from '../../../src/core/keybindings'

const ORIG_HOME = process.env.HOME
const ORIG_KB = process.env.NUKA_KEYBINDINGS

beforeEach(() => { delete process.env.NUKA_KEYBINDINGS })
afterEach(() => {
  if (ORIG_HOME !== undefined) process.env.HOME = ORIG_HOME
  if (ORIG_KB !== undefined) process.env.NUKA_KEYBINDINGS = ORIG_KB
  else delete process.env.NUKA_KEYBINDINGS
})

function k() {
  return {
    ctrl: false, shift: false, meta: false, super: false,
    escape: false, return: false, tab: false, backspace: false, delete: false,
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageUp: false, pageDown: false, home: false, end: false,
  }
}

describe('keybindings integration — env-gated user overrides', () => {
  it('user override file replaces enter→chat:submit with enter→chat:newline', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-kb-int-'))
    mkdirSync(join(home, '.nuka'))
    writeFileSync(
      join(home, '.nuka', 'keybindings.yaml'),
      'bindings:\n  - context: Chat\n    bindings:\n      enter: chat:newline\n',
    )
    const user = await readUserBindings(home)
    const resolve = buildResolver(user)
    expect(resolve('', { ...k(), return: true }, 'Chat')).toBe('chat:newline')
  })

  it('absent file returns null user bindings → defaults apply', async () => {
    const home = mkdtempSync(join(os.tmpdir(), 'nuka-kb-int-'))
    const user = await readUserBindings(home)
    expect(user).toBeNull()
    const resolve = buildResolver(user)
    expect(resolve('', { ...k(), return: true }, 'Chat')).toBe('chat:submit')
  })
})
