// src/core/harness/transitions.ts
import type { HarnessStage, HarnessMode, TaskProfile } from './types'
import { stageRequirement } from './matrix'

const TRANSITIONS: Record<HarnessStage, HarnessStage[]> = {
  brainstorm: ['spec', 'plan', 'search'],
  spec:       ['plan', 'search', 'brainstorm'],
  plan:       ['search', 'implement', 'spec'],
  search:     ['implement', 'plan', 'recap'],
  implement:  ['review', 'search', 'plan'],
  review:     ['recap', 'implement'],
  recap:      [],
}

export type CanTransitionOpts = {
  from: HarnessStage
  to: HarnessStage
  profile: TaskProfile
  mode: HarnessMode
}

export function canTransition(opts: CanTransitionOpts): { ok: true } | { ok: false; reason: string } {
  if (opts.mode === 'off') return { ok: true }
  if (stageRequirement(opts.profile, opts.to) === 'forbidden') {
    return { ok: false, reason: `stage "${opts.to}" forbidden for profile "${opts.profile}"` }
  }
  // Fast mode skips brainstorm + spec mandates
  if (opts.mode === 'fast' && (opts.to === 'brainstorm' || opts.to === 'spec')) {
    return { ok: false, reason: `fast-path: stage "${opts.to}" is bypassed` }
  }
  // Allow extra edges in fast mode (brainstorm → search, spec → implement)
  if (opts.mode === 'fast') {
    const fastEdges: Array<[HarnessStage, HarnessStage]> = [['brainstorm', 'search'], ['spec', 'implement'], ['plan', 'implement']]
    if (fastEdges.some(([a, b]) => a === opts.from && b === opts.to)) return { ok: true }
  }
  if (TRANSITIONS[opts.from].includes(opts.to)) return { ok: true }
  return { ok: false, reason: `no edge ${opts.from} → ${opts.to}` }
}
