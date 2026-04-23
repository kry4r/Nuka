// src/core/permission/bridge.ts
import type { PermissionCall, PermissionDecision } from './types'

export type PermissionPayload = {
  call: PermissionCall
  suggestedPattern?: string
}

export type PermissionHandler = (
  payload: PermissionPayload,
  resolve: (d: PermissionDecision) => void,
) => void

export class PermissionBridge {
  private handler: PermissionHandler | null = null

  setHandler(h: PermissionHandler | null): void {
    this.handler = h
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
}
