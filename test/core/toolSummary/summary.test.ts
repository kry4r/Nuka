// test/core/toolSummary/summary.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildToolCallRow,
  classifyToolForCollapse,
  normalizeToolName,
  summarizeToolInput,
} from '../../../src/core/toolSummary/summary'

describe('normalizeToolName', () => {
  it('lowercases simple snake_case names', () => {
    expect(normalizeToolName('read_file')).toBe('read_file')
    expect(normalizeToolName('SEARCH_CODE')).toBe('search_code')
  })

  it('splits camelCase boundaries into snake_case', () => {
    expect(normalizeToolName('searchJiraIssuesUsingJql')).toBe(
      'search_jira_issues_using_jql',
    )
    expect(normalizeToolName('getMe')).toBe('get_me')
  })

  it('converts kebab-case dashes to underscores', () => {
    expect(normalizeToolName('git-status')).toBe('git_status')
    expect(normalizeToolName('search-code')).toBe('search_code')
  })

  it('handles mixed kebab + camel cases', () => {
    expect(normalizeToolName('asana-searchTasks')).toBe('asana_search_tasks')
  })

  it('passes through unknown names unchanged (apart from case)', () => {
    expect(normalizeToolName('my_custom_tool')).toBe('my_custom_tool')
  })
})

describe('summarizeToolInput', () => {
  it('returns null for undefined / null input', () => {
    expect(summarizeToolInput(undefined)).toBeNull()
    expect(summarizeToolInput(null)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(summarizeToolInput({})).toBeNull()
  })

  it('prefers `command` for shell-style tools', () => {
    expect(
      summarizeToolInput({ command: 'ls -la', cwd: '/tmp' }),
    ).toBe('ls -la')
  })

  it('prefers `prompt` over `query`', () => {
    expect(
      summarizeToolInput({ prompt: 'do thing', query: 'foo' }),
    ).toBe('do thing')
  })

  it('falls back to `query` for search tools', () => {
    expect(summarizeToolInput({ query: 'foo bar' })).toBe('foo bar')
  })

  it('uses `url` for browser / fetch tools', () => {
    expect(
      summarizeToolInput({ url: 'https://example.com/a' }),
    ).toBe('https://example.com/a')
  })

  it('uses `path` for Grep / Glob tools', () => {
    expect(summarizeToolInput({ path: 'src/' })).toBe('src/')
  })

  it('uses `file_path` for Read / Write / Edit tools', () => {
    expect(
      summarizeToolInput({ file_path: '/abs/foo.ts' }),
    ).toBe('/abs/foo.ts')
  })

  it('prefers earlier-priority field when both present', () => {
    // command beats query beats file_path
    expect(
      summarizeToolInput({
        command: 'rg foo',
        query: 'foo',
        file_path: '/a.ts',
      }),
    ).toBe('rg foo')
  })

  it('trims whitespace from the chosen value', () => {
    expect(summarizeToolInput({ query: '  spaced  ' })).toBe('spaced')
  })

  it('skips empty-string fields and continues probing', () => {
    expect(
      summarizeToolInput({ command: '   ', query: 'real' }),
    ).toBe('real')
  })

  it('skips non-string values', () => {
    expect(
      summarizeToolInput({
        command: 42,
        prompt: ['nope'],
        query: 'fallback',
      }),
    ).toBe('fallback')
  })

  it('falls back to JSON when no known field matches', () => {
    expect(summarizeToolInput({ weird_key: 'value', n: 1 })).toBe(
      JSON.stringify({ weird_key: 'value', n: 1 }),
    )
  })

  it('falls back to JSON for empty-string-only-fields with extra data', () => {
    expect(
      summarizeToolInput({ unrecognized: 'x' }),
    ).toBe(JSON.stringify({ unrecognized: 'x' }))
  })

  it('handles trigger_file_path / parent_file_path / transcript_path', () => {
    expect(
      summarizeToolInput({ trigger_file_path: '/tmp/trig' }),
    ).toBe('/tmp/trig')
    expect(
      summarizeToolInput({ parent_file_path: '/tmp/parent' }),
    ).toBe('/tmp/parent')
    expect(
      summarizeToolInput({ transcript_path: '/tmp/log' }),
    ).toBe('/tmp/log')
  })

  it('returns null when JSON.stringify produces only {}', () => {
    // Object whose own keys are all undefined => stringify drops them.
    const input = { a: undefined, b: undefined } as Record<string, unknown>
    expect(summarizeToolInput(input)).toBeNull()
  })

  it('returns null when serialization throws (cyclic input)', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(summarizeToolInput(cyclic)).toBeNull()
  })

  it('does not truncate long values (caller responsibility)', () => {
    const long = 'x'.repeat(500)
    expect(summarizeToolInput({ command: long })).toBe(long)
  })
})

