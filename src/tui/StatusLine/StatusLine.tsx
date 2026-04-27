// src/tui/StatusLine/StatusLine.tsx
// Phase 10 §4.5 — customizable status line component.
//
// When `config.command` is set, spawns it every `intervalMs` ms (default 5000)
// via child_process.exec with a 1 s timeout; appends first stdout line.
// Errors → render '?' once, log once to stderr.

import React, { useState, useEffect, useRef } from 'react'
import { Text } from 'ink'
import { exec } from 'node:child_process'
import type { StatusLineConfig } from '../../core/config/schema'
import { template, type StatusLineCtx } from './template'
import { defaultPalette as P } from '../theme'

export type StatusLineProps = {
  config: StatusLineConfig
  ctx: StatusLineCtx
}

function execFirstLine(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(cmd, { timeout: 1000 }, (err, stdout) => {
      if (err) {
        resolve('?')
        return
      }
      const line = stdout.split('\n')[0]?.trim() ?? ''
      resolve(line)
    })
    void child
  })
}

export function StatusLine({ config, ctx }: StatusLineProps): React.JSX.Element {
  const rendered = template(config?.format, ctx)
  const [commandOutput, setCommandOutput] = useState<string | null>(null)
  const loggedErrRef = useRef(false)

  useEffect(() => {
    if (!config?.command) return
    const intervalMs = config?.intervalMs ?? 5000

    let cancelled = false

    const run = async () => {
      try {
        const out = await execFirstLine(config.command!)
        if (!cancelled) {
          if (out === '?') {
            setCommandOutput('?')
            if (!loggedErrRef.current) {
              loggedErrRef.current = true
              process.stderr.write(`[statusline] command error: ${config.command}\n`)
            }
          } else {
            setCommandOutput(out)
          }
        }
      } catch {
        if (!cancelled) {
          setCommandOutput('?')
          if (!loggedErrRef.current) {
            loggedErrRef.current = true
            process.stderr.write(`[statusline] command failed: ${config.command}\n`)
          }
        }
      }
    }

    void run()
    const id = setInterval(run, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [config?.command, config?.intervalMs])

  const display = commandOutput !== null
    ? `${rendered} ${commandOutput}`
    : rendered

  return <Text color={P.muted}>{display}</Text>
}
