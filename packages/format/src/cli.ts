/**
 * Usage: pnpm validate-package <dir> [--strict]
 *
 * Exits 0 if the package is valid, 1 if not. With --strict, warnings
 * (for example texts marked as missing) also fail.
 */
import path from "node:path";
import { formatReport } from "./report.ts";
import { validatePackageDir } from "./validate.ts";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dirs = args.filter((a) => !a.startsWith("--"));

if (dirs.length === 0) {
  console.error("Usage: pnpm validate-package <package-dir> [more dirs] [--strict]");
  process.exit(2);
}

let failed = false;
for (const dir of dirs) {
  // pnpm runs root scripts from the workspace root; INIT_CWD is where the user typed the command.
  const abs = path.resolve(process.env.INIT_CWD ?? process.cwd(), dir);
  const result = await validatePackageDir(abs);
  console.log(formatReport(dir, result));
  if (!result.ok || (strict && result.warnings.length > 0)) failed = true;
}
// Not process.exit(): it ends the process before a pipe has taken all of stdout, and long reports lost their end.
process.exitCode = failed ? 1 : 0;
