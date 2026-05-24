export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  return baseUrl
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/)?completions$/i, '')
    .replace(/\/responses(?:\/compact)?$/i, '')
}

export function openAIResponsesEndpoints(baseUrl: string): string[] {
  const base = normalizeOpenAIBaseUrl(baseUrl)
  return base.endsWith('/v1')
    ? [`${base}/responses`]
    : [`${base}/responses`, `${base}/v1/responses`]
}

export function openAIResponsesCompactEndpoints(baseUrl: string): string[] {
  return openAIResponsesEndpoints(baseUrl).map(endpoint => `${endpoint}/compact`)
}

export function openAIModelsEndpoints(baseUrl: string): string[] {
  const base = normalizeOpenAIBaseUrl(baseUrl)
  return base.endsWith('/v1')
    ? [`${base}/models`]
    : [`${base}/models`, `${base}/v1/models`]
}

export function shouldTryNextOpenAIEndpoint(
  status: number,
  index: number,
  endpoints: readonly string[],
): boolean {
  return index < endpoints.length - 1 && (status === 403 || status === 404)
}
