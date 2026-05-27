# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Frontend components in this repo are terminal-first. When text can exceed the
viewport, width must be measured in terminal cells, not code units.

## Required Patterns

### Convention: Keep ESLint 9 on a runnable baseline

**What**: Use the repo-root `eslint.config.js` flat config with the existing
`npm run lint` script. Lint must exit successfully as a baseline gate even
while older unused-variable cleanup remains reported as warnings.

**Why**: ESLint 9 no longer reads legacy `.eslintrc.*` files by default. A
missing flat config prevents lint from inspecting any source code at all, which
hides real regressions behind an infrastructure error.

**Example**:
```bash
npm run lint
```

**Related**: `package.json`, `eslint.config.js`, `npm run typecheck`.

### Convention: Use display-width helpers for visible truncation

**What**: Use `stringWidth` and `truncateByWidth` for terminal text that may
need truncation or alignment.

**Why**: `String.prototype.length` undercounts CJK and emoji. Manual
`slice(0, n)` truncation can still overflow the viewport or cut a grapheme
mid-cluster.

**Example**:
```typescript
import { truncateByWidth } from '../../core/stringWidth'

const width = Math.max(20, columns - 4)
const summary = truncateByWidth(JSON.stringify(call.input), width)
```

**Related**: `useTerminalSize`, `PromptInput`, `Welcome`, `toolSummary`.

### Scenario: Agent runtime frontmatter metadata

#### 1. Scope / Trigger

- Trigger: loose-file or plugin agent definitions add runtime metadata such as
  capability availability requirements or declarative hook/capability
  configuration.

#### 2. Signatures

- Contract owner: `src/core/agents/types.ts`.
- Loader boundary: `AgentDefSchema`, `ResolvedAgentDef`, and
  `SubagentDefinition`.
- Visibility boundary:
  `AgentRegistry.listAvailable(availableCapabilities: readonly string[])` and
  `findAvailable(name, availableCapabilities)`.
- Tool host boundary: public agent tools may accept
  `availableCapabilities?: () => readonly string[]`.

#### 3. Contracts

- `requiredCapabilities?: string[]` contains case-insensitive capability-name
  patterns. Every required pattern must match at least one available capability
  name by substring.
- `capabilities?: JsonValue[]` and `hooks?: JsonValue` are declarative metadata
  only until a later task adds tested capability lifecycle or hook execution
  support.
- Skill-backed services and external service bridges must be exposed through
  this capability abstraction. Do not add a parallel protocol-named product
  surface for agent availability, tool routing, cost attribution, config, or
  UI.
- Public extension surfaces should use capability wording consistently:
  provider-visible loader tool `Capability`, slash entry `/capability`, source
  enum `capability`, TUI badge `[capability]`, and settings label
  `Capabilities`. Older implementation names may remain in internal module
  paths or compatibility aliases only when changing storage/extension formats
  would break existing user data.
- `JsonValue` means JSON primitives, arrays, and string-keyed records only.
  Do not allow functions, `undefined`, symbols, class instances, or other
  non-serializable values through plugin or loose-file schemas.
- Availability callback omitted preserves existing behavior: all registered
  agents remain visible and selectable.
- Availability callback supplied and requirements unmet hides the agent from
  public tool descriptions and rejects direct selection with an unavailable
  message listing required capabilities.

#### 4. Tests Required

- Loader tests for loose-file YAML/JSON/Markdown preservation of
  `requiredCapabilities`, `capabilities`, and `hooks`.
- Plugin-loader tests proving `resolveAgentDef` preserves the fields and the
  schema rejects non-JSON metadata.
- Registry tests for required-capability filtering and capability extraction
  from skill names, tool names, and tool tags.
- Dispatch/spawn tests for description filtering, direct-selection rejection,
  and unchanged no-filter behavior.

### Convention: Verify native cursor position from ANSI output

**What**: For focused Ink inputs, test the terminal cursor using production
`renderWithViewport` cursor traces, not only mocked `useCursor` calls.

**Why**: Ink writes fullscreen output without a trailing newline when rendered
height reaches `stdout.rows`. In that mode, `ESC[nA` movement starts from the
last visible row instead of the row after the output. A cursor position that
looks correct in a standalone component can land one row too high in the full
App and overlap the prompt border.

**Example**:
```typescript
const frame = handle.lastFrame()
const cursor = handle.cursorTraces().at(-1)!
const targetLine = frame.split('\n').length - 1 - (cursor.up ?? 0)

expect(frame.split('\n')[targetLine]).toContain('│ >')
```

