import { expectTypeOf } from 'vitest'
import type { Task, TaskKind, TaskState, TaskSpec } from '../../../src/core/tasks/types'

expectTypeOf<TaskKind>().toEqualTypeOf<
  | 'local_bash'
  | 'local_agent'
  | 'in_process_teammate'
  | 'local_shell'
  | 'remote_agent'
  | 'dream'
>()

expectTypeOf<TaskState>().toEqualTypeOf<
  | 'pending'
  | 'running'
  | 'idle'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'shutdown_requested'
>()

const exhaust = (s: TaskSpec): string => {
  switch (s.kind) {
    case 'local_bash':           return 'b'
    case 'local_agent':          return 'a'
    case 'in_process_teammate':  return 't'
    case 'local_shell':          return 's'
    case 'remote_agent':         return 'r'
    case 'dream':                return 'd'
  }
}
expectTypeOf(exhaust).toBeFunction()
