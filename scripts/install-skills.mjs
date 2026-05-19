#!/usr/bin/env node
// scripts/install-skills.mjs
//
// Copy canonical skill source from skills/<name>/ → ~/.claude/skills/<name>/.
// Idempotent; safe to run on every pretest invocation.
//
// Why a script and not a one-liner? The cp(1) flag surface differs between
// GNU coreutils and BSD; fs.cpSync is platform-neutral. The bin shim must
// remain executable after copy, which fs.cpSync preserves (mode 0o755).

import { cpSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(REPO_ROOT, 'skills')
const DEST_ROOT = path.join(os.homedir(), '.claude', 'skills')

if (!existsSync(SRC_ROOT)) {
  // Nothing to install — repo has no skill sources.
  process.exit(0)
}

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
