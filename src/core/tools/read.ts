import { readFile } from 'node:fs/promises'
import { defineTool } from './define'

type ReadInput = { path: string; offset?: number; limit?: number }

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(512, buf.length))
  for (const b of sample) if (b === 0) return true
  return false
}

export const ReadTool = defineTool<ReadInput>({
  name: 'Read',
  description: 'Read a text file and return its contents with line numbers.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string' },
      offset: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1 },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.read'],
  needsPermission: () => 'none',
  async run(input) {
    try {
      const buf = await readFile(input.path)
      if (looksBinary(buf)) {
        return { isError: true, output: `Refusing to read binary file: ${input.path}` }
      }
      const all = buf.toString('utf8').split('\n')
      const start = Math.max(1, input.offset ?? 1)
      const end = input.limit ? start + input.limit - 1 : all.length
      const rows: string[] = []
      for (let i = start; i <= Math.min(end, all.length); i++) {
        const line = all[i - 1] ?? ''
        rows.push(`${i}\t${line}`)
      }
      return { isError: false, output: rows.join('\n') }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
})