describe('classifyToolForCollapse', () => {
  it('classifies known search tools as search', () => {
    expect(classifyToolForCollapse('search_code')).toEqual({
      isSearch: true,
      isRead: false,
    })
    expect(classifyToolForCollapse('brave_web_search')).toEqual({
      isSearch: true,
      isRead: false,
    })
    expect(classifyToolForCollapse('slack_search_public')).toEqual({
      isSearch: true,
      isRead: false,
    })
  })

  it('classifies known read tools as read', () => {
    expect(classifyToolForCollapse('read_file')).toEqual({
      isSearch: false,
      isRead: true,
    })
    expect(classifyToolForCollapse('get_pull_request')).toEqual({
      isSearch: false,
      isRead: true,
    })
    expect(classifyToolForCollapse('git_log')).toEqual({
      isSearch: false,
      isRead: true,
    })
  })

  it('returns neither for unknown tools', () => {
    expect(classifyToolForCollapse('some_random_tool')).toEqual({
      isSearch: false,
      isRead: false,
    })
    expect(classifyToolForCollapse('send_message')).toEqual({
      isSearch: false,
      isRead: false,
    })
  })

  it('returns neither for write/create/update verbs by default', () => {
    expect(classifyToolForCollapse('create_issue')).toEqual({
      isSearch: false,
      isRead: false,
    })
    expect(classifyToolForCollapse('update_pull_request')).toEqual({
      isSearch: false,
      isRead: false,
    })
    expect(classifyToolForCollapse('delete_branch')).toEqual({
      isSearch: false,
      isRead: false,
    })
  })

  it('normalizes camelCase names before lookup', () => {
    expect(classifyToolForCollapse('searchCode')).toEqual({
      isSearch: true,
      isRead: false,
    })
    expect(classifyToolForCollapse('readFile')).toEqual({
      isSearch: false,
      isRead: true,
    })
  })

  it('normalizes kebab-case names before lookup', () => {
    expect(classifyToolForCollapse('git-log')).toEqual({
      isSearch: false,
      isRead: true,
    })
    expect(classifyToolForCollapse('search-code')).toEqual({
      isSearch: true,
      isRead: false,
    })
  })

  it('search wins over read when a name happens to be in both lists', () => {
    // `search_documentation` appears in upstream's SEARCH_TOOLS; we
    // also see read-style "get_*" docs handlers in READ_TOOLS. The
    // disjoint guarantee in the implementation means a search hit
    // suppresses a read hit.
    const result = classifyToolForCollapse('search_documentation')
    expect(result.isSearch).toBe(true)
    expect(result.isRead).toBe(false)
  })

  it('uses raw, normalized name only (does not inspect server name)', () => {
    // The same tool name across two MCP servers ("slack" vs
    // "claude_ai_Slack") must collapse identically.
    const a = classifyToolForCollapse('slack_search_public')
    const b = classifyToolForCollapse('slack_search_public')
    expect(a).toEqual(b)
  })
})

describe('buildToolCallRow', () => {
  it('joins summarize + classify for search tools', () => {
    expect(
      buildToolCallRow('search_code', { query: 'foo' }),
    ).toEqual({
      toolName: 'search_code',
      summary: 'foo',
      isSearch: true,
      isRead: false,
      isCollapsible: true,
    })
  })

  it('joins summarize + classify for read tools', () => {
    expect(
      buildToolCallRow('read_file', { file_path: '/a.ts' }),
    ).toEqual({
      toolName: 'read_file',
      summary: '/a.ts',
      isSearch: false,
      isRead: true,
      isCollapsible: true,
    })
  })

  it('marks unknown tools as non-collapsible but still summarizes', () => {
    expect(
      buildToolCallRow('post_message', { command: 'send foo' }),
    ).toEqual({
      toolName: 'post_message',
      summary: 'send foo',
      isSearch: false,
      isRead: false,
      isCollapsible: false,
    })
  })

  it('returns null summary when input is empty', () => {
    expect(buildToolCallRow('read_file', undefined)).toEqual({
      toolName: 'read_file',
      summary: null,
      isSearch: false,
      isRead: true,
      isCollapsible: true,
    })
  })

  it('respects camelCase tool name normalization', () => {
    const row = buildToolCallRow('readFile', { file_path: '/x' })
    expect(row.isRead).toBe(true)
    expect(row.isCollapsible).toBe(true)
  })

  it('keeps row deterministic across repeated calls', () => {
    const input = { query: 'q', path: '/p' }
    const a = buildToolCallRow('search_code', input)
    const b = buildToolCallRow('search_code', input)
    expect(a).toEqual(b)
  })
})
