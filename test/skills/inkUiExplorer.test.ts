// test/skills/inkUiExplorer.test.ts
//
// M7.T1 — SKILL.md parse contract for ink-ui-explorer skill.
//
// Assertions:
//   1. SKILL.md exists at ~/.claude/skills/ink-ui-explorer/SKILL.md
//   2. YAML frontmatter parses and contains name + description
//   3. description mentions all 5 verbs: capture, sweep, fuzz, judge, repair
//   4. Decision-rule mapping table parses to a typed object with all 4 triggers

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SKILL_DIR = path.join(os.homedir(), '.claude', 'skills', 'ink-ui-explorer')
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md')

// ---------------------------------------------------------------------------
// Minimal frontmatter parser — extract the YAML block between first --- pair
// ---------------------------------------------------------------------------
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const yaml = match[1]!
  const result: Record<string, string> = {}
  // Capture simple key: value and multi-line block scalar (key: |\n  ...)
  const lines = yaml.split('\n')
  let currentKey: string | null = null
  let blockLines: string[] = []

  for (const line of lines) {
    const keyLine = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (keyLine) {
      if (currentKey && blockLines.length > 0) {
        result[currentKey] = blockLines.join('\n').trim()
        blockLines = []
      }
      currentKey = keyLine[1]!
      const val = keyLine[2]!.trim()
      if (val === '|' || val === '>') {
        // block scalar — collect subsequent indented lines
        blockLines = []
      } else {
        result[currentKey] = val
        currentKey = null
      }
    } else if (currentKey && blockLines !== null) {
      // continuation of block scalar
      blockLines.push(line.trimStart())
    }
  }
  if (currentKey && blockLines.length > 0) {
    result[currentKey] = blockLines.join('\n').trim()
  }
  return result
}

// ---------------------------------------------------------------------------
// Decision-rule table parser
// Extract rows of the markdown table under "## Decision rules"
// Returns array of { trigger, verb } objects
// ---------------------------------------------------------------------------
type DecisionRule = { trigger: string; verb: string }

function parseDecisionRuleTable(content: string): DecisionRule[] {
  // Find the "Decision rules" section
  const sectionMatch = content.match(/## Decision rules[\s\S]*?(\|[^\n]*\n[^\n]*\n((?:\|[^\n]*\n?)*))/)
  if (!sectionMatch) return []

  const tableText = sectionMatch[1]!
  const rows = tableText.split('\n').filter((l) => l.trim().startsWith('|'))
  const rules: DecisionRule[] = []

  for (const row of rows) {
    // Skip header and separator rows
    if (row.includes('Trigger') || row.match(/^\s*\|[-| ]+\|\s*$/)) continue
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length >= 2) {
      rules.push({ trigger: cells[0]!, verb: cells[1]! })
    }
  }
  return rules
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ink-ui-explorer SKILL.md', () => {
  it('SKILL.md file exists at ~/.claude/skills/ink-ui-explorer/SKILL.md', () => {
    expect(existsSync(SKILL_MD), `Expected ${SKILL_MD} to exist`).toBe(true)
  })

  it('frontmatter has name = ink-ui-explorer', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const fm = parseFrontmatter(content)
    expect(fm['name']).toBe('ink-ui-explorer')
  })

  it('frontmatter description mentions all 5 verbs', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const fm = parseFrontmatter(content)
    const desc = fm['description'] ?? ''
    for (const verb of ['capture', 'sweep', 'fuzz', 'judge', 'repair']) {
      expect(desc, `description should mention verb "${verb}"`).toContain(verb)
    }
  })

  it('decision-rule table parses to exactly 4 rows', () => {
    // NOTE: SKILL.md currently has 4 decision-rule rows (capture, sweep, fuzz,
    // repair). "judge" is intentionally omitted from this table: it has no
    // human-facing natural-language trigger (judge is invoked internally by
    // sweep, or explicitly by the user knowing the verb). Judge IS pinned in
    // the frontmatter description test above (verb list) and in the bin shim
    // help-output test. If a judge row is ever added to the decision table,
    // update this assertion to === 5.
    const content = readFileSync(SKILL_MD, 'utf8')
    const rules = parseDecisionRuleTable(content)
    expect(rules.length).toBe(4)
  })

  it('decision-rule table has a "capture" trigger', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const rules = parseDecisionRuleTable(content)
    const captureRule = rules.find((r) => r.verb.toLowerCase().includes('capture'))
    expect(captureRule, 'should have a decision rule pointing to capture').toBeDefined()
  })

  it('decision-rule table has a "sweep" trigger', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const rules = parseDecisionRuleTable(content)
    const sweepRule = rules.find((r) => r.verb.toLowerCase().includes('sweep'))
    expect(sweepRule, 'should have a decision rule pointing to sweep').toBeDefined()
  })

  it('decision-rule table has a "fuzz" trigger', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const rules = parseDecisionRuleTable(content)
    const fuzzRule = rules.find((r) => r.verb.toLowerCase().includes('fuzz'))
    expect(fuzzRule, 'should have a decision rule pointing to fuzz').toBeDefined()
  })

  it('decision-rule table has a "repair" trigger', () => {
    const content = readFileSync(SKILL_MD, 'utf8')
    const rules = parseDecisionRuleTable(content)
    const repairRule = rules.find((r) => r.verb.toLowerCase().includes('repair'))
    expect(repairRule, 'should have a decision rule pointing to repair').toBeDefined()
  })

  // NOTE: "judge" is intentionally NOT pinned here — see comment in the
  // "exactly 4 rows" test above. It IS asserted in the frontmatter description
  // test (all 5 verbs) and in the bin shim help-output test.
})

describe('ink-ui-explorer package.json', () => {
  const PKG = path.join(SKILL_DIR, 'package.json')

  it('package.json exists', () => {
    expect(existsSync(PKG), `Expected ${PKG} to exist`).toBe(true)
  })

  it('peerDependencies includes react and ink', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as Record<string, unknown>
    const peers = pkg['peerDependencies'] as Record<string, string>
    expect(peers).toBeDefined()
    expect(Object.keys(peers)).toContain('react')
    expect(Object.keys(peers)).toContain('ink')
  })

  it('dependencies includes string-width, strip-ansi, ansi-regex', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as Record<string, unknown>
    const deps = pkg['dependencies'] as Record<string, string>
    expect(deps).toBeDefined()
    for (const dep of ['string-width', 'strip-ansi', 'ansi-regex']) {
      expect(Object.keys(deps), `should include ${dep}`).toContain(dep)
    }
  })
})
