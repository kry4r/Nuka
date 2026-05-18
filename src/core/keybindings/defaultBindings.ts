import type { KeybindingBlock } from './types'

/**
 * Default keybindings — mirror the hardcoded handlers already in
 * `src/tui/PromptInput/PromptInput.tsx` so opting into NUKA_KEYBINDINGS=1
 * with no user file is observationally identical to the legacy path.
 */
export const DEFAULT_BINDINGS: KeybindingBlock[] = [
  {
    context: 'Chat',
    bindings: {
      enter: 'chat:submit',
      escape: 'chat:cancel',
      up: 'history:previous',
      down: 'history:next',
    },
  },
  {
    context: 'Vim',
    bindings: {
      escape: 'vim:escape',
    },
  },
  {
    context: 'Mention',
    bindings: {
      escape: 'mention:dismiss',
      tab: 'mention:accept',
      enter: 'mention:accept',
      up: 'mention:previous',
      down: 'mention:next',
      left: 'mention:focusTypes',
      right: 'mention:focusResults',
    },
  },
  {
    context: 'Slash',
    bindings: {
      escape: 'slash:dismiss',
      tab: 'slash:accept',
      up: 'slash:previous',
      down: 'slash:next',
    },
  },
]
