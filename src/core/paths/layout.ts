import * as fs from 'node:fs'
import * as path from 'node:path'

export { tasksDir } from '../tasks/persist'
import { tasksDir } from '../tasks/persist'

export function nukaHome(home: string): string { return path.join(home, '.nuka') }
export function teamsDir(home: string): string { return path.join(nukaHome(home), 'teams') }
export function recapsDir(home: string): string { return path.join(nukaHome(home), 'recaps') }
export function forksDir(home: string): string { return path.join(nukaHome(home), 'forks') }
export function eventsDir(home: string): string { return path.join(nukaHome(home), 'events') }
export function teamConfigPath(home: string, name: string): string {
  return path.join(teamsDir(home), name, 'config.json')
}

export function ensureNukaLayout(home: string): void {
  const dirs = [
    tasksDir(home),
    teamsDir(home),
    recapsDir(home),
    forksDir(home),
    eventsDir(home),
  ]
  for (const d of dirs) {
    try { fs.mkdirSync(d, { recursive: true }) } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
        process.stderr.write(`[nuka] ENOSPC creating ${d} — continuing without it\n`)
        continue
      }
      throw err
    }
  }
}
