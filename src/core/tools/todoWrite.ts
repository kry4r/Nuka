import type { Tool } from './types'
import { defineTool } from './define'

export type Todo = { title: string; status: 'pending' | 'in_progress' | 'completed' }

export type TodoState = {
  items: Todo[]
}

export function createTodoStore(): TodoState {
  return { items: [] }
}

export function makeTodoWriteTool(store: TodoState): Tool<{ items: Todo[] }> {
  return defineTool<{ items: Todo[] }>({
    name: 'TodoWrite',
    description:
      'Replace the session todo list. Input is the complete new list of { title, status } items.\n\n' +
      '**When NOT to use:**\n' +
      '- For trivial conversational inputs like greetings ("hello", "hi").\n' +
      '- For single-step tasks that can be completed in one tool call.\n' +
      '- For purely informational replies that require no follow-up.\n' +
      '- When the user has not asked for a multi-step plan.',
    parameters: {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'status'],
            properties: {
              title: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
          },
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'session'],
    needsPermission: () => 'none',
    async run(input) {
      store.items = input.items.map(x => ({ title: x.title, status: x.status }))
      const pretty = store.items.length
        ? store.items
            .map(t => {
              const mark = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[-]' : '[ ]'
              return `${mark} ${t.title}`
            })
            .join('\n')
        : '(no todos)'
      return { output: pretty, isError: false }
    },
  })
}
