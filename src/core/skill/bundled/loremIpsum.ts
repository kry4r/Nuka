// src/core/skill/bundled/loremIpsum.ts
//
// Tier-1 #1 — filler / placeholder text generator. Ported from
// Nuka-Code's `src/skills/bundled/loremIpsum.ts`. The dynamic
// `args`-driven token count is dropped (Nuka skills are keyword-
// activated, not slash-invoked); instead a fixed ~10 000-token
// sample is baked at registration time via `buildBody`.
//
// Gated by `NUKA_SKILL_LOREM_IPSUM=1` — bundled-skill body is large
// and only useful for context-window testing, so off by default.

import { registerBundledSkill } from '../bundled'

const ONE_TOKEN_WORDS = [
  'the', 'a', 'an', 'I', 'you', 'he', 'she', 'it', 'we', 'they',
  'is', 'are', 'was', 'were', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'time', 'year', 'day', 'way', 'man', 'thing', 'life', 'hand',
  'good', 'new', 'first', 'last', 'long', 'great', 'little',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by',
  'and', 'or', 'but', 'if', 'than', 'because', 'as', 'until',
  'not', 'now', 'just', 'more', 'also', 'here', 'there', 'then',
  'test', 'code', 'data', 'file', 'line', 'text', 'word', 'number',
] as const

function generateLoremIpsum(targetTokens: number): string {
  let tokens = 0
  let result = ''
  while (tokens < targetTokens) {
    const sentenceLength = 10 + Math.floor(Math.random() * 11)
    let wordsInSentence = 0
    for (let i = 0; i < sentenceLength && tokens < targetTokens; i++) {
      const word =
        ONE_TOKEN_WORDS[Math.floor(Math.random() * ONE_TOKEN_WORDS.length)] ??
        'the'
      result += word
      tokens++
      wordsInSentence++
      result +=
        i === sentenceLength - 1 || tokens >= targetTokens ? '. ' : ' '
    }
    if (wordsInSentence > 0 && Math.random() < 0.2 && tokens < targetTokens) {
      result += '\n\n'
    }
  }
  return result.trim()
}

const DEFAULT_TOKEN_COUNT = 10_000

const HEADER =
  '# Lorem Ipsum (filler text)\n\n' +
  'When the user asks for filler text, placeholder text, or test content, ' +
  `paste the sample below (~${DEFAULT_TOKEN_COUNT} tokens). If they need a ` +
  'different size, generate proportional text using the same one-token-word vocabulary.\n\n' +
  '---\n\n'

export function registerLoremIpsumSkill(): void {
  if (process.env['NUKA_SKILL_LOREM_IPSUM'] !== '1') return
  registerBundledSkill({
    name: 'lorem-ipsum',
    description: 'Generate filler / placeholder text for context-window testing.',
    when: { keyword: ['lorem', 'filler text', 'placeholder text'] },
    buildBody: () => HEADER + generateLoremIpsum(DEFAULT_TOKEN_COUNT),
  })
}
