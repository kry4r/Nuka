import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { skillFrontmatterSchema } from './types'
import type { Skill } from './types'

export function parseSkill(
  content: string,
  meta: { path: string; source: 'global' | 'project' },
): Skill | null {
  if (!content.startsWith('---\n')) return null

  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return null

  const yamlText = content.slice(4, end)
  const body = content.slice(end + 5).trim()

  let raw: unknown
  try {
    raw = parseYaml(yamlText)
  } catch {
    return null
  }

  const result = skillFrontmatterSchema.safeParse(raw)
  if (!result.success) return null

  const { name, description, when, requires } = result.data
  return {
    name,
    description,
    when,
    ...(requires !== undefined ? { requires } : {}),
    body,
    source: meta.source,
    path: meta.path,
  }
}

async function loadFromDir(
  dir: string,
  source: 'global' | 'project',
): Promise<Skill[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md')).sort()
  const skills: Skill[] = []

  for (const file of mdFiles) {
    const filePath = path.join(dir, file)
    let content: string
    try {
      content = await readFile(filePath, 'utf8')
    } catch {
      continue
    }
    const skill = parseSkill(content, { path: filePath, source })
    if (skill) skills.push(skill)
  }

  return skills
}

export async function loadSkills(opts: {
  home: string
  cwd: string
}): Promise<Skill[]> {
  const globalDir = path.join(opts.home, '.nuka', 'skills')
  const projectDir = path.join(opts.cwd, '.nuka', 'skills')

  const [globals, projects] = await Promise.all([
    loadFromDir(globalDir, 'global'),
    loadFromDir(projectDir, 'project'),
  ])

  const byName = new Map<string, Skill>()
  for (const skill of globals) byName.set(skill.name, skill)
  for (const skill of projects) byName.set(skill.name, skill)

  return [...byName.values()]
}
