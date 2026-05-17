// test/core/diff/applyDiffPermissionHook.test.ts
//
// Permission-gate hook for ApplyDiff. Covers:
//   - HookHandler shape compatibility (registers + invokes via the real
//     HookRegistry, not just direct factory invocation).
//   - Allow / deny based on extracted target paths.
//   - Multi-path inputs (allow only if every path is under a root).
//   - Multiple field-name inputs (path / file_path / filename and array
//     variants).
//   - Relative-path resolution against an explicit `cwd`.
//   - Path-traversal hardening (`../../etc/passwd` must not bypass).
//   - Empty allow-list → all denied.
//   - Passthrough when the tool name doesn't match.
//   - Custom `extractPaths` override.

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  HookRegistry,
  type InvocationResult,
} from '../../../src/core/hooks'
import { createApplyDiffPermissionHandler } from '../../../src/core/diff/applyDiffPermissionHook'
import { formatUnifiedDiff } from '../../../src/core/diff/format'

const TOOL = 'TestApplyDiff'

/**
 * Sugar: build a registry with the handler registered, then invoke
 * beforeToolCall once and return the first invocation result. Tests
 * exercise the registry path (not just the bare handler) so the brief's
 * "Returns a HookHandler shape compatible with `registry.register`"
 * requirement is enforced by every test.
 */
async function fire(opts: {
  allowedRoots: string[]
  cwd?: string
  input: unknown
  toolName?: string
  // The toolName that the registry invokes with — defaults to TOOL so
  // the handler matches; tests that exercise passthrough pass a
  // different name.
  invokeToolName?: string
  extractPaths?: (input: unknown) => string[]
}): Promise<InvocationResult> {
  const registry = new HookRegistry()
  const handler = createApplyDiffPermissionHandler({
    allowedRoots: opts.allowedRoots,
    cwd: opts.cwd,
    toolName: opts.toolName ?? TOOL,
    extractPaths: opts.extractPaths,
  })
  registry.register('beforeToolCall', handler, { id: 'gate' })
  const results = await registry.invoke('beforeToolCall', {
    toolName: opts.invokeToolName ?? TOOL,
    payload: { input: opts.input },
  })
  expect(results).toHaveLength(1)
  return results[0]
}

/** Assert a single InvocationResult is a successful "skip" with a reason. */
function expectDenied(r: InvocationResult, reasonMatch?: RegExp): void {
  expect(r.outcome).toBe('success')
  if (r.outcome !== 'success') return
  expect(r.result?.skip).toBe(true)
  if (reasonMatch !== undefined) {
    expect(r.result?.reason).toMatch(reasonMatch)
  }
}

/** Assert a single InvocationResult is a successful "allow" (no skip). */
function expectAllowed(r: InvocationResult): void {
  expect(r.outcome).toBe('success')
  if (r.outcome !== 'success') return
  // Allow is signalled by `skip` being absent or false.
  expect(r.result?.skip).not.toBe(true)
}

/** Build a minimal modify-diff naming `filename`. */
function makeDiff(filename: string): string {
  return formatUnifiedDiff('one\ntwo\n', 'one\nTWO\n', { filename })
}

describe('createApplyDiffPermissionHandler — HookRegistry integration', () => {
  it('produces a value that HookRegistry.register accepts and invokes', async () => {
    // Smoke: a path under the allowed root → allow. This also confirms
    // the handler is a valid HookHandler (the registry would have
    // thrown otherwise).
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
    })
    expectAllowed(r)
  })
})

describe('createApplyDiffPermissionHandler — allow / deny', () => {
  it('allows a path under the only allowed root', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
    })
    expectAllowed(r)
  })

  it('allows when the path is under any of several allowed roots', async () => {
    const r = await fire({
      allowedRoots: ['/other', '/workspace'],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
    })
    expectAllowed(r)
  })

  it('denies a path outside every allowed root', async () => {
    const r = await fire({
      allowedRoots: ['/workspace/src'],
      cwd: '/workspace',
      input: { diff: makeDiff('/etc/passwd') },
    })
    expectDenied(r, /outside allowed roots/)
  })

  it('mentions the offending path and the configured roots in the reason', async () => {
    const r = await fire({
      allowedRoots: ['/workspace/src'],
      cwd: '/workspace',
      input: { diff: makeDiff('/etc/shadow') },
    })
    expect(r.outcome).toBe('success')
    if (r.outcome !== 'success') return
    expect(r.result?.reason).toContain('/etc/shadow')
    expect(r.result?.reason).toContain('/workspace/src')
  })
})

