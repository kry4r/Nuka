// src/core/agents/agentMemory.ts
//
// Nuka-Code-compatible persistent memory surface for subagents. A subagent can
// declare `memory: user | project | local`; dispatch then appends a small
// memory prompt to that agent's system prompt and points it at a scoped
// MEMORY.md file.

import { mkdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import os from 'node:os'

const ENTRYPOINT_NAME = 'MEMORY.md'
const MEMORY_FILE_TOOLS = ['Read', 'Write', 'Edit'] as const

export type AgentMemoryScope = 'user' | 'project' | 'local'

export type LoadAgentMemoryPromptInput = {
  agentName: string
  scope: AgentMemoryScope
  cwd: string
  home?: string
}

export type AgentMemoryDeps = {
  loadPrompt: (input: LoadAgentMemoryPromptInput) => string
}

export function addAgentMemoryTools(allowedTools: string[]): string[] {
  const out = [...allowedTools]
  const seen = new Set(out)
  for (const tool of MEMORY_FILE_TOOLS) {
    if (!seen.has(tool)) {
      out.push(tool)
      seen.add(tool)
    }
  }
  return out
}

function sanitizeAgentNameForPath(agentName: string): string {
  return agentName.replace(/:/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-')
}

export function agentMemoryDir(input: LoadAgentMemoryPromptInput): string {
  const home = input.home ?? os.homedir()
  const dirName = sanitizeAgentNameForPath(input.agentName)
  switch (input.scope) {
    case 'project':
      return join(input.cwd, '.nuka', 'agent-memory', dirName) + sep
    case 'local':
      return join(input.cwd, '.nuka', 'agent-memory-local', dirName) + sep
    case 'user':
      return join(home, '.nuka', 'agent-memory', dirName) + sep
  }
}

export function loadAgentMemoryPrompt(input: LoadAgentMemoryPromptInput): string {
  const memoryDir = agentMemoryDir(input)
  mkdirSync(memoryDir, { recursive: true })
  const memoryPath = join(memoryDir, ENTRYPOINT_NAME)
  let entrypointContent = ''
  try {
    entrypointContent = readFileSync(memoryPath, 'utf8')
  } catch {
    entrypointContent = ''
  }

  const scopeNote = scopeGuideline(input.scope)
  const lines = [
    '# Persistent Agent Memory',
    '',
    `You have a persistent, file-based memory system at \`${memoryDir}\`.`,
    scopeNote,
    '',
    'Use this memory only for facts and preferences that will help this same subagent in future work.',
    `When saving memory, write concise notes and keep \`${ENTRYPOINT_NAME}\` as the index.`,
    '',
    `## ${ENTRYPOINT_NAME}`,
    '',
    entrypointContent.trim().length > 0
      ? entrypointContent.trimEnd()
      : `Your ${ENTRYPOINT_NAME} is currently empty. When you save new memories, they will appear here.`,
  ]
  return lines.join('\n')
}

function scopeGuideline(scope: AgentMemoryScope): string {
  switch (scope) {
    case 'user':
      return 'Since this memory is user-scope, keep learnings general across projects.'
    case 'project':
      return 'Since this memory is project-scope, tailor memories to this repository.'
    case 'local':
      return 'Since this memory is local-scope, tailor memories to this machine and keep them out of version control.'
  }
}
