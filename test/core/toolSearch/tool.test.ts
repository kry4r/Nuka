// test/core/toolSearch/tool.test.ts
import { describe, expect, it } from 'vitest'
import { defineTool } from '../../../src/core/tools/define'
import { ToolRegistry } from '../../../src/core/tools/registry'
import type { Tool } from '../../../src/core/tools/types'
import {
  makeToolSearchTool,
  parseSelectQuery,
  parseToolName,
  scoreTool,
  searchTools,
  TOOL_SEARCH_DEFAULT_MAX,
  TOOL_SEARCH_HARD_MAX,
  TOOL_SEARCH_TOOL_NAME,
  type ToolSearchMatch,
} from '../../../src/core/toolSearch/tool'

function mkCtx() {
  return { signal: new AbortController().signal, cwd: process.cwd() }
}

/**
 * Build a registry pre-loaded with a representative slice of tools so
 * we can score realistic queries. We use minimal but real `defineTool`
 * outputs — names, tags, descriptions, hints — to mirror Nuka's
 * registry shape.
 */
function mkRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  const tools: Tool[] = [
    defineTool({
      name: 'Read',
      description: 'Read a file from disk and return its contents as text.',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core', 'fs.read'],
      searchHint: ['read', 'file', 'cat'],
      needsPermission: () => 'none',
      async run() { return { isError: false, output: '' } },
    }),
    defineTool({
      name: 'WebFetch',
      description: 'Fetch a URL and return the rendered markdown content.',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core', 'net.read'],
      searchHint: ['fetch', 'web', 'url', 'http'],
      needsPermission: () => 'network',
      async run() { return { isError: false, output: '' } },
    }),
    defineTool({
      name: 'CronCreate',
      description: 'Schedule a prompt to fire on a 5-field cron expression.',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core', 'schedule'],
      searchHint: ['schedule', 'cron', 'remind'],
      needsPermission: () => 'none',
      async run() { return { isError: false, output: '' } },
    }),
    defineTool({
      name: 'Sleep',
      description: 'Wait for a specified duration. Used when nothing to do.',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core', 'sleep'],
      searchHint: ['sleep', 'wait', 'pause', 'delay'],
      aliases: ['sleep_seconds'],
      needsPermission: () => 'none',
      async run() { return { isError: false, output: '' } },
    }),
    defineTool({
      name: 'SlackSendMessage',
      description: 'Send a message to a Slack channel.',
      parameters: { type: 'object', properties: {} },
      source: 'plugin',
      tags: ['plugin'],
      needsPermission: () => 'network',
      async run() { return { isError: false, output: '' } },
    }),
    defineTool({
      name: 'SlackListChannels',
      description: 'List Slack channels in a workspace.',
      parameters: { type: 'object', properties: {} },
      source: 'plugin',
      tags: ['plugin'],
      needsPermission: () => 'network',
      async run() { return { isError: false, output: '' } },
    }),
  ]
  for (const t of tools) reg.register(t)
  return reg
}

describe('ToolSearch — parseToolName', () => {
  it('splits CamelCase names into lowercase parts', () => {
    const p = parseToolName('WebFetch')
    expect(p.parts).toEqual(['web', 'fetch'])
    expect(p.full).toBe('web fetch')
  })

  it('splits snake_case names', () => {
    const p = parseToolName('todo_write')
    expect(p.parts).toEqual(['todo', 'write'])
  })
})

describe('ToolSearch — parseSelectQuery', () => {
  it('returns null for a plain keyword query', () => {
    expect(parseSelectQuery('read file')).toBeNull()
  })

  it('parses a comma-separated select list', () => {
    expect(parseSelectQuery('select:Read,Edit,Grep')).toEqual([
      'Read',
      'Edit',
      'Grep',
    ])
  })

  it('trims whitespace and drops empties', () => {
    expect(parseSelectQuery('select: Read , , Edit')).toEqual(['Read', 'Edit'])
  })

  it('accepts case-insensitive prefix', () => {
    expect(parseSelectQuery('SELECT:Read')).toEqual(['Read'])
  })
})

