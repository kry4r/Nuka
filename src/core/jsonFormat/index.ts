// src/core/jsonFormat/index.ts
//
// Public surface of the pretty JSON formatter. Pure logic — no UI
// deps. See `jsonFormat.ts` for the rationale.

export {
  formatJSON,
  formatJSONCompact,
  type FormatJSONOptions,
  type JsonMarkers,
  type CycleHandler,
  type BigIntHandler,
  type SortKeysOption,
} from './jsonFormat'

export {
  JsonFormatTool,
  JSON_FORMAT_TOOL_NAME,
  runJsonFormat,
  type JsonFormatInput,
  type JsonFormatResult,
} from './jsonFormatTool'
