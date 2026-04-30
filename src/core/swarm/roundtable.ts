export type RoundtableMember = { agent: string; name: string; role: string }
export type RoundtableInput = {
  team: string
  topic: string
  members: RoundtableMember[]
  synthesizer: string
  rounds: number
}

export type RunRoundtableOpts = {
  input: RoundtableInput
  sendRound: (memberName: string, round: number) => Promise<string>
  synthesize: (transcript: string) => Promise<string>
}

export async function runRoundtable(opts: RunRoundtableOpts): Promise<{ artifact: string; rounds: number; transcript: string }> {
  const lines: string[] = []
  for (let r = 0; r < opts.input.rounds; r++) {
    const turn = await Promise.all(opts.input.members.map(m => opts.sendRound(m.name, r)))
    for (const t of turn) lines.push(t)
  }
  const transcript = lines.join('\n')
  const artifact = await opts.synthesize(transcript)
  return { artifact, rounds: opts.input.rounds, transcript }
}