describe('createApplyDiffPermissionHandler — multi-path', () => {
  it('allows when every diff path is under an allowed root', async () => {
    const diff =
      makeDiff('src/a.ts') + makeDiff('src/sub/b.ts')
    const r = await fire({
      allowedRoots: ['/workspace/src'],
      cwd: '/workspace',
      input: { diff },
    })
    expectAllowed(r)
  })

  it('denies if any single diff path escapes the allow-list', async () => {
    const diff =
      makeDiff('src/a.ts') + makeDiff('/etc/passwd')
    const r = await fire({
      allowedRoots: ['/workspace/src'],
      cwd: '/workspace',
      input: { diff },
    })
    expectDenied(r, /\/etc\/passwd/)
  })
})

describe('createApplyDiffPermissionHandler — fallback field names', () => {
  it('reads a single path from `path`', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: 'src/a.ts' },
    })
    expectAllowed(r)
  })

  it('reads a single path from `file_path`', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { file_path: 'src/a.ts' },
    })
    expectAllowed(r)
  })

  it('reads a single path from `filename`', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { filename: 'src/a.ts' },
    })
    expectAllowed(r)
  })

  it('reads a multi-path array from `paths` (allow if all under)', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { paths: ['src/a.ts', 'src/b.ts'] },
    })
    expectAllowed(r)
  })

  it('reads a multi-path array from `paths` (deny if any outside)', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { paths: ['src/a.ts', '/etc/passwd'] },
    })
    expectDenied(r, /\/etc\/passwd/)
  })
})

describe('createApplyDiffPermissionHandler — relative path resolution', () => {
  it('resolves a relative target against the configured cwd', async () => {
    // `src/a.ts` resolved against `/workspace` is `/workspace/src/a.ts`,
    // which lives under the allowed root `/workspace`.
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: 'src/a.ts' },
    })
    expectAllowed(r)
  })

  it('resolves a relative allowed root against the configured cwd', async () => {
    // `./inner` resolved against `/workspace` is `/workspace/inner`; a
    // target at `/workspace/inner/x.ts` should pass.
    const r = await fire({
      allowedRoots: ['./inner'],
      cwd: '/workspace',
      input: { path: '/workspace/inner/x.ts' },
    })
    expectAllowed(r)
  })

  it('rejects a relative target that resolves outside the allow-list', async () => {
    // `cwd` is `/workspace/sub`, but the only allowed root is
    // `/workspace/other`. A relative `x.ts` resolves to
    // `/workspace/sub/x.ts` — not under `/workspace/other`.
    const r = await fire({
      allowedRoots: ['/workspace/other'],
      cwd: '/workspace/sub',
      input: { path: 'x.ts' },
    })
    expectDenied(r)
  })
})

describe('createApplyDiffPermissionHandler — path traversal', () => {
  it('rejects ../../etc/passwd via `path` fallback', async () => {
    // Resolved against `/workspace`, `../../etc/passwd` collapses to
    // `/etc/passwd` — must NOT bypass.
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: '../../etc/passwd' },
    })
    expectDenied(r, /\/etc\/passwd|outside allowed roots/)
  })

  it('rejects a sibling directory whose name starts with .. (no false positive on /workspaceX)', async () => {
    // `/workspaceX/foo` shares a prefix with `/workspace` lexically but
    // is NOT under it; the implementation uses path.relative + ..
    // detection so this should deny.
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: '/workspaceX/foo' },
    })
    expectDenied(r)
  })

  it('rejects a diff with /dev/null source but a target outside the root (create)', async () => {
    // Build a synthetic diff text that names /etc/cron.d/evil as the
    // new file. `parseUnifiedDiff` will surface that name; the gate
    // must reject it.
    const diff =
      '--- /dev/null\n' +
      '+++ /etc/cron.d/evil\n' +
      '@@ -0,0 +1,1 @@\n' +
      '+pwned\n'
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff },
    })
    expectDenied(r, /\/etc\/cron\.d\/evil/)
  })
})

