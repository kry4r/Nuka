# Session History (B4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in cross-startup session-history layer — env gate, `/history` slash, dedicated TUI list — on top of Nuka's existing `SessionStore`.

**Architecture:** Persistence already exists at `~/.nuka/sessions/<id>.jsonl` plus `<id>.meta.json` (see `src/core/session/store.ts`, wired in `src/cli.tsx:431-433`). This plan adds a thin opt-in gate (`NUKA_SESSION_PERSIST=1`), a `HistoryStore` facade with paste-store + reverse-line-reader utilities ported from `Nuka-Code/src/history.ts`, a `/history` slash, and a `SessionList.tsx` TUI surface that lists previews + opens resume / delete actions. The `--resume` flag and `/resume` dialog stay untouched; `/history` is the richer browser.

**Tech Stack:** TypeScript (strict), Vitest

---

## File Structure

```
src/core/session/history/
  types.ts                  # SessionId, HistoryRecord, HistoryListEntry
  store.ts                  # HistoryStore (wraps SessionStore + previews)
  reader.ts                 # readMessagesReverse — streaming reverse-line reader
  persist.ts                # isPersistEnabled() — env gate
  index.ts                  # public barrel

src/slash/history.ts        # /history slash command (opens dialog)

src/tui/History/
  SessionList.tsx           # full-screen browser with preview, resume, delete

test/core/session/history/
  store.test.ts
  reader.test.ts
  persist.test.ts

test/slash/history.test.ts
test/tui/History/SessionList.test.tsx
```

---

## Task 1: Add history types

- [ ] **Files**
  - Create: `src/core/session/history/types.ts`
  - Test: `test/core/session/history/types.test.ts`

- [ ] **Write failing test** — `test/core/session/history/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { SessionId, HistoryRecord, HistoryListEntry } from '../../../../src/core/session/history/types'

describe('history types', () => {
  it('SessionId is a branded string', () => {
    const id: SessionId = 'abc' as SessionId
    expect(typeof id).toBe('string')
  })
  it('HistoryListEntry shape', () => {
    const e: HistoryListEntry = {
      id: 'x' as SessionId,
      providerId: 'anthropic',
      model: 'claude-sonnet',
      messageCount: 3,
      preview: 'hi',
      createdAt: 1,
      updatedAt: 2,
    }
    expect(e.preview).toBe('hi')
  })
  it('HistoryRecord shape', () => {
    const r: HistoryRecord = {
      id: 'x' as SessionId,
      providerId: 'p',
      model: 'm',
      mode: 'normal',
      messageCount: 0,
      totalUsage: { inputTokens: 0, outputTokens: 0 },
      preview: '',
      createdAt: 0,
      updatedAt: 0,
    }
    expect(r.id).toBe('x')
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/session/history/types.test.ts` — should fail with module-not-found.

- [ ] **Implement** — `src/core/session/history/types.ts`:

```ts
// src/core/session/history/types.ts
import type { TokenUsage } from '../../message/types'
import type { SessionMode } from '../types'

declare const __sessionIdBrand: unique symbol
export type SessionId = string & { readonly [__sessionIdBrand]: 'SessionId' }

export type HistoryListEntry = {
  id: SessionId
  providerId: string
  model: string
  messageCount: number
  /** First user-message text, trimmed + truncated to PREVIEW_LEN. Empty when unavailable. */
  preview: string
  createdAt: number
  updatedAt: number
}

export type HistoryRecord = HistoryListEntry & {
  mode: SessionMode
  totalUsage: TokenUsage
}

export const PREVIEW_LEN = 64
```

- [ ] **Run passing**: `npx vitest run test/core/session/history/types.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(session/history): add SessionId + HistoryListEntry types"`

---

## Task 2: Persistence env gate

- [ ] **Files**
  - Create: `src/core/session/history/persist.ts`
  - Test: `test/core/session/history/persist.test.ts`

