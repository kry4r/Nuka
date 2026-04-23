export const DEFAULT_TIPS: string[] = [
  'Which bug are we slicing today?',
  'Keyboard ready. Feed me a task.',
  'Coffee. Code. Avocado.',
  "Refactor o'clock. Deep breath.",
  "I won't write tests, but I'll nag you to.",
  'Saving is brave. Committing is braver.',
  'Past-you left a TODO. Want to see it?',
  'Build or break today? Either works.',
]

export function pickTip(extra: string[] = []): string {
  const pool = [...DEFAULT_TIPS, ...extra]
  return pool[Math.floor(Math.random() * pool.length)] ?? ''
}
