// src/tui/hooks/useTerminalSize.ts
import { useEffect, useState } from 'react'
import { useStdout } from 'ink'

function readTerminalSize(stdout: NodeJS.WriteStream | undefined): { columns: number; rows: number } {
  return {
    columns: stdout?.columns ?? process.stdout.columns ?? 80,
    rows: stdout?.rows ?? process.stdout.rows ?? 24,
  }
}

export function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => readTerminalSize(stdout))
  useEffect(() => {
    const onResize = () => setSize(readTerminalSize(stdout))
    onResize()
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [stdout])
  return size
}
