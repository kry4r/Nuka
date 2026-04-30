// src/core/recap/builder.ts — Phase 14c §6.2
import type { RecapDoc, RecapScope } from './types'
import { reduceCompleted }    from './fields/completed'
import { reduceInFlight }     from './fields/inFlight'
import { reduceFileDiffs }    from './fields/fileDiffs'
import { reduceToolTimeline } from './fields/toolTimeline'
import { reduceMessages }     from './fields/messages'
import { reducePipelines }    from './fields/pipelines'
import { reduceTokens }       from './fields/tokens'
import { reduceKeyDecisions } from './fields/keyDecisions'
import { reduceNextStep }     from './fields/nextStep'

type Rec = { topic: string; payload: any; t?: number }

export async function buildRecap(opts: {
  sessionId: string
  scope: RecapScope
  events: Rec[]
  session: { messages: unknown[] }
  runFork: (prompt: string) => Promise<{ text: string }>
}): Promise<RecapDoc> {
  return {
    session: opts.sessionId,
    generatedAt: Date.now(),
    scope: opts.scope,
    fields: {
      completed:    reduceCompleted(opts.events),
      inFlight:     reduceInFlight(opts.events),
      fileDiffs:    reduceFileDiffs(opts.events),
      toolTimeline: reduceToolTimeline(opts.events),
      messages:     reduceMessages(opts.events),
      pipelines:    reducePipelines(opts.events),
      tokens:       reduceTokens(opts.events),
      keyDecisions: reduceKeyDecisions(opts.events),
      nextStep:     await reduceNextStep({ events: opts.events, session: opts.session, runFork: opts.runFork }),
    },
  }
}
