import { z } from 'zod'
import type { PermissionHint } from '../tools/types'

export const BUILT_IN_PERMISSION_PROFILE_READ_ONLY = ':read-only'
export const BUILT_IN_PERMISSION_PROFILE_WORKSPACE = ':workspace'
export const BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS = ':danger-full-access'

export const PermissionProfileActionSchema = z.enum(['allow', 'ask', 'deny'])
export type PermissionProfileAction = z.infer<typeof PermissionProfileActionSchema>

export const PermissionProfileRulesSchema = z
  .object({
    write: PermissionProfileActionSchema.optional(),
    exec: PermissionProfileActionSchema.optional(),
    network: PermissionProfileActionSchema.optional(),
    ask: PermissionProfileActionSchema.optional(),
  })
  .default({})
export type PermissionProfileRules = z.infer<typeof PermissionProfileRulesSchema>

export const PermissionProfileDefinitionSchema = z.object({
  description: z.string().optional(),
  extends: z.string().min(1).optional(),
  rules: PermissionProfileRulesSchema,
  managed: z.boolean().default(false),
})
export type PermissionProfileDefinition = z.infer<typeof PermissionProfileDefinitionSchema>
export type PermissionProfileDefinitionInput = z.input<typeof PermissionProfileDefinitionSchema>

export const PermissionCatalogSchema = z
  .object({
    active: z.string().min(1).optional(),
    profiles: z.record(z.string(), PermissionProfileDefinitionSchema).default({}),
  })
  .optional()
export type PermissionCatalog = z.infer<typeof PermissionCatalogSchema>
export type PermissionCatalogInput = z.input<typeof PermissionCatalogSchema>

export type PermissionProfileSummary = {
  id: string
  description?: string
}

export type ResolvedPermissionProfile = {
  id: string
  description?: string
  extends?: string
  inherited: string[]
  rules: PermissionProfileRules
}

const BUILT_IN_PROFILES: Record<string, PermissionProfileDefinition> = {
  [BUILT_IN_PERMISSION_PROFILE_READ_ONLY]: {
    rules: { write: 'deny', exec: 'deny', network: 'deny', ask: 'ask' },
    managed: false,
  },
  [BUILT_IN_PERMISSION_PROFILE_WORKSPACE]: {
    rules: { write: 'ask', exec: 'ask', network: 'ask', ask: 'ask' },
    managed: false,
  },
  [BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS]: {
    rules: { write: 'allow', exec: 'allow', network: 'allow', ask: 'allow' },
    managed: false,
  },
}

export const BUILT_IN_PERMISSION_PROFILE_IDS = [
  BUILT_IN_PERMISSION_PROFILE_READ_ONLY,
  BUILT_IN_PERMISSION_PROFILE_WORKSPACE,
  BUILT_IN_PERMISSION_PROFILE_DANGER_FULL_ACCESS,
] as const

function cloneProfile(def: PermissionProfileDefinition): PermissionProfileDefinition {
  return {
    ...(def.description !== undefined ? { description: def.description } : {}),
    ...(def.extends !== undefined ? { extends: def.extends } : {}),
    rules: { ...def.rules },
    managed: def.managed,
  }
}

function normalizeCatalog(catalog: PermissionCatalogInput): NonNullable<PermissionCatalog> {
  return PermissionCatalogSchema.parse(catalog) ?? { profiles: {} }
}

function lookupProfile(
  catalog: NonNullable<PermissionCatalog>,
  id: string,
): PermissionProfileDefinition | undefined {
  const configured = catalog?.profiles?.[id]
  if (configured) return cloneProfile(configured)
  const builtIn = BUILT_IN_PROFILES[id]
  return builtIn ? cloneProfile(builtIn) : undefined
}

function mergeRules(
  parent: PermissionProfileRules,
  child: PermissionProfileRules,
): PermissionProfileRules {
  return {
    ...parent,
    ...child,
  }
}

export function resolvePermissionProfile(
  rawCatalog: PermissionCatalogInput,
  explicitId?: string,
): ResolvedPermissionProfile | null {
  const catalog = normalizeCatalog(rawCatalog)
  const active = explicitId ?? catalog?.active
  if (!active) return null

  const stack: Array<{ id: string; def: PermissionProfileDefinition }> = []
  const visiting: string[] = []
  let id = active

  while (true) {
    const cycleStart = visiting.indexOf(id)
    if (cycleStart >= 0) {
      const cycle = [...visiting.slice(cycleStart), id].join(' -> ')
      throw new Error(`permission profile inheritance cycle detected: ${cycle}`)
    }
    visiting.push(id)

    const def = lookupProfile(catalog, id)
    if (!def) {
      const child = stack.at(-1)?.id
      if (child) {
        throw new Error(`permission profile "${child}" extends undefined profile "${id}"`)
      }
      throw new Error(`active permission profile "${id}" is undefined`)
    }
    stack.push({ id, def })
    if (!def.extends) break
    id = def.extends
  }

  const selected = stack[0]!
  const inherited = stack.slice(1).map(item => item.id)
  const rules = stack
    .slice()
    .reverse()
    .reduce<PermissionProfileRules>((acc, item) => mergeRules(acc, item.def.rules), {})

  return {
    id: selected.id,
    ...(selected.def.description !== undefined ? { description: selected.def.description } : {}),
    ...(selected.def.extends !== undefined ? { extends: selected.def.extends } : {}),
    inherited,
    rules,
  }
}

export function permissionProfileActionFor(
  profile: ResolvedPermissionProfile | null | undefined,
  hint: PermissionHint,
): PermissionProfileAction | undefined {
  if (!profile || hint === 'none') return undefined
  return profile.rules[hint]
}

export function listPermissionProfileSummaries(
  rawCatalog: PermissionCatalogInput,
): PermissionProfileSummary[] {
  const catalog = normalizeCatalog(rawCatalog)
  const configured = Object.entries(catalog?.profiles ?? {})
    .map(([id, profile]) => ({
      id,
      ...(profile.description !== undefined ? { description: profile.description } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

  return [
    ...BUILT_IN_PERMISSION_PROFILE_IDS.map(id => ({ id })),
    ...configured,
  ]
}

export function refreshManagedPermissionCatalog(
  currentRaw: PermissionCatalogInput,
  managedRaw: PermissionCatalogInput,
): NonNullable<PermissionCatalog> {
  const current = normalizeCatalog(currentRaw)
  const managed = normalizeCatalog(managedRaw)
  const currentProfiles = current?.profiles ?? {}
  const managedProfiles = managed?.profiles ?? {}
  const profiles: Record<string, PermissionProfileDefinition> = {}

  for (const [id, profile] of Object.entries(currentProfiles)) {
    if (profile.managed) continue
    profiles[id] = cloneProfile(profile)
  }

  for (const [id, profile] of Object.entries(managedProfiles)) {
    profiles[id] = {
      ...cloneProfile(profile),
      managed: true,
    }
  }

  return {
    active: managed?.active ?? current?.active,
    profiles,
  }
}
