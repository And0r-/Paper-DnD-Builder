/**
 * Every /api request (except /api/health) goes to the builder's own router,
 * which works on standard Request/Response. See src/server/api/router.ts.
 */
import { getApp } from "../../../src/server/app.ts";
import { createApiHandler } from "../../../src/server/api/router.ts";

export const dynamic = "force-dynamic";

let handler: Promise<(req: Request) => Promise<Response>> | undefined;

async function handle(req: Request): Promise<Response> {
  handler ??= getApp().then((app) => createApiHandler(app));
  return (await handler)(req);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
