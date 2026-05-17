// src/core/structuredOutput/tool.ts
//
// StructuredOutput — agent-facing tool that returns the model's final
// response as JSON validated against a caller-supplied JSON Schema.
//
// Use case (mirrors upstream Nuka-Code SyntheticOutputTool): non-interactive
// SDK / CLI workflows where the consumer wants typed results
// ("return one of {success|failed, reason}") rather than free-form prose.
// The schema is bound at tool-construction time so each consumer composes
// its own tool with its own schema, then registers it on the agent.
//
// Port notes — diverges from upstream in three places:
//
//   1. Schema validation uses Nuka's existing `validateWithJsonSchema`
//      (JSON Schema -> Zod adapter in src/core/tools/validate.ts) rather
//      than pulling in ajv. Same semantics: an invalid input is rejected
//      with a descriptive error; an invalid SCHEMA at construction time
//      returns { error } so the caller doesn't get a tool that always
//      throws.
//
//   2. The tool returns a structured `ContentBlock[]` carrying the
//      validated JSON as text — Nuka's ToolResult contract is
//      `{ output: string | ContentBlock[]; isError }`, so we don't need
//      the `structured_output` side-channel upstream uses.
//
//   3. No identity cache (upstream WeakMap). Nuka's registration pattern
//      is one tool per session; the cache was an upstream optimization
//      for workflow scripts that call `agent({schema})` in tight loops.

import type { Tool } from '../tools/types'
import { defineTool } from '../tools/define'
import { validateWithJsonSchema } from '../tools/validate'

export const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput'

export type StructuredOutputInput = Record<string, unknown>

export type CreateStructuredOutputResult =
  | { ok: true; tool: Tool<StructuredOutputInput> }
  | { ok: false; error: string }

/**
 * Construct a StructuredOutput tool bound to `jsonSchema`. The schema is
 * validated up-front; an unusable schema yields `{ ok: false, error }`
 * instead of a tool that explodes at call time.
 *
 * On success, the returned tool's `parameters` is the supplied schema
 * verbatim, so the model sees exactly the shape the caller requested. The
 * tool's `run` re-validates the input against the same schema and either:
 *
 *   - returns `{ isError: false, output: ContentBlock[] }` carrying a
 *     `text` block with `JSON.stringify(input)` and an `application/json`
 *     resource block referring to the same payload (useful for consumers
 *     that prefer the resource form), or
 *   - returns `{ isError: true, output: '<message>' }` with a concise
 *     description of which property tripped the schema.
 *
 * The tool is read-only and parallel-safe — it has no side effects beyond
 * shaping its own input.
 */
export function createStructuredOutputTool(
  jsonSchema: Record<string, unknown>,
): CreateStructuredOutputResult {
  // Validate the schema itself. We do this by running an empty object
  // through it: any structural problem in the schema (e.g. `properties`
  // is an array, `type` is unknown) surfaces here, before the tool ships
  // to the model.
  if (
    typeof jsonSchema !== 'object' ||
    jsonSchema === null ||
    Array.isArray(jsonSchema)
  ) {
    return { ok: false, error: 'schema must be a JSON Schema object' }
  }

  // We don't want "missing required field" to count as a schema error
  // (that's the *input* being wrong), so we strip `required` for the
  // probe. The probe is just looking for structural problems.
  const probeSchema: Record<string, unknown> = { ...jsonSchema }
  if ('required' in probeSchema) delete probeSchema['required']

  try {
    // If this throws, the schema is malformed beyond what validate.ts
    // tolerates (validate.ts silently ignores unknown keywords, so
    // throwing here would mean something deeper, like a circular ref).
    validateWithJsonSchema({}, probeSchema)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const tool: Tool<StructuredOutputInput> = defineTool<StructuredOutputInput>({
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    description:
      'Return your final response in the requested structured JSON format. Use this when the caller has asked for structured output — the input you pass becomes the result.',
    parameters: jsonSchema,
    source: 'builtin',
    tags: ['core', 'structured-output'],
    needsPermission: () => 'none',
    annotations: { readOnly: true, parallelSafe: true },
    async run(input) {
      const result = validateWithJsonSchema<StructuredOutputInput>(
        input,
        jsonSchema,
      )
      if (!result.ok) {
        return {
          isError: true,
          output: `Output does not match required schema: ${result.error}`,
        }
      }

      const payload = JSON.stringify(result.value)
      return {
        isError: false,
        output: [
          { type: 'text', text: payload },
          { type: 'resource', uri: 'structured-output:result', mimeType: 'application/json', text: payload },
        ],
      }
    },
  })

  return { ok: true, tool }
}
