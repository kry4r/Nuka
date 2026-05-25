# Subagent Resume/Fork Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development before product-code edits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and rehydrate subagent write-scope and transcript context across spawn/resume/send without changing the public lifecycle tool names.

**Architecture:** Add one typed write-scope contract in `src/core/tasks/types.ts`, persist it through task meta/transcript sidecars, and format it into deterministic context sections in `spawn_agent` and follow-up tools. Keep enforcement out of this child task; this is the metadata and provider-visible contract needed for later enforcement.

**Tech Stack:** TypeScript, Vitest, Nuka core task sidecars, existing `dispatchAgent` wrappers.

---

### Task 1: Spawn-Time Write Scope Contract

**Files:**
- Modify: `src/core/tasks/types.ts`
- Modify: `src/core/agents/spawnTool.ts`
- Test: `test/core/agents/spawnTool.test.ts`

- [x] **Step 1: Write the failing test**

Add a test proving `spawn_agent` accepts `write_scope`, trims path entries,
stores it on the queued `LocalAgentSpec`, and includes a deterministic
`Write scope:` section in `context`.

- [x] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- test/core/agents/spawnTool.test.ts
```

Expected: fail because `write_scope` is not in the schema/spec.

- [x] **Step 3: Implement minimal spawn support**

Add `LocalAgentWriteScope`, `SpawnAgentInput.write_scope`, a local normalizer,
and merge the formatted scope note into the existing context pipeline.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/core/agents/spawnTool.test.ts
```

Expected: pass.

### Task 2: Persist Scope Sidecars

**Files:**
- Modify: `src/core/tasks/meta.ts`
- Test: `test/core/tasks/manager.test.ts`

- [x] **Step 1: Write the failing test**

Extend the transcript sidecar test to enqueue a local agent with `writeScope`
and assert both `<task>.meta.json` and `<task>.transcript.json` persist it.

- [x] **Step 2: Run the test to verify RED**

Run:

```bash
npm test -- test/core/tasks/manager.test.ts
```

Expected: fail because sidecars do not include `writeScope`.

- [x] **Step 3: Implement persistence**

Thread `writeScope` through `TaskMeta`, `TaskTranscript`, `fromTask()`, and
`transcriptFromMeta()`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/core/tasks/manager.test.ts
```

Expected: pass.

### Task 3: Rehydrate Scope and Transcript for Follow-Ups

**Files:**
- Modify: `src/core/agents/agentLifecycleTools.ts`
- Test: `test/core/agents/agentLifecycleTools.test.ts`

- [x] **Step 1: Write the failing tests**

Add one in-memory resume test and one persisted resume/send test proving the
rebuilt `LocalAgentSpec` preserves `writeScope` and provider-visible prompts
contain prior transcript lines, the write-scope section, the new instruction,
and caller-supplied context.

- [x] **Step 2: Run the tests to verify RED**

Run:

```bash
npm test -- test/core/agents/agentLifecycleTools.test.ts
```

Expected: fail because `writeScope` is not recovered.

- [x] **Step 3: Implement follow-up rehydration**

Extend `ResumeSeed` with `writeScope`; recover it from in-memory specs and
persisted meta/transcript; include it in the rebuilt `LocalAgentSpec` and
formatted context.

- [x] **Step 4: Verify GREEN**

Run:

```bash
npm test -- test/core/agents/agentLifecycleTools.test.ts
```

Expected: pass.

### Task 4: Focused Gate and Roadmap Update

**Files:**
- Modify: `docs/plans/2026-05-23-nuka-objective-roadmap.md`
- Modify: `.trellis/tasks/05-26-subagent-resume-fork-scope/prd.md`

- [x] **Step 1: Run focused regression**

Run:

```bash
npm test -- test/core/agents/spawnTool.test.ts test/core/agents/agentLifecycleTools.test.ts test/core/tasks/manager.test.ts
npm run typecheck
git diff --check
```

- [x] **Step 2: Record evidence**

Update the roadmap and this PRD with the exact passing command set and any
remaining limitations.
