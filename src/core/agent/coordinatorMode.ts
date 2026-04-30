import type { Tool } from '../tools/types'

const ENV_VAR = 'NUKA_COORDINATOR_MODE'
const TRUTHY = new Set(['1', 'true', 'yes'])

export function isCoordinatorMode(): boolean {
  return TRUTHY.has((process.env[ENV_VAR] ?? '').toLowerCase())
}

export const COORDINATOR_INTERNAL_TOOLS = new Set<string>([
  'team_create',
  'team_delete',
  'send_message',
  'dispatch_agent',
  'task_create',
  'task_update',
  'task_list',
  'synthetic_output',
])

export function getCoordinatorUserContext(deps: {
  tools: { list: () => Pick<Tool, 'name'>[] }
  scratchpadDir?: string
}): { [k: string]: string } {
  if (!isCoordinatorMode()) return {}
  const workerTools = deps.tools.list()
    .map(t => t.name)
    .filter(n => !COORDINATOR_INTERNAL_TOOLS.has(n))
    .sort()
    .join(', ')
  const ctx: { [k: string]: string } = { workerTools }
  if (deps.scratchpadDir) ctx.scratchpadDir = deps.scratchpadDir
  return ctx
}

export function matchSessionMode(stored?: 'coordinator' | 'normal'): string | undefined {
  if (!stored) return undefined
  const currentlyCoord = isCoordinatorMode()
  const wantCoord = stored === 'coordinator'
  if (currentlyCoord === wantCoord) return undefined
  if (wantCoord) {
    process.env[ENV_VAR] = '1'
    return 'Entered coordinator mode to match resumed session.'
  } else {
    delete process.env[ENV_VAR]
    return 'Exited coordinator mode to match resumed session.'
  }
}
