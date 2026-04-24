import type { Tool } from './types'

export type Todo = { title: string; status: 'pending' | 'in_progress' | 'completed' }

export type TodoState = {
  items: Todo[]
}

export function createTodoStore(): TodoState {
  return { items: [] }
}

export function makeTodoWriteTool(store: TodoState): Tool<{ items: Todo[] }> {
  return {
    name: 'TodoWrite',
    description: 'Replace the session todo list. Input is the complete new list of { title, status } items.',
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
  }
}
