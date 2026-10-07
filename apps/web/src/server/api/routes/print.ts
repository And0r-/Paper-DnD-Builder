/**
 * The character sheet: as data (the model screen and PDF share) and printed
 * as one PDF with the parts asked for (sheet, cards, rules texts), in the
 * account's language and units, or a kept copy in its own. Only finished
 * characters have an original sheet: a draft with open choices would print
 * a sheet with holes the player cannot explain.
 */
import { evaluateDraft, type Evaluation } from "@builder/core";
import { renderPdf } from "@builder/print";
import {
  buildSheetModel,
  copyWhen,
  isTimeZone,
  sheetModelSchema,
  DEFAULT_API_PARTS,
  DESIGN_IDS,
  inFileOrder,
  MESSAGES,
  PRINT_PARTS,
  SHEET_DESIGNS,
  sheetLanguages,
  type PlayState,
  type PrintPart,
  type SheetModel,
} from "@builder/sheet";
import { HttpError, json } from "../http.ts";
import type { ReachableDraftRow } from "../../store.ts";
import type { RequestContext, Route } from "../router.ts";
import { loadDraft, packageOf } from "./drafts.ts";
import { copyView, defaultName, loadCopy } from "./sheet-copies.ts";

/** Making a PDF takes a moment of CPU; this is plenty for printing and stops a loop from hogging the server. */
const PDF_LIMIT = { max: 20, windowMs: 10 * 60_000 };

/**
 * What a PDF request asks for, checked before anything is loaded. Without
 * `parts` the PDF is the sheet and the cards, as before there were parts.
 * Designs that are planned but not drawn yet say so (`400` with their own
 * code), so a caller can tell them from a typo. `version` is `original` or
 * the id of a kept copy. `tz` is the reader's time zone, for the time a
 * copy was made (its name); without it, the server's.
 */
function printRequest(url: URL): {
  parts: PrintPart[] | undefined;
  design: string;
  version: string;
  filled: boolean;
  timeZone: string | undefined;
} {
  const bad = (parameter: string, value: string): never => {
    throw new HttpError(400, "badQuery", { parameter, value });
  };
  const rawParts = url.searchParams.get("parts");
  let parts: PrintPart[] | undefined;
  if (rawParts !== null) {
    const asked = rawParts.split(",").map((p) => p.trim());
    for (const p of asked) if (!(PRINT_PARTS as readonly string[]).includes(p)) bad("parts", rawParts);
    parts = inFileOrder(asked as PrintPart[]);
  }
  const design = url.searchParams.get("design") ?? SHEET_DESIGNS[0]!.id;
  if (!SHEET_DESIGNS.some((d) => d.id === design)) {
    if (!(DESIGN_IDS as readonly string[]).includes(design)) bad("design", design);
    throw new HttpError(400, "designNotAvailable", { design, designs: SHEET_DESIGNS.map((d) => d.id) });
  }
  const state = url.searchParams.get("state") ?? "empty";
  if (state !== "empty" && state !== "filled") bad("state", state);
  const timeZone = url.searchParams.get("tz") ?? undefined;
  if (timeZone !== undefined && !isTimeZone(timeZone)) bad("tz", timeZone);
  return {
    timeZone,
    parts,
    design,
    version: url.searchParams.get("version") ?? "original",
    filled: state === "filled",
  };
}

