// src/core/agents/types.ts
import { z } from 'zod'
import type { Effort } from '../provider/types'

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

/**
 * Manifest-declared agent definition.
 * Exactly one of `systemPrompt` or `systemPromptPath` must be supplied.
 */
export const AgentDefSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/, 'agent name must match /^[a-z][a-z0-9_-]*$/ (namespace-safe)'),
    description: z.string().min(1),
    model: z.string().optional(),
    systemPrompt: z.string().optional(),
    systemPromptPath: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
    deniedTools: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    maxTurns: z.number().int().positive().default(20),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(1).optional(),
    memory: z.enum(['user', 'project', 'local']).optional(),
    isolation: z.enum(['inherit', 'worktree']).optional(),
    background: z.boolean().optional(),
    permissionMode: z.enum(['plan']).optional(),
    initialPrompt: z.string().min(1).optional(),
    effort: z.enum(['low', 'medium', 'high']).optional(),
    skills: z.array(z.string().min(1)).optional(),
    requiredMcpServers: z.array(z.string().min(1)).optional(),
    mcpServers: z.array(JsonValueSchema).optional(),
    hooks: JsonValueSchema.optional(),
  })
  .refine(
    d => (d.systemPrompt !== undefined) !== (d.systemPromptPath !== undefined),
    { message: 'exactly one of systemPrompt or systemPromptPath must be provided' },
  )

export type AgentDef = z.infer<typeof AgentDefSchema>

/**
 * Agent definition after loader resolution:
 * - systemPromptPath has been read (if set), producing the final systemPrompt.
 * - pluginName is attached so we know where the agent came from.
 * - `name` remains the unqualified name; callers must namespace as
 *   `<pluginName>:<name>` when registering.
 */
export type ResolvedAgentDef = Omit<AgentDef, 'systemPromptPath'> & {
  systemPrompt: string
  pluginName: string
  effort?: Effort
}
