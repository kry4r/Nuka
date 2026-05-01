import { z } from 'zod'
import { ulid } from 'ulid'
import type { TaskProfile, Difficulty } from '../harness/types'
import { TaskGraph } from './taskGraph'
import type { SubTask } from './types'

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  profile: z.enum(['feature', 'debug-fix', 'refactor', 'investigate', 'doc', 'odd-jobs']),
  testStrategy: z.enum(['tdd', 'cross-module', 'multi-test']),
})

const Out = z.object({
  tasks: z.array(TaskSchema).min(1),
  edges: z.array(z.tuple([z.string(), z.string(), z.string()])),
})

const PROMPT = (root: string, profile: TaskProfile, difficulty: Difficulty): string =>
  `Decompose the following user task into a small DAG of executable sub-tasks. Return STRICT JSON only.

User task: ${root}
Top-level profile: ${profile}
Difficulty: ${difficulty}

Schema:
{
  "tasks": [
    { "id": "<short stable id>", "title": "<imperative one-liner>",
      "profile": "feature|debug-fix|refactor|investigate|doc|odd-jobs",
      "testStrategy": "tdd|cross-module|multi-test" }
  ],
  "edges": [ ["fromId", "toId", "reason for the dependency"] ]
}

Rules:
- ${difficulty === 'hard' || difficulty === 'hell' ? 'Aim for 2–5 sub-tasks; never just 1.' : 'Single sub-task is acceptable.'}
- Sub-task profiles can differ from the top-level (e.g. a feature task can have a doc sub-task).
- Edges express "to depends on from"; only include edges that are real dependencies.
- All ids referenced in edges must appear in tasks.

Reply with the JSON object only, no prose.`

function tryParse(text: string): z.infer<typeof Out> | null {
  try {
    const stripped = text
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/```\s*$/, '')
      .trim()
    return Out.parse(JSON.parse(stripped))
  } catch {
    return null
  }
}

function buildGraph(
  rootMessage: string,
  difficulty: Difficulty,
  parsed: z.infer<typeof Out>,
): TaskGraph {
  const g = new TaskGraph({ rootMessage, difficulty })
  // pre-add nodes (without edges) so link() can wire them
  for (const t of parsed.tasks) {
    const node: SubTask = {
      id: t.id,
      title: t.title,
      profile: t.profile,
      testStrategy: t.testStrategy,
      agentId: null,
      status: 'pending',
      dependsOn: [],
      contextFor: [],
      result: null,
    }
    g.add(node)
  }
  for (const [from, to, reason] of parsed.edges) {
    if (g.snapshot().nodes[from] && g.snapshot().nodes[to]) {
      g.link(from, to, reason)
    }
  }
  return g
}

function singletonGraph(rootMessage: string, profile: TaskProfile, difficulty: Difficulty): TaskGraph {
  const g = new TaskGraph({ rootMessage, difficulty })
  g.add({
    id: ulid(),
    title: rootMessage,
    profile,
    testStrategy: 'tdd',
    agentId: null,
    status: 'pending',
    dependsOn: [],
    contextFor: [],
    result: null,
  })
  return g
}

export type DecomposeOpts = {
  rootMessage: string
  profile: TaskProfile
  difficulty: Difficulty
  runFork: (prompt: string) => Promise<{ text: string }>
}

/**
 * Ask the LLM to decompose a root message into a sub-task DAG.
 * Up to 2 attempts; on failure returns a graph with a single sub-task carrying
 * the original root message (so callers can still `runGraph` it).
 */
export async function decomposeTask(opts: DecomposeOpts): Promise<TaskGraph> {
  const prompt = PROMPT(opts.rootMessage, opts.profile, opts.difficulty)
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await opts.runFork(prompt)
    const parsed = tryParse(r.text)
    if (parsed) return buildGraph(opts.rootMessage, opts.difficulty, parsed)
  }
  return singletonGraph(opts.rootMessage, opts.profile, opts.difficulty)
}
