// test/core/tools/shellQuoteTool.test.ts
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { ShellQuoteTool } from '../../../src/core/jsonEscape/shellQuoteTool'

const ctx = { signal: new AbortController().signal, cwd: process.cwd() }

describe('ShellQuoteTool', () => {
  it('declares no permission (pure transform)', () => {
    expect(ShellQuoteTool.needsPermission({ command: 'echo' })).toBe('none')
  })

  it('returns command alone when there are no args', async () => {
    const r = await ShellQuoteTool.run({ command: 'ls' }, ctx)
    expect(r.isError).toBe(false)
    expect(r.output).toBe('ls')
  })

  it('quotes args that contain spaces with single quotes', async () => {
    const r = await ShellQuoteTool.run(
      { command: 'echo', args: ['hello world'] },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toBe("echo 'hello world'")
  })

  it('neutralises a command-injection attempt via $(…)', async () => {
    // If the quoting were broken, sh -c would execute the inner $(rm -rf /).
    // We don't actually run rm — instead we run sh -c with the quoted
    // string and confirm the literal $(…) bytes are echoed back, NOT
    // expanded.
    const malicious = '$(echo PWNED)'
    const r = await ShellQuoteTool.run(
      { command: 'echo', args: [malicious] },
      ctx,
    )
    expect(r.isError).toBe(false)
    // The quoted form must wrap the entire $(…) so the shell sees it
    // as one literal arg.
    expect(r.output).toBe("echo '$(echo PWNED)'")
    // End-to-end: hand the quoted string to /bin/sh -c and confirm it
    // does NOT execute the inner command.
    const out = spawnSync('sh', ['-c', String(r.output)], { encoding: 'utf8' })
    expect(out.status).toBe(0)
    // The literal `$(echo PWNED)` is echoed; the substitution does not
    // run, so the string "PWNED\n" (without the surrounding `$()`) is
    // NOT what we see — we see the literal bytes back.
    expect(out.stdout).toBe('$(echo PWNED)\n')
  })

  it('neutralises a command-injection attempt via shell metacharacters', async () => {
    // `; rm -rf /` is the canonical injection — we confirm it appears
    // as one literal arg to echo, not as a second command.
    const malicious = 'safe; rm -rf /'
    const r = await ShellQuoteTool.run(
      { command: 'echo', args: [malicious] },
      ctx,
    )
    expect(r.isError).toBe(false)
    expect(r.output).toBe("echo 'safe; rm -rf /'")
    const out = spawnSync('sh', ['-c', String(r.output)], { encoding: 'utf8' })
    expect(out.status).toBe(0)
    expect(out.stdout).toBe('safe; rm -rf /\n')
  })

  it('handles args that themselves contain single quotes', async () => {
    const r = await ShellQuoteTool.run(
      { command: 'echo', args: ["it's"] },
      ctx,
    )
    expect(r.isError).toBe(false)
    // canonical bash workaround: close single-quote, escape the ', reopen.
    expect(r.output).toBe("echo 'it'\\''s'")
    const out = spawnSync('sh', ['-c', String(r.output)], { encoding: 'utf8' })
    expect(out.status).toBe(0)
    expect(out.stdout).toBe("it's\n")
  })

  it('supports forced double-quote style for backtick injection', async () => {
    // Backtick-substitution is the other classic injection vector.
    // With style: 'double', the backtick is backslash-escaped so the
    // shell sees a literal backtick.
    const malicious = 'a`echo PWNED`b'
    const r = await ShellQuoteTool.run(
      { command: 'echo', args: [malicious], style: 'double' },
      ctx,
    )
    expect(r.isError).toBe(false)
    // `style: 'double'` is forced for both the binary and every arg —
    // even the already-safe `echo` is double-quoted (which is still
    // valid POSIX and parses identically). The backtick is escaped so
    // command substitution cannot run.
    expect(r.output).toBe('"echo" "a\\`echo PWNED\\`b"')
    const out = spawnSync('sh', ['-c', String(r.output)], { encoding: 'utf8' })
    expect(out.status).toBe(0)
    expect(out.stdout).toBe('a`echo PWNED`b\n')
  })
})
