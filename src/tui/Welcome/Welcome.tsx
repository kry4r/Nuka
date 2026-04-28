import React from 'react'
import { Box, Text } from 'ink'
import { Logo } from './Logo'
import { defaultPalette as P } from '../theme'

export type WelcomeProps = {
  cwd: string
  gitBranch: { branch: string; dirty: boolean } | null
  model: string
  version: string
  tip: string
}

export function Welcome(props: WelcomeProps): React.JSX.Element {
  const { cwd, gitBranch, model, version, tip } = props
  const git = gitBranch
    ? `${gitBranch.branch}${gitBranch.dirty ? ' *' : ''}`
    : '(not a git repo)'

  // Truncate cwd from the left so the leaf directory stays visible.
  const cwdDisplay = cwd.length > 50 ? '…' + cwd.slice(cwd.length - 49) : cwd

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box>
        <Box marginRight={3}>
          <Logo />
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Box>
            <Text color={P.primary} bold>NUKA</Text>
            <Text color={P.fgMuted}>  Avocado Agent · v{version}</Text>
          </Box>
          <Box height={1} />
          <Row label="model" value={model} valueColor={P.primary} />
          <Row label="cwd"   value={cwdDisplay} valueColor={P.fg} />
          <Row
            label="git"
            value={git}
            valueColor={gitBranch?.dirty ? P.warn : P.fg}
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={P.primary}>✦ </Text>
        <Text color={P.fg}>{tip}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={P.fgMuted}>
          Type <Text color={P.primary}>/</Text> for commands ·{' '}
          <Text color={P.primary}>?</Text> for help ·{' '}
          <Text color={P.primary}>esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  )
}

function Row(props: { label: string; value: string; valueColor: string }): React.JSX.Element {
  return (
    <Box>
      <Box width={7}>
        <Text color={P.fgMuted}>{props.label}</Text>
      </Box>
      <Text color={P.fgMuted}>│ </Text>
      <Text color={props.valueColor}>{props.value}</Text>
    </Box>
  )
}