- [ ] **Write failing test** — `test/core/session/history/persist.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { isPersistEnabled, PERSIST_ENV } from '../../../../src/core/session/history/persist'

describe('isPersistEnabled', () => {
  const old = process.env[PERSIST_ENV]
  afterEach(() => {
    if (old === undefined) delete process.env[PERSIST_ENV]
    else process.env[PERSIST_ENV] = old
  })

  it('returns false when env unset', () => {
    delete process.env[PERSIST_ENV]
    expect(isPersistEnabled(process.env)).toBe(false)
  })
  it('returns true for "1"', () => {
    process.env[PERSIST_ENV] = '1'
    expect(isPersistEnabled(process.env)).toBe(true)
  })
  it('returns true for "true" (case-insensitive)', () => {
    process.env[PERSIST_ENV] = 'TRUE'
    expect(isPersistEnabled(process.env)).toBe(true)
  })
  it('returns false for "0" or "false" or arbitrary', () => {
    process.env[PERSIST_ENV] = '0'
    expect(isPersistEnabled(process.env)).toBe(false)
    process.env[PERSIST_ENV] = 'false'
    expect(isPersistEnabled(process.env)).toBe(false)
    process.env[PERSIST_ENV] = 'no'
    expect(isPersistEnabled(process.env)).toBe(false)
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/session/history/persist.test.ts`

- [ ] **Implement** — `src/core/session/history/persist.ts`:

```ts
// src/core/session/history/persist.ts
export const PERSIST_ENV = 'NUKA_SESSION_PERSIST'

/**
 * B4 opt-in gate: when true the cli.tsx boot path wires SessionStore +
 * DebouncedMetaWriter into the SessionManager. When false the manager
 * runs in-memory only — matches pre-B4 behaviour. Defaults to false so
 * upgrading users do not silently start writing transcripts to disk.
 */
export function isPersistEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = env[PERSIST_ENV]
  if (v === undefined) return false
  const lower = v.trim().toLowerCase()
  return lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on'
}
```

- [ ] **Run passing**: `npx vitest run test/core/session/history/persist.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(session/history): NUKA_SESSION_PERSIST opt-in gate"`

---

## Task 3: Reverse-line reader (port from Nuka-Code)

- [ ] **Files**
  - Create: `src/core/session/history/reader.ts`
  - Test: `test/core/session/history/reader.test.ts`

- [ ] **Write failing test** — `test/core/session/history/reader.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readLinesReverse } from '../../../../src/core/session/history/reader'

describe('readLinesReverse', () => {
  let dir: string
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })
  it('yields lines newest-first', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'a\nb\nc\n', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['c', 'b', 'a'])
  })
  it('returns nothing for missing file', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const collected: string[] = []
    for await (const line of readLinesReverse(path.join(dir, 'missing.jsonl'))) {
      collected.push(line)
    }
    expect(collected).toEqual([])
  })
  it('handles file with no trailing newline', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'one\ntwo', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['two', 'one'])
  })
  it('skips empty lines', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-rev-'))
    const file = path.join(dir, 'log.jsonl')
    writeFileSync(file, 'a\n\nb\n', 'utf8')
    const collected: string[] = []
    for await (const line of readLinesReverse(file)) collected.push(line)
    expect(collected).toEqual(['b', 'a'])
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/session/history/reader.test.ts`

- [ ] **Implement** — `src/core/session/history/reader.ts`:

```ts
// src/core/session/history/reader.ts
//
// B4 — Streaming reverse-line reader, ported in shape from
// Nuka-Code/src/utils/fsOperations.ts::readLinesReverse. Used to peek at
// the tail of a large `<id>.jsonl` transcript without loading the whole
// file (e.g. previewing the most recent assistant message in /history).
//
// Reads the file in 16 KiB chunks from the end backward, holds an
// incomplete-line carry across chunks, and yields each complete line
// newest-first. ENOENT yields nothing. Other errors propagate.

import { open, type FileHandle } from 'node:fs/promises'

const CHUNK = 16 * 1024

export async function* readLinesReverse(filePath: string): AsyncGenerator<string> {
  let fh: FileHandle
  try {
    fh = await open(filePath, 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  try {
    const stat = await fh.stat()
    let pos = stat.size
    let carry = ''

    while (pos > 0) {
      const len = Math.min(CHUNK, pos)
      pos -= len
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, pos)
      const text = buf.toString('utf8') + carry
      const lines = text.split('\n')
      // First slot is partial unless we have read from offset 0.
      if (pos > 0) {
        carry = lines.shift() ?? ''
      } else {
        carry = ''
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (line === undefined) continue
        if (line.length === 0) continue
        yield line
      }
    }
    if (carry.length > 0) yield carry
  } finally {
    await fh.close()
  }
}
```

