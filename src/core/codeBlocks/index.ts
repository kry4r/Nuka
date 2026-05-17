// src/core/codeBlocks/index.ts
//
// Public surface of the code-block parser. Pure module, no dependencies.

export {
  extractCodeBlocks,
  splitByCodeFences,
  replaceCodeBlocks,
  findFirstCodeBlock,
  unwrapSingleCodeBlock,
  type CodeBlock,
  type Segment,
  type FenceChar,
} from './parse'

export {
  CodeBlocksTool,
  CODE_BLOCKS_TOOL_NAME,
  runCodeBlocks,
  type CodeBlocksAction,
  type CodeBlocksInput,
  type CodeBlocksResult,
  type CodeBlockView,
  type SegmentView,
} from './codeBlocksTool'
