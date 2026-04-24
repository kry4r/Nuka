// Utilities for bounding MCP result sizes so a runaway tool call cannot
// blow up the agent's context window.

export const MAX_MCP_DESCRIPTION_CHARS = 2048

/**
 * Joins a list of string parts with newlines, truncating the combined text to
 * `maxChars`. When truncation occurs, a human-readable notice of the form
 * `"...[truncated NNN chars of MMM]..."` is appended to the kept portion.
 *
 * The returned `text` is guaranteed to fit within
 * `maxChars + <notice length>` — the notice itself is not counted against
 * the budget so the last fragment stays coherent.
 */
export function truncateMcpResult(
  parts: string[],
  maxChars: number,
): { text: string; truncated: boolean; originalLength: number } {
  const joined = parts.join('\n')
  const originalLength = joined.length
  if (originalLength <= maxChars) {
    return { text: joined, truncated: false, originalLength }
  }
  const kept = joined.slice(0, maxChars)
  const dropped = originalLength - maxChars
  const notice = `...[truncated ${dropped} chars of ${originalLength}]...`
  return { text: `${kept}${notice}`, truncated: true, originalLength }
}

/**
 * Truncate a tool / server description to `MAX_MCP_DESCRIPTION_CHARS`,
 * appending an ellipsis when clipping occurs. Used to keep MCP-supplied
 * descriptions from drowning the model's tool list.
 */
export function truncateDescription(
  s: string,
  max: number = MAX_MCP_DESCRIPTION_CHARS,
): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}
