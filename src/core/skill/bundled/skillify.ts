// src/core/skill/bundled/skillify.ts
//
// Tier-1 #5 — extract a recurring workflow into a Nuka skill.
// Ported from Nuka-Code's `src/skills/bundled/skillify.ts`. The
// upstream's dynamic session-summary helpers (`getSessionMemoryContent`
// / `getMessagesAfterCompactBoundary`) are omitted — the body instead
// asks the model to derive context itself from recent messages.
// Always-on (no env gate); keyword-activated.

import { registerBundledSkill } from '../bundled'

const SKILLIFY_PROMPT = `# Skillify — extract a reusable skill from this conversation

The user wants to capture a recurring workflow as a Nuka skill so it can be activated automatically in future sessions.

## Step 1: Identify the workflow

Read back through this session (most recent 20-30 messages) and find:

1. A concrete sequence of steps the user explicitly or implicitly relies on
2. Activation cues — what keywords / phrases the user uses when this workflow applies
3. Constraints — invariants, output formats, tools the user expects to be used

Surface the identified workflow back to the user in 3-5 bullets and confirm before writing anything.

## Step 2: Decide scope

Skills live at one of two paths:

- **Project**: \`.nuka/skills/<name>.md\` — checked into the repo, applies to this codebase only
- **Global**: \`~/.nuka/skills/<name>.md\` — applies to all sessions on this machine

Default to project scope unless the workflow is editor- or machine-level.

## Step 3: Author the skill file

Use this frontmatter shape (validated by Nuka at load time):

\`\`\`markdown
---
name: my-skill-name
description: One sentence on when to use this skill.
when:
  keyword:
    - cue word
    - another cue
requires:
  - tag1
---

# Body

The body is the prompt injected when the skill activates. Write it as
direct, second-person instructions to the agent.
\`\`\`

- \`name\`: kebab-case, unique
- \`description\`: shown in skill listings
- \`when.keyword\`: array of substrings matched case-insensitively against the user prompt
- \`requires\`: optional capability tags that union with the always-on \`core\` set

## Step 4: Write it

Use the Write tool to create the file. Then confirm to the user:

> Saved <scope> skill: <name>. It will activate when you mention: <keywords>.
`

export function registerSkillifySkill(): void {
  registerBundledSkill({
    name: 'skillify',
    description:
      'Extract a recurring workflow from the current session into a reusable Nuka skill.',
    when: { keyword: ['skillify', 'extract skill', 'make a skill'] },
    body: SKILLIFY_PROMPT,
  })
}
