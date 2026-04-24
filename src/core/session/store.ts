// src/core/session/store.ts
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Session } from './types'
import type { Message } from '../message/types'

export type SessionMeta = {
  id: string
  parentId?: string
  providerId: string
  model: string
  messageCount: number
  totalUsage: { inputTokens: number; outputTokens: number }
  mode: Session['mode']
  createdAt: number
  updatedAt: number
}

export class SessionStore {
  private dir: string
  private dirEnsured = false

  constructor(opts: { dir: string }) {
    this.dir = opts.dir
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return
    await fs.mkdir(this.dir, { recursive: true })
    this.dirEnsured = true
  }

  private msgPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.jsonl`)
  }

  private metaPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.meta.json`)
  }

  private metaTmpPath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.meta.json.tmp`)
  }

  async appendMessage(sessionId: string, msg: Message): Promise<void> {
    await this.ensureDir()
    await fs.appendFile(this.msgPath(sessionId), JSON.stringify(msg) + '\n', 'utf8')
  }

  async writeMeta(session: Session): Promise<void> {
    await this.ensureDir()
    const meta: SessionMeta = {
      id: session.id,
      parentId: session.parentId,
      providerId: session.providerId,
      model: session.model,
      messageCount: session.messages.length,
      totalUsage: {
        inputTokens: session.totalUsage.inputTokens,
        outputTokens: session.totalUsage.outputTokens,
      },
      mode: session.mode,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
    const tmp = this.metaTmpPath(session.id)
    await fs.writeFile(tmp, JSON.stringify(meta), 'utf8')
    await fs.rename(tmp, this.metaPath(session.id))
  }

  async readMessages(sessionId: string): Promise<Message[]> {
    let text: string
    try {
      text = await fs.readFile(this.msgPath(sessionId), 'utf8')
    } catch {
      return []
    }
    const messages: Message[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        messages.push(JSON.parse(trimmed) as Message)
      } catch {
        // skip malformed lines
      }
    }
    return messages
  }

  async readMeta(sessionId: string): Promise<SessionMeta | null> {
    try {
      const text = await fs.readFile(this.metaPath(sessionId), 'utf8')
      return JSON.parse(text) as SessionMeta
    } catch {
      return null
    }
  }

  async list(): Promise<SessionMeta[]> {
    let entries: string[]
    try {
      const dirents = await fs.readdir(this.dir)
      entries = dirents.filter(f => f.endsWith('.meta.json'))
    } catch {
      return []
    }
    const metas: SessionMeta[] = []
    for (const entry of entries) {
      try {
        const text = await fs.readFile(path.join(this.dir, entry), 'utf8')
        metas.push(JSON.parse(text) as SessionMeta)
      } catch {
        console.warn(`[SessionStore] skipping malformed meta file: ${entry}`)
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async delete(sessionId: string): Promise<void> {
    await Promise.all([
      fs.unlink(this.msgPath(sessionId)).catch(() => undefined),
      fs.unlink(this.metaPath(sessionId)).catch(() => undefined),
    ])
  }
}

export class DebouncedMetaWriter {
  private store: SessionStore
  private delayMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Session | undefined

  constructor(store: SessionStore, delayMs = 250) {
    this.store = store
    this.delayMs = delayMs
  }

  schedule(session: Session): void {
    this.pending = session
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      const s = this.pending
      this.pending = undefined
      if (s) this.store.writeMeta(s).catch(err => console.warn('[DebouncedMetaWriter]', err))
    }, this.delayMs)
  }

  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.pending) {
      const s = this.pending
      this.pending = undefined
      await this.store.writeMeta(s)
    }
  }
}
