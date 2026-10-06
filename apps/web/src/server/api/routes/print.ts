/**
 * The character sheet: as data (the model screen and PDF share) and printed
 * as one PDF with the parts asked for (sheet, cards, rules texts), in the
 * account's language and units. Only finished characters have a sheet: a
 * draft with open choices would print a sheet with holes the player cannot
 * explain.
 */
import { evaluateDraft, type Evaluation } from "@builder/core";
import { renderPdf } from "@builder/print";
import {
  buildSheetModel,
  DEFAULT_API_PARTS,
  DESIGN_IDS,
  inFileOrder,
  MESSAGES,
  PRINT_PARTS,
  SHEET_DESIGNS,
  sheetLanguages,
  type PrintPart,
  type SheetModel,
} from "@builder/sheet";
import { HttpError, json } from "../http.ts";
import type { ReachableDraftRow } from "../../store.ts";
import type { RequestContext, Route } from "../router.ts";
import { loadDraft, packageOf } from "./drafts.ts";

/** Making a PDF takes a moment of CPU; this is plenty for printing and stops a loop from hogging the server. */
const PDF_LIMIT = { max: 20, windowMs: 10 * 60_000 };

/**
 * What a PDF request asks for, checked before anything is loaded. Without
 * `parts` the PDF is the sheet and the cards, as before there were parts.
 * Designs and states that are planned but not drawn yet say so (`400`
 * with their own code), so a caller can tell them from a typo.
 */
function printRequest(url: URL): { parts: PrintPart[] | undefined; version: string } {
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
  if (state === "filled") throw new HttpError(400, "stateNotAvailable", { state });
  if (state !== "empty") bad("state", state);
  return { parts, version: url.searchParams.get("version") ?? "original" };
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
  const pkg = packageOf(ctx.app, row);
  const ev: Evaluation = evaluateDraft(pkg, row.document);
  if (!row.finished_at || !ev.complete) throw new HttpError(409, "notFinished", { open: ev.open });

  const languages = sheetLanguages(pkg);
  if (!languages.includes(account.language)) {
    throw new HttpError(422, "languageNotSupported", { language: account.language, languages });
  }
  beforeBuild?.(account.id);
  const model = buildSheetModel(
    pkg,
    row.document,
    {
      language: account.language,
      units: account.units,
      createdAt: ctx.app.now(),
      changedAt: row.updated_at,
    },
    ev,
  );
  return { model, row };
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
      const { parts, version } = printRequest(ctx.url);
      const { model } = await originalSheet(ctx, (accountId) => {
        // Only the original exists until copies of a sheet can be kept.
        if (version !== "original") throw new HttpError(404, "versionNotFound", { version });
        const limit = ctx.app.limiter.take(`pdf:account:${accountId}`, PDF_LIMIT);
        if (!limit.ok) {
          throw new HttpError(429, "tooManyRequests", {}, { "Retry-After": String(limit.retryAfter) });
        }
      });
      const pdf = await renderPdf(model, { parts: parts ?? DEFAULT_API_PARTS });
      // Asked for parts, the file name says which: "Mira - Sheet.pdf".
      const m = MESSAGES[model.language]!;
      const words: Record<PrintPart, string> = { sheet: m.sheet, cards: m.cards, texts: m.rulesTexts };
      const fileName = parts ? `${model.name} - ${parts.map((p) => words[p]).join(", ")}` : model.name;
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
