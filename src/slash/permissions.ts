import type { SlashCommand } from './types'
import {
  listPermissionProfileSummaries,
  resolvePermissionProfile,
  type PermissionProfileRules,
} from '../core/permission/profiles'

const RULE_ORDER: Array<keyof PermissionProfileRules> = ['write', 'exec', 'network', 'ask']

function renderRules(rules: PermissionProfileRules): string {
  const parts = RULE_ORDER
    .filter(kind => rules[kind] !== undefined)
    .map(kind => `${kind}=${rules[kind]}`)
  return parts.length > 0 ? parts.join(' ') : '(none)'
}

export const PermissionsCommand: SlashCommand = {
  name: 'permissions',
  description: 'Show active permission profile and catalog',
  source: 'builtin',
  usage: '/permissions',
  examples: ['/permissions'],
  run: async (_args, ctx) => {
    let active: ReturnType<typeof resolvePermissionProfile>
    try {
      active = resolvePermissionProfile(ctx.config.permissions)
    } catch (err) {
      return { type: 'text', text: `Permission profile error: ${(err as Error).message}` }
    }

    const summaries = listPermissionProfileSummaries(ctx.config.permissions)
    const lines = ['Active permission profile']
    if (active) {
      lines.push(`id       ${active.id}`)
      if (active.description) lines.push(`desc     ${active.description}`)
      if (active.extends) lines.push(`extends  ${active.extends}`)
      if (active.inherited.length > 0) lines.push(`inherits ${active.inherited.join(' -> ')}`)
      lines.push(`rules    ${renderRules(active.rules)}`)
    } else {
      lines.push('active   (none)')
    }

    lines.push('', 'Catalog')
    for (const summary of summaries) {
      const suffix = summary.description ? ` - ${summary.description}` : ''
      lines.push(`${summary.id}${suffix}`)
    }
    return { type: 'text', text: lines.join('\n') }
  },
}
