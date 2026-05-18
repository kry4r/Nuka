// src/core/testing/explorer/L4_repair/dumpReader.ts
//
// M5.T1 — parse a failure dump markdown file back into a typed FailureRecord.
// See locked spec §6 (dump format) + §4.6 step 1.
//
// This is the inverse of `writeFailureDump` in common/tracingFs.ts. The two
// must stay in lockstep: any new field on FailureRecord requires updating
// BOTH the writer and the reader.
//
// Format the reader expects (writer-emitted):
//   # Failure dump: <id>
//   - **component:** <name>
//   - **case:** <case>
//   - **viewport:** <cols>×<rows>
//   - **timestamp:** <iso>
//   - **gridHash:** <hex>          ← optional
//   ## Violations
//   ### <rule> (<severity>)
//   <message lines...>
//   ```
//   <excerpt lines...>             ← optional fenced block
//   ```
//   Cells: (x,y) (x,y) ...         ← optional, one line
//   ## ASCII view
//   ```
//   <asciiView>                    ← preserved verbatim
//   ```
//   ## Stdin sequence (minimal repro)   ← optional section
//   ```json
//   ["k1","k2"]
//   ```

import { readFileSync } from 'node:fs'
import type { FailureRecord, Violation, Viewport } from '../types'

/** Parse a failure dump markdown file into a FailureRecord. */
export function readDump(path: string): FailureRecord {
  // readFileSync throws ENOENT for us — callers see a native error.
  const text = readFileSync(path, 'utf8')

  const lines = text.split('\n')

  // ----- 1. Header -----
  const headerMatch = lines[0]?.match(/^# Failure dump:\s+(.+)$/)
  if (!headerMatch) {
    throw new Error(
      `dumpReader: ${path} missing header '# Failure dump: <id>'`,
    )
  }
  const id = headerMatch[1]!.trim()

  // ----- 2. Bullet metadata (component / case / viewport / timestamp / gridHash) -----
  const bullets = new Map<string, string>()
  for (const line of lines) {
    const m = line.match(/^-\s+\*\*([\w]+):\*\*\s+(.+)$/)
    if (m) bullets.set(m[1]!, m[2]!.trim())
  }
  const component = bullets.get('component')
  const fixtureCase = bullets.get('case')
  const viewportRaw = bullets.get('viewport')
  const timestamp = bullets.get('timestamp')
  if (!component || !fixtureCase || !viewportRaw || !timestamp) {
    throw new Error(
      `dumpReader: ${path} missing required bullets ` +
        `(component/case/viewport/timestamp)`,
    )
  }
  const viewport = parseViewport(viewportRaw)
  const gridHash = bullets.get('gridHash')
  const fixturePath = bullets.get('fixturePath')

  // ----- 3. Section split -----
  // Find the indices of the section headings we care about. Sections are
  // demarcated by '## <name>' on a line by itself. The body of a section runs
  // from the line after the heading until the next '## ' line.
  const sectionStarts: Array<{ name: string; from: number }> = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(/^##\s+(.+)$/)
    if (m) sectionStarts.push({ name: m[1]!.trim(), from: i + 1 })
  }
  function sectionBody(name: string): string[] {
    const idx = sectionStarts.findIndex((s) => s.name === name)
    if (idx === -1) return []
    const from = sectionStarts[idx]!.from
    const to =
      idx + 1 < sectionStarts.length
        ? sectionStarts[idx + 1]!.from - 1 // line before the next '## '
        : lines.length
    return lines.slice(from, to)
  }

  // ----- 4. Violations -----
  const violations = parseViolations(sectionBody('Violations'))

  // ----- 5. ASCII view -----
  const asciiView = parseFencedBlock(sectionBody('ASCII view'))

  // ----- 6. Stdin sequence (optional) -----
  let stdinSequence: string[] | undefined
  const stdinSection = sectionBody('Stdin sequence (minimal repro)')
  if (stdinSection.length > 0) {
    const fenced = parseFencedBlock(stdinSection)
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced)
        if (Array.isArray(parsed)) {
          stdinSequence = parsed.map((s) => String(s))
        }
      } catch {
        /* malformed JSON → ignore, treat as no sequence */
      }
    }
  }

  // ----- 7. Build the record -----
  const rec: FailureRecord = {
    id,
    component,
    fixtureCase,
    viewport,
    violations,
    asciiView,
    timestamp,
  }
  if (gridHash) rec.gridHash = gridHash
  if (fixturePath) rec.fixturePath = fixturePath
  if (stdinSequence && stdinSequence.length > 0) rec.stdinSequence = stdinSequence
  return rec
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseViewport(raw: string): Viewport {
  // Writer uses the multiplication sign U+00D7; accept ASCII 'x' too.
  const m = raw.match(/^(\d+)\s*[×x]\s*(\d+)$/)
  if (!m) {
    throw new Error(`dumpReader: unparseable viewport '${raw}' (want '<cols>×<rows>')`)
  }
  return { cols: Number(m[1]), rows: Number(m[2]) }
}

