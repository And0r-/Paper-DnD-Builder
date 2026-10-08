/**
 * The API reference: openapi.json (served at /api/openapi.json) as a page
 * to read every route and to try it with an access key.
 *
 * Nothing on this page leaves this server, the same promise as the app
 * (privacy.noThirdParty, enforced by the CSP in next.config.ts):
 * - the Scalar bundle is served from /scalar/ (copied there at build time by
 *   scripts/copy-scalar.ts), not from its CDN;
 * - no fonts from Scalar: the page uses the app's own font from /fonts/;
 * - no telemetry, and "Try it" sends straight to this server, never through
 *   Scalar's proxy, so a key typed in goes nowhere else;
 * - the AI chat, the MCP generator, the developer tools and the button to
 *   Scalar's online client are off: all four lead to Scalar's services.
 * The key typed into "Try it" is not stored in the browser (persistAuth off).
 */
import { ApiReference } from "@scalar/nextjs-api-reference";

const FONT = "Atkinson Hyperlegible Next";
/** The ranges of the two font files per weight, as in src/ui/styles/tokens.css. */
const RANGES = {
  latin:
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
};

const fontFaces = [400, 600, 700]
  .flatMap((weight) =>
    Object.entries(RANGES).map(
      ([subset, range]) =>
        `@font-face { font-family: "${FONT}"; font-style: normal; font-weight: ${weight}; font-display: swap; ` +
        `src: url("/fonts/atkinson-hyperlegible-next-${subset}-${weight}-normal.woff2") format("woff2"); unicode-range: ${range}; }`,
    ),
  )
  .join("\n");

/**
 * Zod inside the bundle probes for eval with `Function("")` once; the CSP
 * refuses it and the browser reports a violation, although Zod works on
 * without. Telling Zod up front not to try keeps the page free of violations.
 * A classic script runs before the bundle, which is a (deferred) module.
 */
const ZOD_JITLESS = `<script>globalThis.__zod_globalConfig = { jitless: true };</script>`;

const reference = ApiReference({
  url: "/api/openapi.json",
  pageTitle: "Character builder HTTP API",
  bundle: "/scalar/standalone.esm.js",
  withDefaultFonts: false,
  telemetry: false,
  proxyUrl: "",
  persistAuth: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: "never",
  // "Open API Client" opens client.scalar.com with this server's address; "Try it" works here.
  hideClientButton: true,
  customCss: `${fontFaces}\n:root { --scalar-font: "${FONT}", system-ui, sans-serif; --scalar-font-code: ui-monospace, monospace; }`,
});

export async function GET(): Promise<Response> {
  const page = reference();
  const html = (await page.text())
    .replace("<html>", '<html lang="en">')
    .replace("</head>", `${ZOD_JITLESS}\n</head>`);
  return new Response(html, { headers: page.headers });
}
