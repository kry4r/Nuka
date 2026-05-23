// src/core/tokens/estimate.ts
//
// Pure rough token-count estimator. Ported from Nuka-Code's
// `src/services/tokenEstimation.ts`, stripped of provider-specific code
// (Anthropic SDK / Bedrock / Vertex). Only the byte-ratio heuristic and
// the structural walks remain, retargeted at Nuka's `Message` /
// `ContentBlock` types.
//
// Use this when you need a synchronous, dependency-free token estimate
// — e.g. context-budget gauges, file-too-big rejections, or routing
// hints. It is intentionally conservative on images/PDFs so the
// auto-compact path doesn't trip late on a misjudged attachment.
//
// For an API-accurate count, call the provider's countTokens endpoint
// directly. That path is not part of this module.

import type {
  ContentBlock as MessageContentBlock,
  Message,
} from '../message/types'
import type { ContentBlock as ToolContentBlock } from '../tools/content'

/**
 * Bytes per token to use for plain text.
 *
 * The classic "~4 chars / token" approximation. Accurate enough for
 * English prose; high-density formats like JSON have their own ratio
 * (see {@link bytesPerTokenForFileType}).
 */
export const DEFAULT_BYTES_PER_TOKEN = 4

/**
 * Conservative token cost for a single inline image or PDF block.
 *
 * Matches the upstream microCompact constant. The real cost depends on
 * resolution, but a flat upper bound prevents underestimating a 1 MB
 * base64 PDF (which would otherwise round-trip through
 * `JSON.stringify` and report ~325k tokens — vs the ~2000 the provider
 * actually charges).
 */
export const IMAGE_BLOCK_TOKEN_COST = 2000

/**
 * Estimate token count for an arbitrary string.
 *
 * @param content - the text to count
 * @param bytesPerToken - override the default 4-byte-per-token ratio,
 *   e.g. 2 for dense JSON. Must be positive.
 */
export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = DEFAULT_BYTES_PER_TOKEN,
): number {
  if (!content) return 0
  if (bytesPerToken <= 0) {
    throw new RangeError(
      `bytesPerToken must be positive, got ${bytesPerToken}`,
    )
  }
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns the bytes-per-token ratio for a given file extension.
 *
 * Dense JSON formats have many single-character tokens (`{`, `}`,
 * `:`, `,`, `"`), pushing the real ratio closer to 2 than the default
 * 4. Other extensions default to 4.
 *
 * @param fileExtension - extension with or without a leading dot;
 *   case-insensitive
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  const ext = fileExtension.replace(/^\./, '').toLowerCase()
  switch (ext) {
    case 'json':
    case 'jsonl':
    case 'jsonc':
      return 2
    default:
      return DEFAULT_BYTES_PER_TOKEN
  }
}

/**
 * Like {@link roughTokenCountEstimation} but uses the more accurate
 * bytes-per-token ratio when the file type is known. Matters when the
 * caller is sizing a tool result that might overflow context.
 */
export function roughTokenCountEstimationForFileType(
  content: string,
  fileExtension: string,
): number {
  return roughTokenCountEstimation(
    content,
    bytesPerTokenForFileType(fileExtension),
  )
}

/**
 * Estimate tokens for a single Nuka message content block.
 *
 * Recognises Nuka's plain text/tool_use union as well as the richer
 * tool-result {@link ToolContentBlock} union (image / resource).
 */
export function roughTokenCountEstimationForBlock(
  block: MessageContentBlock | ToolContentBlock,
): number {
  switch (block.type) {
    case 'text':
      return roughTokenCountEstimation(block.text)
    case 'tool_use':
      // The provider serializes the input as JSON. Stringify-length
      // tracks the form the API sees; key/bracket overhead is in the
      // single-digit-percent range on real blocks.
      return roughTokenCountEstimation(
        block.name + safeStringify(block.input ?? {}),
      )
    case 'image':
      return IMAGE_BLOCK_TOKEN_COST
    case 'resource': {
      // Resource blocks may inline text (e.g. a quoted file slice) or
      // reference a URI. Count whatever text we have; URI-only is
      // effectively free.
      const inline = block.text
      return inline ? roughTokenCountEstimation(inline) : 0
    }
    default: {
      // exhaustive guard — if the union grows, this branch surfaces it
      const _exhaustive: never = block
      void _exhaustive
      return 0
    }
  }
}

/**
 * Estimate tokens for a single Nuka {@link Message}.
 *
 * Tool messages whose `content` is a plain string are estimated as
 * text. System messages are also estimated as text.
 */
export function roughTokenCountEstimationForMessage(message: Message): number {
  switch (message.role) {
    case 'user':
    case 'assistant':
      return sumBlocks(message.content)
    case 'tool':
      return typeof message.content === 'string'
        ? roughTokenCountEstimation(message.content)
        : sumBlocks(message.content)
    case 'system':
      return roughTokenCountEstimation(message.content)
    case 'responses_compaction':
      return roughTokenCountEstimation(safeStringify(message.output))
  }
}

/**
 * Estimate tokens for a sequence of messages — typically the entire
 * conversation transcript.
 */
export function roughTokenCountEstimationForMessages(
  messages: readonly Message[],
): number {
  let total = 0
  for (const m of messages) {
    total += roughTokenCountEstimationForMessage(m)
  }
  return total
}

function sumBlocks(
  blocks: ReadonlyArray<MessageContentBlock | ToolContentBlock>,
): number {
  let total = 0
  for (const b of blocks) {
    total += roughTokenCountEstimationForBlock(b)
  }
  return total
}

/**
 * Safe-ish JSON stringify that swallows cycles and BigInt values
 * rather than throwing. Token estimation must never crash the host
 * just because a tool input is exotic.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ) ?? ''
  } catch {
    // Fallback: at least account for whatever toString gives us.
    try {
      return String(value)
    } catch {
      return ''
    }
  }
}
