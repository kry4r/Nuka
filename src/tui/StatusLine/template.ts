// src/tui/StatusLine/template.ts
// Phase 10 §4.5 — statusline template substitution.
//
// Supported tokens: {provider}, {model}, {ctxPct}, {cost}, {plugins}, {tasks}, {branch}

export type StatusLineCtx = {
  provider: string
  model: string
  /** 0–100 */
  ctxPct: number
  /** USD cost, e.g. 0.0042 */
  cost: number
  /** Number of plugins loaded */
  plugins: number
  /** Number of running tasks */
  tasks: number
  /** Current git branch or null */
  branch: string | null
}

const DEFAULT_FORMAT = '{provider}/{model} · ctx {ctxPct}% · ${cost}'

/**
 * Substitute template tokens in `fmt` using values from `ctx`.
 * Unknown tokens are left as-is.
 */
export function template(fmt: string | undefined, ctx: StatusLineCtx): string {
  const f = fmt ?? DEFAULT_FORMAT
  return f
    .replace(/\{provider\}/g, ctx.provider)
    .replace(/\{model\}/g, ctx.model)
    .replace(/\{ctxPct\}/g, ctx.ctxPct.toFixed(1))
    .replace(/\{cost\}/g, ctx.cost.toFixed(4))
    .replace(/\{plugins\}/g, String(ctx.plugins))
    .replace(/\{tasks\}/g, String(ctx.tasks))
    .replace(/\{branch\}/g, ctx.branch ?? '—')
}

export { DEFAULT_FORMAT }
