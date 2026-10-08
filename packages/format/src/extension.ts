/**
 * Extensions (SPEC 17): a package that adds to a base package.
 *
 * An extension is checked in two stages. First its own files: their shape,
 * its base, and that every key it declares is new. Then base and extension
 * are put together into the files of one package, and that package goes
 * through the full validator. Its issues are reported against the
 * extension's own files where they are about them.
 *
 * Putting together works on files, so a package with one extension can be
 * the base for the next: that is how a character with several extensions
 * gets one package.
 */
import type { ZodType } from "zod";
import type { PackageFiles } from "./read.ts";
import {
  extensionFlowSchema,
  extensionManifestSchema,
  extensionSheetSchema,
  glossarySchema,
  textsFileSchema,
  thingsFileSchema,
  valuesSchema,
  type Flow,
  type GlossaryEntry,
  type Manifest,
  type Sheet,
  type TextsFile,
  type Thing,
  type Value,
} from "./schema.ts";
import {
  validatePackageFiles,
  type ContentPackage,
  type ExtensionInfo,
  type Issue,
  type ValidationResult,
} from "./validate.ts";
import { formatVersionMismatch } from "./version.ts";

/** A valid package to put an extension on: a base, or a base already put together with extensions. */
export interface ExtensionBase {
  files: PackageFiles;
  package: ContentPackage;
  /** Its own warnings; they are not repeated for the extension. */
  warnings: readonly Issue[];
}

export interface ExtensionResult extends ValidationResult {
  /** Present when there are no errors: what the package keeps about this extension. */
  extension?: ExtensionInfo;
}

/** Texts an extension declares for itself, not merged into the package (SPEC 17.5). */
const OWN_TEXTS = ["package.name", "package.short"];

const lit = (s: string) => JSON.stringify(s);

/** Reads the extension's manifest for its id and base, without validating anything else. */
export function extensionDependency(files: PackageFiles): { id: string; base: string } | undefined {
  const m = files.get("manifest.json") as { id?: unknown; dependsOn?: { id?: unknown }[] } | undefined;
  const base = m?.dependsOn?.[0]?.id;
  return typeof m?.id === "string" && typeof base === "string" ? { id: m.id, base } : undefined;
}

/** True if version `have` satisfies "same major, at least `min`" (semantic versioning, no ranges). */
export function versionAccepts(have: string, min: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0]!.split(".").map(Number);
  const [h, m] = [parse(have), parse(min)];
  if (h[0] !== m[0]) return false;
  for (let i = 1; i < 3; i++) if (h[i] !== m[i]) return h[i]! > m[i]!;
  return true;
}

/**
 * Validates an extension against its base and puts the two together. The
 * result's `package` (and `files`) is the base with the extension, ready
 * for the rule core; `extension` is what it keeps about the extension.
 */
