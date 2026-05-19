// src/tui/Tasks/SubagentDetail.tsx
import * as React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../core/theme/context'
import { truncateByWidth } from '../../core/stringWidth'
import { defaultPalette } from '../theme'

type Props = {
  taskId: string; agentName: string; teamName: string; status: string
  conversation: Array<{ role: string; content: string }>
  activities: Array<{ toolName: string; input: Record<string, unknown>; activityDescription?: string }>
  planAwaitingApproval?: { plan: string; requestId: string }
  onInjectMessage: (text: string) => void
  onPause: () => void
  onKill: () => void
  onShutdown: () => void
  onApprovePlan: (requestId: string) => void
  onRejectPlan: (requestId: string, feedback: string) => void
}

export function SubagentDetail(p: Props): React.ReactNode {
  const theme = useTheme()
  const { stdout } = useStdout()
  const columns = process.stdout.columns ?? stdout?.columns ?? 80
  const primaryColor = theme.colors.primary ?? defaultPalette.primary
  const fgMutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  const warnColor = theme.colors.warn ?? defaultPalette.warn

  // Outer box: border (2) + 1-col safety = 4 cols of host chrome budget.
  const boxWidth = Math.max(20, columns - 4)
  // Inside the outer Box: border (2) eats 2 cols. Conversation/activity lines
  // sit directly inside, so cap = boxWidth - 2 (border) - 2 (sigil "> "/"◌ ").
  const rowCap = Math.max(1, boxWidth - 4)
  // Nested plan-approval Box adds its own border (2) + padding (2) = 4.
  const innerPlanWidth = Math.max(8, boxWidth - 4)
  const innerPlanCap = Math.max(1, innerPlanWidth - 4)

  // Defensive hard-cut: split on \n, trim unbreakable lines so wrap="wrap"
  // can't push wide glyphs past the right border on URL-style content.
  const safePlan = (s: string, cap: number): string =>
    s.split('\n').map(line => !/\s/.test(line) ? truncateByWidth(line, cap) : line).join('\n')

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={primaryColor} width={boxWidth}>
      <Text bold wrap="truncate-end">{p.agentName} · {p.teamName} · {p.status}</Text>
      <Box flexDirection="column" marginY={1}>
        {p.conversation.slice(-30).map((m, i) => (
          <Box key={i} width={rowCap + 2 /* sigil */}>
            <Text dimColor={m.role === 'user'} wrap="truncate-end">{m.role === 'user' ? '> ' : '◌ '}{m.content}</Text>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Activity</Text>
        {p.activities.map((a, i) => (
          <Box key={i} width={rowCap + 2}>
            <Text dimColor wrap="truncate-end">{a.activityDescription ?? a.toolName}</Text>
          </Box>
        ))}
      </Box>
      {p.planAwaitingApproval && (
        <Box flexDirection="column" borderStyle="single" borderColor={warnColor} padding={1} width={innerPlanWidth}>
          <Text bold>Plan awaiting approval:</Text>
          <Text wrap="wrap">{safePlan(p.planAwaitingApproval.plan, innerPlanCap)}</Text>
          <Text dimColor>[a] approve · [r] reject</Text>
        </Box>
      )}
      <Box marginTop={1}><Text color={fgMutedColor}>[i] inject · [p] pause · [k] kill · [s] shutdown · [esc] back</Text></Box>
    </Box>
  )
}
