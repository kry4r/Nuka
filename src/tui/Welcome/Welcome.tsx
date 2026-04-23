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
    ? `${gitBranch.branch}${gitBranch.dirty ? ' *' : ' · clean'}`
    : '(not a git repo)'
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box>
        <Box marginRight={3}>
          <Logo />
        </Box>
        <Box flexDirection="column">
          <Text color={P.primary} bold>NUKA</Text>
          <Text color={P.muted}>Avocado Agent · v{version}</Text>
          <Box height={1} />
          <Text color={P.muted}>cwd   <Text color={P.fg}>{cwd}</Text></Text>
          <Text color={P.muted}>git   <Text color={P.fg}>{git}</Text></Text>
          <Text color={P.muted}>model <Text color={P.fg}>{model}</Text></Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={P.primary}>✦ </Text>
        <Text color={P.fg}>{tip}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={P.muted}>
          Type <Text color={P.primary}>/</Text> for commands,{' '}
          <Text color={P.primary}>?</Text> for help, <Text color={P.primary}>esc</Text> to cancel.
        </Text>
      </Box>
    </Box>
  )
}
