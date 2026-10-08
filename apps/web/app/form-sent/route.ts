/**
 * Where the password forms really send to (AND-241): an answer without
 * content, so the page stays where it is. Browsers offer to save a
 * password when its form is sent the ordinary way, not when a script
 * fetches. The fields carry no `name`, so the request holds no data.
 */
export function GET(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
