// src/core/outputStyles/types.ts
//
// Schema + public types for user-defined output styles loaded from
// `.nuka/output-styles/`. Mirrors the Nuka-Code shape (markdown file
// with YAML frontmatter), but drops the settings-source / plugin
// coupling — those are part of Nuka-Code's settings system and have no
// counterpart in Nuka.
//
// Format:
//   ---
//   name: explanatory
//   description: short blurb (optional — fallback to first non-blank body line)
//   keepCodingInstructions: true
//   ---
//
//   Body markdown becomes the output-style prompt.
//
// Source semantics match the skill loader (`global` from `$HOME/.nuka/`,
// `project` from `cwd/.nuka/`). Project files override global with the
// same `name`.

import { z } from 'zod'

export const outputStyleFrontmatterSchema = z
  .object({
    /** Display / lookup name. */
    name: z.string().min(1),
    /** Short blurb. Optional — first non-blank line of body acts as fallback. */
    description: z.string().optional(),
    /**
     * If true, the default coding-instructions block stays in the
     * system prompt even when this style is active. Mirrors the
     * Nuka-Code field of the same name. We accept boolean only — the
     * Nuka-Code `'true'`/`'false'` string forms are an upstream legacy
     * compat shim we don't need to inherit.
     */
    keepCodingInstructions: z.boolean().optional(),
  })
  // Permit (and ignore) unknown frontmatter keys for forward-compat.
  // The body is always carried through verbatim, so dropping unknowns
  // here is non-destructive.
  .passthrough()

export type OutputStyleFrontmatter = z.infer<typeof outputStyleFrontmatterSchema>

export type OutputStyleSource = 'global' | 'project'

export type OutputStyle = {
  /** Resolved display name. */
  name: string
  /** Resolved description (frontmatter or body-derived fallback). */
  description: string
  /** Trimmed markdown body — the actual prompt text. */
  prompt: string
  /** Optional persistence of `keepCodingInstructions` for callers. */
  keepCodingInstructions?: boolean
  /** Which `.nuka/output-styles/` root the file came from. */
  source: OutputStyleSource
  /** Absolute path to the source file (for diagnostics / overrides). */
  path: string
}
