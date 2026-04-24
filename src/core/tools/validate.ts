// src/core/tools/validate.ts
// JSON Schema → Zod adapter for input validation.
// Only converts the keyword subset documented in M2.1.
// Unknown keywords are silently ignored (not an error).
import { z } from 'zod'

export type ValidationResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: string }

// ---------------------------------------------------------------------------
// JSON Schema → Zod conversion
// ---------------------------------------------------------------------------

/** Convert a JSON Schema node to a Zod schema. */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema['type']

  if (type === 'string') {
    let s = z.string()
    if (typeof schema['minLength'] === 'number') s = s.min(schema['minLength'] as number)
    if (typeof schema['maxLength'] === 'number') s = s.max(schema['maxLength'] as number)
    return s
  }

  if (type === 'number' || type === 'integer') {
    let n = z.number()
    if (typeof schema['minimum'] === 'number') n = n.min(schema['minimum'] as number)
    if (typeof schema['maximum'] === 'number') n = n.max(schema['maximum'] as number)
    return n
  }

  if (type === 'boolean') {
    return z.boolean()
  }

  if (type === 'null') {
    return z.null()
  }

  if (type === 'array') {
    const items = schema['items']
    const itemSchema =
      items && typeof items === 'object' && !Array.isArray(items)
        ? jsonSchemaToZod(items as Record<string, unknown>)
        : z.unknown()
    return z.array(itemSchema)
  }

  if (Array.isArray(schema['enum'])) {
    const values = schema['enum'] as unknown[]
    // Zod enum only works with strings; use z.union + z.literal for mixed
    if (values.length === 0) return z.never()
    if (values.every(v => typeof v === 'string')) {
      const strs = values as [string, ...string[]]
      return z.enum(strs)
    }
    if (values.length === 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return z.literal(values[0] as any)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const literals = values.map(v => z.literal(v as any))
    return z.union([literals[0]!, literals[1]!, ...literals.slice(2)] as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  if (type === 'object' || schema['properties']) {
    return buildObjectSchema(schema)
  }

  // Fallback: accept anything
  return z.unknown()
}

function buildObjectSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  const properties = schema['properties']
  const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : []

  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return z.object({}).passthrough()
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, propSchema] of Object.entries(properties as Record<string, unknown>)) {
    if (typeof propSchema !== 'object' || propSchema === null || Array.isArray(propSchema)) {
      shape[key] = z.unknown()
      continue
    }
    const fieldSchema = jsonSchemaToZod(propSchema as Record<string, unknown>)
    shape[key] = required.includes(key) ? fieldSchema : fieldSchema.optional()
  }

  return z.object(shape).passthrough()
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate `input` against a JSON Schema `parameters` object.
 * Returns `{ ok: true, value }` on success, `{ ok: false, error }` on failure.
 */
export function validateWithJsonSchema<T = unknown>(
  input: unknown,
  parameters: Record<string, unknown>,
): ValidationResult<T> {
  let schema: z.ZodTypeAny
  try {
    schema = jsonSchemaToZod(parameters)
  } catch {
    // If schema building fails, skip validation (don't block the tool)
    return { ok: true, value: input as T }
  }

  const result = schema.safeParse(input)
  if (result.success) {
    return { ok: true, value: result.data as T }
  }

  const message = result.error.issues
    .map(i => `${i.path.length > 0 ? i.path.join('.') + ': ' : ''}${i.message}`)
    .join('; ')
  return { ok: false, error: message }
}
