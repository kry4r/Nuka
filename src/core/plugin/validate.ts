/**
 * Plugin validation for authors — validates a plugin directory before publishing.
 *
 * Checks performed:
 * 1. plugin.yaml or plugin.json exists and parses.
 * 2. Manifest validates against the Zod schema (passthrough for unknown keys
 *    such as agents[], outputStyles[], channels[] from M5 streams).
 * 3. tools[] import paths exist on disk.
 * 4. slashCommands[] paths exist on disk.
 * 5. skills[] markdown files exist on disk.
 * 6. dependencies[] are locally resolvable (warning, not error).
 *
 * M5-compat note: fields introduced by M5-agents / M5-platform
 * (agents[], outputStyles[], channels[]) are gracefully tolerated via
 * PluginManifestSchema.passthrough(). Deep checks for those fields will be
 * added in a Phase 6 follow-up commit once those streams are merged.
 */
import { readFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { PluginManifestSchema } from './manifest'
import { createRequire } from 'node:module'

export type ValidationIssue = {
  path: string
  message: string
}

export type ValidationReport = {
  errors: Array<ValidationIssue>
  warnings: Array<ValidationIssue>
}

/** Check whether a file exists at the given absolute path. */
async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath)
    return true
  } catch {
    return false
  }
}

/**
 * Validate a plugin directory.
 *
 * @param pluginDir - Absolute (or relative-to-cwd) path to the plugin directory.
 * @returns ValidationReport with errors and warnings.
 */
export async function validatePlugin(pluginDir: string): Promise<ValidationReport> {
  const dir = resolve(pluginDir)
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // -------------------------------------------------------------------------
  // 1. Find and parse manifest
  // -------------------------------------------------------------------------
  let rawContent: string | undefined
  let manifestFile: string | undefined
  for (const filename of ['plugin.yaml', 'plugin.json']) {
    const candidate = join(dir, filename)
    try {
      rawContent = await readFile(candidate, 'utf8')
      manifestFile = filename
      break
    } catch {
      // try next
    }
  }

  if (rawContent === undefined || manifestFile === undefined) {
    errors.push({
      path: dir,
      message: 'No plugin.yaml or plugin.json found in plugin directory',
    })
    return { errors, warnings }
  }

  // -------------------------------------------------------------------------
  // 2. Parse YAML/JSON
  // -------------------------------------------------------------------------
  let data: unknown
  try {
    data = parseYaml(rawContent)
  } catch (err: unknown) {
    errors.push({
      path: manifestFile,
      message: `Failed to parse manifest: ${(err as Error).message}`,
    })
    return { errors, warnings }
  }

  // -------------------------------------------------------------------------
  // 3. Zod schema validation (passthrough for unknown fields → M5 compat)
  // -------------------------------------------------------------------------
  const parseResult = PluginManifestSchema.passthrough().safeParse(data)
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push({
        path: `${manifestFile}#${issue.path.join('.')}`,
        message: issue.message,
      })
    }
    // Still attempt path checks with the raw data if it's an object
  }

  const manifest = parseResult.success ? parseResult.data : null

  // -------------------------------------------------------------------------
  // 4. Check tools[] import paths exist
  // -------------------------------------------------------------------------
  const tools: string[] = Array.isArray((data as Record<string, unknown>)?.['tools'])
    ? ((data as Record<string, unknown>)['tools'] as string[]).filter(t => typeof t === 'string')
    : manifest?.tools ?? []

  for (const toolPath of tools) {
    const absPath = join(dir, toolPath)
    if (!(await fileExists(absPath))) {
      errors.push({
        path: `${manifestFile}#tools`,
        message: `Tool import path does not exist: ${toolPath}`,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 5. Check slashCommands[] paths exist
  // -------------------------------------------------------------------------
  const slashCommands: string[] = Array.isArray(
    (data as Record<string, unknown>)?.['slashCommands'],
  )
    ? (
        (data as Record<string, unknown>)['slashCommands'] as string[]
      ).filter(s => typeof s === 'string')
    : manifest?.slashCommands ?? []

  for (const slashPath of slashCommands) {
    const absPath = join(dir, slashPath)
    if (!(await fileExists(absPath))) {
      errors.push({
        path: `${manifestFile}#slashCommands`,
        message: `Slash command path does not exist: ${slashPath}`,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 6. Check skills[] markdown files exist
  // -------------------------------------------------------------------------
  const skills: string[] = Array.isArray((data as Record<string, unknown>)?.['skills'])
    ? ((data as Record<string, unknown>)['skills'] as string[]).filter(s => typeof s === 'string')
    : manifest?.skills ?? []

  for (const skillPath of skills) {
    const absPath = join(dir, skillPath)
    if (!(await fileExists(absPath))) {
      errors.push({
        path: `${manifestFile}#skills`,
        message: `Skill markdown file does not exist: ${skillPath}`,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 7. Check dependencies[] resolve locally (warning, not error)
  // -------------------------------------------------------------------------
  const rawData = data as Record<string, unknown> | null
  const dependencies: string[] = Array.isArray(rawData?.['dependencies'])
    ? (rawData!['dependencies'] as unknown[]).flatMap((d): string[] => {
        if (typeof d === 'string') return [d]
        if (d !== null && typeof d === 'object' && typeof (d as { name?: unknown }).name === 'string') {
          return [(d as { name: string }).name]
        }
        return []
      })
    : []

  if (dependencies.length > 0) {
    const req = createRequire(join(dir, 'package.json'))
    for (const dep of dependencies) {
      try {
        req.resolve(dep)
      } catch {
        warnings.push({
          path: `${manifestFile}#dependencies`,
          message: `Dependency '${dep}' could not be resolved locally (run npm install in the plugin directory)`,
        })
      }
    }
  }

  return { errors, warnings }
}

/**
 * Format a ValidationReport as human-readable text for CLI output.
 */
export function formatReport(report: ValidationReport, pluginDir: string): string {
  const lines: string[] = []

  if (report.errors.length === 0 && report.warnings.length === 0) {
    lines.push(`✓ Plugin at '${pluginDir}' is valid.`)
    return lines.join('\n')
  }

  if (report.errors.length > 0) {
    lines.push(`Errors (${report.errors.length}):`)
    for (const e of report.errors) {
      lines.push(`  [error] ${e.path}: ${e.message}`)
    }
  }

  if (report.warnings.length > 0) {
    lines.push(`Warnings (${report.warnings.length}):`)
    for (const w of report.warnings) {
      lines.push(`  [warn]  ${w.path}: ${w.message}`)
    }
  }

  return lines.join('\n')
}
