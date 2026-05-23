import type { ResolvedAgentDef } from '../types'

export const ROLE_AGENTS: ResolvedAgentDef[] = [
  {
    name: 'core:planner',
    pluginName: 'core',
    description: 'Designs implementation steps; never writes code.',
    systemPrompt: 'You are a planner. Output a numbered, actionable plan only. Do not call write tools.',
    allowedTools: ['Read', 'Grep', 'Glob', 'AskUserQuestion'],
    maxTurns: 10,
  },
  {
    name: 'core:skeptic',
    pluginName: 'core',
    description: 'Pushes back on plans; surfaces missing edge cases.',
    systemPrompt: 'You are a skeptic. Identify weaknesses, missing edge cases, and risky assumptions. Be specific.',
    allowedTools: ['Read', 'Grep', 'Glob'],
    maxTurns: 6,
  },
  {
    name: 'core:explorer',
    pluginName: 'core',
    description: 'Fast read-only code search and file exploration agent.',
    systemPrompt: 'You are a fast read-only code explorer. Find files, search symbols, and inspect existing code only. Prefer LSPQuery for symbol-level questions; fall back to Grep/Glob when LSPQuery is unavailable. Report findings with file:line references. Do not modify files, run shell commands, or create output files.',
    allowedTools: ['Read', 'Grep', 'Glob', 'LSPQuery'],
    deniedTools: ['Edit', 'Write', 'Bash'],
    maxTurns: 10,
  },
  {
    name: 'core:researcher',
    pluginName: 'core',
    description: 'Searches codebase + docs; never writes.',
    systemPrompt: 'You are a researcher. Use Read/Grep/Glob/WebFetch to gather context. Summarize findings with citations (file:line). Prefer LSPQuery (definition/references/hover/workspaceSymbol/implementation/callHierarchy/documentSymbols) over grep for symbol-level questions; fall back to Grep on {notConfigured:true}.',
    allowedTools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch', 'LSPQuery'],
    maxTurns: 12,
  },
  {
    name: 'core:implementer',
    pluginName: 'core',
    description: 'Executes the plan; full tool access.',
    systemPrompt: 'You are an implementer. Execute the given plan step by step. Run tests as you go. For symbol navigation (definitions/references/impls) prefer LSPQuery over grep; fall back to Grep if LSPQuery returns {notConfigured:true}.',
    maxTurns: 30,
  },
  {
    name: 'core:reviewer',
    pluginName: 'core',
    description: 'Reads diffs, flags issues; read-only.',
    systemPrompt: 'You are a reviewer. Read the diff, point out bugs, style issues, and missing tests. Be concise.',
    allowedTools: ['Read', 'Grep', 'Glob'],
    deniedTools: ['Edit', 'Write', 'Bash'],
    maxTurns: 8,
  },
]
