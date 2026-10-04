import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Package files that live in the package root. Everything else in the root is ignored. */
export const ROOT_FILES = [
  "manifest.json",
  "units.json",
  "values.json",
  "flow.json",
  "sheet.json",
  "glossary.json",
];

/** Parsed JSON content by path relative to the package root (always with "/"). */
export type PackageFiles = Map<string, unknown>;

export interface ReadResult {
  files: PackageFiles;
  /** Files that exist but are not valid JSON: path → message. */
  unreadable: Map<string, string>;
}

/**
 * Reads the JSON files of a package directory. Does not validate anything
 * beyond JSON syntax; see validatePackageFiles.
 */
export async function readPackageDir(dir: string): Promise<ReadResult> {
  const files: PackageFiles = new Map();
  const unreadable = new Map<string, string>();
  const rel: string[] = [];

  const rootEntries = await readdir(dir, { withFileTypes: true });
  for (const e of rootEntries) {
    if (e.isFile() && ROOT_FILES.includes(e.name)) rel.push(e.name);
  }
  rel.push(...(await listJson(dir, "things")));
  const textDirs = await listDirs(dir, "texts");
  for (const lang of textDirs) rel.push(...(await listJson(dir, `texts/${lang}`)));

  for (const r of rel.sort()) {
    const raw = await readFile(path.join(dir, r), "utf8");
    try {
      files.set(r, JSON.parse(raw));
    } catch (e) {
      unreadable.set(r, `not valid JSON: ${(e as Error).message}`);
    }
  }
  // Remember empty language folders so the validator can name them.
  for (const lang of textDirs) {
    if (![...files.keys(), ...unreadable.keys()].some((k) => k.startsWith(`texts/${lang}/`))) {
      files.set(`texts/${lang}/`, undefined);
    }
  }
  return { files, unreadable };
}

async function listJson(root: string, sub: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(root, sub), { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => `${sub}/${e.name}`);
  } catch {
    return [];
  }
}

async function listDirs(root: string, sub: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(root, sub), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}