**Related**: `PromptInput`, `renderWithViewport`, `FakeStdout.cursorEvents`.

### Convention: Keep shared navigation state ref-backed across nested Ink inputs

**What**: When App-level navigation state is also reachable through a child
`useInput` handler, keep the "is this mode active?" flag in a ref that the
shared callback reads.

**Why**: Ink input handlers are subscribed per render. A child prompt handler
can receive the next key before the parent has re-subscribed with state from
the previous key. For example, `Ctrl+O` can visually open a read/diff detail
while the following PageDown still calls an older navigation closure unless
the open-detail state is ref-backed.

**Example**:
```typescript
const expandedIdsRef = useRef(expandedIds)
expandedIdsRef.current = expandedIds

const onNavigate = useCallback((action: PromptNavigationAction) => {
  if (expandedIdsRef.current.size > 0) {
    scrollExpandedDetail(action)
    return
  }
  scrollConversation(action)
}, [])
```

**Related**: `App`, `PromptInput`, `Messages`, `test/tui/app.test.tsx`.

### Convention: Split rare full-screen TUI dialogs out of the startup bundle

**What**: Full-screen dialogs that are only opened by explicit commands
or secondary flows should be exported from `src/tui/dialogs/fullDialogComponents.ts`
and loaded through the computed `new URL('./tui-dialogs.js', import.meta.url)`
sidecar pattern. Keep `App.tsx` placeholders small while the sidecar loads.

**Why**: Literal dynamic imports and static `App.tsx` imports can be folded by
esbuild into `dist/cli.js`, making normal startup pay for rarely used
settings, onboarding, stats, and doctor views. The bundle-size gate requires
`dist/cli.js` to stay under `CLI_BUNDLE_CEILING_BYTES`.

**Example**:
```typescript
const distUrl = new URL('./tui-dialogs.js', import.meta.url).href
const mod = await import(distUrl)
```

**Related**: `scripts/build.mjs`, `src/tui/dialogs/fullDialogComponents.ts`,
`test/build/bundle-size.test.ts`, `test/build/explorerBundle.test.ts`.

### Scenario: Lazy slash-command sidecars

#### 1. Scope / Trigger

- Trigger: a slash command is useful in interactive sessions but not needed
  during normal startup, and its implementation imports formatting,
  aggregation, validation, or reporting logic that pushes `dist/cli.js`
  toward the bundle-size ceiling.

#### 2. Signatures

- Proxy signature:
  `makeLazySlashCommand(meta: LazySlashMetadata, loader: LazySlashLoader): SlashCommand`.
- Sidecar entry signature:
  `src/slash/extra.ts` re-exports concrete `SlashCommand` objects such as
  `CostCommand`, `GoalCommand`, and `PermissionsCommand`.
- Build artifact:
  `scripts/build.mjs` emits `dist/slash-extra.js`.

#### 3. Contracts

- `src/cli.tsx` registers the proxy command at boot so slash suggestions,
  descriptions, usage, and examples are available synchronously.
- The proxy loads the real command with the computed
  `new URL('./slash-extra.js', import.meta.url)` production path, falling back
  to `new URL('./slash/extra.ts', import.meta.url)` in dev mode.
- The loader memoizes the sidecar module so multiple rare commands share one
  dynamic import.
- The sidecar must be marked external in the production `dist/cli.js` build.

#### 4. Validation & Error Matrix

- Missing production sidecar with dev source available -> load the source
  fallback.
- Missing production sidecar and missing source fallback -> command run rejects
  like any other slash-command failure.
- Duplicate slash proxy name -> `SlashRegistry.register` throws the existing
  duplicate slash error.
- Sidecar added without build output -> `test/build/bundle-size.test.ts` fails
  because `dist/slash-extra.js` is missing or empty.

#### 5. Good/Base/Bad Cases

- Good: `/goal`, `/cost`, and `/permissions` keep metadata in the startup
  registry but load implementation code only when run.
- Base: small commands like `/exit`, `/clear`, and `/new` stay eager because
  their bodies are tiny and sidecar indirection would add complexity without
  reducing meaningful startup bytes.
- Bad: importing `CostCommand` or `GoalCommand` directly in `src/cli.tsx` after
  moving them to the sidecar, because esbuild will put their implementation
  back into `dist/cli.js`.

#### 6. Tests Required

