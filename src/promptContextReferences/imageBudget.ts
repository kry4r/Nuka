// src/promptContextReferences/imageBudget.ts
//
// Per-image byte-size cap for the prompt-mention transport. Local-path and
// clipboard images are read by the resolver and base64-encoded before this
// helper looks at them; we enforce the cap on the *decoded* byte length
// (not the encoded base64 string) so the budget matches what the provider
// actually sees.
//
// Opt-in env override `NUKA_PROMPT_IMAGE_MAX_BYTES`:
//   - unset / non-numeric / <= 0  → 5 MiB (default)
//   - positive integer            → that exact byte count
//
// 5 MiB matches the spec ceilings of major hosted providers and is large
// enough for screenshots / photo dumps without blowing the per-message
// payload limit.

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

/** Resolve the per-image byte cap, with `NUKA_PROMPT_IMAGE_MAX_BYTES` opt-in. */
export function getImageMaxBytes(): number {
  const raw = process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
  if (raw === undefined) return DEFAULT_MAX_BYTES
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BYTES
  return parsed
}

/**
 * Compute the decoded byte length of a base64 string without actually
 * decoding it. The standard formula: `floor(len * 3 / 4) - paddingCount`.
 */
export function base64Bytes(b64: string): number {
  if (b64.length === 0) return 0
  let padding = 0
  if (b64.endsWith('==')) padding = 2
  else if (b64.endsWith('=')) padding = 1
  return Math.floor((b64.length * 3) / 4) - padding
}
