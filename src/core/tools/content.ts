// src/core/tools/content.ts
// ContentBlock union for rich tool results (M2.2).
// Distinct from the message/types.ts ContentBlock (which covers text + tool_use).

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; path: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string }

/**
 * Serialize a ContentBlock[] to a plain string for event payloads and
 * contexts that don't support rich content (e.g. the UI tool_result event,
 * OpenAI tool messages).
 */
export function serializeContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map(b => {
      if (b.type === 'text') return b.text
      if (b.type === 'image') return `[image: ${b.mimeType} path=${b.path}]`
      if (b.type === 'resource') {
        const parts: string[] = [`[resource: ${b.uri}`]
        if (b.mimeType) parts.push(` type=${b.mimeType}`)
        if (b.text) parts.push(`]\n${b.text}`)
        else parts.push(']')
        return parts.join('')
      }
      return ''
    })
    .join('\n')
}
