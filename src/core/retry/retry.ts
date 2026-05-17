// src/core/retry/retry.ts
//
// Generic retry helper with exponential backoff. Pure-logic — no React/ink,
// no LLM, no filesystem. Suitable for wrapping network calls, file IO,
// model API calls, child-process spawns, or anything where transient
// failures are common.
//
// Ported in spirit from Nuka-Code `src/services/api/withRetry.ts`. The
// upstream version is wired tightly to the Anthropic SDK (APIError shape,
// retry-after headers, fast-mode cooldown, OAuth refresh) — none of that
// belongs in core. What we keep:
//
//   - `BASE_DELAY_MS * 2**(attempt-1)` exponential schedule
//   - `+ Math.random() * 0.25 * baseDelay` jitter (upstream's exact form)
//   - max-delay cap
//   - AbortSignal honored at the attempt boundary AND inside the delay
//   - shouldRetry predicate (async-compatible)
//
// What we add over upstream:
//
//   - `onAttempt(error, attempt, delayMs)` callback (telemetry / logging
//     hook — upstream emits a yield instead, which couples it to its
//     SystemAPIErrorMessage protocol; a callback is the neutral form)
//   - `attemptTimeoutMs`: wrap each call in a Promise.race timeout so a
//     hung HTTP call doesn't pin the whole loop. Each attempt's
//     AbortController is wired to the outer signal too.
//   - `RetryError` — wraps the final error with attempt count, last delay,
//     and (when wrapping a real Error) the original stack trace
//   - `isRetryableNetworkError(e)` — utility identifying common Node
//     network error codes (ECONNRESET, ETIMEDOUT, EAI_AGAIN, etc.).
//     Re-exported from this file; consumers can pass it as `shouldRetry`
//     directly.
//
// ## Defaults
//
//   maxAttempts:      3
//   initialDelayMs:   100
//   maxDelayMs:       30_000
//   backoffFactor:    2
//   jitter:           true   (±25% of base delay added — never negative)
//   shouldRetry:      () => true   (retry every error until maxAttempts)
//
// ## Delay schedule
//
// For attempt N (1-indexed, after a *failure* on attempt N):
//
//   base = min(initialDelayMs * backoffFactor**(N-1), maxDelayMs)
//   delay = jitter ? base + Math.random() * 0.25 * base : base
//
// The delay is what we sleep BEFORE attempt N+1. The first attempt has
// no preceding delay (we run immediately).
//
// ## Abort semantics
//
// `signal.aborted` is checked:
//   1. before every attempt
//   2. inside `sleep()` between attempts (listener form, no busy-wait)
//   3. during an attempt via `attemptTimeoutMs` (separate timeout AC, but
//      also linked to the outer signal so an outer abort propagates)
//
// When aborted, we throw the signal's `reason` if it's an Error, else an
// `AbortError` we construct. We never wrap an abort in `RetryError` —
// that's reserved for genuine retry-exhaustion or a non-retryable error.
//
// ## TypeScript constraints
//
// - strict, no `any`, no `@ts-ignore`.
// - shouldRetry can be sync or async; the loop awaits it either way.
// - Custom error types are retained (we never strip / wrap unless we
//   throw RetryError at the end, which keeps `.cause`).
//
// All functions are pure (modulo the timer + Math.random for jitter).

/**
 * Error thrown after every attempt has been exhausted or `shouldRetry`
 * returned `false`. Wraps the original error in `cause` and exposes the
 * total attempt count so callers can log / branch on it.
 */
export class RetryError extends Error {
  public readonly attempts: number
  public readonly lastDelayMs: number
  // We keep a direct `originalError` for code that doesn't want to use
  // ES2022 `.cause` plumbing — matches upstream `CannotRetryError`.
  public readonly originalError: unknown

