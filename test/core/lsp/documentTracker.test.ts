import { describe, it, expect, vi } from 'vitest'
import { DocumentTracker } from '../../../src/core/lsp/documentTracker'
import type { LspClient } from '../../../src/core/lsp/client'

function makeMockClient(): LspClient & { _notifyCalls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = []
  const client = {
    _notifyCalls: calls,
    notify: vi.fn((method: string, params: unknown) => { calls.push({ method, params }) }),
    status: 'ready' as const,
  } as unknown as LspClient & { _notifyCalls: Array<{ method: string; params: unknown }> }
  return client
}

describe('DocumentTracker', () => {
  describe('ensureOpen()', () => {
    it('sends didOpen with version 1 on first call', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'const x = 1', 'typescript')

      expect(client.notify).toHaveBeenCalledOnce()
      expect(client.notify).toHaveBeenCalledWith('textDocument/didOpen', {
        textDocument: {
          uri: 'file:///a.ts',
          languageId: 'typescript',
          version: 1,
          text: 'const x = 1',
        },
      })
      expect(tracker.isOpen('file:///a.ts')).toBe(true)
      expect(tracker.versionOf('file:///a.ts')).toBe(1)
    })

    it('is a no-op on second call for the same URI', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'const x = 1', 'typescript')
      await tracker.ensureOpen('file:///a.ts', 'const x = 2', 'typescript') // no-op

      expect(client.notify).toHaveBeenCalledOnce()
      // version should still be 1 (not changed by no-op)
      expect(tracker.versionOf('file:///a.ts')).toBe(1)
    })

    it('can open multiple different URIs', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'a', 'typescript')
      await tracker.ensureOpen('file:///b.py', 'b', 'python')

      expect(client.notify).toHaveBeenCalledTimes(2)
      expect(tracker.isOpen('file:///a.ts')).toBe(true)
      expect(tracker.isOpen('file:///b.py')).toBe(true)
    })
  })

  describe('applyChange()', () => {
    it('sends didChange with version 2 after ensureOpen', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'const x = 1', 'typescript')
      await tracker.applyChange('file:///a.ts', 'const x = 2')

      const didChange = client._notifyCalls.find(c => c.method === 'textDocument/didChange')
      expect(didChange).toBeDefined()
      expect(didChange!.params).toEqual({
        textDocument: { uri: 'file:///a.ts', version: 2 },
        contentChanges: [{ text: 'const x = 2' }],
      })
      expect(tracker.versionOf('file:///a.ts')).toBe(2)
    })

    it('increments version on each change', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'v1', 'typescript')
      await tracker.applyChange('file:///a.ts', 'v2')
      await tracker.applyChange('file:///a.ts', 'v3')

      expect(tracker.versionOf('file:///a.ts')).toBe(3)
      const changes = client._notifyCalls.filter(c => c.method === 'textDocument/didChange')
      expect(changes).toHaveLength(2)
      expect((changes[1]!.params as { textDocument: { version: number } }).textDocument.version).toBe(3)
    })

    it('throws "document not open" for a URI that was never opened', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await expect(tracker.applyChange('file:///not-open.ts', 'text')).rejects.toThrow('document not open')
    })
  })

  describe('close()', () => {
    it('sends didClose and removes the URI from tracking', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'code', 'typescript')
      await tracker.close('file:///a.ts')

      const didClose = client._notifyCalls.find(c => c.method === 'textDocument/didClose')
      expect(didClose).toBeDefined()
      expect(didClose!.params).toEqual({ textDocument: { uri: 'file:///a.ts' } })
      expect(tracker.isOpen('file:///a.ts')).toBe(false)
      expect(tracker.versionOf('file:///a.ts')).toBeUndefined()
    })

    it('is a no-op if URI was not open', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.close('file:///never-opened.ts')
      expect(client.notify).not.toHaveBeenCalled()
    })

    it('applyChange throws after close', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'code', 'typescript')
      await tracker.close('file:///a.ts')

      await expect(tracker.applyChange('file:///a.ts', 'new code')).rejects.toThrow('document not open')
    })

    it('can re-open a closed document', async () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)

      await tracker.ensureOpen('file:///a.ts', 'v1', 'typescript')
      await tracker.close('file:///a.ts')
      await tracker.ensureOpen('file:///a.ts', 'v2', 'typescript')

      // version should be 1 again after re-open
      expect(tracker.versionOf('file:///a.ts')).toBe(1)
      const didOpens = client._notifyCalls.filter(c => c.method === 'textDocument/didOpen')
      expect(didOpens).toHaveLength(2)
    })
  })

  describe('isOpen() / versionOf()', () => {
    it('returns false/undefined for never-opened URI', () => {
      const client = makeMockClient()
      const tracker = new DocumentTracker(client)
      expect(tracker.isOpen('file:///x.ts')).toBe(false)
      expect(tracker.versionOf('file:///x.ts')).toBeUndefined()
    })
  })
})
