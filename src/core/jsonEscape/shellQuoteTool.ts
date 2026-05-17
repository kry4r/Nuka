// src/core/jsonEscape/shellQuoteTool.ts
//
// Agent-callable tool that POSIX-quotes user-supplied arguments and
// concatenates them with a binary name into a single safe command
// string. Intended workflow: agent calls ShellQuote with
// { command: 'grep', args: ['$(rm -rf /)', '/tmp/file'] }, gets back
// { quoted: "grep '$(rm -rf /)' /tmp/file" }, and then passes that
// string to BashTool. This is the recommended path for any command
// that interpolates externally-supplied data into a shell line —
// BashTool itself takes a freeform string by design (agent-authored),
// so the quoting belongs upstream of it.
//
// Why a separate Tool instead of modifying BashTool? BashTool's input
// is a single command string. The agent is the author of that string;
// it is not a structured argv that BashTool can re-quote without
// double-quoting whatever the agent already wrote. Exposing quoteShell
// as a Tool surface gives the agent an explicit, testable way to
// build safe command lines from untrusted data before invoking Bash.

import { defineTool } from '../tools/define'
import { quoteShell, quoteShellArray } from './jsonEscape'

type ShellQuoteInput = {
  command: string
  args?: ReadonlyArray<string>
  style?: 'auto' | 'single' | 'double'
}

export const ShellQuoteTool = defineTool<ShellQuoteInput>({
  name: 'ShellQuote',
  description:
    'POSIX-quote arguments and join them with a binary name to produce a shell-safe command string. Use this when interpolating user-supplied or otherwise untrusted strings into a Bash invocation.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'Binary or built-in to invoke. Quoted with the same rules as each arg.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the binary. Each is POSIX-quoted individually.',
      },
      style: {
        type: 'string',
        enum: ['auto', 'single', 'double'],
        description:
          "Quoting style. 'auto' (default) emits the cheapest correct form; 'single' forces single-quoted; 'double' forces double-quoted.",
      },
    },
  },
  source: 'builtin',
  tags: ['core', 'shell'],
  annotations: { readOnly: true },
  needsPermission: () => 'none',
  async run(input) {
    const style = input.style ?? 'auto'
    const quotedCommand = quoteShell(input.command, { style })
    const args = input.args ?? []
    const quotedArgs = args.length === 0 ? '' : ' ' + quoteShellArray(args, { style })
    return { isError: false, output: quotedCommand + quotedArgs }
  },
})
