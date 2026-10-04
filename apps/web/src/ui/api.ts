/**
 * The browser's only way to talk to the server: JSON to the same origin
 * (see API.md). Errors carry the stable code from the server; screens
 * word them in the player's language.
 */
import type { ContentPackage, TextValue } from "@builder/format/pure";
import type { DraftSummary, Evaluation } from "@builder/core";

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

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  createdAt: string;
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
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface DraftView {
  draft: DraftInfo;
  packageAvailable: boolean;
  evaluation: Evaluation | null;
  summary: DraftSummary | null;
}

export type DraftListEntry = DraftInfo & { packageAvailable: boolean; summary: DraftSummary | null };
