// src/core/testing/explorer/types.ts
//
// Shared type definitions for the ink-ui-explorer skill.
// See locked spec §4.1 (L0 Capture), §4.2 (L1 Invariants), §4.5 (L3' Judge).
//
// All types are intentionally minimal stubs for M0; fields will be filled in
// M1–M5 as each layer is implemented.

// ---------------------------------------------------------------------------
// L0 — Capture types (locked spec §4.1)
// ---------------------------------------------------------------------------

/** A single terminal cell in a rendered grid. */
export type Cell = {
  char: string
  width: 0 | 1 | 2
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  underline?: boolean
  inverse?: boolean
}

/** A detected box-drawing rectangle in the grid. */
export type Box = {
  x: number
  y: number
  w: number
  h: number
  style: 'single' | 'double' | 'round' | 'bold'
}

/** A fully-parsed ANSI terminal grid for one rendered frame. */
export type AnsiGrid = {
  cols: number
  rows: number
  cells: Cell[][]
  boxes: Box[]
  asciiView: string
  hash: string
  toJSON(): unknown
}

/** Terminal size as used by the viewport matrix. */
export type Viewport = { cols: number; rows: number }

// ---------------------------------------------------------------------------
// L1 — Invariant violation type (locked spec §4.2)
// ---------------------------------------------------------------------------

export type Violation = {
  rule: string
  severity: 'error' | 'warn'
  cells?: Array<{ x: number; y: number }>
  excerpt?: string
  message: string
}

// ---------------------------------------------------------------------------
// L2 — Sweep / fixture types (locked spec §4.3)
// ---------------------------------------------------------------------------

/** A single rendered fixture case, including metadata used by invariants. */
export type FixtureCase = {
  render: () => import('react').ReactElement
  mustContain?: string[]
  expectsHugContent?: boolean
  allowStatic?: boolean
  zones?: Record<string, { x: number; y: number; w: number; h: number }>
  /** Custom assertion hook — receives the render handle after mount; can be async. */
  assert?: (handle: InkRenderHandle) => Promise<void> | void
}

/** A fixture file export — one component with N named cases. */
export type FixtureDef = {
  component: string
  cases: Record<string, FixtureCase>
  viewports?: 'default' | Viewport[]
}

// ---------------------------------------------------------------------------
// L3' — Judge types (locked spec §4.5)
// ---------------------------------------------------------------------------

export type JudgeVerdict = {
  gridHash: string
  component: string
  viewport: Viewport
  clean: boolean
  violations: Violation[]
  model: string
  cachedAt?: string
}

// ---------------------------------------------------------------------------
// L4 — Repair / failure dump types (locked spec §4.6)
// ---------------------------------------------------------------------------

export type FailureRecord = {
  id: string
  component: string
  fixtureCase: string
  viewport: Viewport
  violations: Violation[]
  asciiView: string
  stdinSequence?: string[]
  timestamp: string
}

// ---------------------------------------------------------------------------
// L0 — Render handle (locked spec §4.1)
// ---------------------------------------------------------------------------

/** Return type of renderWithViewport — the single handle all layers consume. */
export type InkRenderHandle = {
  frames(): string[]
  lastFrame(): string
  staticWrites(): string[]
  grid(frame?: string): AnsiGrid
  stdin: { write(s: string): void }
  resize(cols: number, rows: number): void
  unmount(): void
}

// ---------------------------------------------------------------------------
// L1 — Invariant context (locked spec §4.2)
// ---------------------------------------------------------------------------

/** Context object passed to every invariant function alongside the grid. */
export type InvariantCtx = {
  viewport: Viewport
  staticWrites: string[]
  fixtureCase?: FixtureCase
}

// ---------------------------------------------------------------------------
// Verb option/result types (stub shapes — filled in M1–M5)
// ---------------------------------------------------------------------------

export type CaptureOpts = {
  fixturePath: string
  viewport?: Viewport
  caseName?: string
  cwd?: string
  out?: string
}

export type CaptureResult = {
  grids: AnsiGrid[]
  capturePath: string
}

export type SweepOpts = {
  fixturesGlob?: string
  noJudge?: boolean
}

export type SweepResult = {
  failures: FailureRecord[]
  total: number
}

export type FuzzOpts = {
  target?: string
  seed?: number
  steps?: number
}

export type FuzzResult = {
  failures: FailureRecord[]
  stepsRun: number
}

export type JudgeOpts = {
  reJudge?: boolean
}

export type JudgeResult = {
  verdicts: JudgeVerdict[]
  apiCallsMade: number
}

export type RepairOpts = {
  failureId: string
}

export type RepairResult = {
  promoted: boolean
  fixturePath?: string
  summary: string
}