/**
 * Extract the body of a fenced block (```...```) from a list of lines.
 * Returns the joined content (newline-separated, trailing newline trimmed
 * for round-trip stability — writer adds the closing fence on its own line).
 */
function parseFencedBlock(body: string[]): string {
  let inFence = false
  const out: string[] = []
  for (const line of body) {
    if (!inFence && /^```/.test(line)) {
      inFence = true
      continue
    }
    if (inFence && /^```$/.test(line)) {
      inFence = false
      break
    }
    if (inFence) out.push(line)
  }
  return out.join('\n')
}

/**
 * Parse the '## Violations' section into Violation[].
 *
 * Each violation is a '### <rule> (<severity>)' heading followed by:
 *   - one or more message lines (until a fence, 'Cells:' line, or next '###'),
 *   - optional fenced excerpt block,
 *   - optional 'Cells: (x,y) ...' line.
 */
function parseViolations(body: string[]): Violation[] {
  const out: Violation[] = []
  let i = 0
  while (i < body.length) {
    const heading = body[i]!.match(/^###\s+(.+?)\s+\((error|warn)\)\s*$/)
    if (!heading) {
      i++
      continue
    }
    const rule = heading[1]!.trim()
    const severity = heading[2] as 'error' | 'warn'
    i++

    // Collect message lines until we hit a fence, a Cells: line, the next
    // heading, or EOF. Skip leading blank lines.
    const messageLines: string[] = []
    while (i < body.length) {
      const line = body[i]!
      if (/^```/.test(line)) break
      if (/^Cells:\s/.test(line)) break
      if (/^###\s/.test(line)) break
      messageLines.push(line)
      i++
    }
    // Drop leading/trailing blank lines from the message.
    while (messageLines.length > 0 && messageLines[0]!.trim() === '') messageLines.shift()
    while (
      messageLines.length > 0 &&
      messageLines[messageLines.length - 1]!.trim() === ''
    ) {
      messageLines.pop()
    }
    const message = messageLines.join('\n')

    // Optional excerpt fenced block.
    let excerpt: string | undefined
    if (i < body.length && /^```/.test(body[i]!)) {
      i++ // consume opening fence
      const excerptLines: string[] = []
      while (i < body.length && !/^```$/.test(body[i]!)) {
        excerptLines.push(body[i]!)
        i++
      }
      if (i < body.length) i++ // consume closing fence
      excerpt = excerptLines.join('\n')
    }

    // Skip blank lines before optional Cells: line.
    while (i < body.length && body[i]!.trim() === '') i++

    // Optional Cells: line.
    let cells: Array<{ x: number; y: number }> | undefined
    if (i < body.length && /^Cells:\s/.test(body[i]!)) {
      const coords: Array<{ x: number; y: number }> = []
      const re = /\((\d+),(\d+)\)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(body[i]!)) !== null) {
        coords.push({ x: Number(m[1]), y: Number(m[2]) })
      }
      cells = coords
      i++
    }

    const violation: Violation = { rule, severity, message }
    if (excerpt !== undefined) violation.excerpt = excerpt
    if (cells !== undefined) violation.cells = cells
    out.push(violation)
  }
  return out
}
