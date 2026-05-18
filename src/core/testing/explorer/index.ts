// src/core/testing/explorer/index.ts
//
// Re-export entry for the ink-ui-explorer runner.
// See locked spec §3.2 for the full module layout.

export { capture } from './capture'
export { sweep } from './sweep'
export { fuzz } from './fuzz'
export { judge } from './judge'
export { repair } from './repair'
export type * from './types'

const USAGE = `\
Usage: nuka explore <verb> [options]

Verbs:
  capture   Mount a single fixture at one viewport; write grid to .ink-explorer/captures/
  sweep     Run fixtures × viewport matrix → L1 invariants → Judge
  fuzz      Random stdin + viewport resize, shrunk to minimal repro
  judge     Re-run Judge stage on the most recent sweep's grids
  repair    Spawn Opus subagent to read failure dump and produce a patch
`

/**
 * CLI entry point for the 'nuka explore' argv branch.
 * Returns 0 on success, 1 on error, 2 on bad/missing args.
 */
export async function runExploreCli(argv: string[]): Promise<number> {
  const verb = argv[0]
  if (!verb || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE)
    return 2
  }

  const { capture } = await import('./capture')
  const { sweep } = await import('./sweep')
  const { fuzz } = await import('./fuzz')
  const { judge } = await import('./judge')
  const { repair } = await import('./repair')

  const verbMap: Record<string, () => Promise<number>> = {
    async capture() {
      // Parse --viewport=COLSxROWS and --out=PATH flags
      const viewportArg = argv.find(a => a.startsWith('--viewport='))
      const outArg = argv.find(a => a.startsWith('--out='))
      let viewport: { cols: number; rows: number } | undefined
      if (viewportArg) {
        const [cols, rows] = viewportArg.slice('--viewport='.length).split('x').map(Number)
        if (cols && rows) viewport = { cols, rows }
      }
      const out = outArg ? outArg.slice('--out='.length) : undefined
      await capture({
        fixturePath: argv[1] ?? '',
        viewport,
        cwd: process.cwd(),
        out,
      })
      return 0
    },

    async sweep() {
      const { formatSummary, buildRunRows } = await import('./sweep/reporter')

      // Parse --fixture-root=<dir>, --out=<dir>, --judge (no-op in M2)
      const fixtureRootArg = argv.find(a => a.startsWith('--fixture-root='))
      const outArg = argv.find(a => a.startsWith('--out='))

      const fixtureRoot = fixtureRootArg
        ? fixtureRootArg.slice('--fixture-root='.length)
        : undefined
      const out = outArg ? outArg.slice('--out='.length) : undefined

      const result = await sweep({
        fixturesGlob: fixtureRoot,
        cwd: process.cwd(),
        out,
      })

      // Print summary table
      const rows = buildRunRows(result)
      const summary = formatSummary(result, rows)
      process.stdout.write(summary)

      // Exit 1 if any failures
      return result.failed > 0 ? 1 : 0
    },

    async fuzz() {
      await fuzz({})
      return 0
    },
    async judge() {
      await judge({})
      return 0
    },
    async repair() {
      await repair({ failureId: argv[1] ?? '' })
      return 0
    },
  }

  const handler = verbMap[verb]
  if (!handler) {
    process.stderr.write(`explore: unknown verb '${verb}'\n`)
    process.stderr.write(USAGE)
    return 2
  }

  try {
    return await handler()
  } catch (err) {
    process.stderr.write(`explore ${verb} failed: ${(err as Error).message}\n`)
    return 1
  }
}
