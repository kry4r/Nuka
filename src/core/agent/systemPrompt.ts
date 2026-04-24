import { alwaysOnSkills } from '../skill/activator'
import type { Skill } from '../skill/types'

export type SystemPromptInput = {
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null
  skills?: Skill[]
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

  return lines.join('\n')
}