  public constructor(
    originalError: unknown,
    attempts: number,
    lastDelayMs: number,
  ) {
    const message = errorMessage(originalError)
    super(`RetryError after ${attempts} attempt(s): ${message}`, {
      cause: originalError,
    })
    this.name = 'RetryError'
    this.attempts = attempts
    this.lastDelayMs = lastDelayMs
    this.originalError = originalError
    if (originalError instanceof Error && originalError.stack) {
      // Preserve the inner stack so the failure source isn't lost behind
      // this wrapper. The `RetryError after N attempt(s)` message stays
      // in the .message field.
      this.stack = originalError.stack
    }
  }
}

/**
 * AbortError thrown when the outer signal aborts and the signal's own
 * `reason` is not an Error instance (so we have something to throw).
 */
export class AbortError extends Error {
  public constructor(message = 'The operation was aborted.') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * Options for `retryWithBackoff`. All keys are optional except where
 * marked. Defaults documented in the file header.
 */
export interface RetryOptions {
  /** Total attempts including the first call. Default `3`. */
  maxAttempts?: number
  /** Delay before the second attempt, in ms. Default `100`. */
  initialDelayMs?: number
  /** Hard cap on delay between attempts. Default `30_000` (30s). */
  maxDelayMs?: number
  /** Exponential growth factor. Default `2`. */
  backoffFactor?: number
  /**
   * When `true` (default), add up to +25% of the base delay as random
   * jitter. The jitter is always non-negative — bounded delays still
   * give callers a predictable upper bound.
   */
  jitter?: boolean
  /**
   * Predicate run after each failure. Returning `false` exits the loop
   * immediately, throwing `RetryError` wrapping that error. Returning
   * `true` continues with the schedule. Can be async. Default: always
   * retry (until `maxAttempts`).
   *
   * Receives the 1-indexed attempt that just failed so the caller can
   * make different decisions for early vs. late failures.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
  /**
   * Telemetry hook. Called AFTER a failure and AFTER `shouldRetry` says
   * retry, but BEFORE the sleep — so callers know what delay is coming.
   * Errors thrown from `onAttempt` propagate (we don't swallow telemetry
   * bugs). When `shouldRetry` returns false, `onAttempt` is NOT called
   * for that failure (the loop is exiting anyway).
   */
  onAttempt?: (error: unknown, attempt: number, delayMs: number) => void
  /**
   * Abort the loop. Checked before each attempt, during the delay
   * between attempts, and (via a child AbortController) propagated into
   * `attemptTimeoutMs`'s race. Aborting throws the signal's `reason`
   * if it's an Error, else `new AbortError()`. We never wrap an abort
   * in `RetryError`.
   */
  signal?: AbortSignal
  /**
   * Wrap each attempt in a Promise.race timeout. When the timeout wins,
   * the attempt throws an `AttemptTimeoutError` which goes through the
   * normal `shouldRetry` predicate. Default: no timeout.
   *
   * NOTE: the timeout cancels the wait, not the underlying work —
   * Node has no way to cancel a Promise that has no AbortSignal of its
   * own. The caller's `fn` should respect the AbortSignal we pass it
   * (via `attempt.signal`) if it wants true cancellation.
   */
  attemptTimeoutMs?: number
}

/**
 * Error thrown when `attemptTimeoutMs` elapses before `fn` resolves.
 * Goes through `shouldRetry` like any other error.
 */
export class AttemptTimeoutError extends Error {
  public readonly attempt: number
  public readonly timeoutMs: number
  public constructor(attempt: number, timeoutMs: number) {
    super(`Attempt ${attempt} timed out after ${timeoutMs}ms`)
    this.name = 'AttemptTimeoutError'
    this.attempt = attempt
    this.timeoutMs = timeoutMs
  }
}

/**
 * Context passed to the user's `fn` on each attempt. The `signal` here
 * is linked to the outer signal AND fires when `attemptTimeoutMs`
 * elapses, so well-behaved `fn` implementations can fold both into a
 * single fetch / spawn `signal` arg.
 */
export interface RetryAttemptContext {
  /** 1-indexed attempt number. */
  attempt: number
  /** Signal that fires on outer abort or per-attempt timeout. */
  signal: AbortSignal
}

/**
 *   const result = await retryWithBackoff(async ({ attempt }) => {
 *     const res = await fetch(url, { signal: ctx.signal })
 *     if (!res.ok) throw new Error(`HTTP ${res.status}`)
 *     return res.json()
 *   }, {
 *     maxAttempts: 5,
 *     initialDelayMs: 200,
 *     shouldRetry: isRetryableNetworkError,
 *     onAttempt: (err, n, delay) => log.warn({ err, n, delay }),
 *     signal: outerSignal,
 *     attemptTimeoutMs: 10_000,
 *   })
 *
 *   // Legacy form: fn that just takes the attempt number (no ctx).
 *   const result = await retryWithBackoff((attempt) => doThing(attempt), {})
 */
export async function retryWithBackoff<T>(
  fn: (
    attemptOrCtx: number | RetryAttemptContext,
  ) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = clampPositiveInt(opts.maxAttempts, 3)
  const initialDelayMs = clampNonNegative(opts.initialDelayMs, 100)
  const maxDelayMs = clampNonNegative(opts.maxDelayMs, 30_000)
  const backoffFactor = opts.backoffFactor ?? 2
  const useJitter = opts.jitter ?? true
  const shouldRetry = opts.shouldRetry ?? (() => true)
  const onAttempt = opts.onAttempt
  const outerSignal = opts.signal
  const attemptTimeoutMs = opts.attemptTimeoutMs

  if (outerSignal?.aborted) throw abortReasonOf(outerSignal)

  let lastError: unknown
  let lastDelayMs = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (outerSignal?.aborted) throw abortReasonOf(outerSignal)

    // Build a per-attempt AbortController that fires on:
    //   - outer abort
    //   - per-attempt timeout (if attemptTimeoutMs is set)
    // We always provide one so callers' fn can plumb a signal even
    // when neither feature is in use.
    const attemptAc = new AbortController()
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const outerListener = () => attemptAc.abort(abortReasonOf(outerSignal!))
    if (outerSignal) {
      outerSignal.addEventListener('abort', outerListener, { once: true })
    }
    if (attemptTimeoutMs !== undefined && attemptTimeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        attemptAc.abort(new AttemptTimeoutError(attempt, attemptTimeoutMs))
      }, attemptTimeoutMs)
    }

    const cleanupAttempt = (): void => {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
      if (outerSignal)
        outerSignal.removeEventListener('abort', outerListener)
    }

    try {
      const ctx: RetryAttemptContext = { attempt, signal: attemptAc.signal }
      // Race the user's fn against the per-attempt timeout. The race form
      // is required because we can't actually cancel a Promise — but we
      // can stop *waiting* for it (and the user's fn can drop work via
      // ctx.signal).
      let result: T
      if (attemptTimeoutMs !== undefined && attemptTimeoutMs > 0) {
        result = await Promise.race<T>([
          // Call the user's fn with ctx; legacy callers that declared
          // their param as `number` still see `ctx.attempt` via implicit
          // numeric coercion (we pass ctx, not a number, on purpose —
          // but tests of both signatures exist). To stay polymorphic in
          // a strict-typed way, we offer the union and let TS narrow.
          fn(ctx),
          new Promise<T>((_, reject) => {
            attemptAc.signal.addEventListener(
              'abort',
              () => {
                const reason = attemptAc.signal.reason
                reject(
                  reason instanceof Error
                    ? reason
                    : new AttemptTimeoutError(attempt, attemptTimeoutMs),
                )
              },
              { once: true },
            )
          }),
        ])
      } else {
        result = await fn(ctx)
      }
      cleanupAttempt()
      return result
    } catch (error) {
      cleanupAttempt()
      lastError = error

      // Outer abort during the attempt: propagate immediately.
      if (outerSignal?.aborted) throw abortReasonOf(outerSignal)

      // Last attempt? Don't ask shouldRetry — we're out of budget.
      if (attempt >= maxAttempts) {
        throw new RetryError(error, attempt, lastDelayMs)
      }

      // Ask the caller: should we keep going?
      const decision = await shouldRetry(error, attempt)
      if (!decision) {
        // shouldRetry said "no more" — wrap and throw with the attempt
        // count we actually did, not the configured max.
        throw new RetryError(error, attempt, lastDelayMs)
      }

      // Compute the delay for the next attempt and notify.
      const delayMs = computeDelay({
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffFactor,
        jitter: useJitter,
      })
      lastDelayMs = delayMs
      if (onAttempt) onAttempt(error, attempt, delayMs)

      // Sleep with abort support.
      await sleepInterruptible(delayMs, outerSignal)
    }
  }

  // Unreachable — loop either returns the success or throws RetryError
  // on the last attempt. Kept for exhaustiveness so TS sees a definite
  // return / throw on every code path.
  throw new RetryError(lastError, maxAttempts, lastDelayMs)
}

