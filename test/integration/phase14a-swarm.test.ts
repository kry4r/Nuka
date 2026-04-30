import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path'
import { TeamRegistry } from '../../src/core/teams/registry'
import { MessageRouter } from '../../src/core/messaging/router'
import { InProcessBackend } from '../../src/core/messaging/inProcessBackend'
import { runPipeline } from '../../src/core/swarm/pipeline'
import { runRoundtable } from '../../src/core/swarm/roundtable'
import { createEventBus } from '../../src/core/events/bus'
import { ensureNukaLayout } from '../../src/core/paths'

describe('phase14a swarm e2e', () => {
  let home: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nuka-14a-'))
    ensureNukaLayout(home)
    process.env.NUKA_COORDINATOR_MODE = '1'
  })
  afterEach(() => { delete process.env.NUKA_COORDINATOR_MODE })

  it('coordinator → team → pipeline (with roundtable in stage 2)', async () => {
    const teams = new TeamRegistry({ home })
    const team = await teams.create('demo', '')
    const bus = createEventBus()
    const backend = new InProcessBackend()
    const router = new MessageRouter({ backends: [backend], bus })

    // Stage 1: research; Stage 2: roundtable (planner+skeptic) → synthesized plan; Stage 3: implement
    const pipeline = await runPipeline({
      input: {
        entry: 'research',
        nodes: [
          { id: 'research', agent: 'core:researcher', prompt: 'find context', next: ['plan'], timeoutMs: 1000 },
          { id: 'plan',     agent: 'core:planner',    prompt: 'plan from {{prev}}', next: ['impl'], timeoutMs: 1000 },
          { id: 'impl',     agent: 'core:implementer', prompt: 'implement {{prev}}', next: [], timeoutMs: 1000 },
        ],
      },
      runStage: async (id, prompt) => {
        if (id === 'plan') {
          const r = await runRoundtable({
            input: { team: 'demo', topic: prompt, members: [{ agent: 'core:planner', name: 'p', role: 'planner' }, { agent: 'core:skeptic', name: 's', role: 'skeptic' }], synthesizer: 'p', rounds: 1 },
            sendRound: async name => `${name} thoughts`,
            synthesize: async transcript => `synthesized: ${transcript.length} chars`,
          })
          return r.artifact
        }
        return `${id}-output`
      },
    })

    expect(pipeline.ok).toBe(true)
    expect(pipeline.stages.length).toBe(3)
    expect(pipeline.stages[1]!.output).toMatch(/synthesized:/)
    expect(team.taskListId).toBeTruthy()
  })
})
