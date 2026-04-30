import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { TeamConfigSchema, type Team, type TeamMember } from './types'
import { teamsDir, teamConfigPath } from '../paths'

export class TeamRegistry {
  private readonly home: string
  private readonly cache = new Map<string, Team>()

  constructor(opts: { home: string }) {
    this.home = opts.home
    this.loadAll()
  }

  private loadAll(): void {
    const root = teamsDir(this.home)
    if (!fs.existsSync(root)) return
    for (const name of fs.readdirSync(root)) {
      const cfg = teamConfigPath(this.home, name)
      if (!fs.existsSync(cfg)) continue
      try {
        const parsed = TeamConfigSchema.parse(JSON.parse(fs.readFileSync(cfg, 'utf8')))
        this.cache.set(parsed.name, parsed)
      } catch {
        // skip corrupt; keep going
      }
    }
  }

  async create(name: string, description: string): Promise<Team> {
    if (this.cache.has(name)) throw new Error(`team "${name}" already exists`)
    const t: Team = {
      name,
      description,
      taskListId: randomUUID(),
      members: [],
      createdAt: Date.now(),
    }
    TeamConfigSchema.parse(t) // validates name regex etc.
    await this.persist(t)
    this.cache.set(name, t)
    return t
  }

  async delete(name: string, _opts?: { keepTasks?: boolean }): Promise<void> {
    const dir = path.dirname(teamConfigPath(this.home, name))
    await fsp.rm(dir, { recursive: true, force: true })
    this.cache.delete(name)
  }

  find(name: string): Team | undefined { return this.cache.get(name) }
  list(): Team[] { return [...this.cache.values()] }

  async addMember(name: string, m: TeamMember): Promise<void> {
    const t = this.cache.get(name)
    if (!t) throw new Error(`team "${name}" not found`)
    t.members = [...t.members, m]
    await this.persist(t)
  }

  async removeMember(name: string, agentName: string): Promise<void> {
    const t = this.cache.get(name)
    if (!t) throw new Error(`team "${name}" not found`)
    t.members = t.members.filter(m => m.agentName !== agentName)
    await this.persist(t)
  }

  private async persist(t: Team): Promise<void> {
    const cfg = teamConfigPath(this.home, t.name)
    await fsp.mkdir(path.dirname(cfg), { recursive: true })
    const tmp = `${cfg}.tmp-${process.pid}`
    await fsp.writeFile(tmp, JSON.stringify(t, null, 2), 'utf8')
    await fsp.rename(tmp, cfg) // atomic on POSIX
  }
}
