// src/core/agents/builtin/editor.ts
import type { ResolvedAgentDef } from '../types'

export const editorAgent: ResolvedAgentDef = {
  pluginName: 'core',
  name: 'editor',
  description: 'Workflow editor-in-chief. Holds global view, dispatches workers, never writes code directly.',
  systemPrompt: '(built dynamically by HarnessStateMachine)',
  allowedTools: [
    'dispatch_agent', 'team_create', 'team_delete', 'send_message',
    'pipeline_run', 'roundtable',
    'sequential_thinking', 'search_and_verify', 'ask_user_question',
    'recap',
    'Read', 'Grep', 'Glob',
    'task_create', 'task_update', 'task_list',
  ],
  deniedTools: ['Edit', 'Write', 'Bash'],
  maxTurns: 100,
}
