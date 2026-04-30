import type { EventBus } from '../events/bus'

export type ToolActivity = {
  toolName: string
  input: Record<string, unknown>
  activityDescription?: string
  isSearch?: boolean
  isRead?: boolean
}

export type ProgressTrackerSnapshot = {
  toolUseCount: number
  latestInputTokens: number
  cumulativeOutputTokens: number
  recentActivities: ToolActivity[]
  summary?: string
}

const MAX_RECENT = 5
const READ_TOOLS = new Set(['Read', 'NotebookRead', 'cat', 'head', 'tail'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob', 'find'])

export class ProgressTracker {
  private toolUseCount = 0
  private latestInputTokens = 0
  private cumulativeOutputTokens = 0
  private activities: ToolActivity[] = []
  private summary?: string

  constructor(private readonly taskId: string, private readonly bus: EventBus) {}

  onToolStart(toolName: string, input: Record<string, unknown>, activityDescription?: string): void {
    this.toolUseCount++
    const activity: ToolActivity = {
      toolName,
      input,
      activityDescription,
      isRead: READ_TOOLS.has(toolName),
      isSearch: SEARCH_TOOLS.has(toolName),
    }
    const last = this.activities[this.activities.length - 1]
    if (last && last.toolName === activity.toolName && (activity.isRead || activity.isSearch)) {
      const m = last.activityDescription?.match(/^(Reading|Searching) (\d+) files?/)
      const next = m ? Number(m[2]) + 1 : 2
      const verb = activity.isRead ? 'Reading' : 'Searching'
      last.activityDescription = `${verb} ${next} files`
      return
    }
    this.activities.push(activity)
    if (this.activities.length > MAX_RECENT) this.activities.shift()
  }

  onUsage(usage: { inputTokens: number; outputTokens: number }): void {
    this.latestInputTokens = usage.inputTokens
    this.cumulativeOutputTokens += usage.outputTokens
  }

  setSummary(summary: string): void { this.summary = summary }

  snapshot(): ProgressTrackerSnapshot {
    const snap: ProgressTrackerSnapshot = {
      toolUseCount: this.toolUseCount,
      latestInputTokens: this.latestInputTokens,
      cumulativeOutputTokens: this.cumulativeOutputTokens,
      recentActivities: [...this.activities],
      summary: this.summary,
    }
    this.bus.emit('task', { type: 'task.progress', id: this.taskId, snapshot: snap })
    return snap
  }
}
