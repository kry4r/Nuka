// src/core/recap/persist.ts — Phase 14c §6.4
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { recapsDir } from '../paths'
import { renderMarkdown } from './renderMarkdown'
import type { RecapDoc } from './types'

export async function persistRecap(home: string, doc: RecapDoc): Promise<string> {
  const dir = recapsDir(home)
  await fsp.mkdir(dir, { recursive: true })
  const date = new Date(doc.generatedAt).toISOString().slice(0, 10)
  const file = path.join(dir, `${date}-${doc.session}.md`)
  await fsp.writeFile(file, renderMarkdown(doc), 'utf8')
  return file
}
