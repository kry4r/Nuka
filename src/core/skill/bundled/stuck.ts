// src/core/skill/bundled/stuck.ts
//
// Tier-1 #3 — diagnose frozen/slow Nuka sessions. Ported from
// Nuka-Code's `src/skills/bundled/stuck.ts`. The original's
// Slack/MCP "post findings" instructions are dropped (Nuka invariant:
// no MCP). The diagnostic flow is preserved and ends with "report
// findings to the user" instead. Env-gated via `NUKA_SKILL_STUCK=1`
// (debugging-only, off by default).

import { registerBundledSkill } from '../bundled'

const STUCK_PROMPT = `# Stuck — diagnose frozen/slow Nuka sessions

The user thinks another Nuka session on this machine is frozen, stuck, or very slow. Investigate and report findings back to the user.

## What to look for

Scan for other Nuka processes (excluding the current one). Process names are typically \`nuka\` (installed) or \`node\` running \`nuka\` dev builds.

Signs of a stuck session:
- **High CPU (>=90%) sustained** — likely an infinite loop. Sample twice, 1-2s apart, to confirm it's not a transient spike.
- **Process state \`D\` (uninterruptible sleep)** — often an I/O hang. The \`state\` column in \`ps\` output; first character matters (ignore modifiers like \`+\`, \`s\`, \`<\`).
- **Process state \`T\` (stopped)** — user probably hit Ctrl+Z by accident.
- **Process state \`Z\` (zombie)** — parent isn't reaping.
- **Very high RSS (>=4GB)** — possible memory leak making the session sluggish.
- **Stuck child process** — a hung \`git\`, \`node\`, or shell subprocess can freeze the parent. Check \`pgrep -lP <pid>\` for each session.

## Investigation steps

1. **List all Nuka processes** (macOS/Linux):
   \`\`\`
   ps -axo pid=,pcpu=,rss=,etime=,state=,comm=,command= | grep -E '(nuka|node)' | grep -v grep
   \`\`\`
   Filter to rows where \`comm\` is \`nuka\` or where the command path mentions \`nuka\`.

2. **For anything suspicious**, gather more context:
   - Child processes: \`pgrep -lP <pid>\`
   - If high CPU: sample again after 1-2s to confirm it's sustained
   - If a child looks hung (e.g., a git command), note its full command line with \`ps -p <child_pid> -o command=\`

3. **Consider a stack dump** for a truly frozen process (advanced, optional):
   - macOS: \`sample <pid> 3\` gives a 3-second native stack sample
   - Only grab it if the process is clearly hung and you want to know *why*

## Report

**Only report findings to the user if you actually found something stuck.** If every session looks healthy, tell the user that directly. When you do find a stuck/slow session, include:

- PID, CPU%, RSS, state, uptime, command line, child processes
- Your diagnosis of what's likely wrong
- Any captured \`sample\` output

## Notes

- Don't kill or signal any processes — this is diagnostic only.
`

export function registerStuckSkill(): void {
  if (process.env['NUKA_SKILL_STUCK'] !== '1') return
  registerBundledSkill({
    name: 'stuck',
    description: 'Investigate frozen/stuck/slow Nuka sessions on this machine.',
    when: { keyword: ['stuck', 'frozen', 'hung', 'unresponsive'] },
    body: STUCK_PROMPT,
  })
}
