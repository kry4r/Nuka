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
  /**
   * Capability tags this skill needs at activation time. Matched against
   * the registry via `queryByTags(...)` and unioned with the always-on
   * `core` set (see spec §4.3).
   */
  requires: z.array(z.string().min(1)).optional(),
})

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>

export type Skill = {
  name: string
  description?: string
  when: SkillFrontmatter['when']
  /**
   * Optional capability tags. Used by `activeToolsFor` to additively
   * expose tools beyond the always-on `core` set (spec §4.3).
   */
  requires?: string[]
  body: string
  source: 'global' | 'project'
  path: string
}
