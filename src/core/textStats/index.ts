// src/core/textStats/index.ts
//
// Public surface of the pure-logic text-statistics helpers. No UI deps.
// See `textStats.ts` for the rationale.

export {
  textStats,
  countLines,
  countWords,
  countSentences,
  countParagraphs,
  type TextStats,
  type TextStatsOptions,
} from './textStats'

export {
  TEXT_STATS_TOOL_NAME,
  TextStatsTool,
  runTextStatsTool,
  type TextStatsAction,
  type TextStatsToolInput,
  type TextStatsToolResult,
} from './textStatsTool'
