// src/core/agents/loader.ts
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AgentDef, ResolvedAgentDef } from './types'

/**
 * Resolve an AgentDef into a ResolvedAgentDef:
 * - if `systemPromptPath` is set, read the file relative to pluginDir.
 * - drop `systemPromptPath`.
 * - attach `pluginName`.
 *
 * Throws if the path cannot be read.
 */
export async function resolveAgentDef(
  def: AgentDef,
  pluginDir: string,
  pluginName: string,
): Promise<ResolvedAgentDef> {
  let systemPrompt: string
  if (def.systemPrompt !== undefined) {
    systemPrompt = def.systemPrompt
  } else if (def.systemPromptPath !== undefined) {
    const abs = resolve(pluginDir, def.systemPromptPath)
    try {
      systemPrompt = await readFile(abs, 'utf8')
    } catch (err) {
      throw new Error(
        `agent '${pluginName}:${def.name}' systemPromptPath '${def.systemPromptPath}' — read failed: ${(err as Error).message}`,
      )
    }
  } else {
    // Zod refine should have caught this, but guard anyway.
    throw new Error(
      `agent '${pluginName}:${def.name}' must declare systemPrompt or systemPromptPath`,
    )
  }

  const { systemPromptPath: _unused, ...rest } = def
  void _unused
  return {
    ...rest,
    systemPrompt,
    pluginName,
  }
}
