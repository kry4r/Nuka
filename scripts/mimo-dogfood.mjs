#!/usr/bin/env node
/**
 * scripts/mimo-dogfood.mjs
 *
 * Demo C driver for the Mimo dogfood run (2026-05-19).
 *
 * Reads ~/.nuka/config.yaml at runtime to extract the Mimo baseUrl + apiKey,
 * makes ONE POST to /chat/completions, prints the assistant reply, and writes
 * the response text to a file for the fixture to consume.
 *
 * Usage:  node scripts/mimo-dogfood.mjs [--out=<path>]
 *
 * IMPORTANT: The apiKey is read from config at runtime — it is NEVER echoed,
 * logged, or committed. The script prints only the assistant's reply text and
 * the HTTP status code.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'

// ---------------------------------------------------------------------------
// 1. Load config
// ---------------------------------------------------------------------------
const configPath = join(homedir(), '.nuka', 'config.yaml')
let cfg
try {
  cfg = parseYaml(readFileSync(configPath, 'utf8'))
} catch (err) {
  process.stderr.write(`[mimo-dogfood] Cannot read config: ${err.message}\n`)
  process.exit(1)
}

const provider = cfg.providers?.find(p => p.id === cfg.active?.providerId)
if (!provider) {
  process.stderr.write(`[mimo-dogfood] Active provider not found in config\n`)
  process.exit(1)
}

const { baseUrl, apiKey, selectedModel, models } = provider
const model = selectedModel ?? models?.[0] ?? 'mimo-v2-omni'

if (!apiKey) {
  process.stderr.write(`[mimo-dogfood] apiKey missing for provider ${provider.id}\n`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Parse --out flag
// ---------------------------------------------------------------------------
const outArg = process.argv.find(a => a.startsWith('--out='))
const outPath = outArg ? outArg.slice('--out='.length) : null

// ---------------------------------------------------------------------------
// 3. Make ONE POST to /chat/completions
// ---------------------------------------------------------------------------
const url = `${baseUrl}/chat/completions`
process.stdout.write(`[mimo-dogfood] POST ${url.replace(apiKey, '[REDACTED]')} model=${model}\n`)

let response
try {
  response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: 'Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}',
        },
      ],
      max_tokens: 512,
      temperature: 0,
    }),
  })
} catch (err) {
  process.stderr.write(`[mimo-dogfood] fetch error: ${err.message}\n`)
  process.exit(1)
}

process.stdout.write(`[mimo-dogfood] HTTP ${response.status}\n`)

if (!response.ok) {
  const body = await response.text()
  process.stderr.write(`[mimo-dogfood] error body: ${body}\n`)
  process.exit(1)
}

const json = await response.json()
const reply = json.choices?.[0]?.message?.content ?? ''
const usage = json.usage ?? {}

process.stdout.write(`[mimo-dogfood] reply: ${JSON.stringify(reply)}\n`)
process.stdout.write(`[mimo-dogfood] usage: prompt_tokens=${usage.prompt_tokens ?? '?'} completion_tokens=${usage.completion_tokens ?? '?'}\n`)

// ---------------------------------------------------------------------------
// 4. Write response to outPath if requested
// ---------------------------------------------------------------------------
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, reply, 'utf8')
  process.stdout.write(`[mimo-dogfood] response written to ${outPath}\n`)
}
