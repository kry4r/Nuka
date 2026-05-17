// src/core/stringWidth/index.ts
//
// Public surface of the terminal display-width helpers. Pure logic,
// no UI deps. See `stringWidth.ts` for the rationale.

export {
  stripAnsi,
  charWidth,
  stringWidth,
  truncateByWidth,
  padToWidth,
  type StringWidthOpts,
  type TruncateByWidthOptions,
  type PadToWidthOptions,
} from './stringWidth'