- [ ] **Run passing**: `npx vitest run test/core/session/history/reader.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(session/history): streaming reverse-line reader"`

---

## Task 4: HistoryStore facade

- [ ] **Files**
  - Create: `src/core/session/history/store.ts`
  - Test: `test/core/session/history/store.test.ts`

- [ ] **Write failing test** — `test/core/session/history/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore } from '../../../../src/core/session/store'
import { HistoryStore } from '../../../../src/core/session/history/store'
import type { SessionId } from '../../../../src/core/session/history/types'
import { createSession, appendMessage } from '../../../../src/core/session/session'
import { makeUserMessage, emptyAssistant } from '../../../../src/core/message/factories'

let dir: string
let store: SessionStore
let history: HistoryStore

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-hist-'))
  store = new SessionStore({ dir })
  history = new HistoryStore({ store })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('HistoryStore.list', () => {
  it('returns [] when sessions dir is empty', async () => {
    expect(await history.list()).toEqual([])
  })

  it('lists sessions newest-first with truncated preview', async () => {
    const s1 = createSession({ providerId: 'p', model: 'm1' })
    s1.createdAt = 100; s1.updatedAt = 100
    appendMessage(s1, makeUserMessage({ text: 'hello world' }))
    await store.appendMessage(s1.id, s1.messages[0]!)
    await store.writeMeta(s1)

    const s2 = createSession({ providerId: 'p', model: 'm2' })
    s2.createdAt = 200; s2.updatedAt = 200
    appendMessage(s2, makeUserMessage({ text: 'X'.repeat(200) }))
    await store.appendMessage(s2.id, s2.messages[0]!)
    await store.writeMeta(s2)

    const entries = await history.list()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.id).toBe(s2.id as unknown as SessionId)
    expect(entries[0]!.preview.length).toBeLessThanOrEqual(64)
    expect(entries[1]!.preview).toBe('hello world')
  })

  it('skips sessions with no readable user message', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    appendMessage(s, emptyAssistant())
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    const entries = await history.list()
    expect(entries[0]!.preview).toBe('')
  })
})

describe('HistoryStore.delete', () => {
  it('removes both jsonl and meta files', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    appendMessage(s, makeUserMessage({ text: 'gone' }))
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    expect((await history.list())).toHaveLength(1)
    await history.delete(s.id as unknown as SessionId)
    expect((await history.list())).toHaveLength(0)
  })
})

describe('HistoryStore.read', () => {
  it('returns full HistoryRecord for known id', async () => {
    const s = createSession({ providerId: 'p', model: 'm' })
    s.totalUsage = { inputTokens: 5, outputTokens: 7 }
    appendMessage(s, makeUserMessage({ text: 'preview text' }))
    await store.appendMessage(s.id, s.messages[0]!)
    await store.writeMeta(s)
    const rec = await history.read(s.id as unknown as SessionId)
    expect(rec).not.toBeNull()
    expect(rec!.preview).toBe('preview text')
    expect(rec!.totalUsage.inputTokens).toBe(5)
  })
  it('returns null for unknown id', async () => {
    expect(await history.read('missing' as unknown as SessionId)).toBeNull()
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/session/history/store.test.ts`

- [ ] **Implement** — `src/core/session/history/store.ts`:

