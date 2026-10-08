/**
 * Package loader: reads every content package from PACKAGES_DIR at start.
 *
 * Each subfolder with a manifest.json is one package; PACKAGES_DIR may also
 * point straight at a single package. A package folder may carry its own
 * extensions in a subfolder `extensions/` (the demo package does). Every
 * package is validated with the format module. Invalid packages are
 * rejected with the validator's report and the builder starts without
 * them; it never crashes over a package. Swapping a package is: replace
 * its files, restart. No rebuild.
 *
 * Extensions (SPEC 17) are loaded after the bases: each is put together
 * with its base and validated as one package. One that does not fit is
 * rejected; its base and the other extensions run on. A character uses its
 * base with the extensions switched on for it: `get("base+ext")` gives
 * that package, put together on first use and kept.
 */
import {
  extensionDependency,
  formatReport,
  readPackageDir,
  validateExtensionFiles,
  validatePackageFiles,
  type ContentPackage,
  type Dependency,
  type ExtensionBase,
  type ExtensionInfo,
  type Issue,
  type PackageFiles,
} from "@builder/format";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export interface LoadedPackage {
  id: string;
  dir: string;
  pkg: ContentPackage;
  warnings: Issue[];
  files: PackageFiles;
}

export interface LoadedExtension {
  id: string;
  dir: string;
  /** Id of the base package. */
  base: string;
  info: ExtensionInfo;
  /** As in its manifest: the base and the lowest version of it the extension takes. */
  dependsOn: Dependency[];
  files: PackageFiles;
}

export interface RejectedPackage {
  dir: string;
  /** The validator's report or the reason, ready to print. */
  report: string;
}

export interface PackageRegistry {
  /** Valid base packages by id. */
  packages: ReadonlyMap<string, LoadedPackage>;
  /** Valid extensions by id; each fits its base and the other extensions of that base. */
  extensions: ReadonlyMap<string, LoadedExtension>;
  rejected: readonly RejectedPackage[];
  /** A base package (`"demo"`) or a base with extensions (`"demo+demo-tides"`, see `packageKey`). */
  get(key: string): ContentPackage | undefined;
}

