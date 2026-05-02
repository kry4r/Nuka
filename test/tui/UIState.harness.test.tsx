// test/tui/UIState.harness.test.tsx
//
// Phase 12 M6 — end-to-end harness pass over every UIState transition.
//
// Drives App through the full state machine:
//   normal → slash:list → slash:arg-hint → submenu (full, /settings) →
//   inline submenu (permission) → back to normal
//
// At each transition asserts the hide rules from spec §4.3:
//
//   UIState                 | Conversation | Tasks      | Prompt   | Status   | Slash card | Submenu
//   ------------------------|--------------|------------|----------|----------|------------|--------
//   normal                  | shown        | shown*     | shown    | shown    | —          | —
//   tasks-collapsed         | shown        | summary    | shown    | shown    | —          | —
//   slash                   | shown        | hidden     | shown    | replaced | shown      | —
//   submenu (full)          | shown        | hidden     | hidden   | hidden   | —          | shown
//   submenu (inline)        | shown        | shown      | hidden   | shown    | —          | shown
//
// (*) Tasks frame is hidden when all sources are empty (spec §4.4).
//
// The full-submenu transition uses the `/settings` flow exactly as the user
// would; the inline-submenu transition is exercised by calling
// `permissionBridge.ask(...)` directly (the harness exposes the bridge).

import { describe, it, expect } from 'vitest'
import { mountApp } from '../../src/tui/testing/harness'
import { SlashRegistry } from '../../src/slash/registry'
import { SettingsCommand } from '../../src/slash/settings'
import { ModelCommand } from '../../src/slash/model'

// Anchor strings rendered in each zone — used to assert visibility.
const STATUS_ANCHOR = /⬢ idle|⬢ awaiting/   // Status panel mode badge
const PROMPT_ANCHOR = /│ >/                   // PromptInput border + cursor
const SLASH_LIST_ANCHOR = /\/settings/        // CommandList row
const ARG_HINT_ANCHOR = /Usage/               // ArgHint card
// The SettingsSubmenu footer renders the unique hint string "j/k · ⏎ open"
// while the rail is in nav mode. No slash description contains this, so
// it disambiguates "settings menu open" from "command list shows /settings".
const FULL_SUB_ANCHOR = /↑↓ select · ⏎ open/
const PERMISSION_ANCHOR = /Yes, once|No$/m     // PermissionDialog options

const wait = (ms = 60) => new Promise(r => setTimeout(r, ms))

