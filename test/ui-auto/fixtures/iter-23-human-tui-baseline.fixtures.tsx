// test/ui-auto/fixtures/iter-23-human-tui-baseline.fixtures.tsx
//
// Human TUI redesign baseline. This fixture is explicit-only because it is a
// before/after capture surface for layout review, not a default invariant sweep.

import React from 'react'
import { Box } from 'ink'
import { Messages } from '../../../src/tui/Messages/Messages'
import { ModelPicker } from '../../../src/tui/dialogs/ModelPicker'
import { Wizard } from '../../../src/tui/Onboarding/Wizard'
import { StatusPanel } from '../../../src/tui/Status/StatusPanel'
import { TasksPanelNew } from '../../../src/tui/Tasks/TasksPanelNew'
import { findTemplate } from '../../../src/core/onboarding/templates'
import { useTerminalSize } from '../../../src/tui/hooks/useTerminalSize'
import type { ProviderConfig } from '../../../src/core/config/schema'
import type { Message } from '../../../src/core/message/types'
import type { ColumnsState } from '../../../src/tui/Tasks/columnReducer'
import type { FocusState } from '../../../src/tui/Tasks/focusReducer'
import type { FixtureDef } from '../../../src/core/testing/explorer/types'

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'xiaomi-mimo',
    name: 'Xiaomi Mimo',
    format: 'openai',
    baseUrl: 'https://api.example.test/v1',
    models: ['mimo-v2-pro', 'mimo-v2-fast'],
    selectedModel: 'mimo-v2-pro',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5', 'gpt-4o'],
    selectedModel: 'gpt-5',
  },
]

const customTemplate = findTemplate('custom')!

const customDetailsInitial = {
  kind: 'customDetails' as const,
  provider: customTemplate,
  details: {
    name: 'Xiaomi Mimo',
    format: 'openai' as const,
    baseUrl: 'https://api.example.test/v1',
    model: 'mimo-v2-pro',
  },
}

const taskState: ColumnsState = {
  plan: {
    rows: [
      { id: 'plan-1', primary: 'Track 4: simplify the conversation chrome', secondary: 'human TUI redesign', status: 'running' },
    ],
  },
  subagent: {
    rows: [
      {
        id: 'agent-1',
        primary: 'core:verifier',
        secondary: 'review provider/statusline layout - agent-1234abcd',
        status: 'running',
        agentName: 'core:verifier',
        agentId: 'agent-1234abcd',
        colorKey: 'agent-2',
      },
    ],
  },
  pipeline: {
    rows: [
      { id: 'pipe-1', primary: 'compact audit', secondary: 'responses compact fallback', status: 'pending' },
    ],
  },
  background: {
    rows: [
      { id: 'bg-1', primary: 'npm test', secondary: 'selected regression suite', status: 'running' },
    ],
  },
  message: {
    rows: [
      { id: 'msg-1', primary: 'user -> core:planner', secondary: 'statusline redesign checklist', status: 'sent' },
    ],
  },
}

const subagentFocus: FocusState = {
  kind: 'tasks-column',
  column: 'subagent',
  selectedIndex: 0,
}

function textMessage(role: 'user' | 'assistant', id: string, text: string): Message {
  return {
    role,
    id,
    ts: Number(id.replace(/\D/g, '')) || 1,
    content: [{ type: 'text', text }],
  }
}

const mainMessages: Message[] = [
  textMessage('user', 'u-1', 'Please fix the custom OpenAI-compatible provider and clean up the statusline.'),
  textMessage('assistant', 'a-2', 'I will verify provider naming, Responses endpoint routing, compact behavior, and the visible TUI layout.'),
  textMessage('user', 'u-3', 'The provider name should be visible. Xiaomi Mimo must not collapse back to custom/custom-2.'),
  textMessage('assistant', 'a-4', 'Provider identity now uses the configured name in the statusline while the model stays readable beside it.'),
]

const longMessages: Message[] = Array.from({ length: 34 }, (_, i) => {
  const n = i + 1
  return textMessage(
    i % 2 === 0 ? 'user' : 'assistant',
    `long-${n}`,
    `message ${n}: custom provider status, compact pressure, and task panel spacing baseline.`,
  )
})

