// src/core/onboarding/providerProbe.ts
//
// Cheap "does this API key actually work?" probe. Used by the onboarding
// wizard to surface auth errors immediately and (optionally) refresh the
// list of usable models with a real /v1/models response for OpenAI.
//
// Tests inject `fetchFn` so we never hit the real network.

import type { ProviderTemplate } from './templates'
import {
  openAIModelsEndpoints,
  shouldTryNextOpenAIEndpoint,
} from '../provider/openaiEndpoints'

export type ProbeOk = { ok: true; models?: string[] }
export type ProbeErr = { ok: false; reason: string }
export type ProbeResult = ProbeOk | ProbeErr

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean
  status: number
  statusText?: string
  json: () => Promise<any>
  text?: () => Promise<string>
}>

function defaultFetch(): FetchLike {
  const f = (globalThis as any).fetch
  if (typeof f !== 'function') {
    throw new Error('global fetch is not available — Node 18+ required')
  }
  return f as FetchLike
}

export async function probeProvider(
  t: ProviderTemplate,
  key: string,
  fetchFn?: FetchLike,
): Promise<ProbeResult> {
  if (!key || key.trim().length === 0) {
    return { ok: false, reason: 'empty api key' }
  }
  const fetch = fetchFn ?? defaultFetch()
  try {
    if (t.type === 'openai') {
      const endpoints = openAIModelsEndpoints(t.baseUrl)
      let lastReason = ''
      for (const [index, endpoint] of endpoints.entries()) {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: { Authorization: `Bearer ${key}` },
        })
        if (!res.ok) {
          lastReason = `${res.status} ${res.statusText ?? ''}`.trim()
          if (shouldTryNextOpenAIEndpoint(res.status, index, endpoints)) continue
          return { ok: false, reason: lastReason }
        }
        let body: any
        try {
          body = await res.json()
        } catch {
          return { ok: true }
        }
        const ids: string[] = Array.isArray(body?.data)
          ? body.data
              .map((m: any) => (typeof m?.id === 'string' ? m.id : null))
              .filter((s: string | null): s is string => s !== null)
          : []
        return ids.length > 0 ? { ok: true, models: ids } : { ok: true }
      }
      return { ok: false, reason: lastReason || 'no OpenAI model endpoints tried' }
    }

    if (t.type === 'anthropic') {
      // 1-token messages.create is cheap and surfaces auth errors immediately.
      const res = await fetch(`${t.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: t.defaultModel,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
      if (!res.ok) {
        return { ok: false, reason: `${res.status} ${res.statusText ?? ''}`.trim() }
      }
      return { ok: true }
    }

    return { ok: false, reason: `unsupported provider type: ${t.type}` }
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? 'network error' }
  }
}
