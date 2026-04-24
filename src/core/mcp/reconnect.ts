// Exponential-backoff reconnect helper for MCP clients.
//
// Used both by the `onclose`-driven reconnect flow and by explicit retries
// after session-expiry errors (see `isSessionExpiryError`).

export type ReconnectPolicy = {
  /** Maximum number of connect attempts before giving up. */
  maxAttempts: number
  /** Initial backoff delay in milliseconds. */
  baseDelayMs: number
  /** Cap on the computed delay for any single attempt. */
  maxDelayMs: number
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
}

/**
 * Exponential backoff: `min(maxDelay, baseDelay * 2^(attempt-1))`.
 * `attempt` is 1-indexed (attempt 1 → baseDelay).
 */
export function nextDelay(attempt: number, policy: ReconnectPolicy): number {
  if (attempt < 1) return 0
  const raw = policy.baseDelayMs * 2 ** (attempt - 1)
  return Math.min(policy.maxDelayMs, raw)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve()
    }, ms)
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer)
        reject(new Error('aborted'))
        return
      }
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          reject(new Error('aborted'))
        },
        { once: true },
      )
    }
  })
}

/**
 * Call `doConnect` up to `policy.maxAttempts` times, sleeping for
 * `nextDelay(attempt, policy)` between attempts. Resolves `{ ok: true }` on
 * the first successful attempt, or `{ ok: false, error, attempts }` after
 * exhausting all attempts (or on abort).
 */
export async function reconnectWithBackoff(
  doConnect: () => Promise<void>,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; error: string; attempts: number }> {
  let lastError: string = 'unknown'
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal?.aborted) {
      return { ok: false, error: 'aborted', attempts: attempt - 1 }
    }
    if (attempt > 1) {
      try {
        await sleep(nextDelay(attempt - 1, policy), signal)
      } catch {
        return { ok: false, error: 'aborted', attempts: attempt - 1 }
      }
    }
    try {
      await doConnect()
      return { ok: true }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  return { ok: false, error: lastError, attempts: policy.maxAttempts }
}

/**
 * Detect the session-expiry-style errors a server may emit in place of (or
 * in addition to) a transport `onclose`. Currently:
 *
 * - HTTP 404 (streamable-HTTP sessions are 404'd after TTL)
 * - JSON-RPC error code -32001 (custom session-expired signal used by
 *   some server implementations)
 *
 * Both are handled by the same `onclose`-driven reconnect flow in the
 * McpClient.
 */
export function isSessionExpiryError(err: unknown): boolean {
  if (!err) return false
  const msg = err instanceof Error ? err.message : String(err)
  if (/\b404\b/.test(msg)) return true
  if (/-32001/.test(msg)) return true
  const maybeCode = (err as { code?: number }).code
  if (typeof maybeCode === 'number' && maybeCode === -32001) return true
  return false
}
