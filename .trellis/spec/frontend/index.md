# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

This directory contains project-specific guidelines for Nuka's Ink terminal UI
and the frontend-facing core contracts that feed it.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition | Filled |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, subscriptions, input ownership | Filled |
| [State Management](./state-management.md) | Local state, runtime state, persistence boundaries | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Type Safety](./type-safety.md) | Type patterns, validation | Filled |

---

## Pre-Development Checklist

Before changing frontend/TUI code:

1. Read [Directory Structure](./directory-structure.md) for file placement.
2. Read [Component Guidelines](./component-guidelines.md) before editing Ink components.
3. Read [Hook Guidelines](./hook-guidelines.md) before changing `useInput`,
   subscriptions, terminal size handling, or prompt-related hooks.
4. Read [State Management](./state-management.md) before moving data between
   App state, core managers, session metadata, task sidecars, or config.
5. Read [Type Safety](./type-safety.md) before adding config, event, task,
   provider, subagent, or plugin contracts.
6. Read [Quality Guidelines](./quality-guidelines.md) before any visible TUI
   layout, statusline, prompt, dialog, or bundle-boundary change.

Run `ink-ui-explorer` capture/sweep or the relevant `test/tui/*` harness after
meaningful Ink layout changes.

---

**Language**: All documentation should be written in **English**.
