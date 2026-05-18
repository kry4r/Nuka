// src/core/testing/explorer/sweep.ts
//
// Re-export from the real sweep implementation (M2).
// The actual logic lives in sweep/sweep.ts to keep file sizes under budget.

export { sweep } from './sweep/sweep'