export function validateExtensionFiles(base: ExtensionBase, ext: PackageFiles): ExtensionResult {
  const issues: Issue[] = [];
  const err = (file: string, path: string, message: string) =>
    issues.push({ level: "error", file, path, message });
  const finish = (): ExtensionResult => ({
    ok: false,
    errors: issues.filter((i) => i.level === "error"),
    warnings: issues.filter((i) => i.level === "warning"),
  });

  // ------------------------------------------------------- 1. own files
  function parse<T>(file: string, schema: ZodType<T>): T | undefined {
    if (!ext.has(file)) return undefined;
    const r = schema.safeParse(ext.get(file));
    if (!r.success) for (const i of r.error.issues) err(file, i.path.join("."), i.message);
    return r.success ? r.data : undefined;
  }
  if (!ext.has("manifest.json")) err("manifest.json", "", "file is missing");
  const manifest = parse("manifest.json", extensionManifestSchema);
  const values = parse("values.json", valuesSchema) ?? [];
  const flow = parse("flow.json", extensionFlowSchema);
  const sheet = parse("sheet.json", extensionSheetSchema);
  const glossary = parse("glossary.json", glossarySchema) ?? [];
  if (ext.has("units.json"))
    err("units.json", "", "an extension uses the units of its base; remove this file");
  const thingFiles = [...ext.keys()].filter((f) => f.startsWith("things/")).sort();
  const things = new Map<string, Thing[]>();
  for (const f of thingFiles) {
    const list = parse(f, thingsFileSchema);
    if (list) things.set(f, list);
  }
  const texts = new Map<string, { lang: string; name: string; data: TextsFile }>();
  for (const f of [...ext.keys()].filter((k) => k.startsWith("texts/")).sort()) {
    const m = /^texts\/([^/]+)\/(.+)$/.exec(f);
    if (!m) continue; // an empty language folder; the language check below names it
    const data = parse(f, textsFileSchema);
    if (data) texts.set(f, { lang: m[1]!, name: m[2]!, data });
  }
  if (!manifest || issues.length > 0) return finish();

  // ------------------------------------------------------ 2. the base
  const bm = base.package.manifest;
  const dep = manifest.dependsOn[0]!;
  const M = "manifest.json";
  if (dep.id !== bm.id) {
    err(M, "dependsOn[0].id", `this extension builds on ${lit(dep.id)}, not on ${lit(bm.id)}`);
    return finish();
  }
  if (bm.dependsOn) err(M, "dependsOn[0].id", `${lit(dep.id)} is itself an extension`);
  if (dep.minVersion && !versionAccepts(bm.version, dep.minVersion)) {
    err(
      M,
      "dependsOn[0].minVersion",
      `needs ${lit(dep.id)} ${dep.minVersion} or a later version with the same major version; found ${bm.version}`,
    );
  }
  const mismatch = formatVersionMismatch(manifest.formatVersion);
  if (mismatch) err(M, "formatVersion", mismatch);
  for (const l of manifest.languages) {
    if (!bm.languages.includes(l))
      err(M, "languages", `${lit(dep.id)} has no language ${lit(l)} (it has ${bm.languages.join(", ")})`);
  }
  const textLangs = new Set(
    [...ext.keys()].filter((k) => k.startsWith("texts/")).map((k) => k.split("/")[1]!),
  );
  for (const l of manifest.languages) {
    if (!textLangs.has(l))
      err(`texts/${l}/`, "", `language ${lit(l)} is in manifest.languages but has no texts`);
  }
  for (const l of textLangs) {
    if (!manifest.languages.includes(l))
      err(`texts/${l}/`, "", `language ${lit(l)} is not in manifest.languages`);
  }

  // ------------------------------------------ 3. adds, never overwrites
  const taken = (file: string, path: string, what: string, key: string) =>
    err(file, path, `${what} ${lit(key)} is already in ${lit(dep.id)}; an extension may only add new keys`);
  manifest.kinds.forEach((k, i) => bm.kinds.includes(k) && taken(M, `kinds[${i}]`, "kind", k));
  const sameEntry = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const [k, v] of Object.entries(manifest.sources)) {
    if (k in bm.sources && !sameEntry(bm.sources[k], v))
      err(M, `sources.${k}`, `source ${lit(k)} is declared differently in ${lit(dep.id)}; use another key`);
  }
  for (const [k, v] of Object.entries(manifest.licenses)) {
    if (k in bm.licenses && !sameEntry(bm.licenses[k], v))
      err(M, `licenses.${k}`, `license ${lit(k)} is declared differently in ${lit(dep.id)}; use another key`);
  }
  const baseValues = new Set(base.package.values.map((v) => v.id));
  values.forEach((v, i) => baseValues.has(v.id) && taken("values.json", `[${i}].id`, "value", v.id));
  const baseThings = new Set(base.package.things.map((t) => t.id));
  for (const [f, list] of things)
    list.forEach((t, i) => baseThings.has(t.id) && taken(f, `[${i}].id`, "thing", t.id));
  const baseChoices = new Set(base.package.flow.choices.map((c) => c.id));
  flow?.choices.forEach(
    (c, i) => baseChoices.has(c.id) && taken("flow.json", `choices[${i}].id`, "choice", c.id),
  );
  const baseGlossary = new Set(base.package.glossary.map((g) => g.id));
  glossary.forEach(
    (g, i) => baseGlossary.has(g.id) && taken("glossary.json", `[${i}].id`, "glossary entry", g.id),
  );
  const baseSections = new Set(base.package.sheet.sections.map((s) => s.id));
  sheet?.sections?.forEach(
    (s, i) => baseSections.has(s.id) && taken("sheet.json", `sections[${i}].id`, "sheet section", s.id),
  );
  for (const k of Object.keys(sheet?.cards ?? {}))
    if (k in base.package.sheet.cards) taken("sheet.json", `cards.${k}`, "card layout for kind", k);
  const baseTextKeys = new Set(Object.values(base.package.texts).flatMap((t) => Object.keys(t)));
  for (const [f, { data }] of texts) {
    for (const key of Object.keys(data.entries)) {
      if (OWN_TEXTS.includes(key)) continue;
      if (baseTextKeys.has(key)) taken(f, `entries.${key}`, "text", key);
    }
  }
  const fallback = manifest.languages[0]!;
  const own = (lang: string, key: string) => {
    for (const { lang: l, data } of texts.values()) {
      const t = l === lang ? data.entries[key] : undefined;
      if (typeof t === "string") return t;
    }
    return undefined;
  };
  for (const key of OWN_TEXTS) {
    if (own(fallback, key) === undefined)
      err(`texts/${fallback}/`, `entries.${key}`, "missing text (the extension's own name and description)");
  }
  if (issues.length > 0) return finish();

  // ------------------------------------------------ 4. put together
  // Under a folder of its own that sorts after the base's files, so its things come after the base's.
  const tag = `~${manifest.id}`;
  const inTag = new RegExp(`^texts/([^/]+)/${tag}/(?:@([^/]+)/)?(.+)$`);
  const files: PackageFiles = new Map(base.files);
  const merged: Manifest = {
    ...(base.files.get("manifest.json") as Manifest),
    kinds: [...bm.kinds, ...manifest.kinds],
    sources: { ...bm.sources, ...manifest.sources },
    licenses: { ...bm.licenses, ...manifest.licenses },
  };
  files.set("manifest.json", merged);
  const baseValuesFile = (base.files.get("values.json") as Value[]) ?? [];
  files.set("values.json", [...baseValuesFile, ...values]);
  const baseFlow = base.files.get("flow.json") as Flow;
  files.set("flow.json", { ...baseFlow, choices: [...baseFlow.choices, ...(flow?.choices ?? [])] });
  const baseSheet = base.files.get("sheet.json") as Sheet;
  files.set("sheet.json", {
    ...baseSheet,
    sections: [...baseSheet.sections, ...(sheet?.sections ?? [])],
    cards: { ...baseSheet.cards, ...sheet?.cards },
  });
  const baseGlossaryFile = (base.files.get("glossary.json") as GlossaryEntry[] | undefined) ?? [];
  if (baseGlossaryFile.length + glossary.length > 0)
    files.set("glossary.json", [...baseGlossaryFile, ...glossary]);
  for (const [f, list] of things) files.set(f.replace(/^things\//, `things/${tag}/`), list);

  // Texts: the extension's own per language; what a language lacks comes from the fallback language.
  const fallbackKeys = new Map<string, Set<string>>(); // lang → keys taken from the fallback language
  const stripOwn = (data: TextsFile): TextsFile => ({
    ...data,
    entries: Object.fromEntries(Object.entries(data.entries).filter(([k]) => !OWN_TEXTS.includes(k))),
  });
  for (const lang of bm.languages) {
    const has = new Set<string>();
    for (const { lang: l, name, data } of texts.values()) {
      if (l !== lang) continue;
      files.set(`texts/${lang}/${tag}/${name}`, stripOwn(data));
      for (const k of Object.keys(data.entries)) has.add(k);
    }
    if (lang === fallback) continue;
    const filled = new Set<string>();
    for (const { lang: l, name, data } of texts.values()) {
      if (l !== fallback) continue;
      const missing = Object.entries(stripOwn(data).entries).filter(([k]) => !has.has(k));
      if (missing.length === 0) continue;
      files.set(`texts/${lang}/${tag}/@${fallback}/${name}`, {
        ...data,
        entries: Object.fromEntries(missing),
      });
      for (const [k] of missing) filled.add(k);
    }
    if (filled.size > 0) fallbackKeys.set(lang, filled);
  }

  // ------------------------------------------- 5. the whole, as one package
  const result = validatePackageFiles(files);
  const counts = {
    values: baseValuesFile.length,
    choices: baseFlow.choices.length,
    sections: baseSheet.sections.length,
    glossary: baseGlossaryFile.length,
  };
  const place = (i: Issue): Issue => {
    // An entry the extension added to a list: its index in the extension's own file.
    const at = (file: string, n: number, prefix: string): Issue | undefined => {
      const m = new RegExp(`^${prefix}\\[(\\d+)\\](.*)$`).exec(i.path);
      if (i.file !== file || !m || Number(m[1]) < n) return undefined;
      return { ...i, path: `${prefix}[${Number(m[1]) - n}]${m[2]}` };
    };
    const texted = inTag.exec(i.file);
    if (texted) return { ...i, file: `texts/${texted[2] ?? texted[1]}/${texted[3]}` };
    if (i.file.startsWith(`things/${tag}/`))
      return { ...i, file: i.file.replace(`things/${tag}/`, "things/") };
    const own =
      at("values.json", counts.values, "") ??
      at("flow.json", counts.choices, "choices") ??
      at("sheet.json", counts.sections, "sections") ??
      at("glossary.json", counts.glossary, "");
    if (own) return own;
    const card = /^cards\.([^.[]+)/.exec(i.path);
    if (i.file === "sheet.json" && card && sheet?.cards && card[1]! in sheet.cards) return i;
    if (i.file === "manifest.json") return i;
    return { ...i, file: `${dep.id}/${i.file}` };
  };
  const baseWarnings = new Set(base.warnings.map((w) => `${w.file}\n${w.path}\n${w.message}`));
  const placed = [...result.errors, ...result.warnings].map(place);
  issues.push(
    ...placed.filter(
      (i) =>
        i.level === "error" ||
        !baseWarnings.has(`${i.file.replace(`${dep.id}/`, "")}\n${i.path}\n${i.message}`),
    ),
  );
  for (const [lang, keys] of fallbackKeys) {
    issues.push({
      level: "warning",
      file: `texts/${lang}/`,
      path: "",
      message: `${keys.size} text(s) of the extension are missing in ${lang} and are shown in ${fallback}`,
    });
  }
  if (!result.package || issues.some((i) => i.level === "error")) return finish();

  // ------------------------------------------------------- 6. the result
  const pkg = result.package;
  for (const [lang, keys] of fallbackKeys) {
    for (const key of keys) {
      const o = pkg.textOrigins[lang]?.[key];
      if (o) pkg.textOrigins[lang]![key] = { ...o, fallbackFrom: fallback };
    }
  }
  for (const origins of Object.values(pkg.textOrigins)) {
    for (const [key, o] of Object.entries(origins)) {
      const m = inTag.exec(o.file);
      if (m) origins[key] = { ...o, file: `${manifest.id}/texts/${m[2] ?? m[1]}/${m[3]}` };
    }
  }
  const textOf = (lang: string, key: string) => own(lang, key) ?? own(fallback, key) ?? null;
  const extension: ExtensionInfo = {
    id: manifest.id,
    version: manifest.version,
    languages: manifest.languages,
    publishable: Object.values(manifest.licenses).every((l) => l.publishable),
    name: Object.fromEntries(bm.languages.map((l) => [l, textOf(l, "package.name")])),
    short: Object.fromEntries(bm.languages.map((l) => [l, textOf(l, "package.short")])),
    things: [...things.values()].flat().map((t) => t.id),
    choices: (flow?.choices ?? []).map((c) => c.id),
  };
  pkg.extensions = [...(base.package.extensions ?? []), extension];
  return {
    ok: true,
    errors: [],
    warnings: issues.filter((i) => i.level === "warning"),
    package: pkg,
    files,
    extension,
  };
}
