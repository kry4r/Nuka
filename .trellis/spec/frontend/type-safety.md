# Type Safety

> Type safety patterns in this project.

---

## Overview

The project is TypeScript-first and uses Zod for runtime validation at
configuration and external-input boundaries. Core contracts should be explicit,
serializable, and testable.

---

## Type Organization

- Put public runtime contracts near their owner:
  `src/core/agents/types.ts`, `src/core/tasks/types.ts`,
  `src/core/events/types.ts`, `src/core/session/types.ts`.
- Put component prop types next to the component, exporting them only when
  reused by tests or other modules.
- Use local private types for display models. Example:
  `src/tui/Tasks/columnReducer.ts` defines `ColumnKind`, `Row`, and
  `ColumnsState`.
- Prefer discriminated unions for event payloads, task specs, provider events,
  and command effects. This keeps switch statements exhaustive and readable.
- Import types with `import type` when no runtime value is needed.

---

## Validation

Use Zod for config and user/plugin-provided structured data:

```typescript
export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  format: ProviderFormatSchema,
  baseUrl: z.string().url(),
  models: z.array(z.string()).default([]),
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
```

Reference: `src/core/config/schema.ts`,
`src/core/agents/subagentLoader.ts`, `src/core/plugin/manifest.ts`,
`src/core/keybindings/schema.ts`.

Validation should happen at boundaries:

- config load/save;
- plugin and subagent definition loading;
- slash/tool input parsing when a schema exists;
- persisted metadata recovery where corrupt files must not crash startup.

## Common Patterns

- Infer TypeScript types from Zod schemas with `z.infer`.
- Use `Pick<>` for component-facing slices of large core types. Example:
  `StatusPanelProps.goal` accepts only `objective` and `status` from
  `SessionGoal`.
- Keep serializable sidecar fields simple: strings, numbers, booleans, arrays,
  records, and discriminated object shapes.
- Normalize optional source labels and metadata before storing them, as
  `CostTracker` does for `source` / `sources`.
- Use explicit return types on exported components and important core helpers:
  `React.JSX.Element`, `Promise<T>`, or named result types.

---

## Forbidden Patterns

- Do not introduce `any` for new public contracts. If a dynamic payload is
  unavoidable, narrow it at the boundary and convert it into a typed shape.
- Do not cast parsed config or plugin data to an interface without validation.
- Do not rely on stringly typed event names without a corresponding typed
  payload union in `src/core/events/types.ts` or the relevant module.
- Do not expose a new option in config or subagent frontmatter without adding
  schema validation and a load test.
- Do not represent terminal-visible width with string length; visible width is
  a display contract, not just a type.
