// test/core/onboarding/probe.test.ts
import { describe, it, expect } from 'vitest'
import { PROVIDER_TEMPLATES, findTemplate } from '../../../src/core/onboarding/templates'
import { probeProvider, type FetchLike } from '../../../src/core/onboarding/providerProbe'

const ANTHROPIC = findTemplate('anthropic')!
const OPENAI = findTemplate('openai')!

function mockFetch(opts: {
  ok?: boolean
  status?: number
  statusText?: string
  body?: any
  throwErr?: Error
}): FetchLike {
  return async () => {
    if (opts.throwErr) throw opts.throwErr
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      statusText: opts.statusText ?? 'OK',
      json: async () => opts.body ?? {},
      text: async () => JSON.stringify(opts.body ?? {}),
    }
  }
}

describe('PROVIDER_TEMPLATES', () => {
  it('exports anthropic + openai + custom with the required shape', () => {
    expect(PROVIDER_TEMPLATES).toHaveLength(3)
    const ids = PROVIDER_TEMPLATES.map(t => t.id).sort()
    expect(ids).toEqual(['anthropic', 'custom', 'openai'])
    for (const t of PROVIDER_TEMPLATES) {
      if (t.id === 'custom') {
        // Free-form template — fields filled in by the customDetails screen.
        expect(t.defaultModel).toBe('')
        expect(t.defaultModels).toHaveLength(0)
        expect(t.helpUrl).toMatch(/^https?:\/\//)
      } else {
        expect(t.defaultModel.length).toBeGreaterThan(0)
        expect(t.defaultModels.length).toBeGreaterThan(0)
        expect(t.defaultModels).toContain(t.defaultModel)
        expect(t.apiKeyEnvVar).toMatch(/_API_KEY$/)
        expect(t.helpUrl).toMatch(/^https?:\/\//)
      }
    }
  })
})

describe('probeProvider — openai', () => {
  it('normalizes legacy completions baseUrls before probing models', async () => {
    const urls: string[] = []
    const fetchFn: FetchLike = async (input) => {
      urls.push(input)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ data: [{ id: 'mimo-v2-pro' }] }),
        text: async () => '',
      }
    }

    const r = await probeProvider({
      ...OPENAI,
      id: 'custom',
      name: 'Xiaomi Mimo',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/completions',
      defaultModel: 'mimo-v2-pro',
      defaultModels: ['mimo-v2-pro'],
    }, 'sk-custom', fetchFn)

    expect(urls).toEqual(['https://token-plan-cn.xiaomimimo.com/v1/models'])
    expect(r).toEqual({ ok: true, models: ['mimo-v2-pro'] })
  })

  it('401 → ok:false', async () => {
    const r = await probeProvider(OPENAI, 'sk-bad', mockFetch({ ok: false, status: 401, statusText: 'Unauthorized' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/401/)
  })

  it('200 + payload → ok:true with models[]', async () => {
    const r = await probeProvider(
      OPENAI,
      'sk-good',
      mockFetch({ ok: true, status: 200, body: { data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] } }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models).toEqual(['gpt-5', 'gpt-4o'])
  })

  it('200 with empty data → ok:true with no models field', async () => {
    const r = await probeProvider(OPENAI, 'sk-good', mockFetch({ ok: true, status: 200, body: { data: [] } }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models).toBeUndefined()
  })
})

describe('probeProvider — anthropic', () => {
  it('200 → ok:true', async () => {
    const r = await probeProvider(ANTHROPIC, 'sk-ant-good', mockFetch({ ok: true, status: 200, body: {} }))
    expect(r.ok).toBe(true)
  })

  it('401 → ok:false', async () => {
    const r = await probeProvider(ANTHROPIC, 'sk-ant-bad', mockFetch({ ok: false, status: 401, statusText: 'Unauthorized' }))
    expect(r.ok).toBe(false)
  })
})

describe('probeProvider — guards', () => {
  it('empty key → ok:false without calling fetch', async () => {
    let called = 0
    const fetchFn: FetchLike = async () => {
      called++
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const r = await probeProvider(OPENAI, '', fetchFn)
    expect(r.ok).toBe(false)
    expect(called).toBe(0)
  })

  it('network error → ok:false with reason', async () => {
    const r = await probeProvider(OPENAI, 'sk-x', mockFetch({ throwErr: new Error('ECONNRESET') }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/ECONNRESET/)
  })
})
