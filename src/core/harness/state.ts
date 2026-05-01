import * as path from 'node:path'
import type { EventBus } from '../events/bus'
import type { HarnessState, HarnessStage, HarnessMode, Triage, StageEntry } from './types'
import { canTransition as transitionCheck } from './transitions'
import { effectiveStageRequirement } from './matrix'
import { readScratchpad, writeScratchpad, truncateToCap } from './scratchpad'

export type HarnessStateMachineOpts = {
  sessionId: string
  bus: EventBus
  home: string
  mode?: HarnessMode
  scratchpadKB?: number
}

export class HarnessStateMachine {
  private state: HarnessState
  private bus: EventBus
  private capBytes: number

  constructor(opts: HarnessStateMachineOpts) {
    this.bus = opts.bus
    this.capBytes = (opts.scratchpadKB ?? 50) * 1024
    this.state = {
      sessionId: opts.sessionId,
      mode: opts.mode ?? 'deep',
      triage: null,
      currentStage: null,
      history: [],
      scratchpadPath: path.join(opts.home, '.nuka', 'harness', `${opts.sessionId}.md`),
      taskGraphPath: path.join(opts.home, '.nuka', 'coordination', `${opts.sessionId}.json`),
      startedAt: Date.now(),
    }
  }

  /**
   * Bootstrap the harness from a fresh user message:
   * - Run triage (LLM fork classifier — at this checkpoint still uses the legacy
   *   single-axis classifier; T2.1/T2.2 will replace this with the full three-axis
   *   triage + ask_user confirmation flow).
   * - Persist the triage on state.
   * - Append header to scratchpad.
   */
  async start(
    userMessage: string,
    deps: { runFork: (p: string) => Promise<{ text: string }> },
  ): Promise<Triage> {
    const { classifyTaskProfile } = await import('./classifier')
    const profile = await classifyTaskProfile({ userMessage, runFork: deps.runFork })
    const triage: Triage = {
      profile,
      difficulty: 'medium',
      testStrategy: 'tdd',
      reasoning: 'legacy classifier output; difficulty/testStrategy use defaults until T2.1',
      userConfirmed: false,
    }
    this.state.triage = triage
    this.appendScratchpad(
      `# Harness — ${this.state.sessionId}\n` +
        `- Profile:      ${triage.profile}\n` +
        `- Difficulty:   ${triage.difficulty}\n` +
        `- TestStrategy: ${triage.testStrategy}\n` +
        `- Mode:         ${this.state.mode}\n` +
        `- Reasoning:    ${triage.reasoning}\n`,
    )
    return triage
  }

  /** Override the current triage (used by /harness retriage and tests). */
  setTriage(triage: Triage): void {
    this.state.triage = triage
  }

  canTransition(to: HarnessStage): { ok: true } | { ok: false; reason: string } {
    const triage = this.state.triage
    if (!triage) return { ok: false, reason: 'triage not classified yet' }
    if (this.state.currentStage === null) {
      if (effectiveStageRequirement(triage.profile, triage.difficulty, to) === 'forbidden') {
        return { ok: false, reason: `forbidden by profile×difficulty` }
      }
      return { ok: true }
    }
    return transitionCheck({
      from: this.state.currentStage,
      to,
      profile: triage.profile,
      difficulty: triage.difficulty,
      mode: this.state.mode,
    })
  }

  canExit(_nextStage: HarnessStage): { ok: true } | { ok: false; reason: string } {
    if (!this.state.currentStage) return { ok: true }
    const entry = this.state.history[this.state.history.length - 1]
    if (!entry) return { ok: true }
    if (['brainstorm', 'spec', 'plan'].includes(this.state.currentStage)) {
      const p = entry.primitivesSeen
      if (!p.sequentialThinking) return { ok: false, reason: 'missing primitive: sequential_thinking' }
      if (!p.searchAndVerify) return { ok: false, reason: 'missing primitive: search_and_verify' }
      if (!p.askUser) return { ok: false, reason: 'missing primitive: ask_user_question' }
    }
    return { ok: true }
  }

  async transition(to: HarnessStage, reason = 'completed'): Promise<void> {
    const r = this.canTransition(to)
    if (!r.ok) throw new Error(`refused: ${(r as { ok: false; reason: string }).reason}`)
    if (this.state.currentStage) {
      const entry = this.state.history[this.state.history.length - 1]
      if (entry) {
        entry.exitedAt = Date.now()
        entry.exitReason = reason as StageEntry['exitReason']
      }
      this.bus.emit('harness', {
        type: 'harness.stage.exit',
        stage: this.state.currentStage,
        sessionId: this.state.sessionId,
        reason,
      })
    }
    this.state.currentStage = to
    this.state.history.push({
      stage: to,
      enteredAt: Date.now(),
      workersSpawned: [],
      primitivesSeen: { sequentialThinking: false, searchAndVerify: false, askUser: false },
    })
    this.bus.emit('harness', { type: 'harness.stage.enter', stage: to, sessionId: this.state.sessionId })
    this.appendScratchpad(`\n## ▶ ${to} (${new Date().toISOString()})\n`)
  }

  recordPrimitive(name: 'sequentialThinking' | 'searchAndVerify' | 'askUser'): void {
    const entry = this.state.history[this.state.history.length - 1]
    if (entry) entry.primitivesSeen[name] = true
  }

  snapshot(): HarnessState {
    return JSON.parse(JSON.stringify(this.state)) as HarnessState
  }

  setMode(mode: HarnessMode): void {
    this.state.mode = mode
  }

  private appendScratchpad(chunk: string): void {
    const cur = readScratchpad(this.state.scratchpadPath)
    const next = truncateToCap(cur + chunk, this.capBytes)
    writeScratchpad(this.state.scratchpadPath, next)
  }

  async flushScratchpad(): Promise<void> {
    /* no-op — append already flushes */
  }
}
