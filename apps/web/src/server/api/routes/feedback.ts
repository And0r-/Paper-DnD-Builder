/**
 * Feedback (AND-354): a logged-in player tells the operator what is wrong,
 * what is missing, or how the builder feels, from the menu; the admin reads
 * it, marks it done, or deletes it.
 *
 * Sending takes a browser session: an access key is made for a program, and
 * feedback is a person's, so no MCP tool sends any. With the text come only
 * the page's path (the browser sends no query or hash, so no token) and the
 * account's language; no user agent, nothing else.
 *
 * Reading and looking after it goes through `requireAdmin`, like the other
 * admin routes; each change goes into the server log with ids only.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { limited } from "../../auth/accounts.ts";
import { LIMITS } from "../../auth/rate-limit.ts";
import type { FeedbackRow } from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Feedback per page of the admin's list. */
export const FEEDBACK_PAGE_SIZE = 50;

/** The longest text; a few paragraphs. */
export const FEEDBACK_MAX_LENGTH = 2000;

const KIND = z.enum(["wrong", "idea", "other"]);
const STATUS = z.enum(["open", "done"]);

const sent = z.strictObject({
  kind: KIND,
  rating: z.number().int().min(1).max(5).nullish(),
  text: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH),
  // A path on this site, never a whole address.
  page: z.string().max(300).startsWith("/").nullish(),
});

const listQuery = z.strictObject({
  status: STATUS.optional(),
  kind: KIND.optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

const publicFeedback = (f: FeedbackRow) => ({
  id: f.id,
  createdAt: f.created_at.toISOString(),
  account: f.account_id === null ? null : { id: f.account_id, name: f.account_name },
  kind: f.kind,
  rating: f.rating,
  text: f.text,
  page: f.page,
  language: f.language,
  status: f.status,
});

/** The feedback id from the path; one that is no id is simply not found. */
function feedbackId(params: Record<string, string>): string {
  const id = params["id"]!;
  if (!UUID.test(id)) throw new HttpError(404, "feedbackNotFound");
  return id;
}

/** One line in the server log: who did what to which feedback, by id only. */
function logAction(adminId: string, action: string, id: string): void {
  console.log(`Admin ${adminId}: ${action} feedback ${id}.`);
}

export const feedbackRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/feedback",
    handler: async (ctx) => {
      const { via, account } = await ctx.requireSession();
      if (via !== "cookie") throw new HttpError(403, "keyCannotFeedback");
      const body = await readJson(ctx.req, sent);
      limited(ctx.app, `feedback:account:${account.id}`, LIMITS.feedbackPerAccount, true);
      const id = randomUUID();
      const now = ctx.app.now();
      await ctx.app.store.addFeedback({
        id,
        account_id: account.id,
        kind: body.kind,
        rating: body.rating ?? null,
        text: body.text,
        page: body.page ?? null,
        language: account.language,
        created_at: now,
      });
      return json(201, { id, createdAt: now.toISOString() });
    },
  },
  {
    method: "GET",
    path: "/api/admin/feedback",
    handler: async (ctx) => {
      await ctx.requireAdmin();
      const parsed = listQuery.safeParse(Object.fromEntries(ctx.url.searchParams));
      if (!parsed.success) {
        throw new HttpError(400, "badRequest", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const { status, kind, page } = parsed.data;
      const { feedback, total } = await ctx.app.store.listFeedbackForAdmin(
        status ?? null,
        kind ?? null,
        FEEDBACK_PAGE_SIZE,
        (page - 1) * FEEDBACK_PAGE_SIZE,
      );
      return json(200, {
        feedback: feedback.map(publicFeedback),
        total,
        page,
        pageSize: FEEDBACK_PAGE_SIZE,
      });
    },
  },
  {
    method: "PATCH",
    path: "/api/admin/feedback/:id/status",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const id = feedbackId(ctx.params);
      const { status } = await readJson(ctx.req, z.strictObject({ status: STATUS }));
      if ((await ctx.app.store.setFeedbackStatus(id, status)) === "missing") {
        throw new HttpError(404, "feedbackNotFound");
      }
      logAction(account.id, `marked ${status}`, id);
      return json(200, { status });
    },
  },
  {
    method: "DELETE",
    path: "/api/admin/feedback/:id",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const id = feedbackId(ctx.params);
      if (!(await ctx.app.store.deleteFeedback(id))) throw new HttpError(404, "feedbackNotFound");
      logAction(account.id, "deleted", id);
      return json(204, null);
    },
  },
];
