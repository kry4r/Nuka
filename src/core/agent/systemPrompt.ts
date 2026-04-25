import { alwaysOnSkills } from '../skill/activator'
import type { Skill } from '../skill/types'
import type { MemoryEntry } from '../memdir/parser'

export type SystemPromptInput = {
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null
  skills?: Skill[]
  /**
   * Phase 7 §5.3 — relevant memory entries to inject under a `## Memory`
   * heading. Caller resolves relevance (via {@link findRelevant}) before
   * passing in. Empty array → section is omitted.
   */
  memory?: MemoryEntry[]
  /**
   * Phase 8 §4.4 — injected under a `## Plan` heading when present AND
   * the active session is in plan mode. Callers should pass the raw
   * Markdown contents of the per-cwd plan file; the empty string is
   * treated as "no plan" and the section is omitted.
   */
  plan?: { active: boolean; body: string }
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const git = input.gitBranch
    ? `git: ${input.gitBranch.branch}${input.gitBranch.dirty ? ' (dirty)' : ''}`
    : 'git: (not a git repository)'
  const lines = [
    'You are Nuka, a terminal coding agent. Be concise. Act. Ask before destructive changes.',
    '',
    'Environment:',
    `  cwd: ${input.cwd}`,
    `  platform: ${input.platform}`,
    `  shell: ${input.shell}`,
    `  node: ${input.nodeVersion}`,
    `  ${git}`,
    '',
    'Tool usage:',
    '  - Use tools to read files, edit files, and run commands rather than guessing.',
    '  - Prefer Edit for targeted changes; Write when creating new files.',
    '  - Announce destructive shell commands before executing them.',
    '  - Report results briefly; let the user review diffs and outputs.',
  ]

  if (input.skills && input.skills.length > 0) {
    const active = alwaysOnSkills(input.skills)
    if (active.length > 0) {
      lines.push('', 'Skills:')
      for (const skill of active) {
        lines.push('', `# ${skill.name}`, '', skill.body)
      }
    }
  }

  if (input.memory && input.memory.length > 0) {
    lines.push('', '## Memory', '')
    for (const e of input.memory) {
      const kw = e.keywords.length > 0 ? ` [${e.keywords.join(', ')}]` : ''
      lines.push(`- ${e.body}${kw}`)
    }
  }

  if (input.plan?.active && input.plan.body.trim().length > 0) {
    lines.push('', '## Plan', '', input.plan.body.trimEnd())
  }

  return lines.join('\n')
}