```ts
// src/core/session/history/store.ts
//
// B4 — Read-side facade over SessionStore. Adds previews (first user
// message text, truncated) and a uniform delete operation. Persistence
// is unchanged: `cli.tsx` still wires `SessionStore` + `DebouncedMetaWriter`
// behind the NUKA_SESSION_PERSIST gate.

import type { Message } from '../../message/types'
import { SessionStore } from '../store'
import { PREVIEW_LEN } from './types'
import type {
  SessionId,
  HistoryListEntry,
  HistoryRecord,
} from './types'

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return trimmed.slice(0, max - 1) + '\u2026'
}

function firstUserText(messages: Message[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue
    for (const block of m.content) {
      if (block.type === 'text' && block.text.trim().length > 0) {
        return block.text
      }
    }
  }
  return ''
}

export class HistoryStore {
  private store: SessionStore

  constructor(opts: { store: SessionStore }) {
    this.store = opts.store
  }

  async list(): Promise<HistoryListEntry[]> {
    const metas = await this.store.list() // newest-first
    const out: HistoryListEntry[] = []
    for (const meta of metas) {
      let preview = ''
      try {
        const msgs = await this.store.readMessages(meta.id)
        preview = truncate(firstUserText(msgs), PREVIEW_LEN)
      } catch {
        preview = ''
      }
      out.push({
        id: meta.id as SessionId,
        providerId: meta.providerId,
        model: meta.model,
        messageCount: meta.messageCount,
        preview,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      })
    }
    return out
  }

  async read(id: SessionId): Promise<HistoryRecord | null> {
    const meta = await this.store.readMeta(id)
    if (!meta) return null
    let preview = ''
    try {
      const msgs = await this.store.readMessages(id)
      preview = truncate(firstUserText(msgs), PREVIEW_LEN)
    } catch {
      preview = ''
    }
    return {
      id: meta.id as SessionId,
      providerId: meta.providerId,
      model: meta.model,
      mode: meta.mode,
      messageCount: meta.messageCount,
      totalUsage: { ...meta.totalUsage },
      preview,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    }
  }

  async delete(id: SessionId): Promise<void> {
    await this.store.delete(id)
  }
}
```

- [ ] **Run passing**: `npx vitest run test/core/session/history/store.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(session/history): HistoryStore facade with previews"`

---

## Task 5: Barrel + index

- [ ] **Files**
  - Create: `src/core/session/history/index.ts`

- [ ] **Implement** — `src/core/session/history/index.ts`:

```ts
// src/core/session/history/index.ts
export { HistoryStore } from './store'
export { readLinesReverse } from './reader'
export { isPersistEnabled, PERSIST_ENV } from './persist'
export type {
  SessionId,
  HistoryListEntry,
  HistoryRecord,
} from './types'
export { PREVIEW_LEN } from './types'
```

- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(session/history): public barrel"`

---

## Task 6: Gate cli.tsx persistence wiring behind the env

- [ ] **Files**
  - Modify: `src/cli.tsx`
  - Test: `test/core/session/history/persist.test.ts` (extend with wiring smoke if possible — otherwise rely on existing cli e2e)

- [ ] **Write failing test** — extend `test/core/session/history/persist.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { SessionManager } from '../../../../src/core/session/manager'
import { buildSessionPersistence } from '../../../../src/core/session/history/persist'

describe('buildSessionPersistence', () => {
  const old = process.env['NUKA_SESSION_PERSIST']
  afterEach(() => {
    if (old === undefined) delete process.env['NUKA_SESSION_PERSIST']
    else process.env['NUKA_SESSION_PERSIST'] = old
  })
  it('returns undefined store when disabled', () => {
    delete process.env['NUKA_SESSION_PERSIST']
    const out = buildSessionPersistence({ home: '/tmp/nuka-x', env: process.env })
    expect(out.store).toBeUndefined()
    expect(out.metaWriter).toBeUndefined()
    // manager still constructable
    const mgr = new SessionManager(out)
    expect(mgr.list()).toEqual([])
  })
  it('returns store + writer when enabled', () => {
    process.env['NUKA_SESSION_PERSIST'] = '1'
    const out = buildSessionPersistence({ home: '/tmp/nuka-x', env: process.env })
    expect(out.store).toBeDefined()
    expect(out.metaWriter).toBeDefined()
  })
})
```

- [ ] **Run failing**: `npx vitest run test/core/session/history/persist.test.ts`

- [ ] **Implement** — extend `src/core/session/history/persist.ts`:

```ts
// (append to existing file)
import { SessionStore, DebouncedMetaWriter } from '../store'
import { sessionsDir } from '../paths'

export type SessionPersistence = {
  store?: SessionStore
  metaWriter?: DebouncedMetaWriter
}

export function buildSessionPersistence(opts: {
  home: string
  env: NodeJS.ProcessEnv
}): SessionPersistence {
  if (!isPersistEnabled(opts.env)) return {}
  const store = new SessionStore({ dir: sessionsDir(opts.home) })
  const metaWriter = new DebouncedMetaWriter(store)
  return { store, metaWriter }
}
```

