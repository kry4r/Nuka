// src/core/tools/edit.ts
import { readFile, writeFile } from 'node:fs/promises'
import { defineTool } from './define'

type EditInput = {
  path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

function countOccurrences(hay: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let i = 0
  for (;;) {
    const found = hay.indexOf(needle, i)
    if (found === -1) return count
    count++
    i = found + needle.length
  }
}

export const EditTool = defineTool<EditInput>({
  name: 'Edit',
  description: 'Exact string replacement in a file.',
  parameters: {
    type: 'object',
    required: ['path', 'old_string', 'new_string'],
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
  },
  source: 'builtin',
  tags: ['core', 'fs.write'],
  needsPermission: () => 'write',
  async run(input) {
    try {
      const content = await readFile(input.path, 'utf8')
      const n = countOccurrences(content, input.old_string)
      if (n === 0) {
        return { isError: true, output: `old_string not found in ${input.path}` }
      }
      if (n > 1 && !input.replace_all) {
        return {
          isError: true,
          output: `old_string matches ${n} times; pass replace_all=true or make the pattern unique`,
        }
      }
      const next = input.replace_all
        ? content.split(input.old_string).join(input.new_string)
        : content.replace(input.old_string, input.new_string)
      await writeFile(input.path, next, 'utf8')
      return { isError: false, output: `edited ${input.path}: ${n} replacement(s)` }
    } catch (err) {
      return { isError: true, output: (err as Error).message }
    }
  },
})
