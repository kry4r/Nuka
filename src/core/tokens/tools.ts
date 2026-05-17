// src/core/tokens/tools.ts
//
// EstimateTokens — agent-facing tool that wraps the pure
// `roughTokenCountEstimation` family. Useful when the model wants to
// size a payload before sending (e.g. "is this file too big to paste
// inline?") without paying a round-trip to the provider's countTokens
// endpoint.
//
// The estimate is the same byte-ratio heuristic that the context-budget
// gauge uses, so an explicit call here matches what the harness
// internally believes.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import {
  DEFAULT_BYTES_PER_TOKEN,
  bytesPerTokenForFileType,
  roughTokenCountEstimation,
} from './estimate'

export type EstimateTokensInput = {
  text: string
  /**
   * Optional file extension (with or without a leading dot). When
   * supplied, swaps in the higher-density ratio for known formats
   * (json/jsonl/jsonc → 2 bytes/token). Unknown extensions fall back
   * to the default ratio.
   */
  fileExtension?: string
}

export const EstimateTokensTool: Tool<EstimateTokensInput> =
  defineTool<EstimateTokensInput>({
    name: 'EstimateTokens',
    description:
      'Estimate the token count of a string using a byte-ratio heuristic (~4 chars/token, 2 for JSON-like). Pure and synchronous — does not hit any API. Useful for sizing payloads before sending.',
    parameters: {
      type: 'object',
      required: ['text'],
      properties: {
        text: {
          type: 'string',
          description: 'The text to estimate.',
        },
        fileExtension: {
          type: 'string',
          description:
            'Optional file extension hint (e.g. "json", ".jsonl"). Improves accuracy for dense formats.',
        },
      },
    },
    source: 'builtin',
    tags: ['core', 'tokens'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    searchHint: ['tokens', 'estimate', 'count', 'size', 'budget'],
    async run(input) {
      const ext = input.fileExtension?.trim() || ''
      const ratio = ext
        ? bytesPerTokenForFileType(ext)
        : DEFAULT_BYTES_PER_TOKEN
      const tokens = roughTokenCountEstimation(input.text, ratio)
      const noteParts = [
        `~${tokens} tokens`,
        `${input.text.length} chars`,
        `${ratio} bytes/token`,
      ]
      if (ext) noteParts.push(`ext=${ext.replace(/^\./, '').toLowerCase()}`)
      return {
        isError: false,
        output: noteParts.join(', '),
      }
    },
  })
