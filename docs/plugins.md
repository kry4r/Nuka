# Nuka Plugin Guide

## Plugin manifest formats

Nuka supports two manifest file formats for plugins: `plugin.yaml` and `plugin.json`.

### plugin.yaml (Nuka-specific)

YAML manifests are supported by Nuka but **not** by Nuka-Code. If you write a plugin using `plugin.yaml` and run it under Nuka-Code, it will silently fail to load. Nuka emits a startup warning when loading any YAML-format plugin.

```yaml
# plugin.yaml — works in Nuka only
name: my-plugin
version: "1.0.0"
description: Example plugin (YAML format)
tools:
  - tools/hello.mjs
slashCommands:
  - commands/greet.mjs
skills:
  - skills/helper.md
hooks: hooks.json
```

### plugin.json (portable)

JSON manifests are supported by both Nuka and Nuka-Code. If you want your plugin to be portable, use `plugin.json`.

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "Example plugin (JSON format, portable)",
  "tools": ["tools/hello.mjs"],
  "slashCommands": ["commands/greet.mjs"],
  "skills": ["skills/helper.md"],
  "hooks": "hooks.json"
}
```

## Portability caveat

| Feature | Nuka | Nuka-Code |
|---|---|---|
| `plugin.json` manifest | Yes | Yes |
| `plugin.yaml` manifest | Yes | No |
| Plugin hooks (`hooks.json`) | Yes | No |

**Recommendation:** Always use `plugin.json` if you want your plugin to work in both Nuka and Nuka-Code.

## Plugin hooks (Nuka-specific)

Plugins can register lifecycle hooks via a `hooks.json` file. The manifest `hooks` field points to this file (relative path from the plugin directory).

```json
{
  "hooks": [
    {
      "event": "beforeToolCall",
      "tool": "Bash",
      "command": "/abs/path/audit.sh",
      "timeoutMs": 5000
    },
    {
      "event": "afterTurn",
      "command": "notify-send 'Nuka turn done'"
    }
  ]
}
```

### Supported events

| Event | Cancelable | Description |
|---|---|---|
| `beforeToolCall` | Yes | Fires before a tool is executed. Return `{"cancel":true}` with exit 1 to veto. |
| `afterToolCall` | No | Fires after a tool result is received. |
| `afterTurn` | No | Fires at the end of a turn (when the assistant produces no tool calls). |
| `beforeAutoCompact` | Yes | Fires before auto-compaction. Return `{"cancel":true}` with exit 1 to skip. |

### Hook payload

Each hook receives a JSON object on stdin describing the event. A non-zero exit code combined with `{"cancel":true}` in stdout cancels the operation (for cancelable events). Exceptions and timeouts (default 10 seconds) are logged as warnings and do not interrupt the agent loop.
