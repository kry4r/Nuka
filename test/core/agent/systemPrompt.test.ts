import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'

describe('buildSystemPrompt', () => {
  it('includes identity, cwd, and tool guidance sections', () => {
    const s = buildSystemPrompt({
      cwd: '/tmp/proj',
      platform: 'linux',
      shell: '/bin/bash',
      nodeVersion: 'v20.10.0',
      gitBranch: { branch: 'main', dirty: false },
    })
    expect(s).toMatch(/You are Nuka/i)
    expect(s).toContain('/tmp/proj')
    expect(s).toContain('linux')
    expect(s).toMatch(/main/)
    expect(s).toMatch(/tool/i)
  })

  it('handles missing git branch gracefully', () => {
    const s = buildSystemPrompt({
      cwd: '/x',
      platform: 'darwin',
      shell: '/bin/zsh',
      nodeVersion: 'v18.0.0',
      gitBranch: null,
    })
    expect(s).not.toContain('null')
  })
})
