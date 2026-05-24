// src/core/provider/remoteModels.ts
import { openAIModelsEndpoints } from './openaiEndpoints'

const ANTHROPIC_VERSION = '2023-06-01'

export type FetchRemoteModelsOpts = {
  format: 'anthropic' | 'openai'
  baseUrl: string
  apiKey?: string
  extraHeaders?: Record<string, string>
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export async function fetchRemoteModels(
  opts: FetchRemoteModelsOpts,
): Promise<string[]> {
  const base = trimSlash(opts.baseUrl)
  const endpoints =
    opts.format === 'anthropic'
      ? [`${base}/v1/models`, `${base}/models`]
      : openAIModelsEndpoints(opts.baseUrl)

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.extraHeaders ?? {}),
  }
  if (opts.format === 'anthropic') {
    if (opts.apiKey) headers['x-api-key'] = opts.apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
  } else if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`
  }

  let lastErr: Error | null = null
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        lastErr = new Error(`${res.status} ${res.statusText} on ${url}`)
        continue
      }
      const body: any = await res.json()
      const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
      return list.map((m: any) => (typeof m === 'string' ? m : m.id)).filter(Boolean)
    } catch (err) {
      lastErr = err as Error
    }
  }
  throw lastErr ?? new Error('no endpoints tried')
}
