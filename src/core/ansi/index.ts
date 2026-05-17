// src/core/ansi/index.ts
//
// Public surface of the ANSI escape-sequence generators. Pure logic,
// no UI deps. See `ansiColors.ts` for the rationale and the full
// SGR table reference.

export {
  // Raw constants & helpers
  RESET,
  sgr,
  // Color-detection + global toggle
  supportsColor,
  enableColors,
  disableColors,
  colorsAreEnabled,
  refreshSupportsColor,
  // Re-export so callers can grab it from one place
  stripAnsi,
  // Foreground basic 8
  black,
  red,
  green,
  yellow,
  blue,
  magenta,
  cyan,
  white,
  gray,
  grey,
  // Foreground bright 8
  blackBright,
  redBright,
  greenBright,
  yellowBright,
  blueBright,
  magentaBright,
  cyanBright,
  whiteBright,
  // Background basic 8
  bgBlack,
  bgRed,
  bgGreen,
  bgYellow,
  bgBlue,
  bgMagenta,
  bgCyan,
  bgWhite,
  // Background bright 8
  bgBlackBright,
  bgRedBright,
  bgGreenBright,
  bgYellowBright,
  bgBlueBright,
  bgMagentaBright,
  bgCyanBright,
  bgWhiteBright,
  // Style modifiers
  bold,
  dim,
  italic,
  underline,
  inverse,
  hidden,
  strikethrough,
  // 256-color & true-color
  color256,
  color256Bg,
  rgb,
  rgbBg,
  // Composition
  style,
  compose,
  // Cursor / screen
  clearLine,
  clearScreen,
  moveTo,
  cursorHide,
  cursorShow,
  // Types
  type StyleName,
} from './ansiColors'