- [ ] **Modify** `src/cli.tsx` — replace the existing always-on wiring (currently around line 431-433):

```ts
// before:
//   const store = new SessionStore({ dir: sessionsDir(os.homedir()) })
//   const metaWriter = new DebouncedMetaWriter(store)
//   const sessions = new SessionManager({ store, metaWriter })
//
// after:
import { buildSessionPersistence } from './core/session/history/persist'
// ...
const persistence = buildSessionPersistence({ home: os.homedir(), env: process.env })
const sessions = new SessionManager(persistence)
const store = persistence.store // existing references below remain valid (--resume already guards on store presence via SessionManager.resume)
```

The existing `--resume` block already calls `sessions.resume(id)` / `sessions.listPersisted()` which both no-op when store is undefined (manager throws on resume but listPersisted returns []). Guard `--resume` with a friendly error when persistence is disabled:

```ts
if (resumeArg !== undefined) {
  if (!persistence.store) {
    console.error('--resume requires NUKA_SESSION_PERSIST=1')
    process.exit(2)
  }
  // ... existing block
}
```

- [ ] **Run passing**: `npx vitest run test/core/session/history/persist.test.ts && npx vitest run test/cli`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(cli): gate session persistence behind NUKA_SESSION_PERSIST"`

---

## Task 7: `/history` slash command

- [ ] **Files**
  - Create: `src/slash/history.ts`
  - Modify: `src/slash/types.ts` (add new DialogDescriptor variant)
  - Modify: wiring site that registers builtin slashes (search `SlashRegistry` registrations in `src/cli.tsx`)
  - Test: `test/slash/history.test.ts`

- [ ] **Write failing test** — `test/slash/history.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { HistoryCommand } from '../../src/slash/history'
import type { SlashContext } from '../../src/slash/types'

describe('/history', () => {
  it('returns text when persistence disabled', async () => {
    const ctx = {
      sessions: { listPersisted: async () => [] } as unknown as SlashContext['sessions'],
      providers: {} as SlashContext['providers'],
      config: {} as SlashContext['config'],
    } as SlashContext
    const old = process.env['NUKA_SESSION_PERSIST']
    delete process.env['NUKA_SESSION_PERSIST']
    try {
      const res = await HistoryCommand.run('', ctx)
      expect(res.type).toBe('text')
      if (res.type === 'text') {
        expect(res.text).toMatch(/NUKA_SESSION_PERSIST/)
      }
    } finally {
      if (old !== undefined) process.env['NUKA_SESSION_PERSIST'] = old
    }
  })

  it('returns dialog when persistence enabled', async () => {
    process.env['NUKA_SESSION_PERSIST'] = '1'
    try {
      const ctx = {
        sessions: {} as SlashContext['sessions'],
        providers: {} as SlashContext['providers'],
        config: {} as SlashContext['config'],
      } as SlashContext
      const res = await HistoryCommand.run('', ctx)
      expect(res.type).toBe('dialog')
      if (res.type === 'dialog') {
        expect(res.dialog.kind).toBe('history-list')
      }
    } finally {
      delete process.env['NUKA_SESSION_PERSIST']
    }
  })
})
```

- [ ] **Run failing**: `npx vitest run test/slash/history.test.ts`

- [ ] **Implement** — extend `src/slash/types.ts`:

```ts
// add the new DialogDescriptor variant:
export type DialogDescriptor =
  | { kind: 'model-picker' }
  | { kind: 'effort-picker' }
  | { kind: 'settings' }
  | { kind: 'session-picker' }
  | { kind: 'history-list' }       // <-- new (B4)
  | { kind: 'stats' }
  | { kind: 'doctor'; report: import('../core/doctor/run').DoctorReport }
  | { kind: 'message-selector'; messages: import('../core/message/types').AssistantMessage[] }
  | { kind: 'monitor' }
  | { kind: 'harness-submenu' }
```

- [ ] **Implement** — `src/slash/history.ts`:

