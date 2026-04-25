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

  // ── Phase 8 §4.4 — plan injection ──────────────────────────────────
  it('injects a ## Plan section when plan is active and body is non-empty', () => {
    const s = buildSystemPrompt({
      cwd: '/p',
      platform: 'linux',
      shell: '/bin/bash',
      nodeVersion: 'v20.0.0',
      gitBranch: null,
      plan: { active: true, body: 'step 1 — do the thing\nstep 2 — verify' },
    })
    expect(s).toMatch(/## Plan/)
    expect(s).toContain('step 1 — do the thing')
    expect(s).toContain('step 2 — verify')
  })

  it('omits ## Plan when plan mode is off', () => {
    const s = buildSystemPrompt({
      cwd: '/p', platform: 'linux', shell: '/bin/bash', nodeVersion: 'v20.0.0', gitBranch: null,
      plan: { active: false, body: 'something' },
    })
    expect(s).not.toContain('## Plan')
  })

  it('omits ## Plan when body is empty even if active', () => {
    const s = buildSystemPrompt({
      cwd: '/p', platform: 'linux', shell: '/bin/bash', nodeVersion: 'v20.0.0', gitBranch: null,
      plan: { active: true, body: '   \n\n' },
    })
    expect(s).not.toContain('## Plan')
  })
})
