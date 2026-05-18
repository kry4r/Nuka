import { alwaysOnSkills } from '../skill/activator'
import type { Skill } from '../skill/types'
import type { MemoryEntry } from '../memdir/parser'
import type { OutputStyle } from '../outputStyles/types'
import { applyOutputStyle } from '../outputStyles/resolve'
import { renderTeamMemorySection } from '../memdir/teamMemPrompts'

export type SystemPromptInput = {
  cwd: string
  platform: string
  shell: string
  nodeVersion: string
  gitBranch: { branch: string; dirty: boolean } | null
  skills?: Skill[]
  /**
   * User-scoped memory (cross-project, single user). Reserved for a
   * follow-up iter that wires a `~/.nuka/user-memory/<sha1(uid)>/`
   * loader; declared here so the three-tier prompt ordering (user →
   * team → project) is locked in today and adding the loader later is
   * a pure data-source change with no prompt-builder churn.
   */
  userMemory?: MemoryEntry[]
  /**
   * Team-scoped memory loaded from
   * `~/.nuka/team-memory/<teamId>/<sha1(cwd)>/MEMORY.md` when
   * `config.teamId` is set. Empty array → section omitted (same as
   * project memory). Sits between user and project in the rendered
   * prompt; teams override user prefs, projects override teams.
   */
  teamMemory?: MemoryEntry[]
  /**
   * Project-scoped (per-cwd) memory. Phase 7 §5.3.  Caller resolves
   * relevance via `findRelevant` before passing in. Empty array →
   * section is omitted. Naming preserved as `memory` rather than
   * `projectMemory` so existing call sites compile unchanged.
   */
  memory?: MemoryEntry[]
  /**
   * Phase 8 §4.4 — injected under a `## Plan` heading when present AND
   * the active session is in plan mode. Callers should pass the raw
   * Markdown contents of the per-cwd plan file; the empty string is
   * treated as "no plan" and the section is omitted.
   */
  plan?: { active: boolean; body: string }
  /**
   * User-defined output style resolved upstream from
   * `.nuka/output-styles/*.md`. When present, the prompt is post-
   * processed by {@link applyOutputStyle}: appended under a
   * `## Output Style` header when `keepCodingInstructions` is true /
   * unset, or replacing the assembled base entirely when it is false.
   * Caller passes `null` (or omits the field) to skip merging — the
   * prompt then matches the pre-output-styles behaviour byte-for-byte.
   */
  outputStyle?: OutputStyle | null
}

function renderEntryBullets(heading: string, entries: readonly MemoryEntry[]): string[] {
  if (entries.length === 0) return []
  const out: string[] = ['', heading, '']
  for (const e of entries) {
    const kw = e.keywords.length > 0 ? ` [${e.keywords.join(', ')}]` : ''
    out.push(`- ${e.body}${kw}`)
  }
  return out
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const git = input.gitBranch
    ? `git: ${input.gitBranch.branch}${input.gitBranch.dirty ? ' (dirty)' : ''}`
    : 'git: (not a git repository)'
  const lines: string[] = [
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

  // Memory tiers — emitted in user → team → project order so more-specific
  // scopes (project) win when downstream summarisers / dedupers see
  // overlapping entries. Each section is omitted entirely when its
  // entries array is empty or undefined.
  if (input.userMemory && input.userMemory.length > 0) {
    lines.push(...renderEntryBullets('## User Memory', input.userMemory))
  }
  if (input.teamMemory && input.teamMemory.length > 0) {
    lines.push(...renderTeamMemorySection(input.teamMemory))
  }
  if (input.memory && input.memory.length > 0) {
    lines.push(...renderEntryBullets('## Memory', input.memory))
  }

  if (input.plan?.active && input.plan.body.trim().length > 0) {
    lines.push('', '## Plan', '', input.plan.body.trimEnd())
  }

  const assembled = lines.join('\n')
  if (input.outputStyle) {
    return applyOutputStyle(assembled, input.outputStyle)
  }
  return assembled
}