```ts
// src/slash/history.ts
import type { SlashCommand } from './types'
import { isPersistEnabled, PERSIST_ENV } from '../core/session/history/persist'

export const HistoryCommand: SlashCommand = {
  name: 'history',
  description: 'Browse, resume or delete past sessions',
  source: 'builtin',
  usage: '/history',
  examples: ['/history'],
  run: async () => {
    if (!isPersistEnabled(process.env)) {
      return {
        type: 'text',
        text: `Session history is disabled. Set ${PERSIST_ENV}=1 and restart Nuka to enable cross-startup session resume.`,
      }
    }
    return { type: 'dialog', dialog: { kind: 'history-list' } }
  },
}
```

- [ ] **Modify** the slash registry wiring (search `SlashRegistry` usage in `src/cli.tsx`):

```ts
import { HistoryCommand } from './slash/history'
// ...
slashRegistry.register(HistoryCommand)
```

- [ ] **Run passing**: `npx vitest run test/slash/history.test.ts`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(slash): /history command with persistence-gate error"`

---

## Task 8: `SessionList.tsx` TUI component

- [ ] **Files**
  - Create: `src/tui/History/SessionList.tsx`
  - Test: `test/tui/History/SessionList.test.tsx`

- [ ] **Write failing test** — `test/tui/History/SessionList.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render } from 'ink-testing-library'
import React from 'react'
import { SessionList } from '../../../src/tui/History/SessionList'
import type { HistoryListEntry, SessionId } from '../../../src/core/session/history/types'

const e = (over: Partial<HistoryListEntry>): HistoryListEntry => ({
  id: 'abc12345' as SessionId,
  providerId: 'anthropic',
  model: 'claude-sonnet',
  messageCount: 3,
  preview: 'hello',
  createdAt: 0,
  updatedAt: 1_700_000_000_000,
  ...over,
})

describe('<SessionList>', () => {
  it('renders empty state', () => {
    const { lastFrame } = render(
      <SessionList entries={[]} loading={false} onResume={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toMatch(/No past sessions/)
  })

  it('renders rows with preview + id prefix', () => {
    const { lastFrame } = render(
      <SessionList
        entries={[e({ preview: 'first prompt' }), e({ id: 'def67890' as SessionId, preview: 'second' })]}
        loading={false}
        onResume={() => {}}
        onDelete={() => {}}
        onCancel={() => {}}
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toMatch(/first prompt/)
    expect(frame).toMatch(/second/)
    expect(frame).toMatch(/abc12345/)
  })

  it('calls onResume with selected id on enter', async () => {
    const onResume = vi.fn()
    const { stdin } = render(
      <SessionList
        entries={[e({ id: 'first000' as SessionId }), e({ id: 'second00' as SessionId })]}
        loading={false}
        onResume={onResume}
        onDelete={() => {}}
        onCancel={() => {}}
      />,
    )
    stdin.write('\r') // enter on row 0
    await new Promise(r => setTimeout(r, 10))
    expect(onResume).toHaveBeenCalledWith('first000')
  })

  it('calls onDelete on "d" key', async () => {
    const onDelete = vi.fn()
    const { stdin } = render(
      <SessionList
        entries={[e({ id: 'xyz' as SessionId })]}
        loading={false}
        onResume={() => {}}
        onDelete={onDelete}
        onCancel={() => {}}
      />,
    )
    stdin.write('d')
    await new Promise(r => setTimeout(r, 10))
    expect(onDelete).toHaveBeenCalledWith('xyz')
  })

  it('renders loading state', () => {
    const { lastFrame } = render(
      <SessionList entries={[]} loading={true} onResume={() => {}} onDelete={() => {}} onCancel={() => {}} />,
    )
    expect(lastFrame()).toMatch(/Loading/)
  })
})
```

- [ ] **Run failing**: `npx vitest run test/tui/History/SessionList.test.tsx`

- [ ] **Implement** — `src/tui/History/SessionList.tsx`:

