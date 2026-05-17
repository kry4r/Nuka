// src/tui/promptMentions/index.ts
// Barrel for the prompt-mentions TUI components (iter 3a — components only).

export { AtomicChip } from './AtomicChip'
export type { AtomicChipProps } from './AtomicChip'
export { MentionPalette } from './MentionPalette'
export type { MentionPaletteProps } from './MentionPalette'
export {
  usePromptMention,
  buildSemanticOptions,
  optionToToken,
} from './usePromptMention'
export type {
  PromptMentionLoaders,
  UsePromptMentionArgs,
  UsePromptMentionReturn,
} from './usePromptMention'
