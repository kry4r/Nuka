// test/ui-auto/fixtures/regression-bug-a.fixtures.tsx
//
// Regression fixture for Bug A: "hello" triggers TodoWrite.
//
// Root cause (bringup §2.1):
//   src/core/tools/todoWrite.ts:17 — Tool description has no "When NOT to use" guidance.
//   src/core/agent/systemPrompt.ts — No TodoWrite usage section injected.
//
// Fix surface (M9/repair): extend todoWrite.ts description AND inject a
//   TodoWrite usage section into systemPrompt.ts.
//
// This fixture is a prompt-surface test (not a render test).
// The render side is a no-op <Text> so the explorer glob can pick it up.
// The real assertions live in the case assert() hook.

import React from 'react'
import { Text } from 'ink'
import { makeTodoWriteTool, createTodoStore } from '../../../src/core/tools/todoWrite'
import { buildSystemPrompt } from '../../../src/core/agent/systemPrompt'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const fixture: FixtureDef = {
  component: 'BugA-TodoWritePromptSurface',
  cases: {
    'tool-description-has-when-not-to-use': {
      // Render side is a no-op placeholder (Bug A is prompt-surface, not render)
      render: () => React.createElement(Text, null, 'todo-tool-prompt-surface'),
      assert: async () => {
        const store = createTodoStore()
        const tool = makeTodoWriteTool(store)

        // BUG A (currently failing): The tool description must contain
        // explicit "When NOT to use" guidance so the model does not call
        // TodoWrite on trivial conversational inputs like "hello".
        if (!tool.description.includes('When NOT to use')) {
          throw new Error(
            `Bug A: TodoWrite.description missing "When NOT to use" section.\n` +
            `Current description: ${tool.description}`,
          )
        }
      },
    },
    'system-prompt-has-todowrite-section': {
      render: () => React.createElement(Text, null, 'todo-tool-prompt-surface'),
      assert: async () => {
        const prompt = buildSystemPrompt({
          cwd: '/test',
          platform: 'linux',
          shell: 'bash',
          nodeVersion: 'v20.0.0',
          gitBranch: null,
        })

        // BUG A (currently failing): The assembled system prompt must contain
        // a TodoWrite usage section so the model knows when NOT to use it.
        if (!prompt.includes('TodoWrite')) {
          throw new Error(
            `Bug A: System prompt contains no TodoWrite section.\n` +
            `The model cannot know when NOT to use TodoWrite without guidance.`,
          )
        }
      },
    },
  },
} satisfies FixtureDef

export default fixture
