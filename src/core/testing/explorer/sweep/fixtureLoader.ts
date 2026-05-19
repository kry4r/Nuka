// src/core/testing/explorer/sweep/fixtureLoader.ts
//
// Discovers and loads FixtureDef files from a root directory.
// Glob: **/*.fixtures.tsx (recursive readdirSync, no tinyglobby — M1 patch constraint).
// Dynamic import uses a one-shot tsx.register() so all fixture imports share the same
// Node ESM module cache, keeping a single Ink instance (and its StdoutContext) across
// the explorer process and every loaded fixture.

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { FixtureDef, Viewport } from '../types'
import { VIEWPORT_PROFILES } from './viewportMatrix'

/** One discovered and validated fixture file. */
export type LoadedFixture = {
  path: string
  fixture: FixtureDef
}

/**
 * Collect all *.fixtures.tsx files under `root` (recursive).
 * Non-fixture files are silently skipped.
 */
function collectFixturePaths(root: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(root)) return results

  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFixturePaths(full))
    } else if (entry.isFile() && entry.name.endsWith('.fixtures.tsx')) {
      results.push(full)
    }
  }
  return results.sort()
}

/**
 * Validate that a loaded module export is a FixtureDef shape.
 * Returns the FixtureDef or throws with a descriptive message.
 */
function validateFixtureDef(raw: unknown, filePath: string): FixtureDef {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${filePath}: default export is not an object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj['component'] !== 'string') {
    throw new Error(`${filePath}: FixtureDef.component must be a string`)
  }
  if (!obj['cases'] || typeof obj['cases'] !== 'object') {
    throw new Error(`${filePath}: FixtureDef.cases must be an object`)
  }
  return raw as FixtureDef
}

// Module-scope state — tsx is registered exactly once per process.
// After register(), Node's native ESM loader handles .tsx via tsx's hook and the
// standard module cache deduplicates Ink (and React) across the explorer and every
// fixture, fixing the StdoutContext-instance mismatch.
let tsxRegistered = false
export async function ensureTsxRegistered(): Promise<void> {
  if (tsxRegistered) return
  try {
    const tsx = await import('tsx/esm/api')
    if (typeof tsx.register === 'function') {
      tsx.register() // global, no namespace — shares the ESM module cache
    }
  } catch {
    // Not installed or environment already supports .tsx imports (e.g. vitest).
  }
  tsxRegistered = true
}

/**
 * Load all *.fixtures.tsx files under `root`.
 * Uses a one-shot tsx.register() so that all fixtures share the same Node ESM
 * module graph as the explorer, ensuring a single Ink instance and StdoutContext.
 *
 * @param root  Directory to scan (default: test/ui-auto/fixtures relative to cwd)
 */
export async function loadFixtures(root?: string): Promise<LoadedFixture[]> {
  const fixtureRoot = root ?? path.join(process.cwd(), 'test', 'ui-auto', 'fixtures')
  const paths = collectFixturePaths(fixtureRoot)

  await ensureTsxRegistered()

  const results: LoadedFixture[] = []
  for (const p of paths) {
    const mod = await import(pathToFileURL(p).href) as { default?: FixtureDef } | FixtureDef
    const raw = 'default' in (mod as object) ? (mod as { default?: FixtureDef }).default : mod

    const fixture = validateFixtureDef(raw, p)
    results.push({ path: p, fixture })
  }
  return results
}

/**
 * Return the viewport list for a given fixture.
 * - 'default' or undefined → return VIEWPORT_PROFILES
 * - Viewport[] → return as-is
 */
export function resolveViewports(fixture: FixtureDef): Viewport[] {
  if (!fixture.viewports || fixture.viewports === 'default') {
    return VIEWPORT_PROFILES
  }
  return fixture.viewports
}
