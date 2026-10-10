/**
 * The admin's routes (AND-353): the accounts on this builder, found by a
 * part of their name or address, made admin or player, logged out
 * everywhere, deleted.
 *
 * Every route goes through `requireAdmin`: a browser session of an admin,
 * never an access key, so none of this is in the MCP server either. What
 * an admin sees of an account is what the list shows: no settings, no
 * characters, only how many. Nobody logs in as someone else.
 *
 * Each change goes into the server log with the account ids, never a name
 * or an address, and nowhere else: the builder keeps no log of its own.
 */
import { z } from "zod";
import type { AdminAccountRow } from "../../store.ts";
import { HttpError, json, readJson } from "../http.ts";
import type { Route } from "../router.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Accounts per page of the list. */
export const ADMIN_PAGE_SIZE = 50;

const listQuery = z.strictObject({
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

const publicAdminAccount = (a: AdminAccountRow, selfId: string) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  language: a.language,
  role: a.role,
  createdAt: a.created_at.toISOString(),
  drafts: a.drafts,
  campaigns: a.campaigns,
  /** The admin's own account: it cannot be deleted from here. */
  self: a.id === selfId,
});

/** The account id from the path; one that is no id is simply not found. */
function accountId(params: Record<string, string>): string {
  const id = params["id"]!;
  if (!UUID.test(id)) throw new HttpError(404, "accountNotFound");
  return id;
}

/** One line in the server log: who did what to which account, by id only. */
function logAction(adminId: string, action: string, accountId: string): void {
  console.log(`Admin ${adminId}: ${action} account ${accountId}.`);
}

export const adminRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/admin/accounts",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const parsed = listQuery.safeParse(Object.fromEntries(ctx.url.searchParams));
      if (!parsed.success) {
        throw new HttpError(400, "badRequest", {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        });
      }
      const { q, page } = parsed.data;
      const { accounts, total } = await ctx.app.store.listAccountsForAdmin(
        q ? q : null,
        ADMIN_PAGE_SIZE,
        (page - 1) * ADMIN_PAGE_SIZE,
      );
      return json(200, {
        accounts: accounts.map((a) => publicAdminAccount(a, account.id)),
        total,
        page,
        pageSize: ADMIN_PAGE_SIZE,
      });
    },
  },
  {
    // The last admin stays one: without an admin, nobody could make one again.
    method: "PATCH",
    path: "/api/admin/accounts/:id/role",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const id = accountId(ctx.params);
      const { role } = await readJson(ctx.req, z.strictObject({ role: z.enum(["player", "admin"]) }));
      const result = await ctx.app.store.setRole(id, role);
      if (result === "missing") throw new HttpError(404, "accountNotFound");
      if (result === "lastAdmin") throw new HttpError(409, "lastAdmin");
      logAction(account.id, `made ${role}`, id);
      return json(200, { role });
    },
  },
  {
    // For an account someone else got into: every session and every access key ends at once.
    method: "POST",
    path: "/api/admin/accounts/:id/logout-all",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const id = accountId(ctx.params);
      const ended = await ctx.app.store.endAllLogins(id);
      if (!ended) throw new HttpError(404, "accountNotFound");
      // Their live connections end with their logins.
      ctx.app.draftEvents.publish({ kind: "access" });
      logAction(account.id, "logged out everywhere", id);
      return json(200, ended);
    },
  },
  {
    // Deletes everything of the account, as "Delete my account" does. Not the admin's own, not the last admin.
    method: "DELETE",
    path: "/api/admin/accounts/:id",
    handler: async (ctx) => {
      const { account } = await ctx.requireAdmin();
      const id = accountId(ctx.params);
      if (id === account.id) throw new HttpError(409, "ownAccount");
      const result = await ctx.app.store.deleteAccountUnlessLastAdmin(id);
      if (!result.deleted) {
        throw result.reason === "missing"
          ? new HttpError(404, "accountNotFound")
          : new HttpError(409, "lastAdmin");
      }
      ctx.app.draftEvents.publish({ kind: "access" });
      if (result.email) ctx.app.limiter.reset(`login:account:${result.email}`);
      logAction(account.id, "deleted", id);
      return json(204, null);
    },
  },
];
