<div align="center">

<img src="assets/logo.png" width="128" height="128" alt="Nuka" />

# Nuka

**A plugin-first, agent-swarm CLI coding assistant.**

[![tests](https://img.shields.io/badge/tests-849%20passing-brightgreen)]()
[![bundle](https://img.shields.io/badge/bundle-237%20KB-blue)]()
[![status](https://img.shields.io/badge/status-active-success)]()
[![license](https://img.shields.io/badge/license-TBD-lightgrey)]()

Stream-rendered TUI · MCP servers · plugin marketplace · multi-expert agents · LSP-aware tools — all in a single ~240 KB bundle.

[English](README.md) · [简体中文](README.zh-CN.md)

</div>

---

## ✨ Highlights

| | |
|---|---|
| **🎯 Plugin-first** | Tools, slash commands, MCP servers, hooks, agents, output renderers, LSP servers — all flow through one manifest. |
| **🤖 Agent swarm** | Plugins declare specialist agents. Main agent dispatches with isolated sessions, filtered tools, up to 4 in parallel. |
| **🔌 Provider-agnostic** | Anthropic + OpenAI today. New providers in ~150 LOC. |
| **📦 Marketplace** | Install from URL index, git, npm, or `.mcpb`/`.dxt` bundles. Versioned cache. Dependency closure. |
| **🛡️ Permission-aware** | Read-only / destructive / network annotations drive prompt UX. Per-session consent cache. |
| **📁 LSP integration** | Stdio LSP servers. Diagnostics / definition / references as agent tools. Auto `didChange` on `Write`/`Edit`. |

---

## 🚀 Quickstart

```bash
git clone https://github.com/kry4r/Nuka.git
cd Nuka && npm install && npm run build && npm link
```

Configure a provider in `~/.nuka/config.yaml`:

```yaml
providers:
  - id: anthropic
    type: anthropic
    apiKey: sk-ant-...
    model: claude-opus-4-7
defaultProvider: anthropic
```

Run:

```bash
nuka
```

---

## 🏗 Architecture

```
                ┌─────────────────────┐
                │     src/cli.tsx     │
                │  providers·sessions │
                │  permission·slash   │
                └──────────┬──────────┘
                           │
                  ┌────────▼────────┐
                  │  agent/loop.ts  │  streaming · parallel batches
                  │                 │  hooks · channels · autocompact
                  └─┬──────┬──────┬─┘
                    │      │      │
            ┌───────▼─┐ ┌──▼───┐ ┌▼──────────┐
            │  Tools  │ │Skills│ │ Provider  │
            └────┬────┘ └──────┘ └───────────┘
                 │
       ┌─────────┼─────────────────────────────┐
       │         │                             │
   ┌───▼───┐ ┌───▼────┐ ┌──────────┐ ┌─────────▼────┐
   │  MCP  │ │Plugins │ │  Agents  │ │     LSP      │
   │client │ │ wire   │ │ dispatch │ │ jsonrpc·docs │
   │mgr    │ │market  │ │ registry │ │ manager·tools│
   └───────┘ └────────┘ └──────────┘ └──────────────┘
```

### Module map

```
src/core/
  agent/         loop · events · system prompt · progress pump
  agents/        dispatch · registry · tool filter
  config/        4-scope cascade (enterprise/user/project/local)
  hooks/         lifecycle hooks (execa runner)
  lsp/           jsonrpc · client · doc tracker · manager · tools
  mcp/           client · transports · reconnect · elicitation
  notifications/ channels (webhook/command)
  permission/    checker · bridge · pattern cache
  plugin/        manifest · install · deps · marketplace · userConfig
  provider/      Anthropic · OpenAI adapters
  tools/         registry · validate · concurrency · content blocks
src/slash/       /plugin · /help · plugin-contributed
src/tui/         Ink renderer · dialogs · message rows
```

---

## 🧩 Plugin manifest

```yaml
name: my-plugin
version: 1.0.0

# Capabilities
tools:        [tools/foo.js]
slashCommands:[slash/bar.js]
skills:       [skills/baz.md]
hooks:        hooks.json
mcpServers:   { fs: { type: stdio, command: ... } }
lspServers:   [{ name: ts, command: typescript-language-server, ... }]

# Multi-expert agents
agents:
  - name: reviewer
    description: Reviews code for style + correctness
    systemPrompt: You are a strict reviewer...
    allowedTools: [Read, Grep, Glob]
    keywords: [review, audit]

# UI customization
outputStyles: [{ name: gh, matchToolName: "mcp__github__*", componentPath: ... }]
channels:     [{ name: slack, allowlist: [tool_result], dispatch: { type: webhook, url: ... } }]

# Configuration
userConfig:   { fields: [{ name: token, type: string, required: true }] }
dependencies: [{ name: shared-lib, required: true }]
```

---

## 🤖 Auto-test mode

Nuka ships a headless TUI test harness. Plans are YAML files in `test-plans/`
that mount the app, send keystrokes, and assert on rendered frames.

```bash
# Run a plan (pretty reporter, default)
nuka --test-plan test-plans/01-offline-boot.yaml

# TAP output for CI
nuka --test-plan test-plans/01-offline-boot.yaml --reporter=tap

# Update snapshots
nuka --test-plan test-plans/01-offline-boot.yaml --update-snapshots

# Run all sample plans via vitest
npx vitest run test/integration/samplePlans.test.ts
```

Five sample plans live in `test-plans/`: offline boot, onboarding wizard,
theme-switch surface, stats view, and plan-mode lockout.

---

## 🎬 Manual test flow

```bash
# Sanity
npm run typecheck && npm test && npm run build

# Interactive
nuka              # Type a prompt. /help for slash commands.

# Plugin smoke
mkdir -p ~/.nuka/plugins/hello/{tools,slash}
# (copy plugin.yaml + greet.js + wave.js — see docs/superpowers/specs/)
nuka              # /plugin list → see hello

# Agent dispatch
# Add `agents: [{ name: reviewer, ... }]` to hello/plugin.yaml
nuka              # "dispatch reviewer to look at src/cli.tsx"
                  # → indented [hello:reviewer] block

# LSP
npm install -g typescript-language-server
# Add `lspServers: [{ name: ts, ... }]` to hello/plugin.yaml
nuka              # "lsp_diagnostics for src/cli.tsx"

# Validate
nuka plugin validate ~/.nuka/plugins/hello

# Config scopes
nuka config show [--scope user]
```

Full 13-step test plan: `docs/superpowers/specs/2026-04-24-phase5-marketplace-agents-design.md`.

---

## 🛣 Phase history

| Phase | Items | Highlight |
|------:|------:|---|
| 1–3 | foundation | agent loop · providers · MCP min · basic plugins |
| **4a** | 21 | timeouts · truncation · listRoots · resource_link · image persist · validation · ContentBlock · hooks · elicitation · SSE · reconnect |
| **4b** | 14 | parallel batches · annotation prompts · scheduling · aliases · userConfig · stderr buffer · LRU cache |
| **5** | 16 | marketplace + git/npm/bundle · deps closure · `/plugin` TUI · **agents swarm** · outputStyles · channels · 4-scope config |
| **6** | 1 | LSP integration |

849 tests · 237 KB bundle · 0 vendored deps for new features.

---

## 📜 License

TBD. All rights reserved by the maintainer until declared.

## 🤝 Contributing

Issues and PRs welcome. Each major change ships a design spec + plan + Gap Closure entry under `docs/superpowers/`.