describe('createApplyDiffPermissionHandler — empty allow-list', () => {
  it('denies a normal call when allowedRoots is empty', async () => {
    const r = await fire({
      allowedRoots: [],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
    })
    expectDenied(r, /outside allowed roots/)
  })
})

describe('createApplyDiffPermissionHandler — passthrough', () => {
  it('returns allow ({}) when the tool name does not match', async () => {
    const r = await fire({
      allowedRoots: [],
      cwd: '/workspace',
      input: { diff: makeDiff('/etc/passwd') },
      toolName: TOOL,
      invokeToolName: 'NotMyTool',
    })
    expectAllowed(r)
  })

  it('does not interfere with a different tool when the same registry has the gate', async () => {
    const registry = new HookRegistry()
    registry.register(
      'beforeToolCall',
      createApplyDiffPermissionHandler({
        allowedRoots: ['/workspace'],
        cwd: '/workspace',
        toolName: TOOL,
      }),
    )
    const results = await registry.invoke('beforeToolCall', {
      toolName: 'OtherTool',
      payload: { input: { path: '/etc/passwd' } },
    })
    expect(results).toHaveLength(1)
    expectAllowed(results[0])
  })
})

describe('createApplyDiffPermissionHandler — malformed input', () => {
  it('denies (fail-closed) when input is undefined', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: undefined,
    })
    expectDenied(r, /could not extract target path/)
  })

  it('denies (fail-closed) when input has no known path fields', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { unrelated: 'value' },
    })
    expectDenied(r, /could not extract target path/)
  })

  it('denies (fail-closed) when diff text is unparseable', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff: 'not a real diff' },
    })
    expectDenied(r, /could not extract target path/)
  })
})

describe('createApplyDiffPermissionHandler — extractPaths override', () => {
  it('uses the caller-supplied extractor instead of the default', async () => {
    // Inject an extractor that ignores the input and always returns
    // `/etc/passwd`; gate should deny regardless of what the input
    // actually carries.
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
      extractPaths: () => ['/etc/passwd'],
    })
    expectDenied(r, /\/etc\/passwd/)
  })

  it('treats empty extractor return as "could not extract"', async () => {
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { diff: makeDiff('src/a.ts') },
      extractPaths: () => [],
    })
    expectDenied(r, /could not extract target path/)
  })
})

describe('createApplyDiffPermissionHandler — defaults', () => {
  it('defaults toolName to ApplyDiff when omitted', async () => {
    // Build a handler with no toolName override and invoke for
    // 'ApplyDiff'. Should engage the gate and deny.
    const registry = new HookRegistry()
    registry.register(
      'beforeToolCall',
      createApplyDiffPermissionHandler({
        allowedRoots: ['/workspace'],
        cwd: '/workspace',
        // toolName omitted on purpose
      }),
    )
    const results = await registry.invoke('beforeToolCall', {
      toolName: 'ApplyDiff',
      payload: { input: { diff: makeDiff('/etc/passwd') } },
    })
    expect(results).toHaveLength(1)
    expectDenied(results[0])
  })

  it('does not engage the default-name gate for an unrelated tool', async () => {
    const registry = new HookRegistry()
    registry.register(
      'beforeToolCall',
      createApplyDiffPermissionHandler({
        allowedRoots: ['/workspace'],
        cwd: '/workspace',
      }),
    )
    const results = await registry.invoke('beforeToolCall', {
      toolName: 'Read',
      payload: { input: { path: '/etc/passwd' } },
    })
    expect(results).toHaveLength(1)
    expectAllowed(results[0])
  })
})

describe('createApplyDiffPermissionHandler — boundary cases', () => {
  it('allows a target exactly equal to an allowed root', async () => {
    // Edge case: the allowed root itself is the target. `path.relative`
    // returns '' for self → must be treated as "under".
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: '/workspace' },
    })
    expectAllowed(r)
  })

  it('allows a deeply nested path under a root', async () => {
    const deep = join('/workspace', 'a', 'b', 'c', 'd', 'e', 'f.ts')
    const r = await fire({
      allowedRoots: ['/workspace'],
      cwd: '/workspace',
      input: { path: deep },
    })
    expectAllowed(r)
  })
})
