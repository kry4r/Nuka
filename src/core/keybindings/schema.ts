import { z } from 'zod'
import { KEYBINDING_ACTIONS, KEYBINDING_CONTEXTS } from './types'

export const KeybindingBlockSchema = z.object({
  context: z.enum(KEYBINDING_CONTEXTS),
  bindings: z.record(
    z.string(),
    z.union([z.enum(KEYBINDING_ACTIONS), z.null()]),
  ),
})

export const KeybindingsSchema = z.object({
  $schema: z.string().optional(),
  bindings: z.array(KeybindingBlockSchema),
})

export type KeybindingsFile = z.infer<typeof KeybindingsSchema>
