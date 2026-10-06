/**
 * The character sheet: as data (the model screen and PDF share) and printed
 * as one PDF with the cards, in the account's language and units. Only
 * finished characters have a sheet: a draft with open choices would print
 * a sheet with holes the player cannot explain.
 */
import { evaluateDraft, type Evaluation } from "@builder/core";
import { renderPdf } from "@builder/print";
import { buildSheetModel, sheetLanguages, type SheetModel } from "@builder/sheet";
import { HttpError, json } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";
import { loadDraft, packageOf } from "./drafts.ts";

/** Making a PDF takes a moment of CPU; this is plenty for printing and stops a loop from hogging the server. */
const PDF_LIMIT = { max: 20, windowMs: 10 * 60_000 };

/** An ASCII file name from the character's name; the exact name goes into `filename*`. */
function fileNames(name: string): string {
  const ascii =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/[^A-Za-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "character";
  return `attachment; filename="${ascii}.pdf"; filename*=UTF-8''${encodeURIComponent(`${name}.pdf`)}`;
}

/**
 * The sheet of a finished character, in the language and units of whoever
 * asks: a game master sees a player's character in their own. `beforeBuild`
 * runs once the request is known to be good (the PDF's rate limit).
 */
async function sheetOf(ctx: RequestContext, beforeBuild?: (accountId: string) => void): Promise<SheetModel> {
  const { row, viewer: account } = await loadDraft(ctx);
  const pkg = packageOf(ctx.app, row);
  const ev: Evaluation = evaluateDraft(pkg, row.document);
  if (!row.finished_at || !ev.complete) throw new HttpError(409, "notFinished", { open: ev.open });

  const languages = sheetLanguages(pkg);
  if (!languages.includes(account.language)) {
    throw new HttpError(422, "languageNotSupported", { language: account.language, languages });
  }
  beforeBuild?.(account.id);
  return buildSheetModel(
    pkg,
    row.document,
    { language: account.language, units: account.units, createdAt: ctx.app.now() },
    ev,
  );
}

export const printRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drafts/:id/sheet",
    handler: async (ctx) => {
      return json(200, await sheetOf(ctx));
    },
  },
  {
    method: "GET",
    path: "/api/drafts/:id/pdf",
    handler: async (ctx) => {
      const model = await sheetOf(ctx, (accountId) => {
        const limit = ctx.app.limiter.take(`pdf:account:${accountId}`, PDF_LIMIT);
        if (!limit.ok) {
          throw new HttpError(429, "tooManyRequests", {}, { "Retry-After": String(limit.retryAfter) });
        }
      });
      const pdf = await renderPdf(model);
      return new Response(pdf.bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": fileNames(model.name),
          "Content-Length": String(pdf.bytes.byteLength),
          // Personal data: never cached, not in the browser and not in a proxy.
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  },
];
