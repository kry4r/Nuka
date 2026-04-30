// src/tui/Tasks/SubagentDetail.tsx
import * as React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../core/theme/context'
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
  const primaryColor = theme.colors.primary ?? defaultPalette.primary
  const fgMutedColor = theme.colors.fgMuted ?? defaultPalette.fgMuted
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={primaryColor}>
      <Text bold>{p.agentName} · {p.teamName} · {p.status}</Text>
      <Box flexDirection="column" marginY={1}>
        {p.conversation.slice(-30).map((m, i) => (
          <Text key={i} dimColor={m.role === 'user'}>{m.role === 'user' ? '> ' : '◌ '}{m.content}</Text>
        ))}
      </Box>
      <Box flexDirection="column">
        <Text bold>Activity</Text>
        {p.activities.map((a, i) => <Text key={i} dimColor>{a.activityDescription ?? a.toolName}</Text>)}
      </Box>
      {p.planAwaitingApproval && (
        <Box flexDirection="column" borderStyle="single" borderColor="yellow" padding={1}>
          <Text bold>Plan awaiting approval:</Text>
          <Text>{p.planAwaitingApproval.plan}</Text>
          <Text dimColor>[a] approve · [r] reject</Text>
        </Box>
      )}
      <Box marginTop={1}><Text color={fgMutedColor}>[i] inject · [p] pause · [k] kill · [s] shutdown · [esc] back</Text></Box>
    </Box>
  )
}
