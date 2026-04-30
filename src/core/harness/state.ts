// src/core/harness/state.ts
import * as path from 'node:path'
import type { EventBus } from '../events/bus'
import type { HarnessState, HarnessStage, HarnessMode, TaskProfile, StageEntry } from './types'
import { canTransition as transitionCheck } from './transitions'
import { stageRequirement } from './matrix'
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
      taskProfile: null,
      currentStage: null,
      history: [],
      scratchpadPath: path.join(opts.home, '.nuka', 'harness', `${opts.sessionId}.md`),
      startedAt: Date.now(),
    }
  }

  async start(userMessage: string, deps: { runFork: (p: string) => Promise<{ text: string }> }): Promise<TaskProfile> {
    const { classifyTaskProfile } = await import('./classifier')
    this.state.taskProfile = await classifyTaskProfile({ userMessage, runFork: deps.runFork })
    this.appendScratchpad(`# Harness — ${this.state.sessionId}\n- Profile: ${this.state.taskProfile}\n- Mode: ${this.state.mode}\n`)
    return this.state.taskProfile
  }

  canTransition(to: HarnessStage): { ok: true } | { ok: false; reason: string } {
    if (!this.state.taskProfile) return { ok: false, reason: 'profile not classified yet' }
    if (this.state.currentStage === null) {
      if (stageRequirement(this.state.taskProfile, to) === 'forbidden') return { ok: false, reason: `forbidden by profile` }
      return { ok: true }
    }
    return transitionCheck({ from: this.state.currentStage, to, profile: this.state.taskProfile, mode: this.state.mode })
  }

  canExit(_nextStage: HarnessStage): { ok: true } | { ok: false; reason: string } {
    if (!this.state.currentStage) return { ok: true }
    const entry = this.state.history[this.state.history.length - 1]
    if (!entry) return { ok: true }
    if (['brainstorm', 'spec', 'plan'].includes(this.state.currentStage)) {
      const p = entry.primitivesSeen
      if (!p.sequentialThinking) return { ok: false, reason: 'missing primitive: sequential_thinking' }
      if (!p.searchAndVerify)    return { ok: false, reason: 'missing primitive: search_and_verify' }
      if (!p.askUser)            return { ok: false, reason: 'missing primitive: ask_user_question' }
    }
    return { ok: true }
  }

  async transition(to: HarnessStage, reason = 'completed'): Promise<void> {
    const r = this.canTransition(to)
    if (!r.ok) throw new Error(`refused: ${r.reason}`)
    if (this.state.currentStage) {
      const entry = this.state.history[this.state.history.length - 1]
      if (entry) { entry.exitedAt = Date.now(); entry.exitReason = reason as StageEntry['exitReason'] }
      this.bus.emit('harness', { type: 'harness.stage.exit', stage: this.state.currentStage, sessionId: this.state.sessionId, reason })
    }
    this.state.currentStage = to
    this.state.history.push({
      stage: to, enteredAt: Date.now(), workersSpawned: [],
      primitivesSeen: { sequentialThinking: false, searchAndVerify: false, askUser: false },
    })
    this.bus.emit('harness', { type: 'harness.stage.enter', stage: to, sessionId: this.state.sessionId })
    this.appendScratchpad(`\n## ▶ ${to} (${new Date().toISOString()})\n`)
  }

  recordPrimitive(name: 'sequentialThinking' | 'searchAndVerify' | 'askUser'): void {
    const entry = this.state.history[this.state.history.length - 1]
    if (entry) entry.primitivesSeen[name] = true
  }

  snapshot(): HarnessState { return JSON.parse(JSON.stringify(this.state)) as HarnessState }

  setMode(mode: HarnessMode): void { this.state.mode = mode }

  private appendScratchpad(chunk: string): void {
    const cur = readScratchpad(this.state.scratchpadPath)
    const next = truncateToCap(cur + chunk, this.capBytes)
    writeScratchpad(this.state.scratchpadPath, next)
  }

  async flushScratchpad(): Promise<void> { /* no-op — append already flushes */ }
}