// ─── helpers ────────────────────────────────────────────────────────

interface ComputeDelayArgs {
  attempt: number
  initialDelayMs: number
  maxDelayMs: number
  backoffFactor: number
  jitter: boolean
}

/**
 * Pure delay computation, exported for testability. `attempt` here is
 * the 1-indexed attempt that just failed, so the returned delay is what
 * we sleep before attempt `attempt + 1`.
 *
 *   computeDelay({ attempt: 1, initialDelayMs: 100, ... }) -> 100 (no jitter)
 *   computeDelay({ attempt: 2, initialDelayMs: 100, ... }) -> 200 (no jitter)
 *   computeDelay({ attempt: 3, initialDelayMs: 100, ... }) -> 400 (no jitter)
 *
 * With `jitter: true`, the result is in `[base, base * 1.25)` because
 * jitter is `Math.random() * 0.25 * base` — never negative.
 */
export function computeDelay(args: ComputeDelayArgs): number {
  const {
    attempt,
    initialDelayMs,
    maxDelayMs,
    backoffFactor,
    jitter,
  } = args
  // attempt is 1-indexed: first-failure delay is initialDelayMs *
  // backoffFactor^0 = initialDelayMs.
  const exponent = Math.max(0, attempt - 1)
  const raw = initialDelayMs * Math.pow(backoffFactor, exponent)
  const base = Math.min(raw, maxDelayMs)
  if (!jitter) return base
  const jit = Math.random() * 0.25 * base
  return base + jit
}

