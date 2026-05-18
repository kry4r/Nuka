// src/core/tools/coordinator/blackboardTool.ts
//
// B5 — Pair of tools injected into each sub-agent's filtered tool
// registry. The Blackboard instance is captured by closure so sibling
// workers all see the same store. The tool factory is called once per
// coordinator invocation.

import type { Tool, ToolResult } from '../types'
import { defineTool } from '../define'
import type { Blackboard } from '../../agents/coordinator/blackboard'

export type BlackboardWriteInput = { key: string; value: string }
export type BlackboardReadInput = { key: string; list?: boolean }

export const BB_WRITE_NAME = 'bb_write'
export const BB_READ_NAME = 'bb_read'

export function makeBlackboardTools(blackboard: Blackboard): {
  read: Tool<BlackboardReadInput>
  write: Tool<BlackboardWriteInput>
} {
  const write = defineTool<BlackboardWriteInput>({
    name: BB_WRITE_NAME,
    description:
      'Write a string value to the shared coordinator blackboard. Sibling agents under the same coordinator run can read it via bb_read.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Identifier for this finding (e.g. "auth_bug_location").' },
        value: { type: 'string', description: 'Value to store. Plain text only.' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: false, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input: BlackboardWriteInput): Promise<ToolResult> {
      try {
        await blackboard.write(input.key, input.value)
        return { output: `Wrote ${input.key} (${input.value.length} chars)`, isError: false }
      } catch (err) {
        return { output: (err as Error).message, isError: true }
      }
    },
  })

  const read = defineTool<BlackboardReadInput>({
    name: BB_READ_NAME,
    description:
      'Read a value from the shared coordinator blackboard. Pass {list: true} with key="" to enumerate keys.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to look up. Pass "" with list:true to enumerate.' },
        list: { type: 'boolean', description: 'When true, return the list of available keys instead of a value.' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    source: 'builtin',
    tags: ['core', 'agent', 'coordinator'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input: BlackboardReadInput): Promise<ToolResult> {
      if (input.list === true) {
        const keys = blackboard.list()
        return { output: keys.length === 0 ? '(empty)' : keys.join('\n'), isError: false }
      }
      const value = blackboard.read(input.key)
      return { output: value ?? '', isError: false }
    },
  })

  return { read, write }
}
