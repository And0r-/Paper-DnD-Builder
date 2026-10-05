/**
 * The printed character: sheet and cards as one PDF, in the account's
 * language and units. Only finished characters are printed: a draft with
 * open choices would print a sheet with holes the player cannot explain.
 */
import { evaluateDraft } from "@builder/core";
import { buildPrintModel, printLanguages, renderPdf } from "@builder/print";
import { HttpError } from "../http.ts";
import type { Route } from "../router.ts";
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

export const printRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/drafts/:id/pdf",
    handler: async (ctx) => {
      // A game master prints a player's character in the game master's own language and units.
      const { row, viewer: account } = await loadDraft(ctx);
      const pkg = packageOf(ctx.app, row);
      const ev = evaluateDraft(pkg, row.document);
      if (!row.finished_at || !ev.complete) throw new HttpError(409, "notFinished", { open: ev.open });

      const languages = printLanguages(pkg);
      if (!languages.includes(account.language)) {
        throw new HttpError(422, "languageNotSupported", { language: account.language, languages });
      }
      const limit = ctx.app.limiter.take(`pdf:account:${account.id}`, PDF_LIMIT);
      if (!limit.ok) {
        throw new HttpError(429, "tooManyRequests", {}, { "Retry-After": String(limit.retryAfter) });
      }

      const model = buildPrintModel(
        pkg,
        row.document,
        { language: account.language, units: account.units, createdAt: ctx.app.now() },
        ev,
      );
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
