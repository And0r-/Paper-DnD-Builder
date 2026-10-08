/**
 * openapi.json, the description of every route (see API.md), for the API
 * reference at /api/docs and for any program that reads it. The file in the
 * repository stays the one source: it is bundled in at build time, not copied.
 */
import spec from "../../../openapi.json" with { type: "json" };

export function GET(): Response {
  return Response.json(spec);
}
