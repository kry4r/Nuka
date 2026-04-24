import { z } from 'zod'

export const skillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  when: z
    .union([
      z.literal('on-session-start'),
      z.object({ keyword: z.array(z.string().min(1)).min(1) }),
    ])
    .default('on-session-start'),
})

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>

export type Skill = {
  name: string
  description?: string
  when: SkillFrontmatter['when']
  body: string
  source: 'global' | 'project'
  path: string
}