function StatusBaseline(props: { narrow?: boolean }): React.JSX.Element {
  return (
    <StatusPanel
      mode={props.narrow ? 'running' : 'idle'}
      model="mimo-v2-pro"
      providerId="xiaomi-mimo"
      providerName="Xiaomi Mimo"
      cwd="/data/xtzhang/Nuka"
      gitBranch={{ branch: 'main', dirty: true }}
      contextUsed={props.narrow ? 174000 : 42000}
      contextMax={200000}
      inputTokens={59900}
      outputTokens={186}
      cost={0}
      pluginCount={0}
      sessionPluginCount={0}
      agentInFlight={1}
      hiddenSegments={[]}
      layout="compact"
      iconMode="text"
    />
  )
}

function TaskBaseline(): React.JSX.Element {
  const { columns } = useTerminalSize()
  return (
    <TasksPanelNew
      state={taskState}
      focus={subagentFocus}
      cols={columns}
    />
  )
}

function ConversationBaseline(): React.JSX.Element {
  return (
    <Box flexDirection="column" height={24} overflow="hidden">
      <Messages
        items={longMessages}
        streaming={null}
        availableRows={8}
      />
    </Box>
  )
}

function MainScreen(props: { narrow?: boolean }): React.JSX.Element {
  return (
    <Box flexDirection="column" height={props.narrow ? 24 : 30} overflow="hidden">
      <Messages
        items={mainMessages}
        streaming={null}
        availableRows={10}
      />
      <TaskBaseline />
      <StatusBaseline narrow={props.narrow} />
    </Box>
  )
}

function ModelPickerBaseline(): React.JSX.Element {
  return (
    <ModelPicker
      providers={PROVIDERS}
      activeProviderId="xiaomi-mimo"
      activeModel="mimo-v2-pro"
      onSave={async () => {}}
      onSelect={() => {}}
      onAddProvider={() => {}}
      onFetchRemote={async () => ['mimo-v2-pro', 'mimo-v2-fast', 'mimo-v2-coder']}
      onCancel={() => {}}
    />
  )
}

function ProviderWizardBaseline(): React.JSX.Element {
  return (
    <Wizard
      initial={customDetailsInitial}
      onDone={() => {}}
      onCancel={() => {}}
    />
  )
}

const fixture: FixtureDef = {
  component: 'HumanTuiBaseline',
  sweepMode: 'explicit-only',
  viewports: [
    { cols: 120, rows: 30 },
    { cols: 70, rows: 24 },
  ],
  cases: {
    'main-screen-desktop': {
      render: () => <MainScreen />,
      mustContain: ['Xiaomi Mimo', 'core:verifier'],
    },
    'main-screen-narrow': {
      render: () => <MainScreen narrow />,
      mustContain: ['[running]', 'compact soon'],
    },
    'long-conversation-desktop': {
      render: () => <ConversationBaseline />,
      mustContain: ['older', 'message 34'],
    },
    'long-conversation-narrow': {
      render: () => <ConversationBaseline />,
      mustContain: ['older', 'message 34'],
    },
    'model-picker-desktop': {
      render: () => <ModelPickerBaseline />,
      mustContain: ['Select provider:', 'Xiaomi Mimo'],
    },
    'model-picker-narrow': {
      render: () => <ModelPickerBaseline />,
      mustContain: ['Select provider:', 'Xiaomi Mimo'],
    },
    'provider-wizard-desktop': {
      render: () => <ProviderWizardBaseline />,
      mustContain: ['Custom provider', 'openai'],
    },
    'provider-wizard-narrow': {
      render: () => <ProviderWizardBaseline />,
      mustContain: ['Custom provider', 'openai'],
    },
    'task-panel-desktop': {
      render: () => <TaskBaseline />,
      mustContain: ['Subagents', 'core:verifier'],
    },
    'task-panel-narrow': {
      render: () => <TaskBaseline />,
      mustContain: ['sub(1)', 'core:verifier'],
    },
    'statusline-desktop': {
      render: () => <StatusBaseline />,
      mustContain: ['Xiaomi Mimo', 'context:'],
    },
    'statusline-narrow': {
      render: () => <StatusBaseline narrow />,
      mustContain: ['Xiaomi', 'compact soon'],
    },
  },
}

export default fixture
