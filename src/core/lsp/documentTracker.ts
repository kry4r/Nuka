// src/core/lsp/documentTracker.ts
// Tracks open documents per LspClient and sends didOpen/didChange/didClose notifications.
import type { LspClient } from './client'

type DocState = {
  version: number
  languageId: string
  text: string
}

export class DocumentTracker {
  private readonly _client: LspClient
  private readonly _docs: Map<string, DocState> = new Map()

  constructor(client: LspClient) {
    this._client = client
  }

  /** Returns true if the URI is currently open in this tracker. */
  isOpen(uri: string): boolean {
    return this._docs.has(uri)
  }

  /** Returns the current version number for the URI, or undefined if not open. */
  versionOf(uri: string): number | undefined {
    return this._docs.get(uri)?.version
  }

  /**
   * Opens the document if not already open (sends didOpen with version 1).
   * If already open, this is a no-op.
   */
  async ensureOpen(uri: string, text: string, languageId: string): Promise<void> {
    if (this._docs.has(uri)) return

    this._docs.set(uri, { version: 1, languageId, text })
    this._client.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    })
  }

  /**
   * Sends a full-document didChange notification and bumps the version.
   * Throws if the document is not open.
   */
  async applyChange(uri: string, newText: string): Promise<void> {
    const state = this._docs.get(uri)
    if (!state) {
      throw new Error(`document not open: ${uri}`)
    }
    const newVersion = state.version + 1
    state.version = newVersion
    state.text = newText

    this._client.notify('textDocument/didChange', {
      textDocument: {
        uri,
        version: newVersion,
      },
      contentChanges: [{ text: newText }],
    })
  }

  /**
   * Sends didClose and removes the document from tracking.
   * No-op if the document is not open.
   */
  async close(uri: string): Promise<void> {
    if (!this._docs.has(uri)) return

    this._docs.delete(uri)
    this._client.notify('textDocument/didClose', {
      textDocument: { uri },
    })
  }
}
