/**
 * Bundles the stdio server into one file, dist/server.mjs, that runs with
 * `node` alone (Node 20 or newer): no node_modules next to it.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ["src/stdio.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  legalComments: "eof",
  // Some dependencies are CommonJS and call require() for Node's own modules.
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});
