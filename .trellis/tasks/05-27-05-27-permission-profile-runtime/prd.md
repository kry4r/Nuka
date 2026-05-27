# Permission profile runtime

## Goal

Land Codex-style permission profiles as a small runtime slice: typed config,
inheritance, enforcement in `PermissionChecker`, and visible `/permissions`
audit output.

## Requirements

- Add `permissions.active` and named `permissions.profiles` config with Zod
  validation and project-scope loading.
- Support built-in read-only, workspace, and danger-full-access profiles plus
  user-defined profile inheritance with cycle / missing-parent errors.
- Enforce resolved profile rules before session cache or UI prompt decisions.
- Expose the active profile and catalog through `/permissions`.

## Acceptance Criteria

- [x] Config loading preserves project-scoped permission profile settings.
- [x] Profile resolution handles built-ins, inheritance, managed refresh, and
  invalid inheritance errors.
- [x] `PermissionChecker` deny/allow/ask behavior follows the active profile.
- [x] `/permissions` renders active profile rules and catalog summaries.
