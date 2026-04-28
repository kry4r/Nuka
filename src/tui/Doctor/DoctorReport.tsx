// src/tui/Doctor/DoctorReport.tsx
// Phase 10 §4.4 — renders a doctor report inside the TUI.

import React, { useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import type { DoctorReport as Report, Check } from '../../core/doctor/run'
import { defaultPalette as P } from '../theme'

export type DoctorReportProps = {
  report: Report
  onClose: () => void
}

function statusIcon(status: Check['status']): string {
  if (status === 'ok') return '✓'
  if (status === 'warn') return '⚠'
  return '✗'
}

function statusColor(status: Check['status']): string {
  if (status === 'ok') return P.success
  if (status === 'warn') return P.warn
  return P.error
}

export function DoctorReport({ report, onClose }: DoctorReportProps): React.JSX.Element {
  const handler = useCallback((_input: string, key: import('ink').Key) => {
    if (key.escape || key.return) onClose()
  }, [onClose])

  useInput(handler)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={report.ok ? P.primary : P.error} paddingX={1}>
      <Text bold color={report.ok ? P.primary : P.error}>
        {report.ok ? '✓ Doctor — all checks passed' : '✗ Doctor — issues found'}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {report.checks.map((check, i) => (
          <Box key={i} flexDirection="column">
            <Text color={statusColor(check.status)}>
              {statusIcon(check.status)} {check.name}: {check.detail}
            </Text>
            {check.remedy && (
              <Text color={P.fgMuted}>  → {check.remedy}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Text color={P.fgMuted} dimColor>Press Enter or Esc to dismiss</Text>
    </Box>
  )
}