describe('ToolSearch — scoreTool', () => {
  const reg = mkRegistry()

  it('returns 0 for empty query', () => {
    const tool = reg.find('Read')!
    expect(scoreTool(tool, '')).toBe(0)
  })

  it('scores an exact name-part match higher than a description hit', () => {
    const read = reg.find('Read')!
    const webFetch = reg.find('WebFetch')!
    const readScore = scoreTool(read, 'read')
    const webFetchScore = scoreTool(webFetch, 'read') // description-only via "rendered"
    expect(readScore).toBeGreaterThan(webFetchScore)
    expect(readScore).toBeGreaterThanOrEqual(10)
  })

  it('rewards exact tag matches', () => {
    const cron = reg.find('CronCreate')!
    // The tag "schedule" should bump the score
    const scheduleScore = scoreTool(cron, 'schedule')
    expect(scheduleScore).toBeGreaterThanOrEqual(10)
  })

  it('rewards alias exact matches', () => {
    const sleep = reg.find('Sleep')!
    expect(scoreTool(sleep, 'sleep_seconds')).toBeGreaterThanOrEqual(8)
  })
})

describe('ToolSearch — searchTools', () => {
  const reg = mkRegistry()

  it('returns an empty list for an empty query', () => {
    expect(searchTools(reg, '')).toEqual([])
  })

  it('returns an empty list when nothing matches', () => {
    expect(searchTools(reg, 'xyznomatch')).toEqual([])
  })

  it('exact-name fast path returns just one tool with high score', () => {
    const matches = searchTools(reg, 'Read')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.name).toBe('Read')
    expect(matches[0]!.score).toBe(100)
  })

  it('exact-alias fast path resolves to the primary name', () => {
    const matches = searchTools(reg, 'sleep_seconds')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.name).toBe('Sleep')
    expect(matches[0]!.score).toBe(100)
  })

  it('case-insensitive exact-name fast path works', () => {
    const matches = searchTools(reg, 'cronCreate')
    expect(matches).toHaveLength(1)
    expect(matches[0]!.name).toBe('CronCreate')
  })

  it('partial keyword match returns ranked candidates', () => {
    const matches = searchTools(reg, 'wait sleep')
    expect(matches.length).toBeGreaterThan(0)
    // Sleep has both "wait" and "sleep" in its hints/name — should be #1
    expect(matches[0]!.name).toBe('Sleep')
  })

  it('tag query surfaces tools sharing that tag', () => {
    const matches = searchTools(reg, 'schedule')
    expect(matches[0]!.name).toBe('CronCreate')
  })

  it('honours maxResults cap', () => {
    // Multi-term broad query should yield several matches
    const matches = searchTools(reg, 'read fetch', 2)
    expect(matches.length).toBeLessThanOrEqual(2)
  })

  it('orders by score descending, then alphabetically for ties', () => {
    const matches = searchTools(reg, 'channel slack', 10)
    // SlackListChannels description contains "channel"+"slack",
    // SlackSendMessage has only "slack" in its name parts.
    // SlackListChannels should beat SlackSendMessage.
    const top = matches.map(m => m.name)
    expect(top.indexOf('SlackListChannels')).toBeLessThan(
      top.indexOf('SlackSendMessage'),
    )
  })
})