```tsx
// src/tui/History/SessionList.tsx
//
// B4 — Full-screen browser for past sessions. Mirrors the layout of
// SessionPicker.tsx but adds preview text + a delete affordance. Keys:
//   ↑/↓      navigate
//   enter    resume highlighted session
//   d        delete highlighted session
//   esc      cancel back to main TUI
//
// Stateless on the data side — parent (App.tsx submenu reducer) loads
// the list, passes entries+loading, and re-loads after delete.

import React, { useState, useRef, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import stringWidth from 'string-width'
import type { HistoryListEntry, SessionId } from '../../core/session/history/types'
import { defaultPalette as P } from '../theme'
import { useTerminalSize } from '../hooks/useTerminalSize'

function truncateRight(s: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (stringWidth(s) <= maxWidth) return s
  const budget = maxWidth - 1
  const chars = Array.from(s)
  let width = 0
  let i = 0
  while (i < chars.length) {
    const w = stringWidth(chars[i]!)
    if (width + w > budget) break
    width += w
    i++
  }
  return chars.slice(0, i).join('') + '\u2026'
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export type SessionListProps = {
  entries: HistoryListEntry[]
  loading: boolean
  onResume: (id: SessionId) => void
  onDelete: (id: SessionId) => void
  onCancel: () => void
}

export function SessionList(props: SessionListProps): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const stateRef = useRef({ cursor, entries: props.entries })
  stateRef.current = { cursor, entries: props.entries }

  const handler = useCallback((input: string, key: import('ink').Key) => {
    const { cursor: c, entries } = stateRef.current
    if (key.upArrow) {
      setCursor(prev => Math.max(0, prev - 1))
    } else if (key.downArrow) {
      setCursor(prev => Math.min(Math.max(0, entries.length - 1), prev + 1))
    } else if (key.return) {
      const sel = entries[c]
      if (sel) props.onResume(sel.id)
    } else if (input === 'd') {
      const sel = entries[c]
      if (sel) props.onDelete(sel.id)
    } else if (key.escape) {
      props.onCancel()
    }
  }, [props])

  useInput(handler)

  if (props.loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Session history</Text>
        <Text color={P.fg} dimColor>Loading\u2026</Text>
      </Box>
    )
  }

  if (props.entries.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
        <Text color={P.primary} bold>Session history</Text>
        <Text color={P.fg}>No past sessions.</Text>
        <Text color={P.fg} dimColor>esc to cancel</Text>
      </Box>
    )
  }

  const { columns } = useTerminalSize()
  const rowWidth = Math.max(20, columns - 4)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={P.primary} paddingX={1}>
      <Text color={P.primary} bold>Session history</Text>
      {props.entries.map((entry, i) => {
        const arrow = i === cursor ? '\u203a' : ' '
        const idShort = entry.id.slice(0, 8)
        const date = formatDate(entry.updatedAt)
        const preview = entry.preview || '(no preview)'
        const row = `${arrow} ${idShort}  ${date}  msgs=${entry.messageCount}  ${preview}`
        return (
          <Text key={entry.id} color={i === cursor ? P.primary : P.fg}>
            {truncateRight(row, rowWidth)}
          </Text>
        )
      })}
      <Text color={P.fg} dimColor>\u2191\u2193 navigate \u00b7 enter resume \u00b7 d delete \u00b7 esc cancel</Text>
    </Box>
  )
}
```

- [ ] **Run passing**: `npx vitest run test/tui/History/SessionList.test.tsx`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(tui): History/SessionList component"`

---

## Task 9: Wire `history-list` dialog into App.tsx

- [ ] **Files**
  - Modify: `src/tui/App.tsx`
  - Test: extend the SessionList test or add `test/tui/App.history.test.tsx` — at minimum verify the dialog branch renders.

- [ ] **Modify** the `submenu` discriminated union (currently around `src/tui/App.tsx:92-104`):

```ts
type Submenu =
  | { kind: 'settings' }
  | { kind: 'model-picker' }
  | { kind: 'effort-picker' }
  | { kind: 'session-picker'; metas: SessionMeta[] | 'loading' }
  // B4 — history browser
  | { kind: 'history-list'; entries: HistoryListEntry[] | 'loading' }
  | { kind: 'onboarding-wizard' }
  | { kind: 'stats' }
  | { kind: 'doctor'; report: import('../core/doctor/run').DoctorReport }
  // ...
```

- [ ] **Modify** the slash-dispatch switch (currently around `src/tui/App.tsx:447-460`):

