# hello-hook — in-process hook example

A minimal Nuka plugin demonstrating the `inProcessHooks:` manifest field.

It registers one `afterToolCall` handler that writes the tool name to
`stderr` after every tool call:

```
[hello-hook] afterToolCall tool=Bash
[hello-hook] afterToolCall tool=Read
```

See [`docs/plugin-hooks.md`](../../../docs/plugin-hooks.md) for the full
field contract, event list, and security notes.

## Layout

```
hello-hook/
  plugin.yaml          # manifest, declares inProcessHooks: hooks/index.mjs
  hooks/
    index.mjs          # default-exports a HookConfigEntry[]
  README.md            # this file
```

## Install (system-wide)

Copy or symlink the plugin into your Nuka plugins directory, then restart
Nuka. The directory under `~/.nuka/plugins/` becomes the plugin slug — name
it the same as the manifest `name` field for clarity.

```bash
ln -s "$(pwd)/examples/plugins/hello-hook" ~/.nuka/plugins/hello-hook
nuka
```

Or copy it:

```bash
mkdir -p ~/.nuka/plugins
cp -r examples/plugins/hello-hook ~/.nuka/plugins/
nuka
```

On startup you should see a line like:

```
[plugin:hello-hook] tools=0 slash=0 skills=0 hooks=0 agents=0 lsp=0 inProcessHooks=1
```

Then exercise any tool (e.g. ask the agent to `ls`) and watch `stderr` for
`[hello-hook] afterToolCall tool=...` lines.

## Install (session-only)

Use `--plugin-dir` to load every plugin under a parent directory without
installing into `~/.nuka/plugins/`. The flag is repeatable. The path you
pass is the **parent** of plugin directories, not the plugin itself.

```bash
nuka --plugin-dir examples/plugins
```

Session plugins survive only for the current invocation; nothing is written
to `~/.nuka/`.

## Validate the manifest

Nuka ships an author-side validator that checks the manifest against the
schema:

```bash
nuka plugin validate examples/plugins/hello-hook
```

It confirms the manifest is structurally valid (including
`inProcessHooks: string`). It does **not** currently `import()` the handler
module — catch import errors by installing and launching as above.

## Uninstall

Remove the symlink or directory from `~/.nuka/plugins/`:

```bash
rm ~/.nuka/plugins/hello-hook
```

Or from a TUI session:

```
/plugin uninstall hello-hook
```

## Security

In-process handlers run inside the Nuka process with full Node.js
privileges — no sandbox. Audit any third-party plugin's handler module
before installing. See the [Security section in the
guide](../../../docs/plugin-hooks.md#security).
