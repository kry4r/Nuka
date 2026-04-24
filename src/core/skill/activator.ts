import type { Skill } from './types'

export function alwaysOnSkills(all: Skill[]): Skill[] {
  return all.filter((s) => s.when === 'on-session-start')
}

export function matchKeywordSkills(all: Skill[], userText: string): Skill[] {
  return all.filter((s) => {
    if (typeof s.when !== 'object' || !('keyword' in s.when)) return false
    return s.when.keyword.some((kw) => new RegExp(`\\b${kw}\\b`, 'i').test(userText))
  })
}
