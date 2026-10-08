/**
 * The browser's only way to talk to the server: JSON to the same origin
 * (see API.md). Errors carry the stable code from the server; screens
 * word them in the player's language.
 */
import type { ContentPackage, TextValue } from "@builder/format/pure";
import type { DraftSummary, Evaluation, LevelUpState } from "@builder/core";
import type { PrintChoice } from "@builder/sheet/printouts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly retryAfter: number | undefined;

  constructor(status: number, code: string, details: Record<string, unknown> = {}, retryAfter?: number) {
    super(`${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }

  /** No answer at all: offline, server down, connection cut. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

/** The browser sends at most this much with `keepalive`; a larger body goes as an ordinary request. */
const KEEPALIVE_MAX_BYTES = 60_000;

/**
 * `keepalive`: the request goes out even if the page is closed or reloaded
 * right after it was started (a note typed just before leaving).
 */
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  options: { keepalive?: boolean } = {},
): Promise<T> {
  let res: Response;
  const json = body !== undefined ? JSON.stringify(body) : undefined;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: json !== undefined ? { "content-type": "application/json" } : {},
      ...(json !== undefined ? { body: json } : {}),
      ...(options.keepalive && new Blob([json ?? ""]).size <= KEEPALIVE_MAX_BYTES ? { keepalive: true } : {}),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const error = (data as { error?: { code?: string } & Record<string, unknown> } | null)?.error;
    const retry = Number(res.headers.get("retry-after"));
    throw new ApiError(
      res.status,
      error?.code ?? (res.status >= 500 ? "server" : "unknown"),
      error ?? {},
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return data as T;
}

// ------------------------------------------------------------------ shapes

export interface Account {
  email: string;
  language: string;
  units: Record<string, string>;
  /** What the download dialog offers first: the last download's choice. */
  print: PrintChoice;
  createdAt: string;
}

/** A sheet design as `GET /api/sheet-designs` lists it; names per screen language. */
export interface SheetDesignInfo {
  id: string;
  name: Record<string, string>;
  description: Record<string, string>;
}

export interface PackageListEntry {
  id: string;
  version: string;
  languages: string[];
  language: string;
  name: string | null;
  short: string | null;
}

/** Package structure without texts, as `GET /api/packages/:id` sends it. */
export type PackageStructure = Omit<ContentPackage, "texts">;
export type PackageTexts = Record<string, TextValue>;

export interface DraftInfo {
  id: string;
  packageId: string;
  packageVersion: string;
  version: number;
  status: "draft" | "finished";
  level: number;
  /** The level a raise started from, until the character is finished again. */
  levelBefore: number | null;
  /** The campaign the character belongs to; null for none. */
  campaignId: string | null;
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  /** Whose character it is; a game master sees the player here. */
  owner: { email: string };
  /** Opened as its owner, or as the game master of a campaign the owner plays in. */
  access: "owner" | "gameMaster";
}

export interface DraftView {
  draft: DraftInfo;
  packageAvailable: boolean;
  evaluation: Evaluation | null;
  summary: DraftSummary | null;
  levelUp: LevelUpState | null;
}

export type DraftListEntry = DraftInfo & { packageAvailable: boolean; summary: DraftSummary | null };

export interface Campaign {
  id: string;
  name: string;
  role: "gameMaster" | "player";
  gameMaster: { email: string };
  playerCount: number;
  createdAt: string;
  /** When the viewer joined as a player; null for the game master. */
  joinedAt: string | null;
}

export interface CampaignPlayer {
  id: string;
  email: string;
  addedAt: string;
  characters: DraftListEntry[];
}

/** `players` is null for a player of the campaign: they see only its name and who leads it. */
export interface CampaignView {
  campaign: Campaign;
  players: CampaignPlayer[] | null;
}
