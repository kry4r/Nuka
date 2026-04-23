// src/core/session/telemetry.ts
import { execSync } from 'node:child_process'
import type { TokenUsage } from '../message/types'
import type { ProviderConfig } from '../config/schema'

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0) || undefined,
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0) || undefined,
  }
}

export function computeCost(
  provider: ProviderConfig,
  modelId: string,
  usage: TokenUsage,
): number {
  const rate = provider.pricing?.[modelId]
  if (!rate) return 0
  const input = (usage.inputTokens / 1_000_000) * rate.input
  const output = (usage.outputTokens / 1_000_000) * rate.output
  const cacheRead = rate.cacheRead
    ? ((usage.cacheReadTokens ?? 0) / 1_000_000) * rate.cacheRead
    : 0
  const cacheWrite = rate.cacheWrite
    ? ((usage.cacheWriteTokens ?? 0) / 1_000_000) * rate.cacheWrite
    : 0
  return input + output + cacheRead + cacheWrite
}

export function currentGitBranch(cwd: string): { branch: string; dirty: boolean } | null {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    const statusLen = execSync('git status --porcelain', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().length
    return { branch, dirty: statusLen > 0 }
  } catch {
    return null
  }
}
