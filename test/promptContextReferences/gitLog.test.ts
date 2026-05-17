import { describe, expect, test } from 'vitest'

import { listRecentCommits } from '../../src/promptContextReferences/gitLog'

describe('listRecentCommits', () => {
  test('parses %h\\0%s\\0%ar\\0%an format with exact argv', async () => {
    const runGit = async (args: string[]) => {
      expect(args).toEqual([
        'log',
        '-30',
        'HEAD',
        '--format=%h%x00%s%x00%ar%x00%an',
      ])
      return {
        stdout:
          'a1b2c3d\x00feat: add foo\x002 hours ago\x00Alice\n' +
          'e4f5678\x00fix: bar\x00yesterday\x00Bob\n',
        code: 0,
      }
    }
    const commits = await listRecentCommits({ runGit })
    expect(commits).toEqual([
      {
        hash: 'a1b2c3d',
        subject: 'feat: add foo',
        relativeDate: '2 hours ago',
        author: 'Alice',
      },
      {
        hash: 'e4f5678',
        subject: 'fix: bar',
        relativeDate: 'yesterday',
        author: 'Bob',
      },
    ])
  })

  test('honours custom limit', async () => {
    let captured: string[] = []
    const runGit = async (args: string[]) => {
      captured = args
      return { stdout: '', code: 0 }
    }
    await listRecentCommits({ runGit, limit: 5 })
    expect(captured).toContain('-5')
  })

  test('returns [] on non-zero exit', async () => {
    const runGit = async () => ({ stdout: '', code: 128 })
    const commits = await listRecentCommits({ runGit })
    expect(commits).toEqual([])
  })

  test('returns [] on empty stdout', async () => {
    const runGit = async () => ({ stdout: '', code: 0 })
    const commits = await listRecentCommits({ runGit })
    expect(commits).toEqual([])
  })

  test('never throws; swallows runGit rejection', async () => {
    const runGit = async () => {
      throw new Error('boom')
    }
    const commits = await listRecentCommits({ runGit })
    expect(commits).toEqual([])
  })

  test('skips malformed lines (wrong field count)', async () => {
    const runGit = async () => ({
      stdout: 'a1b2c3d\x00only two fields\nvalid\x00s\x00d\x00a',
      code: 0,
    })
    const commits = await listRecentCommits({ runGit })
    expect(commits).toEqual([
      { hash: 'valid', subject: 's', relativeDate: 'd', author: 'a' },
    ])
  })
})
