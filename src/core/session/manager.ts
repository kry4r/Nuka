// src/core/session/manager.ts
import type { Session } from './types'
import type { Message } from '../message/types'
import { createSession, branchSession } from './session'
import type { SessionStore, DebouncedMetaWriter, SessionMeta } from './store'
import { PermissionCache } from '../permission/cache'
import { MessageQueue } from './queue'

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

  async resume(id: string): Promise<Session> {
    if (!this.store) throw new Error('no store — session resume unavailable')
    const meta = await this.store.readMeta(id)
    if (!meta) throw new Error(`unknown session: ${id}`)
    const messages = await this.store.readMessages(id)
    const s: Session = {
      id: meta.id,
      parentId: meta.parentId,
      providerId: meta.providerId,
      model: meta.model,
      messages,
      totalUsage: { ...meta.totalUsage },
      permissionCache: new PermissionCache(),
      queue: new MessageQueue(),
      mode: meta.mode,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      unDeferredToolNames: new Set(),
    }
    this.sessions.push(s)
    this.activeId = s.id
    return s
  }

  async listPersisted(): Promise<SessionMeta[]> {
    if (!this.store) return []
    return this.store.list()
  }

  async delete(id: string): Promise<void> {
    if (this.store) await this.store.delete(id)
    this.sessions = this.sessions.filter(s => s.id !== id)
    if (this.activeId === id) this.activeId = undefined
  }
}
