import os from 'node:os'
import type { SlashCommand, SlashResult } from './types'
import { loadSkills } from '../core/skill/loader'

export const SkillCommand: SlashCommand = {
  name: 'skill',
  description: 'List loaded skills (use the skill tool to invoke one)',
  async run(): Promise<SlashResult> {
    const skills = await loadSkills({ home: os.homedir(), cwd: process.cwd() })
    if (skills.length === 0) {
      return { type: 'text', text: 'No skills loaded. Drop markdown files under ~/.nuka/skills/ or in a plugin.' }
    }
    const lines = [`${skills.length} skill${skills.length === 1 ? '' : 's'}:`]
    for (const s of skills) {
      const desc = s.description ? ` — ${s.description}` : ''
      lines.push(`  · ${s.name}${desc}`)
    }
    lines.push('')
    lines.push('Invoke via the agent: ask the agent to "use the <name> skill".')
    return { type: 'text', text: lines.join('\n') }
  },
}
