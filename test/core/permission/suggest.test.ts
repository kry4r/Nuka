// test/core/permission/suggest.test.ts
import { describe, it, expect } from 'vitest'
import { suggestPattern } from '../../../src/core/permission/suggest'

describe('suggestPattern', () => {
  it('suggests a prefix glob from a file path for write hint', () => {
    expect(
      suggestPattern({
        toolName: 'Write',
        hint: 'write',
        input: { path: 'src/provider/openai.ts', content: '' },
      }),
    ).toBe('src/provider/**')
  })

  it('suggests a command-head glob for exec hint', () => {
    expect(
      suggestPattern({
        toolName: 'Bash',
        hint: 'exec',
        input: { command: 'npm test -- --coverage' },
      }),
    ).toBe('npm *')
  })

  it('returns undefined when nothing natural suggests', () => {
    expect(
      suggestPattern({ toolName: 'Grep', hint: 'none', input: {} }),
    ).toBeUndefined()
  })
})
