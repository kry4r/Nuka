// src/tui/Messages/MessageRow.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { Message } from '../../core/message/types'
import { defaultPalette as P } from '../theme'
import { Markdown } from './Markdown'
import { ToolCall } from './ToolCall'
import { AgentCall } from './AgentCall'
import { DISPATCH_AGENT_TOOL_NAME } from '../../core/agents/dispatchTool'
import { matchStyle, getRegistry } from '../../core/plugin/outputStyles'
import type { OutputStyleProps } from '../../core/plugin/outputStyles'

function summarize(input: unknown): string {
  return JSON.stringify(input) ?? ''
}

/**
 * Error boundary that wraps a custom output-style component.
 * On error, renders the fallback ToolCall and logs a warning.
 */
class OutputStyleErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; styleName: string },
  { hasError: boolean }
> {
  constructor(props: OutputStyleErrorBoundary['props']) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  override componentDidCatch(err: Error): void {
    console.warn(
      `[outputStyles] component '${this.props.styleName}' threw during render — falling back to default. Error: ${err.message}`,
    )
  }

  override render(): React.ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

/**
 * Lazily loads and renders a custom output-style component.
 * Falls back (via error boundary) to the default ToolCall on any throw.
 */
function CustomOutputStyle(props: {
  componentPath: string
  styleName: string
  styleProps: OutputStyleProps
  fallback: React.ReactNode
}): React.JSX.Element {
  const [Comp, setComp] = React.useState<React.ComponentType<OutputStyleProps> | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const fileUrl = 'file://' + props.componentPath
    // Dynamic import of the resolved absolute path
    import(fileUrl)
      .then((mod: unknown) => {
        if (cancelled) return
        const m = mod as Record<string, unknown>
        const firstKey = Object.keys(m)[0]
        const component = (m['default'] ?? (firstKey ? m[firstKey] : undefined)) as
          | React.ComponentType<OutputStyleProps>
          | undefined
        if (typeof component === 'function') {
          setComp(() => component)
        } else {
          setLoadError('no valid default export')
          console.warn(`[outputStyles] component '${props.styleName}' has no valid default export`)
        }
      })
      .catch((err: Error) => {
        if (cancelled) return
        setLoadError(err.message)
        console.warn(
          `[outputStyles] failed to load component '${props.styleName}': ${err.message}`,
        )
      })
    return () => {
      cancelled = true
    }
  }, [props.componentPath, props.styleName])

  if (loadError !== null || Comp === null) return <>{props.fallback}</>

  return (
    <OutputStyleErrorBoundary styleName={props.styleName} fallback={props.fallback}>
      <Comp {...props.styleProps} />
    </OutputStyleErrorBoundary>
  )
}

export function MessageRow(props: {
  m: Message
  /** Pre-resolved tool_result output keyed by tool_use id, for dispatch_agent rendering. */
  toolResultsById?: Map<string, { output: string; isError: boolean }>
  /** Ids of dispatch_agent tool_use blocks that should render expanded. */
  expandedAgentCallIds?: Set<string>
  resolveToolSource?: (toolName: string) => 'builtin' | 'skill' | 'plugin' | undefined
  resolveToolAnnotations?: (
    toolName: string,
  ) => { readOnly?: boolean; destructive?: boolean; openWorld?: boolean } | undefined
}): React.JSX.Element | null {
  const { m } = props
  if (m.role === 'system') return null
  if (m.role === 'responses_compaction') {
    return (
      <Box flexDirection="row">
        <Text color={P.fgMuted} bold>▎ </Text>
        <Box flexGrow={1}>
          <Text dimColor>context compacted · {m.output.length} Responses item{m.output.length === 1 ? '' : 's'}</Text>
        </Box>
      </Box>
    )
  }
  const barColor = m.role === 'user' ? P.success : m.role === 'assistant' ? P.error : P.accentCool

  if (m.role === 'tool') {
    // Suppress the standalone tool-role block for dispatch_agent — the
    // AgentCall renders its own result inline with the tool_use call.
    if (props.toolResultsById?.has(m.toolUseId)) {
      return null
    }
    const toolContent =
      typeof m.content === 'string'
        ? m.content
        : m.content.map(b => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n')
    return (
      <Box flexDirection="row">
        <Text color={barColor} bold>▎ </Text>
        <Box flexDirection="column" flexGrow={1}>
          <Markdown source={toolContent} />
        </Box>
      </Box>
    )
  }

  if (m.role === 'assistant') {
    const blocks = m.content
    return (
      <Box flexDirection="row">
        <Text color={barColor} bold>▎ </Text>
        <Box flexDirection="column" flexGrow={1}>
          {blocks.map((b: any, i: number) => {
            if (b.type === 'text') {
              return <Markdown key={i} source={b.text} />
            }
            if (b.type === 'tool_use') {
              if (b.name === DISPATCH_AGENT_TOOL_NAME) {
                const input = (b.input ?? {}) as { agent?: string; task?: string }
                const agent = typeof input.agent === 'string' ? input.agent : '(unknown)'
                const task = typeof input.task === 'string' ? input.task : ''
                const res = props.toolResultsById?.get(b.id)
                const status: 'running' | 'ok' | 'error' = !res
                  ? 'running'
                  : res.isError ? 'error' : 'ok'
                return (
                  <AgentCall
                    key={i}
                    agent={agent}
                    task={task}
                    status={status}
                    {...(res ? { result: res.output } : {})}
                    expanded={props.expandedAgentCallIds?.has(b.id) ?? false}
                  />
                )
              }
              const source = props.resolveToolSource?.(b.name)
              const annotations = props.resolveToolAnnotations?.(b.name)
              const registry = getRegistry()
              const matchedStyle = matchStyle(b.name, source, [...registry])

              const defaultFallback = (
                <ToolCall
                  key={i}
                  name={b.name}
                  argSummary={summarize(b.input)}
                  status="ok"
                  source={source}
                  annotations={annotations}
                />
              )

              if (matchedStyle) {
                const styleProps: OutputStyleProps = {
                  toolName: b.name,
                  input: b.input,
                  output: '',
                  isError: false,
                }
                return (
                  <CustomOutputStyle
                    key={i}
                    componentPath={matchedStyle.componentPath}
                    styleName={matchedStyle.name}
                    styleProps={styleProps}
                    fallback={defaultFallback}
                  />
                )
              }

              return defaultFallback
            }
            return null
          })}
        </Box>
      </Box>
    )
  }

  // user message — the colored left bar already provides user/assistant
  // visual distinction. Dropping the per-text backgroundColor avoids the
  // zebra-stripe effect on multi-line pastes where trailing whitespace
  // lines previously rendered painted-per-character.
  const text = m.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  return (
    <Box flexDirection="row">
      <Text color={barColor} bold>▎ </Text>
      <Box flexGrow={1}>
        <Text color={P.fg}>{text}</Text>
      </Box>
    </Box>
  )
}
