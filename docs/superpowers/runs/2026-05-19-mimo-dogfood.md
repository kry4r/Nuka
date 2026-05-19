# Mimo Dogfood Run — 2026-05-19

**Date**: 2026-05-19  
**Tip commit**: `49e517c`  
**Mimo model**: `mimo-v2-omni` (provider id: `custom`, format: `openai`)  
**Demo level achieved**: **C** (Mimo HTTP call → fixture → skill `capture` + `sweep` analysis)

---

## Why Demo C (not A or B)

After inspecting `src/cli.tsx`, Nuka has no non-interactive mode. All argv branches
are subcommands (`explore`, `doctor`, `init`, `plugin`, `config show`, `--test-plan`),
and the default path falls through to an interactive Ink `App` rendered with `render()`
from ink, requiring a TTY. There is no `--prompt`, `--exec`, `--input-file`, or
`--non-interactive` flag. Demo A and B require inventing CLI features that don't exist.

Demo C was the strongest achievable path using existing primitives.

---

## What Was Done

### Step 1 — Mimo API call

`scripts/mimo-dogfood.mjs` reads `~/.nuka/config.yaml` at runtime (apiKey never echoed
or committed), resolves the active provider (`custom`/xiaomi), and POSTs to
`${baseUrl}/chat/completions`.

Prompt sent:
```
Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}
```

**Observation**: `mimo-v2-omni` is a chain-of-thought reasoning model. It expends its token
budget generating `reasoning_content` before producing `content`. At 64 tokens (call 1),
`content` was empty (`finish_reason=length`). At 256 tokens (call 2), the model produced a
partial output before hitting the limit:

```
{"greeting":"hello","from":"mimo","status"
```

The `reasoning_content` field confirmed the model understood the task; it was converging
toward the correct JSON output but ran out of completion tokens. **Total Mimo API calls: 2.
Total tokens consumed: ~548 (prompt: 274×2, completion: 0+256=256).**

### Step 2 — Fixture

`test/ui-auto/fixtures/mimo-dogfood-response.fixtures.tsx` was created with two cases:
- `actual-truncated-reply`: the real truncated output from call 2
- `expected-complete-reply`: what the model was converging toward (confirmed by `reasoning_content`)

The fixture renders a simulated Nuka TUI chat frame using pure Ink `<Box>` / `<Text>` components.

### Step 3 — Skill capture (via `_fixtureDef` backdoor)

`scripts/mimo-capture-frame.mjs` (invoked with `node --import=tsx/esm`) uses the
`capture` function from `dist/explorer.js` with the `_fixtureDef` internal backdoor
to bypass the gap where `nuka explore capture <file.tsx>` does not call `tsx.register()`
before `import(fixturePath)`. This is a known limitation documented below.

**Captured ASCII frame at 80×24** (`actual-truncated-reply`):
```
╭──────────────────────────────────────────────────────────────────────────────╮
│┌────────────────────────────────────────────────────────────────────────────┐│
││ Nuka ↔ Mimo Dogfood Run 2026-05-19 [model: mimo-v2-omni]                   ││
│└────────────────────────────────────────────────────────────────────────────┘│
│ > Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}           │
│ ~                                                                            │
│ {"greeting":"hello","from":"mimo","status"                                   │
│ [truncated: finish_reason=length, 256 completion_tokens]                     │
│ provider: custom (xiaomi) · format: openai                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Artifact: `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-actual-truncated-reply-80x24.txt`

**Captured ASCII frame at 80×24** (`expected-complete-reply`):
```
╭──────────────────────────────────────────────────────────────────────────────╮
│┌────────────────────────────────────────────────────────────────────────────┐│
││ Nuka ↔ Mimo Dogfood Run 2026-05-19 [model: mimo-v2-omni]                   ││
│└────────────────────────────────────────────────────────────────────────────┘│
│ > Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}           │
│ ~                                                                            │
│ {"greeting":"hello","from":"mimo","status":"ok"}                             │
│ provider: custom (xiaomi) · format: openai                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
```

Artifact: `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-expected-complete-reply-80x24.txt`

### Step 4 — Skill L1 invariant output

Both captures: **0 violations** (grid hash `909cadb4…`, 3 boxes detected).

Sweep run via `nuka explore sweep` over all fixtures (including mimo dogfood):
- `MimoDogfoodResponse / actual-truncated-reply` — **14/14 viewports PASS** (60×30 → 140×60)
- `MimoDogfoodResponse / expected-complete-reply` — **14/14 viewports PASS**

L1 invariants checked per viewport: `noContentBeyondColumns`, `noBorderBleed`,
`noOverlapBetweenZones`, `noLossyTruncation`, `flexGrowBounded`, `noStaticWrites`.

---

## Artifacts

| File | Purpose |
|---|---|
| `scripts/mimo-dogfood.mjs` | Mimo API driver (reads config at runtime, apiKey never committed) |
| `scripts/mimo-capture-frame.mjs` | Fixture renderer using `dist/explorer.js` `capture` backdoor |
| `test/ui-auto/fixtures/mimo-dogfood-response.fixtures.tsx` | Demo fixture embedding actual Mimo response |
| `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-actual-truncated-reply-80x24.txt` | ASCII frame (truncated reply) |
| `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-actual-truncated-reply-80x24.json` | Grid JSON + violations |
| `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-expected-complete-reply-80x24.txt` | ASCII frame (complete reply) |
| `.ink-explorer/runs/mimo-dogfood/captures/mimodogfoodresponse-expected-complete-reply-80x24.json` | Grid JSON + violations |

---

## Honest Limitations

1. **No live Nuka capture**: The skill is fixture-driven. It cannot attach to a running
   `nuka` process and observe its rendered frames. Bridging this would require a new
   `capture --live <pid>` verb (or a PTY-capture approach) — out of scope here.

2. **`nuka explore capture <file.tsx>` gap**: The `capture` CLI verb calls `import(fixturePath)`
   without first calling `tsx.register()`, so `.tsx` fixture files fail with
   `Unknown file extension ".tsx"`. The `sweep` verb works because it uses `fixtureLoader`
   which calls `ensureTsxRegistered()`. Fix: call `ensureTsxRegistered()` at the top of
   `capture()` before the dynamic import.

3. **mimo-v2-omni token budget problem**: `mimo-v2-omni` is a chain-of-thought reasoning
   model that generates extensive `reasoning_content` before producing `content`. Short
   `max_tokens` budgets (64, 256) are consumed by reasoning before any content is emitted.
   For real Nuka sessions with this model, users should be aware that token costs are
   dominated by reasoning. For dogfood testing, use a simpler prompt or set
   `max_tokens >= 512`.

4. **Two API calls instead of one**: Call 1 (64 tokens) produced empty content. Call 2
   (256 tokens) produced the partial output used in the fixture. The 3-call budget was
   respected.

---

## Next Steps

- Fix the `nuka explore capture` tsx-loader gap (one-line fix in `capture.ts`).
- Add a `--max-tokens` tuning note to the Mimo provider docs for reasoning models.
- Consider a `capture --live` verb backed by PTY interception for true live-session observation.
