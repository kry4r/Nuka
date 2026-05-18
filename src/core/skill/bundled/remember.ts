// src/core/skill/bundled/remember.ts
//
// Tier-1 #4 — persist a fact to user memdir. Ported from Nuka-Code's
// `src/skills/bundled/remember.ts`. Body is content-only (instructions
// on how to use Nuka's memdir subsystem); no runtime dep on memdir
// internals. Env-gated via `NUKA_SKILL_REMEMBER=1`.

import { registerBundledSkill } from '../bundled'

const REMEMBER_PROMPT = `# Remember — persist a fact to user memdir

The user wants you to remember something across sessions. Use the memdir subsystem to persist the fact as a small structured note.

## How to save

1. Distill the fact into a single sentence of useful, durable context. Examples:
   - "User prefers TypeScript strict mode and refuses \`any\`."
   - "User's primary editor is Helix; they avoid GUI tools."
   - "When debugging hooks, user wants pipeline mode (\`NUKA_HOOK_PIPELINE_MODE=pipeline\`)."
2. Avoid duplicates — first scan existing memdir entries (under \`~/.nuka/memdir/\`). If a near-duplicate exists, update it instead of adding a new note.
3. Avoid noise — don't save transient facts (e.g. the current branch name, the file you just edited). Save only patterns and preferences that will be useful in future sessions.
4. Avoid PII unless the user explicitly named it for storage.

## Format

Each note is a single markdown file. Filename is a short kebab-case slug of the fact. Body is one short paragraph; the first line is the fact, optionally followed by 1-3 bullets of context.

## Confirmation

After saving, tell the user briefly: "Saved to memdir: <slug>". Do not echo the full content back unless asked.
`

export function registerRememberSkill(): void {
  if (process.env['NUKA_SKILL_REMEMBER'] !== '1') return
  registerBundledSkill({
    name: 'remember',
    description: 'Persist user preferences and durable facts to memdir.',
    when: { keyword: ['remember', 'memorize', 'save to memory'] },
    body: REMEMBER_PROMPT,
  })
}
