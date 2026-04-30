import { z } from 'zod'

export const TeamMemberSchema = z.object({
  agentName: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  agentDefRef: z.string(),
  spawnedAt: z.number(),
  taskId: z.string().optional(),
})

export const TeamConfigSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  description: z.string(),
  taskListId: z.string(),
  members: z.array(TeamMemberSchema),
  createdAt: z.number(),
})

export type TeamMember = z.infer<typeof TeamMemberSchema>
export type Team = z.infer<typeof TeamConfigSchema>
