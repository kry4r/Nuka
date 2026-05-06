// src/tui/inkStdin.ts
//
// Phase D1 — per-render fake-TTY stdin for Ink.
//
// Returns the real `process.stdin` when it's already a TTY; otherwise a thin
// proxy that pretends to be a TTY for Ink's setRawMode / ref / unref paths
// but proxies all event/data methods through to the real stream.  Avoids
// mutating `process.stdin` globally so non-TTY callers branching on
// `process.stdin.isTTY` still see the truth.
//
// Background: Ink 6.8's `App.handleSetRawMode` reads `stdin.isTTY` directly
// off props (see node_modules/ink/build/components/App.js line 46).  When
// the real stdin is a pipe, isTTY is false and Ink throws inside its
// ErrorBoundary; the resulting ErrorOverview emits a React duplicate-key
// warning because raw stack-frame strings repeat.  Passing this proxy as
// `render(<App/>, { stdin: makeInkStdin() })` short-circuits the throw.

export function makeInkStdin(): NodeJS.ReadStream {
  if (process.stdin.isTTY) return process.stdin
  const real = process.stdin
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'isTTY') return true
      if (prop === 'setRawMode') return () => target
      if (prop === 'ref' || prop === 'unref') return () => target
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as NodeJS.ReadStream
}