/** The key of a base with extensions: `base+ext1+ext2`, extensions sorted. Ids never contain "+". */
export function packageKey(base: string, extensions: readonly string[] = []): string {
  return [base, ...[...new Set(extensions)].sort()].join("+");
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

async function packageSubdirs(root: string): Promise<string[]> {
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

/** Folders to load: PACKAGES_DIR itself if it is a package, else its subfolders that are; each with its `extensions/`. */
async function packageDirs(root: string): Promise<string[]> {
  const dirs = (await isPackage(root)) ? [root] : await packageSubdirs(root);
  const withExtensions: string[] = [];
  for (const dir of dirs) {
    withExtensions.push(dir);
    try {
      withExtensions.push(...(await packageSubdirs(path.join(dir, "extensions"))));
    } catch {
      // no extensions folder
    }
  }
  return withExtensions;
}

const lastLine = (report: string) =>
  report
    .split("\n")
    .at(-1)!
    .replace(/^OK\s+/, "");

export async function loadPackages(
  root: string | undefined,
  log: LoaderLog = consoleLog,
): Promise<PackageRegistry> {
  const packages = new Map<string, LoadedPackage>();
  const extensions = new Map<string, LoadedExtension>();
  const rejected: RejectedPackage[] = [];
  // Packages put together, by key; null for a combination that does not fit.
  const combined = new Map<string, (ExtensionBase & { package: ContentPackage }) | null>();

  /** The base with these extensions (in this order), put together and validated once. */
  const combine = (
    base: string,
    exts: readonly string[],
  ): (ExtensionBase & { package: ContentPackage }) | null => {
    const key = [base, ...exts].join("+");
    const known = combined.get(key);
    if (known !== undefined) return known;
    let made: (ExtensionBase & { package: ContentPackage }) | null = null;
    if (exts.length === 0) {
      const b = packages.get(base);
      if (b) made = { files: b.files, package: b.pkg, warnings: b.warnings };
    } else {
      const below = combine(base, exts.slice(0, -1));
      const ext = extensions.get(exts.at(-1)!);
      if (below && ext && ext.base === base) {
        const r = validateExtensionFiles(below, ext.files);
        if (r.package && r.files) made = { files: r.files, package: r.package, warnings: r.warnings };
        else
          log.error(
            `Packages: extensions ${exts.join(", ")} of "${base}" do not fit together:\n${formatReport(key, r)}`,
          );
      }
    }
    combined.set(key, made);
    return made;
  };

  const registry: PackageRegistry = {
    packages,
    extensions,
    rejected,
    get: (key) => {
      const [base, ...exts] = key.split("+");
      if (exts.length === 0) return packages.get(base!)?.pkg;
      if (exts.some((e) => !extensions.has(e))) return undefined;
      return combine(base!, [...new Set(exts)].sort())?.package;
    },
  };

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

  const reject = (dir: string, report: string) => {
    rejected.push({ dir, report });
    log.error(`Packages: REJECTED ${dir}\n${report}`);
  };

  // Bases first, then the extensions: each needs its base.
  const read: { dir: string; files: PackageFiles; unreadable: Map<string, string> }[] = [];
  for (const dir of dirs) {
    try {
      read.push({ dir, ...(await readPackageDir(dir)) });
    } catch (error) {
      reject(dir, `cannot read package: ${(error as Error).message}`);
    }
  }
  const unreadable = (r: (typeof read)[number]) =>
    [...r.unreadable].map(([file, message]) => `error    ${file}: ${message}`).join("\n");

  for (const r of read.filter((r) => !extensionDependency(r.files))) {
    if (r.unreadable.size > 0) {
      reject(r.dir, `${unreadable(r)}\nFAILED  ${r.dir}`);
      continue;
    }
    const result = validatePackageFiles(r.files);
    if (!result.package) {
      reject(r.dir, formatReport(r.dir, result));
      continue;
    }
    const id = result.package.manifest.id;
    const existing = packages.get(id);
    if (existing) {
      reject(r.dir, `two packages have the id "${id}": ${existing.dir} and ${r.dir}; keeping the first`);
      continue;
    }
    packages.set(id, { id, dir: r.dir, pkg: result.package, warnings: result.warnings, files: r.files });
    log.info(`Packages: loaded ${lastLine(formatReport(r.dir, result))}`);
  }

  for (const r of read) {
    const dep = extensionDependency(r.files);
    if (!dep) continue;
    if (r.unreadable.size > 0) {
      reject(r.dir, `${unreadable(r)}\nFAILED  ${r.dir}`);
      continue;
    }
    const base = packages.get(dep.base);
    if (!base) {
      reject(r.dir, `extension "${dep.id}" needs the package "${dep.base}", which is not loaded`);
      continue;
    }
    if (packages.has(dep.id) || extensions.has(dep.id)) {
      reject(r.dir, `two packages have the id "${dep.id}"; keeping the first`);
      continue;
    }
    const result = validateExtensionFiles(
      { files: base.files, package: base.pkg, warnings: base.warnings },
      r.files,
    );
    if (!result.extension || !result.files) {
      reject(r.dir, formatReport(r.dir, result));
      continue;
    }
    // It must also fit the extensions of the same base loaded before it.
    const siblings = [...extensions.values()].filter((e) => e.base === dep.base).map((e) => e.id);
    const dependsOn = (r.files.get("manifest.json") as { dependsOn: Dependency[] }).dependsOn;
    extensions.set(dep.id, {
      id: dep.id,
      dir: r.dir,
      base: dep.base,
      info: result.extension,
      dependsOn,
      files: r.files,
    });
    combined.set(packageKey(dep.base, [dep.id]), {
      files: result.files,
      package: result.package!,
      warnings: result.warnings,
    });
    if (siblings.length > 0 && !combine(dep.base, [...siblings, dep.id])) {
      extensions.delete(dep.id);
      combined.delete(packageKey(dep.base, [dep.id]));
      reject(
        r.dir,
        `extension "${dep.id}" does not fit together with ${siblings.join(", ")}; see the line above`,
      );
      continue;
    }
    log.info(`Packages: loaded ${lastLine(formatReport(r.dir, result))}`);
  }
  const withExtensions = extensions.size > 0 ? ` (and ${extensions.size} extension(s))` : "";
  log.info(`Packages: ${packages.size} loaded${withExtensions}, ${rejected.length} rejected.`);
  return registry;
}
