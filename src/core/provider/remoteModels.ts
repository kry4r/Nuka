// src/core/provider/remoteModels.ts
// Stub — real implementation lives in Task 12.
export async function fetchRemoteModels(_opts: {
  format: 'anthropic' | 'openai'
  baseUrl: string
  apiKey?: string
  extraHeaders?: Record<string, string>
}): Promise<string[]> {
  throw new Error('fetchRemoteModels not yet implemented (see Task 12)')
}