- Unit: `test/slash/lazy.test.ts` must prove metadata is preserved, loading is
  lazy, and the real command is cached after first run.
- Build: `test/build/bundle-size.test.ts` must assert both the CLI ceiling and
  the existence of `dist/slash-extra.js`.
- Regression: command-specific slash tests remain against the concrete command
  modules, while CLI bundle tests prove the production split still holds.

#### 7. Wrong vs Correct

Wrong:
```typescript
import { CostCommand } from './slash/cost'
slash.register(CostCommand)
```

Correct:
```typescript
const CostSlashCommand = makeLazySlashCommand({
  name: 'cost',
  description: 'Show cost and token breakdown',
}, async () => loadSlashExtraCommand('CostCommand'))
slash.register(CostSlashCommand)
```

### Convention: Keep red explorer snapshots out of default sweeps

**What**: Fixtures that intentionally render a broken or pre-fix state must set
`sweepMode: 'explicit-only'`. Default `sweep()` runs must skip those fixtures;
tests that assert red-snapshot behavior must opt in with
`includeExplicitOnly: true` and should load only the snapshot fixture they are
asserting.

**Why**: Red snapshots are useful for dogfooding repair and failure-dump flows,
but they are not product regressions. Letting them run in default sweeps prints
misleading `FAIL` rows during otherwise green verification and makes TUI quality
signals harder to trust.

**Example**:
```typescript
const result = await sweep({
  cwd: scratch,
  includeExplicitOnly: true,
  _fixtures: [{ path: fixturePath, fixture: redSnapshotFixture }],
})
```

**Related**: `src/core/testing/explorer/sweep/sweep.ts`,
`test/core/testing/explorer/sweep/sweep.test.ts`,
`test/core/testing/explorer/dogfood/bugB-sweep.test.ts`.

## Forbidden Patterns

- Using `.length` or `.slice()` to cap visible terminal text when display
  width matters.
- Re-implementing width-aware truncation in a component when the shared helper
  already exists.
- Adding a literal dynamic import for a rare TUI dialog when a computed
  sidecar import is required to keep esbuild from bundling it into `cli.js`.
- Eagerly importing a rare observability slash command into `src/cli.tsx` when
  only its metadata is needed at boot.
- Running `explicit-only` explorer fixtures in ordinary sweep or full-suite
  paths without a targeted red-snapshot assertion.

## Testing Requirements

- Add a narrow viewport fixture for any text that can exceed the frame.
- Assert the visible tail or ellipsis that proves the text was truncated by
  display width.
- Keep the sweep baseline honest: a fixed regression fixture should fail on the
  broken implementation and pass after the width-aware fix.
- Keep default explorer sweeps green-only. If a test needs red snapshots, mark
  the fixture `explicit-only`, pass `includeExplicitOnly: true`, and assert the
  expected failure records directly.
- For native cursor bugs, include a production-mode App or fullscreen viewport
  regression that converts `cursorTraces().at(-1).up` back into a visible row
  and asserts it lands on the editable text row, not a border.
- After moving or adding rare full-screen dialogs, run `npm run build` and the
  bundle-size gates.
- After moving or adding rare lazy slash commands, run
  `npm test -- test/slash/lazy.test.ts test/build/bundle-size.test.ts test/build/explorerBundle.test.ts`
  plus `npm run build`.

## Common Mistakes

- Treating ESLint's missing-config failure as a source lint failure. First add
  or repair `eslint.config.js`; then triage actual lint findings.
- Writing a fixture that asserts the full original string for content that is
  intentionally truncated.
- Assuming CJK characters are width 1.
- Treating mocked `useCursor` coordinates as sufficient coverage for a TUI
  cursor bug. The user-visible cursor is the ANSI suffix after Ink decides
  whether the output is fullscreen.
- Assuming a visual state change from one keypress means the next keypress sees
  that state in every nested `useInput` closure. Cover the full key path when
  navigation behavior crosses App and PromptInput.
- Assuming `await import('./SomeDialog')` is lazy in the production bundle.
  Literal dynamic imports can still pull the dialog into `dist/cli.js`; use
  the computed sidecar URL pattern for startup-size-sensitive dialog code.
- Adding new command logic directly to the CLI import list because the command
  is "just text output." Aggregation and schema helpers can still push the
  startup bundle over the budget; check the esbuild metafile or bundle gate.
- Treating a green Vitest exit as enough when sweep logs contain unrelated
  `FAIL` rows. First check whether a red snapshot leaked into a default sweep.