/** An ASCII file name from the character's name; the exact name goes into `filename*`. */
function fileNames(name: string): string {
  const ascii =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "character";
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`;
}

/**
 * The sheet of a finished character, in the language and units of whoever
 * asks: a game master sees a player's character in their own. `beforeBuild`
 * runs once the request is known to be good (the PDF's rate limit). The
 * origin says when the character last changed, so a kept copy can tell
 * whether this original moved on since.
 */
export async function originalSheet(
  ctx: RequestContext,
  beforeBuild?: (accountId: string) => void,
): Promise<{ model: SheetModel; row: ReachableDraftRow }> {
  const { row, viewer: account } = await loadDraft(ctx);
  beforeBuild?.(account.id);
  return { model: buildOriginal(ctx, row, account), row };
}

/** The original sheet of a character the viewer reaches, in the given language and units. */
function buildOriginal(
  ctx: RequestContext,
  row: ReachableDraftRow,
  settings: { language: string; units: Record<string, string> },
): SheetModel {
  const pkg = packageOf(ctx.app, row);
  const ev: Evaluation = evaluateDraft(pkg, row.document);
  if (!row.finished_at || !ev.complete) throw new HttpError(409, "notFinished", { open: ev.open });

  const languages = sheetLanguages(pkg);
  if (!languages.includes(settings.language)) {
    throw new HttpError(422, "languageNotSupported", { language: settings.language, languages });
  }
  return buildSheetModel(
    pkg,
    row.document,
    {
      language: settings.language,
      units: settings.units,
      createdAt: ctx.app.now(),
      changedAt: row.updated_at,
    },
    ev,
  );
}

/**
 * What a PDF prints: the original, or a kept copy as the player left it, in
 * the copy's language and units. A copy has the original's cards and rules
 * texts (in the copy's language and units, so the file stays in one), and
 * only when they are asked for: the sheet of a copy prints even when the
 * character is no longer finished or its package is gone. A row the player
 * wrote into a copy has no card and no rules text. A copy with the name it
 * was given when made is named as on the screen, by the minute it was made
 * ("Meine Fassung vom 7. Oktober, 09:40"); `file` says the same for the
 * file name. The original has no `file`.
 */
async function printedSheet(
  ctx: RequestContext,
  version: string,
  parts: readonly PrintPart[],
  timeZone: string | undefined,
  beforeBuild: (accountId: string) => void,
): Promise<{ model: SheetModel; row: ReachableDraftRow; file?: string }> {
  if (version === "original") return originalSheet(ctx, beforeBuild);
  const { row, viewer } = await loadDraft(ctx);
  const copy = await loadCopy(ctx, row.id, version).catch((e: unknown) => {
    if (e instanceof HttpError && e.code === "copyNotFound")
      throw new HttpError(404, "versionNotFound", { version });
    throw e;
  });
  // Stored models are checked on the way in; a shape older than this code is not printed half.
  const parsed = sheetModelSchema.safeParse(copyView(copy).model);
  if (!parsed.success) throw new HttpError(409, "copyUnreadable", { version });
  beforeBuild(viewer.id);
  const m = MESSAGES[copy.language]!;
  const at = copyWhen(copy.language, copy.created_at, { timeZone, now: ctx.app.now() });
  const named = copy.name !== defaultName(copy.language, copy.created_at);
  const name = named ? copy.name : m.copyNameAt(at.date, at.time);
  const { origin } = parsed.data;
  if (origin.kind !== "copy") throw new Error("a kept copy that is not a copy");
  const model: SheetModel = { ...parsed.data, origin: { ...origin, name } };
  const file = named ? copy.name : m.copyFile(at.date, at.time);
  if (!parts.includes("cards") && !parts.includes("texts")) return { model, row, file };
  const original = buildOriginal(ctx, row, { language: copy.language, units: copy.units });
  return { model: { ...model, cards: original.cards, rulesTexts: original.rulesTexts }, row, file };
}

export const printRoutes: Route[] = [
  {
    // The designs a sheet can be printed in, for the download dialog. Nothing personal: no session needed.
    method: "GET",
    path: "/api/sheet-designs",
    handler: async () => {
      return json(200, {
        designs: SHEET_DESIGNS.map((d) => ({ id: d.id, name: d.name, description: d.description })),
        default: SHEET_DESIGNS[0]!.id,
      });
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id/sheet",
    handler: async (ctx) => {
      return json(200, (await originalSheet(ctx)).model);
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id/pdf",
    handler: async (ctx) => {
      const { parts, design, version, filled, timeZone } = printRequest(ctx.url);
      const printed = parts ?? DEFAULT_API_PARTS;
      const { model, row, file } = await printedSheet(ctx, version, printed, timeZone, (accountId) => {
        const limit = ctx.app.limiter.take(`pdf:account:${accountId}`, PDF_LIMIT);
        if (!limit.ok) {
          throw new HttpError(429, "tooManyRequests", {}, { "Retry-After": String(limit.retryAfter) });
        }
      });
      // The play state is one per character, for the original and every copy alike.
      const play: PlayState = filled ? ((await ctx.app.store.findCharacterState(row.id))?.state ?? {}) : {};
      const pdf = await renderPdf(model, { parts: printed, design, play });
      // Asked for parts, the file name says which: "Mira - Sheet.pdf". A copy says which copy,
      // so it is not taken for the original in a downloads folder: "Mira - Version October 7 09-40 - Sheet.pdf".
      const m = MESSAGES[model.language]!;
      const words: Record<PrintPart, string> = { sheet: m.sheet, cards: m.cards, texts: m.rulesTexts };
      const fileName = [
        model.name,
        ...(file ? [file] : []),
        ...(parts ? [parts.map((p) => words[p]).join(", ")] : []),
      ].join(" - ");
      return new Response(pdf.bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": fileNames(fileName),
          "Content-Length": String(pdf.bytes.byteLength),
          // Personal data: never cached, not in the browser and not in a proxy.
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  },
];
