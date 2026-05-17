// src/core/memdir/memoryTypes.ts
//
// Slim port of upstream Nuka-Code `src/memdir/memoryTypes.ts` — only the
// closed type enum + parser is carried over. Upstream also ships ~22KB of
// prompt-text constants used by Claude Code's combined-memory prompt; those
// depend on `memdir.ts` / `paths.ts` / `teamMemPaths.ts` which themselves
// depend on Claude-Code-specific paths/feature-flag infra that Nuka does
// not have. Carving out just the enum keeps memoryScan / findRelevantMemories
// portable without dragging in cascading prompt-builder code.
//
// 备注: Nuka 的 memdir 当前只把每条 entry 看作 keyword+body+score；引入
// type taxonomy 是为了未来按 type 过滤召回（findRelevantMemories manifest
// 给 selector 用），并不要求 entry 必须带 type.

/**
 * Memory type taxonomy. 与上游一致的 4 类:
 *  - user: 用户角色/偏好（永远 private）
 *  - feedback: 用户给出的方法学指导
 *  - project: 项目动态（who/what/why）
 *  - reference: 持久 reference 文档
 */
export const MEMORY_TYPES = [
  'user',
  'feedback',
  'project',
  'reference',
] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined — legacy files without a
 * `type:` field keep working, files with unknown types degrade gracefully.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find(t => t === raw)
}
