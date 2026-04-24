// src/core/session/manager.ts
import type { Session } from './types'
import type { Message } from '../message/types'
import { createSession, branchSession } from './session'
import type { SessionStore, DebouncedMetaWriter } from './store'

export class SessionManager {
  private sessions: Session[] = []
  private activeId: string | undefined
  private store: SessionStore | undefined
  private metaWriter: DebouncedMetaWriter | undefined

  constructor(opts?: { store?: SessionStore; metaWriter?: DebouncedMetaWriter }) {
    this.store = opts?.store
    this.metaWriter = opts?.metaWriter
  }

  start(opts: { providerId: string; model: string }): Session {
    const s = createSession(opts)
    this.sessions.push(s)
    this.activeId = s.id
    this.metaWriter?.schedule(s)
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
    this.metaWriter?.schedule(s)
    return s
  }

  branch(): Session {
    const base = this.active()
    if (!base) throw new Error('no active session to branch from')
    const forked = branchSession(base)
    this.sessions.push(forked)
    this.activeId = forked.id
    this.metaWriter?.schedule(forked)
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

  persist = (session: Session, msg: Message): void => {
    if (this.store) {
      this.store.appendMessage(session.id, msg).catch(err =>
        console.warn('[SessionManager] appendMessage failed:', err),
      )
    }
    this.metaWriter?.schedule(session)
  }
}
