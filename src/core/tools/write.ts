// src/core/tools/write.ts
import { writeFile, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { defineTool } from './define'

type WriteInput = { path: string; content: string }

export const WriteTool = defineTool<WriteInput>({
  name: 'Write',
  description: 'Write content to a file (atomic; parent dir must exist).',
  parameters: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.write'],
  needsPermission: () => 'write',
  async run(input) {
    try {
      const parent = dirname(input.path)
      await stat(parent) // throws if missing
      const tmp = `${input.path}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, input.content, 'utf8')
      await rename(tmp, input.path)
      return { isError: false, output: `wrote ${input.content.length} bytes to ${input.path}` }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
})
