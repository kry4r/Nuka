import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { readScratchpad, writeScratchpad, truncateToCap } from '../../../src/core/harness/scratchpad'

describe('scratchpad', () => {
  let dir: string
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-sp-')) })
  it('write+read round-trips', () => {
    const file = path.join(dir, 's.md')
    writeScratchpad(file, '# Hello\nWorld')
    expect(readScratchpad(file)).toBe('# Hello\nWorld')
  })
  it('returns empty string when missing', () => {
    expect(readScratchpad(path.join(dir, 'missing.md'))).toBe('')
  })
  it('truncates to cap KB by dropping oldest sections', () => {
    const big = Array.from({ length: 100 }, (_, i) => `## Section ${i}\n${'x'.repeat(2_000)}`).join('\n')
    const t = truncateToCap(big, 50 * 1024)
    expect(Buffer.byteLength(t, 'utf8')).toBeLessThanOrEqual(50 * 1024 + 200)
    // newest section retained
    expect(t).toContain('Section 99')
  })
})
