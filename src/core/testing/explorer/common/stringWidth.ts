// src/core/testing/explorer/common/stringWidth.ts
//
// Re-export string-width with wcwidth caveats documented.
//
// Caveat: string-width v8 uses Unicode 15 wcswidth tables.  Some CJK
// extension blocks (CJK Unified Ideographs Extension B–H, U+20000+) report
// width 2 correctly.  Emoji with VS-16 (\uFE0F) also report 2.
// Zero-width joiners (ZWJ, U+200D) report 0 as expected.
// Combining diacritics (U+0300–U+036F) report 0 — their base char is
// counted separately.
//
// For the purposes of AnsiGrid, each cell is allocated stringWidth(char)
// columns (0 = combining, 1 = normal, 2 = CJK/emoji wide).

export { default as stringWidth } from 'string-width'
