// test/ui-auto/fixtures/mimo-dogfood-response.fixtures.tsx
//
// Demo C dogfood fixture (2026-05-19).
//
// Renders a simulated Nuka chat turn where the user asked Mimo to produce JSON
// and the model replied. The response text comes from an actual Mimo API call
// made by scripts/mimo-dogfood.mjs — mimo-v2-omni is a reasoning model that
// consumed its token budget on chain-of-thought before outputting content.
// The truncated partial output is captured here as a static prop.
//
// Purpose: prove the skill's `capture` verb can observe a frame that was
// derived from a real Mimo provider response, even though the skill is
// fixture-driven and cannot attach to a live Nuka process.

import React from 'react'
import { Box, Text } from 'ink'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

// The actual truncated reply from mimo-v2-omni (finish_reason=length, 256 tokens).
// The model spent its token budget on reasoning_content before producing content.
const MIMO_ACTUAL_REPLY = '{"greeting":"hello","from":"mimo","status"'

// A successful response (what the model was converging toward, confirmed by
// reasoning_content in the raw response).
const MIMO_EXPECTED_REPLY = '{"greeting":"hello","from":"mimo","status":"ok"}'

// Simulate the Nuka TUI message layout: user prompt + assistant reply in boxes.
function MimoChatFrame({
  userPrompt,
  assistantReply,
  model,
  truncated,
}: {
  userPrompt: string
  assistantReply: string
  model: string
  truncated: boolean
}): React.JSX.Element {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={0}>
      {/* Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold color="cyan">
          Nuka ↔ Mimo Dogfood Run 2026-05-19
        </Text>
        <Text> </Text>
        <Text color="gray">[model: {model}]</Text>
      </Box>

      {/* User turn */}
      <Box paddingX={1} paddingY={0}>
        <Text bold color="green">
          {'> '}
        </Text>
        <Text>{userPrompt}</Text>
      </Box>

      {/* Assistant reply */}
      <Box paddingX={1} paddingY={0} flexDirection="column">
        <Text bold color="yellow">
          {'~ '}
        </Text>
        <Text color={truncated ? 'red' : 'white'}>{assistantReply}</Text>
        {truncated && (
          <Text color="red" dimColor>
            [truncated: finish_reason=length, 256 completion_tokens]
          </Text>
        )}
      </Box>

      {/* Footer */}
      <Box paddingX={1}>
        <Text dimColor>provider: custom (xiaomi) · format: openai</Text>
      </Box>
    </Box>
  )
}

const fixture: FixtureDef = {
  component: 'MimoDogfoodResponse',
  cases: {
    'actual-truncated-reply': {
      render: () => (
        <MimoChatFrame
          userPrompt='Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}'
          assistantReply={MIMO_ACTUAL_REPLY}
          model="mimo-v2-omni"
          truncated={true}
        />
      ),
      mustContain: ['mimo', 'greeting', 'Mimo Dogfood'],
    },
    'expected-complete-reply': {
      render: () => (
        <MimoChatFrame
          userPrompt='Output exactly: {"greeting":"hello","from":"mimo","status":"ok"}'
          assistantReply={MIMO_EXPECTED_REPLY}
          model="mimo-v2-omni"
          truncated={false}
        />
      ),
      mustContain: ['mimo', 'ok', 'greeting'],
    },
  },
}

export default fixture
