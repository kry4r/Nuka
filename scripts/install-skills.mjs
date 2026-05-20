#!/usr/bin/env node
// scripts/install-skills.mjs
//
// Copy canonical skill source from skills/<name>/ → ~/.claude/skills/<name>/.
// Idempotent; safe to run on every pretest invocation.
//
// Why a script and not a one-liner? The cp(1) flag surface differs between
// GNU coreutils and BSD; fs.cpSync is platform-neutral. The bin shim must
// remain executable after copy, which fs.cpSync preserves (mode 0o755).

import { cpSync, chmodSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(REPO_ROOT, 'skills')

// Install into every detected agent platform that uses the SKILL.md convention.
// ~/.claude/skills/  — Claude Code (always create if missing).
// ~/.codex/skills/   — Codex CLI (only if ~/.codex exists; don't create the
//                      parent, which would suggest Codex is installed when it isn't).
const HOME = os.homedir()
const TARGETS = [
  { dest: path.join(HOME, '.claude', 'skills'), createParent: true },
  { dest: path.join(HOME, '.codex',  'skills'), createParent: false },
]
const PATH_BIN_DIR = path.join(HOME, '.nuka', 'bin')

if (!existsSync(SRC_ROOT)) {
  // Nothing to install — repo has no skill sources.
  process.exit(0)
}

for (const { dest: DEST_ROOT, createParent } of TARGETS) {
  if (!createParent && !existsSync(path.dirname(DEST_ROOT))) continue
  mkdirSync(DEST_ROOT, { recursive: true })

  for (const entry of ['ink-ui-explorer']) {
    const src = path.join(SRC_ROOT, entry)
    if (!existsSync(src)) continue
    const dest = path.join(DEST_ROOT, entry)
    cpSync(src, dest, { recursive: true })
    // Re-assert +x on bin/<entry> after copy (fs.cpSync should preserve mode,
    // but make this resilient against future Node behavior changes).
    const binPath = path.join(dest, 'bin', entry)
    if (existsSync(binPath)) chmodSync(binPath, 0o755)
  }
}

for (const entry of ['ink-ui-explorer']) {
  const binPath = path.join(SRC_ROOT, entry, 'bin', entry)
  if (!existsSync(binPath)) continue
  mkdirSync(PATH_BIN_DIR, { recursive: true })
  chmodSync(binPath, 0o755)
  const linkPath = path.join(PATH_BIN_DIR, entry)
  rmSync(linkPath, { force: true })
  symlinkSync(binPath, linkPath)
}
