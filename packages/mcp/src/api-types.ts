/**
 * The parts of the API's answers this package reads, as described in
 * apps/web/openapi.json (the source of truth). Written by hand and kept
 * small: fields the tools do not use are left out.
 */

export type TextValue = string | string[] | null;
export type Texts = Record<string, TextValue>;

export interface Account {
  name: string;
  email: string | null;
  language: string;
  units: Record<string, string>;
}

export interface PackageEntry {
  id: string;
  version: string;
  languages: string[];
  language: string;
  name: string | null;
  short: string | null;
}

export interface FlowChoice {
  id: string;
  kind: string;
  targets?: string[];
  methods?: Array<Record<string, unknown> & { method: string }>;
  maxLength?: number;
}

/** `GET /api/packages/{id}`: the structure, no texts. */
export interface PackageStructure {
  manifest: { id: string; version: string; languages: string[] };
  units: unknown;
  values: unknown;
  flow: { choices: FlowChoice[]; level?: { min?: number; max?: number; default?: number } };
}

export interface Summary {
  name: string | null;
  level: number;
  complete: boolean;
  line: Record<string, string | number | null>;
}

export interface Draft {
  id: string;
  packageId: string;
  version: number;
  status: "draft" | "finished";
  level: number;
  levelBefore: number | null;
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  access: "owner" | "gameMaster";
}

export interface DraftListEntry extends Draft {
  packageAvailable: boolean;
  summary: Summary | null;
}

export interface PoolState {
  options: string[];
  choices: Array<{ choice: string; count: number; upTo: boolean; picks: string[]; remaining: number }>;
  picks: string[];
  count: number;
  remaining: number;
  recommended?: string[];
}

export interface StepState {
  id: string;
  choices: string[];
  status: "done" | "open" | "needsAttention";
  grantedBy?: string[];
  pool?: PoolState;
  atLevel?: number;
}

export interface HeldThing {
  id: string;
  kind: string;
  step?: string;
  grantedBy?: string;
  everyone?: true;
  atLevel?: number;
  count?: number;
}

export interface InfoContent {
  of: string;
  thing: string | null;
  things?: string[];
  values?: Array<{ value: string; add: number }>;
  choices?: string[];
}

export interface ChoiceState {
  id: string;
  copyOf?: string;
  kind: "pickOne" | "pickMany" | "distribute" | "number" | "text" | "info";
  step: string;
  optional: boolean;
  status: "answered" | "incomplete" | "missing" | "invalid" | "info";
  problem?: string;
  answer?: unknown;
  options?: string[];
  count?: number;
  upTo?: boolean;
  remaining?: number;
  min?: number;
  max?: number;
  recommended?: string[] | { method: number; assign: Record<string, number> };
  badges?: Record<string, string>;
  held?: string[];
  info?: InfoContent;
  textVariant?: string;
  grantedBy?: string[];
  atLevel?: number;
  raise?: { points: number; before: Record<string, number>; most: Record<string, number> };
}

export interface Evaluation {
  level: number;
  steps: StepState[];
  choices: Record<string, ChoiceState>;
  things: HeldThing[];
  values: Record<string, number>;
  open: string[];
  complete: boolean;
}

export interface LevelUpState {
  from: number;
  to: number;
  newSteps: string[];
  newChoices: string[];
  openSteps: string[];
}

export interface DraftView {
  draft: Draft;
  packageAvailable: boolean;
  evaluation: Evaluation | null;
  summary: Summary | null;
  levelUp: LevelUpState | null;
}

export type ValueSource =
  | { kind: "start" }
  | { kind: "choice"; choice: string }
  | { kind: "thing"; thing: string }
  | { kind: "values"; values: string[] }
  | { kind: "unclear" };

export interface ValueExplanation {
  value: string;
  total: number;
  parts: Array<{ amount: number; source: ValueSource }> | null;
}