describe('ToolSearch — tool surface', () => {
  it('exposes the expected name and tags', () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    expect(tool.name).toBe(TOOL_SEARCH_TOOL_NAME)
    expect(TOOL_SEARCH_TOOL_NAME).toBe('ToolSearch')
    expect(tool.tags).toContain('core')
    expect(tool.tags).toContain('tool-search')
    expect(tool.annotations?.readOnly).toBe(true)
    expect(tool.annotations?.parallelSafe).toBe(true)
    expect(tool.needsPermission({ query: 'x' })).toBe('none')
  })

  it('rejects a missing / empty query at runtime', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r1 = await tool.run({ query: '' }, mkCtx())
    expect(r1.isError).toBe(true)
    expect(r1.output).toContain('non-empty')

    const r2 = await tool.run(
      { query: '   ' as string },
      mkCtx(),
    )
    expect(r2.isError).toBe(true)
  })

  it('rejects a non-positive max_results', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run(
      { query: 'read', max_results: 0 },
      mkCtx(),
    )
    expect(r.isError).toBe(true)
    expect(r.output).toContain('positive number')
  })

  it('caps requested max_results at the hard cap', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    // Above hard cap — should not error, just clamp silently
    const r = await tool.run(
      { query: 'read', max_results: TOOL_SEARCH_HARD_MAX + 100 },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
  })

  it('uses default max when not provided', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'read' }, mkCtx())
    expect(r.isError).toBe(false)
    const lines = String(r.output).split('\n').filter(Boolean)
    expect(lines.length).toBeLessThanOrEqual(TOOL_SEARCH_DEFAULT_MAX)
  })

  it('keyword query formats output with name + score + description', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'sleep' }, mkCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('Sleep')
    expect(String(r.output)).toMatch(/score=\d+/)
  })

  it('no-match query returns a clean "no tools matched" string', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'frobnicate-xyz' }, mkCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('No tools matched')
  })

  it('select:Read returns the matching tool', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'select:Read' }, mkCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('Selected 1 tool')
    expect(String(r.output)).toContain('Read')
  })

  it('select:A,B,UnknownX reports missing names alongside found ones', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run(
      { query: 'select:Read,WebFetch,UnknownTool' },
      mkCtx(),
    )
    expect(r.isError).toBe(false)
    const out = String(r.output)
    expect(out).toContain('Selected 2 tool')
    expect(out).toContain('missing: UnknownTool')
    expect(out).toContain('Read')
    expect(out).toContain('WebFetch')
  })

  it('select with all-missing names reports zero found', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'select:NopeA,NopeB' }, mkCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('No tools found')
    expect(String(r.output)).toContain('NopeA, NopeB')
  })

  it('select can resolve a tool via its alias', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'select:sleep_seconds' }, mkCtx())
    expect(r.isError).toBe(false)
    // Alias resolves to primary name
    expect(String(r.output)).toContain('Sleep')
  })

  it('select dedupes when alias + primary name both listed', async () => {
    const reg = mkRegistry()
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'select:Sleep,sleep_seconds' }, mkCtx())
    expect(r.isError).toBe(false)
    // Should still be 1, not 2 (deduplicated)
    expect(String(r.output)).toContain('Selected 1 tool')
  })

  it('long description gets truncated in formatted output', async () => {
    const reg = new ToolRegistry()
    const longDesc = 'A'.repeat(500)
    reg.register(defineTool({
      name: 'BigTool',
      description: longDesc,
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      async run() { return { isError: false, output: '' } },
    }))
    const tool = makeToolSearchTool(reg)
    const r = await tool.run({ query: 'BigTool' }, mkCtx())
    expect(r.isError).toBe(false)
    expect(String(r.output)).toContain('...')
    // Truncated form is name + "(score=N): " + 200 chars
    expect(String(r.output).length).toBeLessThan(longDesc.length + 100)
  })
})

describe('ToolSearch — return type ergonomics', () => {
  it('ToolSearchMatch description is trimmed', () => {
    const reg = new ToolRegistry()
    reg.register(defineTool({
      name: 'Padded',
      description: '   trim me   ',
      parameters: { type: 'object', properties: {} },
      source: 'builtin',
      tags: ['core'],
      needsPermission: () => 'none',
      async run() { return { isError: false, output: '' } },
    }))
    const matches: ToolSearchMatch[] = searchTools(reg, 'Padded')
    expect(matches[0]!.description).toBe('trim me')
  })
})
