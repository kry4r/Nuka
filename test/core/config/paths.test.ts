import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { globalConfigPath, projectConfigPath } from '../../../src/core/config/paths'

describe('config paths', () => {
  const origHome = os.homedir()
  beforeEach(() => { process.env.HOME = '/tmp/nuka-home' })
  afterEach(() => { process.env.HOME = origHome })

  it('globalConfigPath resolves under $HOME/.nuka/', () => {
    expect(globalConfigPath()).toBe(path.join('/tmp/nuka-home', '.nuka', 'config.yaml'))
  })

  it('projectConfigPath resolves under given cwd/.nuka/', () => {
    expect(projectConfigPath('/workspace/foo')).toBe(
      path.join('/workspace/foo', '.nuka', 'config.yaml'),
    )
  })
})
