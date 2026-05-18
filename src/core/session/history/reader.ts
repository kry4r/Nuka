// src/core/session/history/reader.ts
//
// B4 — Streaming reverse-line reader, ported in shape from
// Nuka-Code/src/utils/fsOperations.ts::readLinesReverse. Used to peek at
// the tail of a large `<id>.jsonl` transcript without loading the whole
// file (e.g. previewing the most recent assistant message in /history).
//
// Reads the file in 16 KiB chunks from the end backward, holds an
// incomplete-line carry across chunks, and yields each complete line
// newest-first. ENOENT yields nothing. Other errors propagate.

import { open, type FileHandle } from 'node:fs/promises'

const CHUNK = 16 * 1024

export async function* readLinesReverse(filePath: string): AsyncGenerator<string> {
  let fh: FileHandle
  try {
    fh = await open(filePath, 'r')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }

  try {
    const stat = await fh.stat()
    let pos = stat.size
    let carry = ''

    while (pos > 0) {
      const len = Math.min(CHUNK, pos)
      pos -= len
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, pos)
      const text = buf.toString('utf8') + carry
      const lines = text.split('\n')
      // First slot is partial unless we have read from offset 0.
      if (pos > 0) {
        carry = lines.shift() ?? ''
      } else {
        carry = ''
      }
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (line === undefined) continue
        if (line.length === 0) continue
        yield line
      }
    }
    if (carry.length > 0) yield carry
  } finally {
    await fh.close()
  }
}
