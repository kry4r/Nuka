// src/core/tools/coordinator/index.ts
export {
  makeCoordinateAgentsTool,
  COORDINATE_AGENTS_TOOL_NAME,
} from './coordinateAgentsTool'
export type { CoordinateAgentsInput } from './coordinateAgentsTool'
export { makeBlackboardTools, BB_READ_NAME, BB_WRITE_NAME } from './blackboardTool'
export type { BlackboardReadInput, BlackboardWriteInput } from './blackboardTool'
