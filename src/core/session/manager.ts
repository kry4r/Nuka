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

  /**
   * Phase 8 §4.3 — Truncate the active (or specified) session's transcript
   * at `messageId` inclusive. The selected message and everything after it
   * are dropped. If the session is backed by a store, the messages file is
   * rewritten atomically and a meta write is scheduled.
   *
   * Returns the number of messages removed. Throws when `messageId` is not
   * in the session (callers can catch and surface a user-friendly error).
   */
  async truncateAfter(messageId: string, sessionId?: string): Promise<number> {
    const target = sessionId
      ? this.sessions.find(s => s.id === sessionId)
      : this.active()
    if (!target) throw new Error('no active session to truncate')
    const idx = target.messages.findIndex(m =>
      (m.role === 'user' || m.role === 'assistant' || m.role === 'tool') && m.id === messageId,
    )
    if (idx < 0) throw new Error(`message not in session: ${messageId}`)
    const removed = target.messages.length - idx
    target.messages = target.messages.slice(0, idx)
    target.updatedAt = Date.now()
    if (this.store) {
      await this.store.rewriteMessages(target.id, target.messages)
    }
    this.metaWriter?.schedule(target)
    return removed
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