```ts
} else if (res.type === 'dialog') {
  if (res.dialog.kind === 'session-picker') {
    // existing path — unchanged
    dispatchUI({ type: 'open-submenu', submenu: { kind: 'session-picker', metas: 'loading' } })
    const metas = await props.sessions.listPersisted()
    dispatchUI({ type: 'update-submenu', submenu: { kind: 'session-picker', metas } })
  } else if (res.dialog.kind === 'history-list') {
    dispatchUI({ type: 'open-submenu', submenu: { kind: 'history-list', entries: 'loading' } })
    const history = new HistoryStore({ store: props.store! })
    const entries = await history.list()
    dispatchUI({ type: 'update-submenu', submenu: { kind: 'history-list', entries } })
  } else {
    dispatchUI({ type: 'open-submenu', submenu: res.dialog })
  }
}
```

- [ ] **Modify** the submenu render switch (currently around `src/tui/App.tsx:1124-1140`):

```tsx
{submenuFull && submenu?.kind === 'history-list' && (
  <SubmenuFrame mode="full" title="History" focused>
    <SessionList
      entries={submenu.entries === 'loading' ? [] : submenu.entries}
      loading={submenu.entries === 'loading'}
      onResume={async (id) => {
        closeSubmenu()
        await props.sessions.resume(id)
      }}
      onDelete={async (id) => {
        const history = new HistoryStore({ store: props.store! })
        await history.delete(id)
        // re-load list
        dispatchUI({ type: 'update-submenu', submenu: { kind: 'history-list', entries: 'loading' } })
        const entries = await history.list()
        dispatchUI({ type: 'update-submenu', submenu: { kind: 'history-list', entries } })
      }}
      onCancel={closeSubmenu}
    />
  </SubmenuFrame>
)}
```

`props.store` is a new optional `App` prop: thread it from `cli.tsx` (`<App ... store={persistence.store} />`).

- [ ] **Run passing**: `npx vitest run test/tui/App.panels.test.tsx`
- [ ] **Typecheck**: `npx tsc --noEmit`
- [ ] **Commit**: `git commit -m "feat(tui): wire /history dialog through App submenu reducer"`

---

## Task 10: Integration smoke test

- [ ] **Files**
  - Create: `test/integration/session-history.test.ts`

- [ ] **Write & implement** — `test/integration/session-history.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { SessionStore, DebouncedMetaWriter } from '../../src/core/session/store'
import { SessionManager } from '../../src/core/session/manager'
import { HistoryStore } from '../../src/core/session/history/store'
import { makeUserMessage } from '../../src/core/message/factories'

describe('B4 — cross-startup resume', () => {
  let dir: string
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('persists then resumes a session via HistoryStore.list + manager.resume', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'nuka-b4-'))
    const store = new SessionStore({ dir })
    const writer = new DebouncedMetaWriter(store, 5)
    const mgr = new SessionManager({ store, metaWriter: writer })
    const s = mgr.start({ providerId: 'p', model: 'm' })
    const msg = makeUserMessage({ text: 'replay me' })
    s.messages.push(msg)
    await store.appendMessage(s.id, msg)
    await writer.flush()

    // simulate restart: fresh manager + history store reading the same dir
    const mgr2 = new SessionManager({ store, metaWriter: writer })
    const history = new HistoryStore({ store })
    const list = await history.list()
    expect(list.find(e => e.id === s.id)?.preview).toBe('replay me')
    const resumed = await mgr2.resume(s.id)
    expect(resumed.id).toBe(s.id)
    expect(resumed.messages).toHaveLength(1)
  })
})
```

- [ ] **Run passing**: `npx vitest run test/integration/session-history.test.ts`
- [ ] **Typecheck + full test**: `npx tsc --noEmit && npx vitest run`
- [ ] **Commit**: `git commit -m "test(session/history): cross-startup integration"`

---

## Out-of-scope (explicitly deferred)

- Prompt-level history (Up-arrow recall of past prompts in PromptInput) — separate feature, would port `formatPastedTextRef` / `addToHistory` from `Nuka-Code/src/history.ts`. Tracked separately.
- Paste-store inlining (`hashPastedText` / `storePastedText`) — only relevant for prompt history above.
- Lockfile-based concurrent-writer protection — current single-instance assumption holds; revisit if multi-instance becomes a real workflow.
