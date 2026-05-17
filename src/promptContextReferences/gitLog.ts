/**
 * `listRecentCommits` — produces the commit palette feed used by the
 * `@commit:` mention picker. Ported from Nuka-Code; argv shape is
 * load-bearing (the resolver tests assert exact argv).
 *
 * The function intentionally never throws — palette UI is non-fatal and
 * a missing repo just yields an empty list.
 */

export type RecentCommit = {
  hash: string
  subject: string
  relativeDate: string
  author: string
}

type RunGit = (args: string[]) => Promise<{ stdout: string; code: number }>

export async function listRecentCommits(deps: {
  runGit: RunGit
  limit?: number
}): Promise<RecentCommit[]> {
  const limit = deps.limit ?? 30
  try {
    const result = await deps.runGit([
      'log',
      `-${limit}`,
      'HEAD',
      '--format=%h%x00%s%x00%ar%x00%an',
    ])
    if (result.code !== 0) {
      return []
    }
    const lines = result.stdout.split('\n').filter(line => line.length > 0)
    const commits: RecentCommit[] = []
    for (const line of lines) {
      const parts = line.split('\x00')
      if (parts.length !== 4) {
        continue
      }
      const [hash, subject, relativeDate, author] = parts
      commits.push({
        hash: hash!,
        subject: subject!,
        relativeDate: relativeDate!,
        author: author!,
      })
    }
    return commits
  } catch {
    return []
  }
}
