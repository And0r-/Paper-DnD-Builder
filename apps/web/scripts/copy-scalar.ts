/**
 * Copies the Scalar browser bundle (the API reference at /api/docs) to
 * public/scalar, so the page loads it from this server and never from a CDN.
 * Only the ESM build the page loads (standalone.esm.js and its chunks/):
 * source maps and the single-file standalone.js (4.4 MB) stay behind, they
 * only make the image bigger.
 */
import { cpSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

// The package does not export its browser folder; pnpm links it here (a devDependency of @builder/web).
const from = fileURLToPath(new URL("../node_modules/@scalar/api-reference/dist/browser", import.meta.url));
const to = fileURLToPath(new URL("../public/scalar", import.meta.url));

rmSync(to, { recursive: true, force: true });
const skip = (src: string) => src.endsWith(".map") || basename(src) === "standalone.js";
cpSync(from, to, { recursive: true, filter: (src) => !skip(src) });
console.log(`Scalar bundle copied to ${to}`);
