// test/core/plugin/outputStyles.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  matchStyle,
  globMatch,
  registerOutputStyle,
  getRegistry,
  clearRegistry,
  type OutputStyleDef,
} from '../../../src/core/plugin/outputStyles'

describe('globMatch', () => {
  it('matches exact strings', () => {
    expect(globMatch('Read', 'Read')).toBe(true)
    expect(globMatch('Read', 'Write')).toBe(false)
  })

  it('matches wildcard prefix glob', () => {
    expect(globMatch('plugin__github__*', 'plugin__github__listRepos')).toBe(true)
    expect(globMatch('plugin__github__*', 'plugin__github__createPR')).toBe(true)
    expect(globMatch('plugin__github__*', 'Read')).toBe(false)
  })

  it('wildcard does not cross tool-name boundaries unexpectedly', () => {
    expect(globMatch('plugin__github__*', 'plugin__gitlab__listRepos')).toBe(false)
  })

  it('full wildcard matches anything', () => {
    expect(globMatch('*', 'anything')).toBe(true)
  })

  it('escapes regex special characters in pattern', () => {
    expect(globMatch('tool.name', 'toolXname')).toBe(false)
    expect(globMatch('tool.name', 'tool.name')).toBe(true)
  })
})

describe('matchStyle', () => {
  const defs: OutputStyleDef[] = [
    {
      name: 'github-style',
      matchToolName: 'plugin__github__*',
      componentPath: '/fake/github-style.js',
    },
    {
      name: 'plugin-style',
      matchToolSource: 'plugin',
      componentPath: '/fake/plugin-style.js',
    },
    {
      name: 'read-style',
      matchToolName: 'Read',
      matchToolSource: 'builtin',
      componentPath: '/fake/read-style.js',
    },
  ]

  it('matches glob tool name — acceptance criterion 1', () => {
    const result = matchStyle('plugin__github__listRepos', 'plugin', defs)
    expect(result).toBeDefined()
    expect(result!.name).toBe('github-style')
  })

  it('does not match non-matching name — acceptance criterion 1', () => {
    const result = matchStyle('Read', 'builtin', defs)
    // github-style wont match, plugin-style source=builtin wont match, read-style will match
    expect(result).toBeDefined()
    expect(result!.name).toBe('read-style')
  })

  it('returns first matching def (registration order)', () => {
    const twoStyleDefs: OutputStyleDef[] = [
      { name: 'first', matchToolName: '*', componentPath: '/a.js' },
      { name: 'second', matchToolName: '*', componentPath: '/b.js' },
    ]
    const result = matchStyle('anything', 'builtin', twoStyleDefs)
    expect(result!.name).toBe('first')
  })

  it('matches by source only when matchToolName is absent', () => {
    const result = matchStyle('plugin__my__tool', 'plugin', defs)
    expect(result).toBeDefined()
    expect(result!.name).toBe('plugin-style')
  })

  it('returns undefined when no def matches', () => {
    const result = matchStyle('Unknown', 'builtin', [
      { name: 's', matchToolName: 'plugin__*', componentPath: '/x.js' },
    ])
    expect(result).toBeUndefined()
  })

  it('both matchToolName and matchToolSource must match', () => {
    // 'Read' name + 'skill' source: github-style won't match (wrong name),
    // plugin-style won't match (wrong source), read-style won't match
    // (wrong source).
    const result = matchStyle('Read', 'skill', defs)
    expect(result).toBeUndefined()
  })
})

describe('registry', () => {
  beforeEach(() => {
    clearRegistry()
  })

  it('starts empty after clear', () => {
    expect(getRegistry()).toHaveLength(0)
  })

  it('registers styles and retrieves them in order', () => {
    registerOutputStyle({ name: 'a', componentPath: '/a.js' })
    registerOutputStyle({ name: 'b', componentPath: '/b.js' })
    const reg = getRegistry()
    expect(reg).toHaveLength(2)
    expect(reg[0]!.name).toBe('a')
    expect(reg[1]!.name).toBe('b')
  })
})
