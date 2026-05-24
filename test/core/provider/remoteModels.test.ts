// test/core/provider/remoteModels.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { fetchRemoteModels } from '../../../src/core/provider/remoteModels'

const server = setupServer(
  http.get('https://api.openai.example/v1/models', ({ request }) => {
    const auth = request.headers.get('authorization')
    if (auth !== 'Bearer sk-x') return new HttpResponse(null, { status: 401 })
    return HttpResponse.json({
      data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }],
    })
  }),
  http.get('https://api.anthropic.example/v1/models', ({ request }) => {
    const key = request.headers.get('x-api-key')
    if (key !== 'sk-a') return new HttpResponse(null, { status: 401 })
    return HttpResponse.json({
      data: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-opus-4-7' }],
    })
  }),
  http.get('https://api.openai.example/v1/completions/models', () => {
    return new HttpResponse('blocked legacy path', { status: 403 })
  }),
  http.get('https://api.openai.example/v1/completions/v1/models', () => {
    return new HttpResponse('wrong legacy fallback', { status: 404 })
  }),
)

beforeAll(() => server.listen())
afterAll(() => server.close())

describe('fetchRemoteModels', () => {
  it('fetches OpenAI-format /v1/models', async () => {
    const models = await fetchRemoteModels({
      format: 'openai',
      baseUrl: 'https://api.openai.example/v1',
      apiKey: 'sk-x',
    })
    expect(models).toEqual(['gpt-5', 'gpt-4o'])
  })

  it('normalizes legacy OpenAI completions baseUrls before listing models', async () => {
    const models = await fetchRemoteModels({
      format: 'openai',
      baseUrl: 'https://api.openai.example/v1/completions',
      apiKey: 'sk-x',
    })
    expect(models).toEqual(['gpt-5', 'gpt-4o'])
  })

  it('fetches Anthropic-format /v1/models', async () => {
    const models = await fetchRemoteModels({
      format: 'anthropic',
      baseUrl: 'https://api.anthropic.example',
      apiKey: 'sk-a',
    })
    expect(models).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7'])
  })

  it('raises on 401', async () => {
    await expect(
      fetchRemoteModels({
        format: 'openai',
        baseUrl: 'https://api.openai.example/v1',
        apiKey: 'wrong',
      }),
    ).rejects.toThrow(/401/)
  })
})
