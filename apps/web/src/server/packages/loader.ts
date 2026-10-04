/**
 * Package loader: reads every content package from PACKAGES_DIR at start.
 *
 * Each subfolder with a manifest.json is one package; PACKAGES_DIR may also
 * point straight at a single package. Every package is validated with the
 * format module. Invalid packages are rejected with the validator's report
 * and the builder starts without them; it never crashes over a package.
 * Swapping a package is: replace its files, restart. No rebuild.
 */
import { formatReport, validatePackageDir, type ContentPackage, type Issue } from "@builder/format";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface LoadedPackage {
  id: string;
  dir: string;
  pkg: ContentPackage;
  warnings: Issue[];
}

export interface RejectedPackage {
  dir: string;
  /** The validator's report or the reason, ready to print. */
  report: string;
}

export interface PackageRegistry {
  /** Valid packages by id. */
  packages: ReadonlyMap<string, LoadedPackage>;
  rejected: readonly RejectedPackage[];
  get(id: string): ContentPackage | undefined;
}

export interface LoaderLog {
  info(message: string): void;
  error(message: string): void;
}

const consoleLog: LoaderLog = {
  info: (m) => console.log(m),
  error: (m) => console.error(m),
};

async function isPackage(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, "manifest.json"))).isFile();
  } catch {
    return false;
  }
}

/** Folders to load: PACKAGES_DIR itself if it is a package, else its subfolders that are. */
async function packageDirs(root: string): Promise<string[]> {
  if (await isPackage(root)) return [root];
  const entries = await readdir(root, { withFileTypes: true });
  const dirs: string[] = [];
  for (const e of entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(root, e.name);
    if (await isPackage(dir)) dirs.push(dir);
  }
  return dirs;
}

export async function loadPackages(
  root: string | undefined,
  log: LoaderLog = consoleLog,
): Promise<PackageRegistry> {
  const packages = new Map<string, LoadedPackage>();
  const rejected: RejectedPackage[] = [];
  const registry: PackageRegistry = { packages, rejected, get: (id) => packages.get(id)?.pkg };

  if (!root) {
    log.error("Packages: PACKAGES_DIR is not set; no content package is loaded.");
    return registry;
  }
  let dirs: string[];
  try {
    dirs = await packageDirs(root);
  } catch (error) {
    log.error(`Packages: cannot read PACKAGES_DIR "${root}": ${(error as Error).message}`);
    return registry;
  }
  if (dirs.length === 0)
    log.error(`Packages: no package found in "${root}" (a package is a folder with manifest.json).`);

  for (const dir of dirs) {
    let report: string;
    try {
      const result = await validatePackageDir(dir);
      if (result.package) {
        const id = result.package.manifest.id;
        const existing = packages.get(id);
        if (existing) {
          report = `two packages have the id "${id}": ${existing.dir} and ${dir}; keeping the first`;
        } else {
          packages.set(id, { id, dir, pkg: result.package, warnings: result.warnings });
          log.info(
            `Packages: loaded ${formatReport(dir, result)
              .split("\n")
              .at(-1)!
              .replace(/^OK\s+/, "")}`,
          );
          continue;
        }
      } else {
        report = formatReport(dir, result);
      }
    } catch (error) {
      report = `cannot read package: ${(error as Error).message}`;
    }
    rejected.push({ dir, report });
    log.error(`Packages: REJECTED ${dir}\n${report}`);
  }
  log.info(`Packages: ${packages.size} loaded, ${rejected.length} rejected.`);
  return registry;
}
