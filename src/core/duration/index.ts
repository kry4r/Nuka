// src/core/duration/index.ts
//
// Public surface of the duration / approx-time / bytes formatters.
// Pure logic, no UI deps. See `duration.ts` for rationale and edge cases.

export {
  UNIT_MS,
  formatDuration,
  parseDuration,
  formatDurationApprox,
  formatTimestamp,
  formatBytes,
  formatFileSize,
  type DurationUnit,
  type FormatDurationOptions,
  type FormatDurationApproxOptions,
  type FormatTimestampOptions,
  type FormatBytesOptions,
} from './duration'

// Practical Iter OO — agent-facing Tool wrapper over the pure formatters.
// One discriminated-action surface for format/parse/approx/timestamp/bytes.
export {
  FormatDurationTool,
  FORMAT_DURATION_TOOL_NAME,
  runFormatDuration,
  type FormatDurationAction,
  type FormatDurationInput,
  type FormatDurationResult,
} from './durationTool'
