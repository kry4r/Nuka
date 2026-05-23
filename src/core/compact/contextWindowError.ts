export function isContextWindowError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const lower = message.toLowerCase()
  return (
    lower.includes('413') ||
    lower.includes('context') ||
    lower.includes('too long') ||
    lower.includes('prompt') && lower.includes('limit') ||
    lower.includes('maximum') && lower.includes('token')
  )
}
