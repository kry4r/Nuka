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
