/**
 * Unicode sanitization for MCP tool output text.
 *
 * Strips invisible / control characters that can corrupt terminal output or
 * confuse downstream text processing, while preserving all printable content
 * and the three common whitespace characters (tab, newline, carriage return).
 */

/**
 * Sanitize a tool-output string by stripping:
 * - BOM: U+FEFF
 * - C0 controls except \t (U+0009), \n (U+000A), \r (U+000D):
 *     U+0000–U+0008, U+000B, U+000C, U+000E–U+001F
 * - C1 controls: U+0080–U+009F
 * - Zero-width characters: U+200B, U+200C, U+200D, U+2060
 *
 * Tabs, newlines, and carriage returns are preserved.
 */
export function sanitizeToolText(s: string): string {
  // Single regex combining all categories:
  //   \uFEFF                 — BOM
  //   [\u0000-\u0008]        — C0: NUL … BS
  //   [\u000B\u000C]         — C0: VT, FF (tab=\t=U+0009, LF=\n=U+000A, CR=\r=U+000D are preserved)
  //   [\u000E-\u001F]        — C0: SO … US
  //   [\u0080-\u009F]        — C1 controls
  //   [\u200B-\u200D\u2060]  — zero-width chars
  return s.replace(
    /\uFEFF|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u0080-\u009F\u200B-\u200D\u2060]/g,
    '',
  )
}
