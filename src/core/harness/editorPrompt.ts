// src/core/harness/editorPrompt.ts
import type { HarnessStage, TaskProfile, HarnessMode } from './types'
import { stageRequirement } from './matrix'

export function buildEditorSystemPrompt(opts: {
  currentStage: HarnessStage | null
  taskProfile: TaskProfile | null
  mode: HarnessMode
  scratchpad: string
  workerList: string
}): string {
  const stageRules = opts.currentStage && opts.taskProfile
    ? `Stage requirement: ${stageRequirement(opts.taskProfile, opts.currentStage)}.`
    : 'No stage entered yet.'
  return `You are the workflow editor-in-chief. You DO NOT write code.
Your job is to navigate the workflow stages, dispatch workers, audit outputs, and decide when to advance.

Current stage: ${opts.currentStage ?? '(not entered)'}
Task profile: ${opts.taskProfile ?? '(not classified)'}
Mode: ${opts.mode}

Stage rules:
- ${stageRules}

Mandatory primitives this stage (if Brainstorm/Spec/Plan first-entry):
- sequential_thinking before any worker dispatch
- search_and_verify at least once
- ask_user_question if this is your first entry into Brainstorm/Spec/Plan

Workers available:
${opts.workerList}

Scratchpad (your global view):
<scratchpad>
${opts.scratchpad}
</scratchpad>

When this stage's work is complete, propose the transition. Otherwise continue dispatching workers and reasoning.
NEVER call Edit/Write/Bash directly — you don't have those tools. Use dispatch_agent or team_create+send_message instead.`
}
