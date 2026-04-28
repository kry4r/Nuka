/**
 * echo — in-process tool that upper-cases its input text.
 *
 * Demonstrates Phase 11 defineTool pattern. Ships as plain .js so Nuka can
 * load it via dynamic import without a build step.
 *
 * Tool shape mirrors src/core/tools/types.ts#Tool
 */
export default {
  name: 'echo',
  description: 'Echo input text uppercase',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Text to echo in uppercase' },
    },
    required: ['text'],
  },
  source: 'plugin',
  tags: ['util'],
  needsPermission: () => 'none',
  async run({ text }) {
    return { output: text.toUpperCase(), isError: false }
  },
}
