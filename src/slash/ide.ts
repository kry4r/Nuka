/**
 * src/slash/ide.ts — Phase 8 §4.5
 *
 * /ide               — probe for running IDEs and list them (numbered).
 * /ide connect <n>   — register an MCP SSE server for the nth detected IDE.
 * /ide disconnect    — remove the 'ide' MCP server entry.
 */

import type { SlashCommand, SlashContext, SlashResult } from './types'
import { detectIdes, IDE_PORTS, type IdeFamily } from '../core/ide/detect'

/** Internal server name used when connecting to an IDE MCP endpoint. */
const IDE_SERVER_NAME = 'ide'

/** Port overrides via environment variables (e.g. NUKA_IDE_VSCODE_PORT=4096). */
function portForFamily(family: IdeFamily): number {
  const envKey = `NUKA_IDE_${family.toUpperCase()}_PORT`
  const envVal = process.env[envKey]
  if (envVal) {
    const n = parseInt(envVal, 10)
    if (!isNaN(n) && n > 0) return n
  }
  return IDE_PORTS[family]
}

export const IdeCommand: SlashCommand = {
  name: 'ide',
  description: 'Detect running IDEs and connect via MCP',
  usage: '/ide | /ide connect <n> | /ide disconnect',

  run: async (args: string, ctx: SlashContext): Promise<SlashResult> => {
    const sub = args.trim()

    // -----------------------------------------------------------------------
    // /ide disconnect
    // -----------------------------------------------------------------------
    if (sub === 'disconnect') {
      if (!ctx.mcpManager) {
        return { type: 'text', text: 'No MCP manager available.' }
      }
      await ctx.mcpManager.removeServer(IDE_SERVER_NAME)
      return { type: 'text', text: 'IDE MCP server disconnected.' }
    }

    // -----------------------------------------------------------------------
    // /ide connect <n>
    // -----------------------------------------------------------------------
    const connectMatch = sub.match(/^connect\s+(\d+)$/)
    if (connectMatch) {
      if (!ctx.mcpManager) {
        return { type: 'text', text: 'No MCP manager available.' }
      }
      const idx = parseInt(connectMatch[1]!, 10) - 1
      const ides = await detectIdes()
      if (ides.length === 0) {
        return { type: 'text', text: '(no IDEs detected — see docs/ide.md)' }
      }
      if (idx < 0 || idx >= ides.length) {
        return { type: 'text', text: `Invalid selection. Choose 1–${ides.length}.` }
      }
      const ide = ides[idx]!
      const port = portForFamily(ide.family)
      const url = `http://localhost:${port}/mcp`
      await ctx.mcpManager.addServer(IDE_SERVER_NAME, { type: 'sse', url })
      return {
        type: 'text',
        text: `Connected to ${ide.family} IDE at ${url}. If the extension is not installed, the connection will fail — install the Nuka extension and retry.`,
      }
    }

    // -----------------------------------------------------------------------
    // /ide  (list detected IDEs)
    // -----------------------------------------------------------------------
    if (sub === '' || sub === 'list') {
      const ides = await detectIdes()
      if (ides.length === 0) {
        return { type: 'text', text: '(no IDEs detected — see docs/ide.md)' }
      }
      const lines = ides.map(
        (ide, i) =>
          `  ${i + 1}. ${ide.family}${ide.port !== undefined ? ` (port ${ide.port})` : ''}`,
      )
      return {
        type: 'text',
        text: `Detected IDEs:\n${lines.join('\n')}\n\nUse /ide connect <n> to register the MCP server.`,
      }
    }

    return {
      type: 'text',
      text: 'Usage: /ide | /ide connect <n> | /ide disconnect',
    }
  },
}
