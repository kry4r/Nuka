import type { Tool } from '../tools/types'
import type { Skill } from './types'

export function makeSkillTool(skills: Skill[]): Tool<{ name: string }> {
  return {
    name: 'Skill',
    description: 'Load a named skill; its guidance is injected into the next turn.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    source: 'skill',
    tags: [],
    needsPermission: () => 'none',
    async run({ name }) {
      const skill = skills.find((s) => s.name === name)
      if (!skill) return { output: `Unknown skill: ${name}`, isError: true }
      return { output: `[Skill: ${name}]\n\n${skill.body}`, isError: false }
    },
  }
}
