// test/promptContextReferences/imageBudget.test.ts
//
// Pure unit tests for the per-image byte-budget helper. Reads
// `NUKA_PROMPT_IMAGE_MAX_BYTES` with a sensible default and a fallback for
// non-numeric / non-positive overrides.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { base64Bytes, getImageMaxBytes } from '../../src/promptContextReferences/imageBudget'

describe('getImageMaxBytes', () => {
  const orig = process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
  beforeEach(() => { delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] })
  afterEach(() => {
    if (orig === undefined) delete process.env['NUKA_PROMPT_IMAGE_MAX_BYTES']
    else process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = orig
  })

  it('defaults to 5 MiB when env is unset', () => {
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })

  it('honors a positive integer override', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '1024'
    expect(getImageMaxBytes()).toBe(1024)
  })

  it('falls back to default on non-numeric env value', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = 'abc'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })

  it('falls back to default on zero or negative', () => {
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '0'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
    process.env['NUKA_PROMPT_IMAGE_MAX_BYTES'] = '-1'
    expect(getImageMaxBytes()).toBe(5 * 1024 * 1024)
  })
})

describe('base64Bytes', () => {
  it('computes decoded byte length without decoding', () => {
    // 4 base64 chars → 3 bytes; each `=` reduces by 1
    expect(base64Bytes('AAAA')).toBe(3)
    expect(base64Bytes('AAA=')).toBe(2)
    expect(base64Bytes('AA==')).toBe(1)
    expect(base64Bytes('')).toBe(0)
  })
})
