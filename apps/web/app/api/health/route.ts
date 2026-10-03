/** Liveness probe for Docker. Reports only that the process serves requests. */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" });
}