describe('Phase 12 M6 — UIState e2e harness', () => {
  it('drives normal → slash:list → slash:arg-hint → submenu(full) → submenu(inline) → normal, asserting §4.3 hide rules at each step', async () => {
    const slash = new SlashRegistry()
    slash.register(SettingsCommand)
    slash.register(ModelCommand)
    const cfg = {
      providers: [
        { id: 'p', name: 'p', format: 'openai', baseUrl: 'https://api.example.com', models: ['m'] },
      ],
      active: { providerId: 'p' },
    } as any

    const h = mountApp({ target: 'app', slash, config: cfg })
    try {
      // --- Step 1: normal ----------------------------------------------------
      // Welcome (no messages yet) + Prompt + Status all visible.
      await wait()
      const f0 = h.frames().pop() ?? ''
      expect(f0).toMatch(STATUS_ANCHOR)        // Status shown
      expect(f0).toMatch(PROMPT_ANCHOR)        // Prompt shown
      expect(f0).not.toMatch(SLASH_LIST_ANCHOR) // no slash card
      expect(f0).not.toMatch(FULL_SUB_ANCHOR)   // no submenu

      // --- Step 2: normal → slash:list ---------------------------------------
      h.stdin.write('/')
      await h.waitFor({ contains: '/settings' })
      const f1 = h.frames().pop() ?? ''
      expect(f1).toMatch(SLASH_LIST_ANCHOR)       // SlashCard visible
      expect(f1).toMatch(PROMPT_ANCHOR)            // Prompt still shown
      // Status now stays visible during slash so the user keeps live context.
      expect(f1).toMatch(STATUS_ANCHOR)
      expect(f1).not.toMatch(/Tasks ▸/)             // Tasks hidden (collapsed-summary not shown either)
      expect(f1).not.toMatch(FULL_SUB_ANCHOR)       // no submenu

      // --- Step 3: slash:list → slash:arg-hint -------------------------------
      h.stdin.write('settings ')                // type space — switches to arg-hint
      await h.waitFor({ contains: 'Usage' })
      const f2 = h.frames().pop() ?? ''
      expect(f2).toMatch(ARG_HINT_ANCHOR)            // ArgHint card
      expect(f2).toMatch(PROMPT_ANCHOR)              // Prompt still shown
      expect(f2).toMatch(STATUS_ANCHOR)              // Status stays visible
      expect(f2).not.toMatch(/builtins \(/)          // grouped list NOT visible

      // --- Step 4: slash → submenu (full, /settings) -------------------------
      // The current input is "/settings ". Submitting it runs /settings (the
      // SlashRegistry parses by name, ignoring trailing args), which dispatches
      // a `dialog: { kind: 'settings' }` SlashResult and opens the SettingsSubmenu.
      h.stdin.write('\r')                         // submit
      // SettingsSubmenu menu state — footer hint anchors the open state.
      await h.waitFor({ contains: '↑↓ select' }, 1000)
      const f3 = h.frames().pop() ?? ''
      expect(f3).toMatch(FULL_SUB_ANCHOR)          // SettingsSubmenu visible
      expect(f3).not.toMatch(STATUS_ANCHOR)         // Status hidden
      expect(f3).not.toMatch(PROMPT_ANCHOR)         // Prompt hidden
      expect(f3).not.toMatch(/Tasks ▸/)             // Tasks hidden
      expect(f3).not.toMatch(SLASH_LIST_ANCHOR)     // slash card gone

      // --- Step 5: submenu(full) → normal ------------------------------------
      h.stdin.write('\u001B')                      // Esc closes submenu
      await h.waitFor({ regex: '⬢ idle' })
      const f4 = h.frames().pop() ?? ''
      expect(f4).toMatch(STATUS_ANCHOR)            // Status back
      expect(f4).toMatch(PROMPT_ANCHOR)            // Prompt back
      expect(f4).not.toMatch(FULL_SUB_ANCHOR)      // submenu gone

      // --- Step 6: normal → submenu (inline, permission) ---------------------
      // Drive the inline submenu by asking the permission bridge directly.
      const decisionPromise = h.permissionBridge.ask({
        call: { tool: 'Bash', input: { command: 'rm -rf /' }, hint: 'Bash' },
        annotationBadges: ['destructive'],
      })
      await h.waitFor({ contains: 'Yes, once' })
      const f5 = h.frames().pop() ?? ''
      // Inline submenu rules per §4.3:
      //   - PermissionDialog visible
      //   - Status still visible (inline keeps Status)
      //   - Prompt replaced (no PROMPT_ANCHOR)
      expect(f5).toMatch(PERMISSION_ANCHOR)
      expect(f5).toMatch(STATUS_ANCHOR)
      expect(f5).not.toMatch(PROMPT_ANCHOR)

      // Decide → returns to normal.
      // PermissionDialog default cursor for destructive is the LAST option
      // (No / Deny). Pressing Enter resolves with allowed:false.
      h.stdin.write('\r')
      const decision = await decisionPromise
      expect(decision.allowed).toBe(false)

      await h.waitFor({ regex: '⬢ idle' })
      const f6 = h.frames().pop() ?? ''
      expect(f6).toMatch(STATUS_ANCHOR)
      expect(f6).toMatch(PROMPT_ANCHOR)
      expect(f6).not.toMatch(PERMISSION_ANCHOR)
    } finally {
      h.unmount()
    }
    // Bumped from 10s to 30s: the e2e harness drives many state transitions
    // (slash → arg-hint → submenu full → inline → normal) and gets squeezed
    // when vitest is running the full suite in parallel — passes < 1s alone.
  }, 30_000)

  it('Ctrl+T toggles tasks-collapsed; Status / Prompt remain visible per §4.3', async () => {
    const h = mountApp({ target: 'app' })
    try {
      await wait()
      // Baseline normal — Tasks frame absent because all sources empty.
      const f0 = h.frames().pop() ?? ''
      expect(f0).toMatch(STATUS_ANCHOR)
      expect(f0).toMatch(PROMPT_ANCHOR)
      expect(f0).not.toMatch(/Tasks ▸/)

      // Ctrl+T -> collapsed summary row visible.
      h.stdin.write('\u0014')
      await h.waitFor({ regex: 'Tasks ▸' })
      const f1 = h.frames().pop() ?? ''
      expect(f1).toMatch(/Tasks ▸/)
      expect(f1).toMatch(STATUS_ANCHOR)        // Status still shown
      expect(f1).toMatch(PROMPT_ANCHOR)        // Prompt still shown

      // Ctrl+T again -> back to normal.
      h.stdin.write('\u0014')
      await wait()
      const f2 = h.frames().pop() ?? ''
      expect(f2).not.toMatch(/Tasks ▸/)
      expect(f2).toMatch(STATUS_ANCHOR)
      expect(f2).toMatch(PROMPT_ANCHOR)
    } finally {
      h.unmount()
    }
  }, 5_000)
})
