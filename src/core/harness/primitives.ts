// src/core/harness/primitives.ts
import { defineTool } from '../tools/define'
import type { HarnessStateMachine } from './state'

export function makeSequentialThinkingTool(harness: Pick<HarnessStateMachine, 'recordPrimitive'>) {
  return defineTool<{ thought: string }>({
    name: 'sequential_thinking',
    description: 'Record a thinking step. Returns immediately. Use to force pause + reflection before action.',
    parameters: { type: 'object', properties: { thought: { type: 'string' } }, required: ['thought'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: true },
    needsPermission: () => 'none',
    async run(_input, _ctx) {
      harness.recordPrimitive('sequentialThinking')
      return { output: 'thought recorded', isError: false }
    },
  })
}

export function makeSearchAndVerifyTool(harness: Pick<HarnessStateMachine, 'recordPrimitive'>, deps: { runResearcher: (q: string) => Promise<string> }) {
  return defineTool<{ query: string }>({
    name: 'search_and_verify',
    description: 'Run a read-only researcher pass to verify an assumption. Returns findings.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: true, parallelSafe: true },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const findings = await deps.runResearcher(input.query)
        harness.recordPrimitive('searchAndVerify')
        return { output: findings, isError: false }
      } catch (e) { return { output: (e as Error).message, isError: true } }
    },
  })
}

export function makeAskUserQuestionTool(harness: Pick<HarnessStateMachine, 'recordPrimitive'>, deps: { askUser: (q: string) => Promise<string> }) {
  return defineTool<{ question: string }>({
    name: 'ask_user_question',
    description: 'Ask the user a clarifying question. Required at least once in Brainstorm/Spec/Plan first-entry.',
    parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false },
    source: 'builtin', tags: ['core', 'harness'],
    annotations: { readOnly: true, destructive: false, openWorld: false, parallelSafe: false },
    needsPermission: () => 'none',
    async run(input, _ctx) {
      try {
        const answer = await deps.askUser(input.question)
        harness.recordPrimitive('askUser')
        return { output: answer, isError: false }
      } catch (e) { return { output: (e as Error).message, isError: true } }
    },
  })
}
