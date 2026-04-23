// src/core/session/manager.ts
import type { Session } from './types'
import { createSession, branchSession } from './session'

export class SessionManager {
  private sessions: Session[] = []
  private activeId: string | undefined

  start(opts: { providerId: string; model: string }): Session {
    const s = createSession(opts)
    this.sessions.push(s)
    this.activeId = s.id
    return s
  }

  new(): Session {
    const base = this.active()
    const s = createSession({
      providerId: base?.providerId ?? '',
      model: base?.model ?? '',
    })
    this.sessions.push(s)
    this.activeId = s.id
    return s
  }

  branch(): Session {
    const base = this.active()
    if (!base) throw new Error('no active session to branch from')
    const forked = branchSession(base)
    this.sessions.push(forked)
    this.activeId = forked.id
    return forked
  }

  switch(id: string): Session {
    const s = this.sessions.find(x => x.id === id)
    if (!s) throw new Error(`unknown session: ${id}`)
    this.activeId = id
    return s
  }

  active(): Session | undefined {
    return this.sessions.find(s => s.id === this.activeId)
  }

  list(): Session[] {
    return [...this.sessions]
  }
}