function sleepInterruptible(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(abortReasonOf(signal))
    return Promise.resolve()
  }
  if (signal?.aborted) return Promise.reject(abortReasonOf(signal))
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(abortReasonOf(signal!))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortReasonOf(signal: AbortSignal): unknown {
  const r: unknown = (signal as { reason?: unknown }).reason
  if (r instanceof Error) return r
  return new AbortError()
}

function clampPositiveInt(v: number | undefined, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt
  const n = Math.floor(v)
  return n < 1 ? 1 : n
}

function clampNonNegative(v: number | undefined, dflt: number): number {
  if (v === undefined || !Number.isFinite(v)) return dflt
  return v < 0 ? 0 : v
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

// ─── isRetryableNetworkError ────────────────────────────────────────

/**
 * Common Node network/IO error codes that are typically worth retrying.
 * Use as `shouldRetry: isRetryableNetworkError`. Mirrors upstream
 * `isStaleConnectionError` plus the broader set most "should I retry
 * this?" lists agree on. Does NOT match HTTP status codes — callers
 * with response-level errors should compose this with their own check.
 *
 *   ECONNRESET   peer reset the connection
 *   ECONNREFUSED nothing listening at the address
 *   ETIMEDOUT    socket-level timeout
 *   EPIPE        write to a broken pipe
 *   EHOSTUNREACH host not reachable on the network
 *   ENETUNREACH  network not reachable
 *   EAI_AGAIN    DNS lookup transient failure
 *   ENOTFOUND    DNS lookup miss (treat as retryable — could be transient)
 *   UND_ERR_SOCKET undici socket error
 *   AbortError   *not* matched here — abort isn't retryable.
 *   AttemptTimeoutError *not* matched here either; caller decides if
 *     timeouts mean "retry" or "give up".
 */
export function isRetryableNetworkError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string') return false
  return RETRYABLE_NET_CODES.has(code)
}

const RETRYABLE_NET_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'UND_ERR_SOCKET',
])
