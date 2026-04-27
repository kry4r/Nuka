import type { SlashCommand, SlashContext } from './types'

const CMDS: Array<[string, string]> = [
  ['/exit', 'Quit Nuka'],
  ['/help', 'Show this help'],
  ['/clear', 'Clear rendered messages (keeps session)'],
  ['/new', 'Start a new session'],
  ['/branch', 'Fork the current session'],
  ['/model', 'Pick provider + model'],
  ['/config', 'Edit config in $EDITOR'],
  ['/btw <text>', 'Queue a message without interrupting the current turn'],
  ['/compact', 'Summarize older messages to free context'],
  ['/cost', 'Show cost and token breakdown'],
  ['/tasks', 'List/show/cancel background tasks'],
]

export const HelpCommand: SlashCommand = {
  name: 'help',
  description: 'Show help',
  run: async (_args: string, _ctx: SlashContext) => {
    const rows = CMDS.map(([k, v]) => `  ${k.padEnd(18)} ${v}`).join('\n')
    return { type: 'text', text: `Commands:\n${rows}` }
  },
}
