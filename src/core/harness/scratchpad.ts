// src/core/harness/scratchpad.ts
import * as fs from 'node:fs'

export function readScratchpad(file: string): string {
  if (!fs.existsSync(file)) return ''
  return fs.readFileSync(file, 'utf8')
}

export function writeScratchpad(file: string, content: string): void {
  fs.mkdirSync(file.replace(/\/[^/]+$/, ''), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

export function truncateToCap(content: string, maxBytes: number): string {
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return content
  const sections = content.split(/(?=^## )/m)
  const header = sections.shift() ?? ''
  while (sections.length && Buffer.byteLength([header, '_(older sections truncated)_', ...sections].join('\n'), 'utf8') > maxBytes) {
    sections.shift()
  }
  return [header, '_(older sections truncated)_', ...sections].join('\n')
}
