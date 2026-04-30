import { describe, it, expect } from 'vitest'
import { runRoundtable } from '../../../src/core/swarm/roundtable'

describe('runRoundtable', () => {
  it('runs K rounds and synthesizer produces artifact', async () => {
    const transcript: string[] = []
    const fakeRound = async (member: string, _round: number) => {
      const line = `${member}-says-something`
      transcript.push(line)
      return line
    }
    const fakeSynth = async (transcript: string) => `final-from-${transcript.split('\n').length}-lines`
    const r = await runRoundtable({
      input: {
        team: 'demo', topic: 'design',
        members: [
          { agent: 'core:planner',  name: 'p', role: 'planner' },
          { agent: 'core:skeptic',  name: 's', role: 'skeptic' },
        ],
        synthesizer: 'p', rounds: 2,
      },
      sendRound: fakeRound,
      synthesize: fakeSynth,
    })
    expect(r.rounds).toBe(2)
    expect(r.transcript.split('\n').length).toBe(4)         // 2 members × 2 rounds
    expect(r.artifact).toMatch(/final-from-/)
  })
})
