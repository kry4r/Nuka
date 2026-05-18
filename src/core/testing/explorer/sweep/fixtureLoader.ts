// src/core/testing/explorer/sweep/fixtureLoader.ts
//
// Discovers and loads FixtureDef files from a root directory.
// Glob: **/*.fixtures.tsx (recursive readdirSync, no tinyglobby — M1 patch constraint).
// Dynamic import uses tsImport (tsx/esm api) so .tsx loads in dist/explorer.js runtime.

import fs from 'node:fs'
import path from 'node:path'
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

/**
 * Load all *.fixtures.tsx files under `root`.
 * Uses tsImport (tsx esm api) for .tsx support at runtime (dist/explorer.js).
 * Vitest tests can use direct import() since vitest already transforms tsx.
 *
 * @param root  Directory to scan (default: test/ui-auto/fixtures relative to cwd)
 */
export async function loadFixtures(root?: string): Promise<LoadedFixture[]> {
  const fixtureRoot = root ?? path.join(process.cwd(), 'test', 'ui-auto', 'fixtures')
  const paths = collectFixturePaths(fixtureRoot)

  const results: LoadedFixture[] = []
  for (const p of paths) {
    let raw: unknown
    try {
      // Use tsImport so .tsx files load correctly from dist/explorer.js runtime.
      // tsImport falls back gracefully in a tsx-aware environment (vitest).
      const { tsImport } = await import('tsx/esm/api')
      const mod = await tsImport(p, import.meta.url) as { default?: FixtureDef } | FixtureDef
      raw = 'default' in (mod as object) ? (mod as { default?: FixtureDef }).default : mod
    } catch {
      // tsImport unavailable (pure vitest context where tsx/esm is not registered
      // but import() natively handles .tsx via vite transform)
      const mod = await import(p) as { default?: FixtureDef } | FixtureDef
      raw = 'default' in (mod as object) ? (mod as { default?: FixtureDef }).default : mod
    }

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
