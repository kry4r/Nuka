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

  it('appends always-on skills under a Skills section', () => {
    const s = buildSystemPrompt({
      cwd: '/proj',
      platform: 'linux',
      shell: '/bin/bash',
      nodeVersion: 'v20.0.0',
      gitBranch: null,
      skills: [
        { name: 'tdd-discipline', when: 'on-session-start', body: 'Write tests first.', source: 'global', path: '/x.md' },
        { name: 'deploy-guide', when: { keyword: ['deploy'] }, body: 'Run smoke tests.', source: 'global', path: '/y.md' },
      ],
    })
    expect(s).toContain('Skills:')
    expect(s).toContain('# tdd-discipline')
    expect(s).toContain('Write tests first.')
    expect(s).not.toContain('# deploy-guide')
  })
})
