/**
 * Liveness probe for Docker. Answers "ok" while the process serves
 * requests, and lists the loaded content packages (see health.ts).
 */
import { getApp } from "../../../src/server/app.ts";
import { healthReport } from "../../../src/server/health.ts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // A failed start is reported in the body, never as an error: the probe stays up.
  const app = await getApp().catch(() => undefined);
  return Response.json(healthReport(app?.packages));
}
