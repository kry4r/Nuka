// src/core/diff/applyDiffName.ts
//
// Pure constant module — the canonical name of the ApplyDiff tool.
//
// Lifted out of `applyDiffTool.ts` so consumers that only need the
// name (e.g. `applyDiffPermissionHook.ts`) don't drag the entire
// tool implementation (parse + apply + writeFile) into the main
// bundle (Phase P2 #12). The tool implementation itself still
// re-exports this constant for backward compatibility.

export const APPLY_DIFF_TOOL_NAME = 'ApplyDiff'
