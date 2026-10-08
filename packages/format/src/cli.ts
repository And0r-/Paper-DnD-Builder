/**
 * Usage: pnpm validate-package <dir> [more dirs] [--strict]
 *
 * Exits 0 if the package is valid, 1 if not. With --strict, warnings
 * (for example texts marked as missing) also fail. An extension is
 * validated with its base: one of the other folders given, else the
 * folder next to it (or above it) whose package has the base's id.
 */
import path from "node:path";
import { extensionDependency, validateExtensionFiles } from "./extension.ts";
import { readPackageDir } from "./read.ts";
import { formatReport } from "./report.ts";
import { validatePackageDir, type ValidationResult } from "./validate.ts";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
// pnpm runs root scripts from the workspace root; INIT_CWD is where the user typed the command.
const dirs = args
  .filter((a) => !a.startsWith("--"))
  .map((d) => ({ shown: d, abs: path.resolve(process.env.INIT_CWD ?? process.cwd(), d) }));

if (dirs.length === 0) {
  console.error("Usage: pnpm validate-package <package-dir> [more dirs] [--strict]");
  process.exit(2);
}

const validated = new Map<string, Promise<ValidationResult>>();
const validate = (abs: string) => {
  let r = validated.get(abs);
  if (!r) validated.set(abs, (r = validatePackageDir(abs)));
  return r;
};

async function packageId(abs: string): Promise<string | undefined> {
  try {
    const m = (await readPackageDir(abs)).files.get("manifest.json") as { id?: unknown } | undefined;
    return typeof m?.id === "string" ? m.id : undefined;
  } catch {
    return undefined;
  }
}

async function findBase(extDir: string, baseId: string): Promise<string | undefined> {
  const candidates = [
    ...dirs.map((d) => d.abs).filter((d) => d !== extDir),
    path.join(extDir, "..", baseId),
    path.join(extDir, "..", ".."),
  ];
  for (const c of candidates) if ((await packageId(c)) === baseId) return c;
  return undefined;
}

let failed = false;
for (const { shown, abs } of dirs) {
  const { files } = await readPackageDir(abs);
  const dep = extensionDependency(files);
  let result: ValidationResult;
  if (!dep) {
    result = await validate(abs);
  } else {
    const baseDir = await findBase(abs, dep.base);
    const base = baseDir ? await validate(baseDir) : undefined;
    if (!base?.package || !base.files) {
      console.log(
        baseDir
          ? `FAILED  ${shown}: its base "${dep.base}" (${baseDir}) is not valid; validate it first`
          : `FAILED  ${shown}: its base "${dep.base}" was not found; name its folder too`,
      );
      failed = true;
      continue;
    }
    result = validateExtensionFiles(
      { files: base.files, package: base.package, warnings: base.warnings },
      files,
    );
  }
  console.log(formatReport(shown, result));
  if (!result.ok || (strict && result.warnings.length > 0)) failed = true;
}
// Not process.exit(): it ends the process before a pipe has taken all of stdout, and long reports lost their end.
process.exitCode = failed ? 1 : 0;
