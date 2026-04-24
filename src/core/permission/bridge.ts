// src/core/permission/bridge.ts
import type { PermissionCall, PermissionDecision } from './types'
import type { ElicitationPayload, ElicitationResult } from '../mcp/elicitation'

export type PermissionPayload = {
  call: PermissionCall
  suggestedPattern?: string
}

export type PermissionHandler = (
  payload: PermissionPayload,
  resolve: (d: PermissionDecision) => void,
) => void

export type ElicitationHandler = (
  payload: ElicitationPayload,
  resolve: (r: ElicitationResult) => void,
) => void

export class PermissionBridge {
  private handler: PermissionHandler | null = null
  private elicitationHandler: ElicitationHandler | null = null

  setHandler(h: PermissionHandler | null): void {
    this.handler = h
  }

  setElicitationHandler(h: ElicitationHandler | null): void {
    this.elicitationHandler = h
  }

  ask(payload: PermissionPayload): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      if (!this.handler) {
        resolve({ allowed: false, reason: 'no permission UI attached' })
        return
      }
      this.handler(payload, resolve)
    })
  }

  /**
   * Open an elicitation dialog. Resolves with the user's choice.
   * When no elicitation UI is attached, this resolves with
   * `{ action: 'decline' }` so the server gets a clean signal instead of
   * hanging.
   */
  elicit(payload: ElicitationPayload): Promise<ElicitationResult> {
    return new Promise<ElicitationResult>((resolve) => {
      if (!this.elicitationHandler) {
        resolve({ action: 'decline' })
        return
      }
      this.elicitationHandler(payload, resolve)
    })
  }
}
