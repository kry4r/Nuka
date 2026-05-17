/**
 * hello-hook — minimal in-process hook example.
 *
 * Registers a single `afterToolCall` handler that prints the tool name to
 * stderr after every tool execution. Demonstrates the simplest possible
 * shape of an `inProcessHooks:` module:
 *
 *   - default-exported array of { event, handler, id?, priority? } entries
 *   - handler is a plain function; may return void or { skip, data, ... }
 *   - stderr only (never stdout — Nuka's TUI owns stdout)
 *
 * After loading, this plugin's handlers are registered on the shared
 * HookRegistry with the namespaced ID `plugin:hello-hook:log-tool-name`.
 *
 * See docs/plugin-hooks.md for the full contract.
 */

/** @type {Array<import('../../../../src/core/hooks/configLoader.js').HookConfigEntry>} */
const entries = [
  {
    event: 'afterToolCall',
    id: 'log-tool-name',
    priority: 0,
    handler: (ctx) => {
      // ctx.toolName is populated for beforeToolCall / afterToolCall* events.
      // ctx.payload is the event-specific data (opaque to the registry).
      const name = ctx.toolName ?? '<unknown>'
      process.stderr.write(`[hello-hook] afterToolCall tool=${name}\n`)
      // Returning undefined / void leaves the tool result untouched.
    },
  },
]

export default entries
