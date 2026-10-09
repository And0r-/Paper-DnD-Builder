/**
 * Package validation: per-file structure (Zod) plus cross-file rules.
 *
 * Every problem becomes an Issue with the file, a path inside the file and
 * a sentence a package author can act on. Errors make a package unusable;
 * warnings point at likely mistakes or content marked as missing.
 */
import type { ZodType } from "zod";
import { collectRefs, parseExpr, BUILTIN_REFS, ExprSyntaxError } from "./expr.ts";
import { readPackageDir, type PackageFiles } from "./read.ts";
import {
  flowSchema,
  glossarySchema,
  manifestSchema,
  sheetSchema,
  textsFileSchema,
  thingsFileSchema,
  unitsSchema,
  valuesSchema,
  type CardOrigin,
  type FilledText,
  type Flow,
  type GatherStep,
  type GlossaryEntry,
  type Manifest,
  type Mark,
  type OptionSource,
  type Sheet,
  type TextValue,
  type Thing,
  type Units,
  type Value,
} from "./schema.ts";
import { parseTemplate, sentences, TemplateSyntaxError, visibleText } from "./template.ts";
import { formatVersionMismatch } from "./version.ts";

export interface Issue {
  level: "error" | "warning";
  /** Path relative to the package root, e.g. "things/knacks.json". */
  file: string;
  /** Location inside the file, e.g. "[3].grants[0].choice"; empty for the whole file. */
  path: string;
  message: string;
}

/** Where a text came from: its file and the provenance declared there. */
export interface TextOrigin {
  file: string;
  source: string;
  license: string;
  /**
   * Set when an extension's text is missing in this language and was taken
   * from the extension's fallback language (SPEC 17.5): that language.
   */
  fallbackFrom?: string;
}

/** A fully validated package, ready for the loader. */
export interface ContentPackage {
  manifest: Manifest;
  units: Units;
  values: Value[];
  things: Thing[];
  flow: Flow;
  sheet: Sheet;
  glossary: GlossaryEntry[];
  /** Texts by language, then key. `null` marks a text as known missing. */
  texts: Record<string, Record<string, TextValue>>;
  textOrigins: Record<string, Record<string, TextOrigin>>;
  /** The extensions put together into this package, in order (SPEC 17); absent for a base alone. */
  extensions?: ExtensionInfo[];
}

/** What a package put together with extensions keeps about each of them. */
export interface ExtensionInfo {
  id: string;
  version: string;
  /** The extension's own languages; the first is its fallback language. */
  languages: string[];
  /** False if any license of the extension is not publishable (SPEC 4, 17.7). */
  publishable: boolean;
  /** The extension's `package.name` and `package.short` per language of the base (fallback applied). */
  name: Record<string, string | null>;
  short: Record<string, string | null>;
  /** Keys the extension declares; a character "has something from it" through them. */
  things: string[];
  choices: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
  /** Present when there are no errors. */
  package?: ContentPackage;
  /** The files the result was made from (for putting extensions together with this package). */
  files?: PackageFiles;
}

/** Text key prefixes reserved for package-level texts; thing ids may not start with them. */
export const RESERVED_PREFIXES = [
  "package",
  "level",
  "kind",
  "choice",
  "step",
  "group",
  "value",
  "stat",
  "unit",
  "glossary",
  "summary",
  "sheet",
  "card",
];

export async function validatePackageDir(dir: string): Promise<ValidationResult> {
  const { files, unreadable } = await readPackageDir(dir);
  const pre: Issue[] = [...unreadable].map(([file, message]) => ({
    level: "error",
    file,
    path: "",
    message,
  }));
  const result = { ...validatePackageFiles(files), files };
  if (pre.length === 0) return result;
  return { ok: false, errors: [...pre, ...result.errors], warnings: result.warnings };
}

const lit = (s: string) => JSON.stringify(s);
const pathOf = (segments: readonly PropertyKey[]): string =>
  segments
    .map((s, i) =>
      typeof s === "number"
        ? `[${s}]`
        : typeof s === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
          ? `${i === 0 ? "" : "."}${s}`
          : `[${lit(String(s))}]`,
    )
    .join("");

/** Validates already-parsed package files (path → JSON value). */
export function validatePackageFiles(files: PackageFiles): ValidationResult {
  const issues: Issue[] = [];
  const err = (file: string, path: string, message: string) =>
    issues.push({ level: "error", file, path, message });
  const warn = (file: string, path: string, message: string) =>
    issues.push({ level: "warning", file, path, message });
  const finish = (pkg?: ContentPackage): ValidationResult => {
    const errors = issues.filter((i) => i.level === "error");
    const warnings = issues.filter((i) => i.level === "warning");
    return errors.length === 0 && pkg
      ? { ok: true, errors, warnings, package: pkg }
      : { ok: false, errors, warnings };
  };

  // ------------------------------------------------------------ 1. structure
  function parse<T>(file: string, schema: ZodType<T>, required = true): T | undefined {
    if (!files.has(file)) {
      if (required) err(file, "", "file is missing");
      return undefined;
    }
    const r = schema.safeParse(files.get(file));
    if (!r.success) {
      for (const i of r.error.issues) err(file, pathOf(i.path), i.message);
      return undefined;
    }
    return r.data;
  }

  const manifest = parse("manifest.json", manifestSchema);
  const units = parse("units.json", unitsSchema);
  const values = parse("values.json", valuesSchema);
  const flow = parse("flow.json", flowSchema);
  const sheet = parse("sheet.json", sheetSchema);
  const glossary = files.has("glossary.json") ? parse("glossary.json", glossarySchema) : [];

  const thingFiles = [...files.keys()].filter((f) => f.startsWith("things/")).sort();
  if (thingFiles.length === 0) err("things/", "", "no things: add at least one file things/<name>.json");
  const thingsAt: { thing: Thing; file: string; index: number }[] = [];
  for (const f of thingFiles) {
    const list = parse(f, thingsFileSchema);
    list?.forEach((thing, index) => thingsAt.push({ thing, file: f, index }));
  }

  const textFiles = [...files.keys()].filter((f) => f.startsWith("texts/")).sort();
  const parsedTexts: { file: string; lang: string; data: ReturnType<typeof textsFileSchema.parse> }[] = [];
  for (const f of textFiles) {
    const m = /^texts\/([^/]+)\/(.*)$/.exec(f);
    if (!m || m[2] === "") continue; // empty language folder, reported below
    const data = parse(f, textsFileSchema);
    if (data) parsedTexts.push({ file: f, lang: m[1]!, data });
  }

  if (!manifest || !units || !values || !flow || !sheet || !glossary || issues.length > 0) return finish();

  // ------------------------------------------------------------- 2. manifest
  const mismatch = formatVersionMismatch(manifest.formatVersion);
  if (mismatch) err("manifest.json", "formatVersion", mismatch);
  if (manifest.dependsOn) {
    err(
      "manifest.json",
      "dependsOn",
      `this package extends ${lit(manifest.dependsOn[0]!.id)}; validate it together with that package`,
    );
  }
  duplicates(manifest.languages).forEach((l) =>
    err("manifest.json", "languages", `language ${lit(l)} listed twice`),
  );
  duplicates(manifest.kinds).forEach((k) => err("manifest.json", "kinds", `kind ${lit(k)} listed twice`));
  for (const [sid, s] of Object.entries(manifest.sources)) {
    if (!(s.license in manifest.licenses)) {
      err(
        "manifest.json",
        `sources.${sid}.license`,
        `unknown license ${lit(s.license)}${known(manifest.licenses)}`,
      );
    }
  }

  const checkProvenance = (file: string, path: string, source: string, license?: string) => {
    if (!(source in manifest.sources)) {
      err(file, `${path}.source`, `unknown source ${lit(source)}${known(manifest.sources)}`);
    }
    if (license !== undefined && !(license in manifest.licenses)) {
      err(file, `${path}.license`, `unknown license ${lit(license)}${known(manifest.licenses)}`);
    }
  };

  // ---------------------------------------------------------------- indexes
  const valueIds = new Set(values.map((v) => v.id));
  const valueById = new Map(values.map((v) => [v.id, v]));
  const thingById = new Map<string, Thing>();
  const choiceById = new Map(flow.choices.map((c) => [c.id, c]));
  const glossaryIds = new Set(glossary.map((g) => g.id));
  const allTags = new Set(thingsAt.flatMap(({ thing }) => thing.tags ?? []));
  const thingAt = new Map<string, string>();
  for (const { thing, file, index } of thingsAt) {
    const first = thingAt.get(thing.id);
    if (first) err(file, `[${index}].id`, `thing ${lit(thing.id)} is declared twice (first in ${first})`);
    else thingAt.set(thing.id, `${file} [${index}]`);
    thingById.set(thing.id, thing);
  }

  const resolveOptions = (o: OptionSource): Thing[] =>
    [...thingById.values()].filter(
      (t) =>
        (o.kind === undefined || t.kind === o.kind) &&
        (o.ids === undefined || o.ids.includes(t.id)) &&
        (o.tags ?? []).every((tag) => t.tags?.includes(tag)),
    );
  // Things a pick choice can give (not only mark): where texts of a thing (`textInputs`) are asked.
  let picked: Set<string> | undefined;
  const pickedThings = () =>
    (picked ??= new Set(
      flow.choices.flatMap((c) =>
        (c.kind === "pickOne" || c.kind === "pickMany") && !c.options.owned
          ? resolveOptions(c.options).map((t) => t.id)
          : [],
      ),
    ));

  // Tracks: the options of the choice flow.level.tracks names, and every thing that can
  // come through one of them (its grants, the options of the choices it grants, and so on).
  const tracksChoice = flow.level.tracks ? choiceById.get(flow.level.tracks.choice) : undefined;
  const trackIds = new Set(
    tracksChoice && "options" in tracksChoice ? resolveOptions(tracksChoice.options).map((t) => t.id) : [],
  );
  const inTrack = new Set(trackIds);
  for (const queue = [...trackIds]; queue.length > 0;) {
    const reach = (tid: string) => {
      if (!thingById.has(tid) || inTrack.has(tid)) return;
      inTrack.add(tid);
      queue.push(tid);
    };
    for (const g of thingById.get(queue.pop()!)?.grants ?? []) {
      if (g.thing !== undefined) reach(g.thing);
      const c = g.choice !== undefined ? choiceById.get(g.choice) : undefined;
      if (c && "options" in c) resolveOptions(c.options).forEach((t) => reach(t.id));
    }
  }

  /** A choice that gives what is picked in it: a pick choice without `options.owned`. */
  const checkGivingPick = (file: string, path: string, cid: string) => {
    const c = choiceById.get(cid);
    if (!c) err(file, path, `unknown choice ${lit(cid)}`);
    else if (c.kind !== "pickOne" && c.kind !== "pickMany")
      err(file, path, `choice ${lit(cid)} is ${c.kind}; name a pickOne or pickMany choice`);
    else if (c.options.owned)
      err(
        file,
        path,
        `choice ${lit(cid)} only marks what the character has (options.owned); it gives nothing`,
      );
  };

  const checkExpr = (file: string, path: string, src: string) => {
    let ast;
    try {
      ast = parseExpr(src);
    } catch (e) {
      if (e instanceof ExprSyntaxError) {
        err(file, path, `cannot read expression ${lit(src)}: ${e.message} (at character ${e.position + 1})`);
        return undefined;
      }
      throw e;
    }
    const refs = collectRefs(ast);
    for (const v of refs.values) {
      if (!valueIds.has(v) && !(BUILTIN_REFS as readonly string[]).includes(v)) {
        err(file, path, `expression ${lit(src)} uses unknown value ${lit(v)}`);
      }
    }
    for (const t of refs.things) {
      if (!thingById.has(t))
        err(file, path, `expression ${lit(src)} asks has(${lit(t)}) but there is no such thing`);
    }
    for (const t of refs.tags) {
      if (!allTags.has(t))
        warn(file, path, `expression ${lit(src)} counts tag ${lit(t)}, which no thing carries`);
    }
    for (const t of refs.tracks) {
      if (!flow.level.tracks)
        err(file, path, `expression ${lit(src)} asks levelOf(${lit(t)}), but flow.level.tracks is not set`);
      else if (!trackIds.has(t))
        err(
          file,
          path,
          `expression ${lit(src)} asks levelOf(${lit(t)}), but that is no option of the tracks choice ${lit(flow.level.tracks.choice)}`,
        );
    }
    return refs;
  };

  const isValueRef = (v: string) => valueIds.has(v) || v === "level";
  /** A value worked out from others, so no choice can set it. */
  const computed = (v: Value) =>
    v.formula !== undefined || v.byLevel !== undefined || v.byValue !== undefined;

  // A table by level has one number per level the flow offers.
  const levels = flow.level.max - flow.level.min + 1;
  const checkByLevel = (file: string, path: string, table: readonly number[]) => {
    if (table.length !== levels) {
      err(
        file,
        path,
        `has ${table.length} numbers, but levels ${flow.level.min} to ${flow.level.max} need ${levels}`,
      );
    }
  };
  /** A number, an expression or a table by level. */
  const checkAmountSource = (file: string, path: string, a: number | string | { byLevel: number[] }) => {
    if (typeof a === "string") checkExpr(file, path, a);
    else if (typeof a === "object") checkByLevel(file, `${path}.byLevel`, a.byLevel);
  };

  // ------------------------------------------------------------------ units
  const unitDim = new Map<string, string>();
  for (const [dim, d] of Object.entries(units.dimensions)) {
    if (!d.units.includes(d.source)) {
      err(
        "units.json",
        `dimensions.${dim}.source`,
        `source unit ${lit(d.source)} is not in this dimension's units`,
      );
    }
    for (const u of d.units) {
      if (unitDim.has(u))
        err("units.json", `dimensions.${dim}.units`, `unit ${lit(u)} belongs to two dimensions`);
      unitDim.set(u, dim);
    }
  }
  for (const lang of manifest.languages) {
    const defaults = units.languageDefaults[lang];
    for (const dim of Object.keys(units.dimensions)) {
      if (!defaults?.[dim]) {
        err("units.json", `languageDefaults.${lang}`, `no default ${dim} unit for language ${lit(lang)}`);
      }
    }
  }
  for (const [lang, defaults] of Object.entries(units.languageDefaults)) {
    if (!manifest.languages.includes(lang)) {
      warn("units.json", `languageDefaults.${lang}`, `language ${lit(lang)} is not in manifest.languages`);
    }
    for (const [dim, u] of Object.entries(defaults)) {
      if (!(dim in units.dimensions))
        err("units.json", `languageDefaults.${lang}.${dim}`, `unknown dimension ${lit(dim)}`);
      else if (unitDim.get(u) !== dim) {
        err("units.json", `languageDefaults.${lang}.${dim}`, `unit ${lit(u)} is not a ${dim} unit`);
      }
    }
  }
  units.conversions.forEach((c, i) => {
    const p = `conversions[${i}]`;
    if (!unitDim.has(c.from)) err("units.json", `${p}.from`, `unknown unit ${lit(c.from)}`);
    if (!unitDim.has(c.to)) err("units.json", `${p}.to`, `unknown unit ${lit(c.to)}`);
    if (unitDim.has(c.from) && unitDim.get(c.from) !== unitDim.get(c.to)) {
      err("units.json", p, `cannot convert ${c.from} to ${c.to}: different dimensions`);
    }
    duplicates(c.table.map(([a]) => a)).forEach((a) =>
      err("units.json", `${p}.table`, `amount ${a} appears twice in the ${c.from}→${c.to} table`),
    );
  });

  /** Every stated amount must be convertible to every other unit of its dimension. */
  const checkAmount = (file: string, path: string, amount: number, unit: string) => {
    const dim = unitDim.get(unit);
    if (!dim) {
      err(file, path, `unknown unit ${lit(unit)}; declare it in units.json`);
      return;
    }
    for (const to of units.dimensions[dim]!.units) {
      if (to === unit) continue;
      const c = units.conversions.find((x) => x.from === unit && x.to === to);
      if (!c) err(file, path, `no conversion ${unit}→${to} in units.json`);
      else if (!c.fallback && !c.table.some(([a]) => a === amount)) {
        err(
          file,
          path,
          `${amount} ${unit} has no row in the ${unit}→${to} table; add [${amount}, …] to units.json`,
        );
      }
    }
  };

  // ----------------------------------------------------------------- values
  values.forEach((v, i) => {
    const p = `[${i}]`;
    checkProvenance("values.json", p, v.source, v.license);
    if (v.unit !== undefined) {
      if (!unitDim.has(v.unit)) err("values.json", `${p}.unit`, `unknown unit ${lit(v.unit)}`);
      else {
        for (const to of units.dimensions[unitDim.get(v.unit)!]!.units) {
          const c = units.conversions.find((x) => x.from === v.unit && x.to === to);
          if (to !== v.unit && c && !c.fallback) {
            warn(
              "values.json",
              `${p}.unit`,
              `value ${lit(v.id)} is computed in ${v.unit}, but the ${v.unit}→${to} table has no fallback; results missing from the table cannot be shown`,
            );
          }
        }
      }
    }
    if (v.formula !== undefined) checkExpr("values.json", `${p}.formula`, v.formula);
    if (v.byLevel !== undefined) checkByLevel("values.json", `${p}.byLevel`, v.byLevel);
    if (v.byValue !== undefined && v.table !== undefined) {
      const by = valueById.get(v.byValue);
      if (!isValueRef(v.byValue)) err("values.json", `${p}.byValue`, `unknown value ${lit(v.byValue)}`);
      else if (v.byValue === v.id) err("values.json", `${p}.byValue`, "a value cannot be a table by itself");
      else if (by?.max !== undefined && v.table.length < by.max + 1)
        warn(
          "values.json",
          `${p}.table`,
          `has ${v.table.length} numbers, but ${lit(v.byValue)} goes up to ${by.max}; higher values get the last number`,
        );
    }
    if (v.min !== undefined && v.max !== undefined && v.min > v.max)
      err("values.json", p, "min is greater than max");
  });
  duplicates(values.map((v) => v.id)).forEach((v) =>
    err("values.json", "", `value ${lit(v)} is declared twice`),
  );
  for (const cycle of formulaCycles(values)) {
    err("values.json", "", `formulas depend on each other in a circle: ${cycle.join(" → ")}`);
  }

  // ----------------------------------------------------------------- things
  const checkOptionSource = (file: string, path: string, o: OptionSource): Thing[] => {
    if (o.kind !== undefined && !manifest.kinds.includes(o.kind))
      err(file, `${path}.kind`, `unknown kind ${lit(o.kind)}${known(manifest.kinds)}`);
    o.ids?.forEach((tid, j) => {
      if (!thingById.has(tid)) err(file, `${path}.ids[${j}]`, `unknown thing ${lit(tid)}`);
    });
    o.tags?.forEach((tag, j) => {
      if (!allTags.has(tag)) err(file, `${path}.tags[${j}]`, `no thing carries tag ${lit(tag)}`);
    });
    const found = resolveOptions(o);
    if (found.length === 0) err(file, path, "selects no things");
    return found;
  };

  const grantedChoices = new Map<string, string>(); // choice id → granting thing id
  const statKeys = new Set<string>();
  const statTextKeys = new Set<string>();
  const statTextVars = new Map<string, Set<string>>(); // stat text key → var names its stats supply
  /** A text filled with character values: its texts must exist and use only the names in `vars`. */
  const checkFilledText = (file: string, path: string, ft: FilledText) => {
    for (const [name, v] of Object.entries(ft.vars ?? {})) {
      if (!isValueRef(v)) err(file, `${path}.vars.${name}`, `unknown value ${lit(v)}`);
    }
    ft.variants?.forEach((v, j) => checkExpr(file, `${path}.variants[${j}].when`, v.when));
    const keys = [ft.text, ...(ft.variants ?? []).map((v) => v.text)];
    duplicates(keys).forEach((key) => err(file, `${path}.variants`, `text ${lit(key)} is named twice`));
    for (const key of keys) {
      statTextKeys.add(key);
      // A variant text is checked even without `vars`: it may not use a name nothing fills.
      if (ft.vars === undefined && key === ft.text) continue;
      let names = statTextVars.get(key);
      if (!names) statTextVars.set(key, (names = new Set()));
      for (const name of Object.keys(ft.vars ?? {})) names.add(name);
    }
  };
  const groups = new Set<string>();
  for (const { thing: t, file, index } of thingsAt) {
    const p = `[${index}]`;
    const prefix = t.id.split(".")[0]!;
    if (RESERVED_PREFIXES.includes(prefix)) {
      err(
        file,
        `${p}.id`,
        `thing ids may not start with ${lit(prefix + ".")}; that prefix is reserved for package texts`,
      );
    }
    if (!manifest.kinds.includes(t.kind))
      err(file, `${p}.kind`, `unknown kind ${lit(t.kind)}${known(manifest.kinds)}`);
    checkProvenance(file, p, t.source, t.license);
    if (t.group !== undefined) groups.add(t.group);
    if (t.requires !== undefined) checkExpr(file, `${p}.requires`, t.requires);
    if (t.addRequires !== undefined) {
      checkExpr(file, `${p}.addRequires`, t.addRequires);
      if (!trackIds.has(t.id))
        err(
          file,
          `${p}.addRequires`,
          flow.level.tracks
            ? `only a track can be added; ${lit(t.id)} is no option of the tracks choice ${lit(flow.level.tracks.choice)}`
            : "only a track can be added, and flow.level.tracks is not set",
        );
    }
    for (const [k, s] of Object.entries(t.stats ?? {})) {
      statKeys.add(k);
      if (typeof s === "object" && "amount" in s) checkAmount(file, `${p}.stats.${k}`, s.amount, s.unit);
      if (typeof s === "object" && "text" in s) checkFilledText(file, `${p}.stats.${k}`, s);
      if (typeof s === "object" && "value" in s && !isValueRef(s.value))
        err(file, `${p}.stats.${k}.value`, `unknown value ${lit(s.value)}`);
    }
    t.grants?.forEach((g, j) => {
      const gp = `${p}.grants[${j}]`;
      if (g.thing !== undefined) {
        if (!thingById.has(g.thing)) err(file, `${gp}.thing`, `unknown thing ${lit(g.thing)}`);
        if (g.thing === t.id) err(file, `${gp}.thing`, "a thing cannot grant itself");
      }
      if (g.choice !== undefined) {
        if (!choiceById.has(g.choice))
          err(file, `${gp}.choice`, `unknown choice ${lit(g.choice)}${known(choiceById)}`);
        grantedChoices.set(g.choice, t.id);
      }
      if (g.value !== undefined) {
        if (!valueIds.has(g.value))
          err(file, `${gp}.value`, `unknown value ${lit(g.value)}${known(valueIds)}`);
        if (g.add !== undefined) checkAmountSource(file, `${gp}.add`, g.add);
      }
      if (g.atLevel !== undefined && g.atLevel < flow.level.min) {
        warn(file, `${gp}.atLevel`, `level ${g.atLevel} is below the lowest level ${flow.level.min}`);
      }
      if (g.only !== undefined) {
        if (!flow.level.tracks)
          err(file, `${gp}.only`, `"only" needs tracks, and flow.level.tracks is not set`);
        else if (!inTrack.has(t.id))
          warn(
            file,
            `${gp}.only`,
            `${lit(t.id)} never belongs to a track (it does not come through the tracks choice), so this grant never applies`,
          );
      }
    });
    if (t.about !== undefined) {
      if (!thingById.has(t.about)) err(file, `${p}.about`, `unknown thing ${lit(t.about)}`);
      if (t.about === t.id) err(file, `${p}.about`, "a thing cannot be about itself");
    }
    if (t.repeatable && !t.grants?.some((g) => g.choice !== undefined)) {
      warn(
        file,
        `${p}.repeatable`,
        "the thing grants no choice; picking it again changes nothing (a thing counts once)",
      );
    }
    if (t.textInputs !== undefined && !pickedThings().has(t.id)) {
      warn(
        file,
        `${p}.textInputs`,
        "no pickOne or pickMany choice offers the thing; its texts are asked only where it is picked",
      );
    }
    if (t.card && !(t.kind in sheet.cards)) {
      err(file, `${p}.card`, `card is set, but sheet.json has no card layout for kind ${lit(t.kind)}`);
    }
  }

  // --------------------------------------------------------------- glossary
  glossary.forEach((g, i) => checkProvenance("glossary.json", `[${i}]`, g.source, g.license));
  duplicates(glossary.map((g) => g.id)).forEach((g) =>
    err("glossary.json", "", `entry ${lit(g)} is declared twice`),
  );

  // ------------------------------------------------------------------- flow
  const F = "flow.json";
  duplicates(flow.choices.map((c) => c.id)).forEach((c) =>
    err(F, "choices", `choice ${lit(c)} is declared twice`),
  );
  const suggestionKeys = new Set<string>();
  flow.choices.forEach((c, i) => {
    const p = `choices[${i}]`;
    checkProvenance(F, p, c.source, c.license);
    c.textVariants?.forEach((v, j) => checkExpr(F, `${p}.textVariants[${j}].when`, v.when));
    duplicates((c.textVariants ?? []).map((v) => v.id)).forEach((v) =>
      err(F, `${p}.textVariants`, `text variant ${lit(v)} is declared twice`),
    );
    switch (c.kind) {
      case "pickOne":
      case "pickMany": {
        const options = checkOptionSource(F, `${p}.options`, c.options);
        const optionIds = new Set(options.map((o) => o.id));
        if (c.kind === "pickMany") {
          checkAmountSource(F, `${p}.count`, c.count);
          const most = typeof c.count === "object" ? Math.max(...c.count.byLevel) : c.count;
          if (typeof most === "number" && most > options.length && options.length > 0) {
            err(F, `${p}.count`, `asks for ${most} but only ${options.length} options exist`);
          }
        }
        c.recommend?.forEach((r, j) => {
          if (r.when !== undefined) checkExpr(F, `${p}.recommend[${j}].when`, r.when);
          if (c.kind === "pickOne" && r.pick.length !== 1) {
            err(F, `${p}.recommend[${j}].pick`, "pickOne recommends exactly one option");
          }
          r.pick.forEach((id, k) => {
            if (!optionIds.has(id))
              err(F, `${p}.recommend[${j}].pick[${k}]`, `${lit(id)} is not one of this choice's options`);
          });
        });
        const badged = new Set<string>();
        c.badges?.forEach((b, j) => {
          b.things.forEach((id, k) => {
            const bp = `${p}.badges[${j}].things[${k}]`;
            if (!optionIds.has(id)) err(F, bp, `${lit(id)} is not one of this choice's options`);
            else if (badged.has(id)) err(F, bp, `${lit(id)} already has a badge in this choice`);
            badged.add(id);
          });
        });
        if (c.held && !options.some((o) => o.about !== undefined))
          err(F, `${p}.held`, 'none of this choice\'s options is "about" another thing');
        c.options.ownedFrom?.forEach((cid, k) => checkGivingPick(F, `${p}.options.ownedFrom[${k}]`, cid));
        if (c.options.rankUpTo !== undefined) {
          checkExpr(F, `${p}.options.rankUpTo`, c.options.rankUpTo);
          if (options.length > 0 && !options.some((o) => o.rank !== undefined))
            warn(F, `${p}.options.rankUpTo`, "none of this choice's options has a rank; all count as rank 0");
        }
        for (const [from, to] of Object.entries(c.cardValues ?? {})) {
          if (!valueIds.has(from)) err(F, `${p}.cardValues.${from}`, `unknown value ${lit(from)}`);
          if (!valueIds.has(to)) err(F, `${p}.cardValues.${from}`, `unknown value ${lit(to)}`);
        }
        if (c.cardValues !== undefined && options.length > 0 && !options.some((o) => o.card))
          warn(F, `${p}.cardValues`, "none of this choice's options has a card");
        break;
      }
      case "distribute": {
        // Raising adds on top of any value; the other methods set a value's base.
        const raise = c.methods.find((m) => m.method === "raise");
        if (raise && c.methods.length > 1)
          err(F, `${p}.methods`, '"raise" adds to values and cannot be offered next to other methods');
        c.targets.forEach((v, j) => {
          const value = valueById.get(v);
          if (!value) err(F, `${p}.targets[${j}]`, `unknown value ${lit(v)}`);
          else if (!raise && computed(value))
            err(F, `${p}.targets[${j}]`, `value ${lit(v)} has a formula and cannot take input`);
        });
        c.methods.forEach((m, j) => {
          const mp = `${p}.methods[${j}]`;
          if (m.method === "array" && m.values.length !== c.targets.length) {
            err(F, `${mp}.values`, `has ${m.values.length} numbers for ${c.targets.length} targets`);
          }
          if (m.method === "raise") {
            if (typeof m.cap === "string") checkExpr(F, `${mp}.cap`, m.cap);
            if (m.maxPerTarget !== undefined && m.maxPerTarget > m.points)
              warn(F, `${mp}.maxPerTarget`, `is more than the ${m.points} points there are`);
          }
          if (m.method === "pointBuy") {
            const scores = Object.keys(m.costs)
              .map(Number)
              .sort((a, b) => a - b);
            if (scores.length < 2) err(F, `${mp}.costs`, "needs at least two scores");
            for (let k = 1; k < scores.length; k++) {
              if (scores[k] !== scores[k - 1]! + 1)
                err(F, `${mp}.costs`, `score ${scores[k - 1]! + 1} is missing`);
              if (m.costs[String(scores[k])]! < m.costs[String(scores[k - 1])]!) {
                err(F, `${mp}.costs`, `cost must not fall from score ${scores[k - 1]} to ${scores[k]}`);
              }
            }
          }
        });
        c.recommend?.forEach((r, j) => {
          if (r.when !== undefined) checkExpr(F, `${p}.recommend[${j}].when`, r.when);
          for (const k of Object.keys(r.assign)) {
            if (!c.targets.includes(k))
              err(F, `${p}.recommend[${j}].assign.${k}`, `${lit(k)} is not a target of this choice`);
          }
          if (raise) {
            const most = raise.maxPerTarget ?? raise.points;
            const amounts = Object.values(r.assign);
            if (amounts.some((n) => n < 0 || n > most))
              err(F, `${p}.recommend[${j}].assign`, `gives a target less than 0 or more than ${most} points`);
            if (amounts.reduce((a, b) => a + b, 0) > raise.points)
              err(F, `${p}.recommend[${j}].assign`, `gives more than the ${raise.points} points there are`);
          }
        });
        c.badges?.forEach((b, j) => {
          if (b.when !== undefined) checkExpr(F, `${p}.badges[${j}].when`, b.when);
          b.targets.forEach((v, k) => {
            if (!c.targets.includes(v))
              err(F, `${p}.badges[${j}].targets[${k}]`, `${lit(v)} is not a target of this choice`);
          });
        });
        break;
      }
      case "number": {
        const value = valueById.get(c.target);
        if (!value) err(F, `${p}.target`, `unknown value ${lit(c.target)}`);
        else if (computed(value))
          err(F, `${p}.target`, `value ${lit(c.target)} has a formula and cannot take input`);
        if (typeof c.min === "string") checkExpr(F, `${p}.min`, c.min);
        if (typeof c.max === "string") checkExpr(F, `${p}.max`, c.max);
        if (typeof c.min === "number" && typeof c.max === "number" && c.min > c.max)
          err(F, p, "min is greater than max");
        break;
      }
      case "text":
        if (c.suggestions !== undefined) suggestionKeys.add(c.suggestions);
        break;
      case "info": {
        const of = choiceById.get(c.of);
        if (!of) err(F, `${p}.of`, `unknown choice ${lit(c.of)}`);
        else if (of.kind !== "pickOne")
          err(F, `${p}.of`, `choice ${lit(c.of)} is ${of.kind}; info works with pickOne`);
        break;
      }
    }
  });

  flow.grants?.forEach((tid, i) => {
    if (!thingById.has(tid)) err(F, `grants[${i}]`, `unknown thing ${lit(tid)}`);
  });
  duplicates(flow.grants ?? []).forEach((t) => err(F, "grants", `thing ${lit(t)} is granted twice`));

  const inStep = new Map<string, string>();
  duplicates(flow.steps.map((s) => s.id)).forEach((s) => err(F, "steps", `step ${lit(s)} is declared twice`));
  const gatherSteps = new Map<string, GatherStep>(); // group → its gather step
  flow.steps.forEach((s, i) => {
    if (s.when !== undefined) checkExpr(F, `steps[${i}].when`, s.when);
    if ("gather" in s) {
      const first = gatherSteps.get(s.gather);
      if (first)
        err(F, `steps[${i}].gather`, `group ${lit(s.gather)} is already gathered in step ${lit(first.id)}`);
      else gatherSteps.set(s.gather, s);
      return;
    }
    s.choices.forEach((cid, j) => {
      const sp = `steps[${i}].choices[${j}]`;
      if (!choiceById.has(cid)) err(F, sp, `unknown choice ${lit(cid)}${known(choiceById)}`);
      else if (inStep.has(cid))
        err(F, sp, `choice ${lit(cid)} is already used in step ${lit(inStep.get(cid)!)}`);
      else if (grantedChoices.has(cid)) {
        err(
          F,
          sp,
          `choice ${lit(cid)} is granted by ${lit(grantedChoices.get(cid)!)} and cannot also be a fixed step`,
        );
      }
      inStep.set(cid, s.id);
    });
  });
  const gathered = new Set<string>();
  flow.choices.forEach((c, i) => {
    if (!inStep.has(c.id) && !grantedChoices.has(c.id)) {
      warn(F, `choices[${i}]`, `choice ${lit(c.id)} is never asked: no step lists it and no thing grants it`);
    }
    if (c.gather === undefined) return;
    gathered.add(c.gather);
    const at = gatherSteps.get(c.gather);
    if (inStep.has(c.id)) {
      warn(
        F,
        `choices[${i}].gather`,
        `choice ${lit(c.id)} is listed in step ${lit(inStep.get(c.id)!)}, so it is never gathered`,
      );
    } else if (!at) {
      warn(
        F,
        `choices[${i}].gather`,
        `no step gathers group ${lit(c.gather)}; the choice is asked right after the step that grants it`,
      );
    } else if (at.together === "list" && c.kind !== "pickOne" && c.kind !== "pickMany") {
      err(
        F,
        `choices[${i}].gather`,
        `step ${lit(at.id)} shows one list of options; choice ${lit(c.id)} is ${c.kind}`,
      );
    } else if (at.together === "list" && "options" in c && c.options.owned) {
      err(
        F,
        `choices[${i}].gather`,
        `step ${lit(at.id)} shows one list without what the character has; choice ${lit(c.id)} offers only that (options.owned)`,
      );
    }
  });
  flow.steps.forEach((s, i) => {
    if ("gather" in s && !gathered.has(s.gather))
      warn(
        F,
        `steps[${i}].gather`,
        `no choice is gathered in group ${lit(s.gather)}; the step is never shown`,
      );
  });
  const tracks = flow.level.tracks;
  if (tracks) {
    const tp = "level.tracks.choice";
    if (!tracksChoice) err(F, tp, `unknown choice ${lit(tracks.choice)}${known(choiceById)}`);
    else if (tracksChoice.kind !== "pickOne")
      err(F, tp, `choice ${lit(tracks.choice)} is ${tracksChoice.kind}; tracks come from a pickOne choice`);
    else if (tracksChoice.options.owned)
      err(F, tp, `choice ${lit(tracks.choice)} only marks what the character has (options.owned)`);
    else if (!inStep.has(tracks.choice))
      err(F, tp, `choice ${lit(tracks.choice)} must be listed in a step: the first track is its answer`);
    if (tracks.addRequiresCurrent && ![...thingById.values()].some((t) => t.addRequires !== undefined))
      warn(F, "level.tracks.addRequiresCurrent", 'no thing has "addRequires"; there is nothing to check');
  }
  const nameChoice = choiceById.get(flow.characterName);
  if (!nameChoice) err(F, "characterName", `unknown choice ${lit(flow.characterName)}`);
  else if (nameChoice.kind !== "text")
    err(F, "characterName", `choice ${lit(flow.characterName)} must be a text choice`);
  flow.summary.fields.forEach((v, i) => {
    if (!isValueRef(v)) err(F, `summary.fields[${i}]`, `unknown value ${lit(v)}`);
  });
  for (const [name, arg] of Object.entries(flow.summary.line)) {
    if ("choice" in arg && !choiceById.has(arg.choice))
      err(F, `summary.line.${name}`, `unknown choice ${lit(arg.choice)}`);
    if ("value" in arg && !isValueRef(arg.value))
      err(F, `summary.line.${name}`, `unknown value ${lit(arg.value)}`);
    if ("tracks" in arg && !tracks)
      err(F, `summary.line.${name}`, "names the tracks, but flow.level.tracks is not set");
  }

  // ------------------------------------------------------------------ sheet
  const S = "sheet.json";
  duplicates(sheet.sections.map((s) => s.id)).forEach((s) =>
    err(S, "sections", `section ${lit(s)} is declared twice`),
  );
  if (sheet.sections[0]?.kind !== "header") warn(S, "sections[0]", "the first section should be the header");
  const thingPlace = new Map(thingsAt.map((at) => [at.thing.id, at]));
  // A sheet field that names a stat ("uses", "note", "total", a table column): some
  // selected thing must have it, and every value must be printable in that place.
  const checkStatRef = (
    path: string,
    key: string,
    selected: Thing[],
    role: "uses" | "note" | "total" | "column",
  ) => {
    const having = selected.filter((t) => t.stats?.[key] !== undefined);
    if (having.length === 0) {
      err(
        S,
        path,
        statKeys.has(key)
          ? `none of the things selected here has a stat ${lit(key)}`
          : `no thing has a stat ${lit(key)}`,
      );
      return;
    }
    for (const t of having) {
      const v = t.stats![key]!;
      const ok =
        role === "uses"
          ? (typeof v === "number" && Number.isInteger(v) && v >= 0) ||
            (typeof v === "object" && ("text" in v || "value" in v))
          : role === "total"
            ? typeof v === "object" && "value" in v
            : typeof v !== "boolean";
      if (ok) continue;
      const at = thingPlace.get(t.id)!;
      const problem = {
        uses: `${path} draws use boxes from this stat; it must be a whole number ≥ 0, {"text": …} or {"value": …}`,
        note: `${path} prints this stat next to the name; it cannot be true/false`,
        total: `${path} prints the character's value in the box; this stat must be {"value": …}`,
        column: `${path} prints this stat in a table column; it cannot be true/false`,
      }[role];
      err(at.file, `[${at.index}].stats.${key}`, problem);
    }
  };
  /** The fields of a mark or a card origin (and of its `not`) name tags, things and choices that exist. */
  const checkMarkCondition = (mark: Mark | CardOrigin, path: string) => {
    for (const [m, mp] of [
      [mark, path],
      ...(mark.not ? [[mark.not, `${path}.not`] as const] : []),
    ] as const) {
      m.tags?.forEach((tag, k) => {
        if (!allTags.has(tag)) err(S, `${mp}.tags[${k}]`, `no thing carries tag ${lit(tag)}`);
      });
      if (m.from !== undefined) checkOptionSource(S, `${mp}.from`, m.from);
      m.pickedIn?.forEach((cid, k) => checkGivingPick(S, `${mp}.pickedIn[${k}]`, cid));
      for (const field of ["marked", "unmarked"] as const)
        m[field]?.forEach((cid, k) => {
          const c = choiceById.get(cid);
          if (!c) err(S, `${mp}.${field}[${k}]`, `unknown choice ${lit(cid)}`);
          else if (!("options" in c && c.options.owned))
            err(
              S,
              `${mp}.${field}[${k}]`,
              `choice ${lit(cid)} marks nothing; name a choice with options.owned`,
            );
        });
    }
  };
  sheet.sections.forEach((s, i) => {
    const p = `sections[${i}]`;
    if (s.when !== undefined) checkExpr(S, `${p}.when`, s.when);
    switch (s.kind) {
      case "header":
        s.fields?.forEach((f, j) => {
          if ("choice" in f) {
            if (!choiceById.has(f.choice))
              err(S, `${p}.fields[${j}].choice`, `unknown choice ${lit(f.choice)}`);
            return;
          }
          if ("tracks" in f) {
            if (!tracks) err(S, `${p}.fields[${j}].tracks`, "flow.level.tracks is not set");
            return;
          }
          checkOptionSource(S, `${p}.fields[${j}].things`, f.things);
          if (f.label === undefined && f.things.kind === undefined)
            err(
              S,
              `${p}.fields[${j}]`,
              'needs a "label": without "things.kind" there is no kind name to print',
            );
        });
        break;
      case "statBoxes":
        s.boxes.forEach((b, j) => {
          if (!isValueRef(b.value)) err(S, `${p}.boxes[${j}].value`, `unknown value ${lit(b.value)}`);
          if (b.when !== undefined) checkExpr(S, `${p}.boxes[${j}].when`, b.when);
          if (b.text !== undefined) {
            if (b.style === "pencil")
              err(S, `${p}.boxes[${j}].text`, "a pencil box has no text, only a field");
            checkFilledText(S, `${p}.boxes[${j}].text`, b.text);
          }
        });
        break;
      case "scoreColumn":
        s.scores.forEach((sc, j) => {
          if (!valueIds.has(sc.value)) err(S, `${p}.scores[${j}].value`, `unknown value ${lit(sc.value)}`);
          if (sc.derived !== undefined && !valueIds.has(sc.derived)) {
            err(S, `${p}.scores[${j}].derived`, `unknown value ${lit(sc.derived)}`);
          }
          if (sc.extra !== undefined && !valueIds.has(sc.extra)) {
            err(S, `${p}.scores[${j}].extra`, `unknown value ${lit(sc.extra)}`);
          }
          if (sc.derivedLabel !== undefined && sc.derived === undefined) {
            err(S, `${p}.scores[${j}].derivedLabel`, '"derivedLabel" only goes with "derived"');
          }
          if (sc.extraLabel !== undefined && sc.extra === undefined) {
            err(S, `${p}.scores[${j}].extraLabel`, '"extraLabel" only goes with "extra"');
          }
        });
        break;
      case "checkList": {
        const selected = checkOptionSource(S, `${p}.things`, s.things);
        if (s.note !== undefined) checkStatRef(`${p}.note`, s.note, selected, "note");
        if (s.total !== undefined) checkStatRef(`${p}.total`, s.total, selected, "total");
        if (s.strong !== undefined) {
          const ids = new Set(selected.map((t) => t.id));
          const strong = checkOptionSource(S, `${p}.strong`, s.strong);
          if (strong.length > 0 && !strong.some((t) => t.about !== undefined && ids.has(t.about)))
            err(S, `${p}.strong`, "none of these things is `about` a thing listed in this section");
        }
        if (s.strongLegend !== undefined && s.strong === undefined)
          err(S, `${p}.strongLegend`, 'explains the double mark, but the section has no "strong"');
        break;
      }
      case "statTable": {
        const selected = checkOptionSource(S, `${p}.things`, s.things);
        s.columns.forEach((c, j) => checkStatRef(`${p}.columns[${j}].stat`, c.stat, selected, "column"));
        duplicates(s.columns.map((c) => c.stat)).forEach((k) =>
          err(S, `${p}.columns`, `stat ${lit(k)} is a column twice`),
        );
        break;
      }
      case "featureTable": {
        const selected = checkOptionSource(S, `${p}.things`, s.things);
        if (s.uses !== undefined) checkStatRef(`${p}.uses`, s.uses, selected, "uses");
        if (s.byRank && !selected.some((t) => t.rank !== undefined))
          err(S, `${p}.byRank`, "none of the things selected here has a rank");
        s.marks?.forEach((mark, j) => checkMarkCondition(mark, `${p}.marks[${j}]`));
        if (s.lead !== undefined) checkOptionSource(S, `${p}.lead.things`, s.lead.things);
        if (s.note !== undefined) checkStatRef(`${p}.note`, s.note, selected, "note");
        if (s.byRank && s.groupBy !== undefined)
          err(S, `${p}.groupBy`, 'rows are grouped one way: "byRank" or "groupBy", not both');
        break;
      }
      case "list":
        checkOptionSource(S, `${p}.things`, s.things);
        break;
      case "answers":
        s.choices.forEach((cid, j) => {
          const c = choiceById.get(cid);
          if (!c) err(S, `${p}.choices[${j}]`, `unknown choice ${lit(cid)}`);
          // Picks among what the character has (options.owned) are printed nowhere else.
          else if (c.kind !== "text" && c.kind !== "number" && !("options" in c && c.options.owned)) {
            err(
              S,
              `${p}.choices[${j}]`,
              `choice ${lit(cid)} is ${c.kind}; answers shows text and number choices and picks with options.owned`,
            );
          }
        });
        break;
      default:
        break;
    }
  });
  for (const [kind, layout] of Object.entries(sheet.cards)) {
    if (!manifest.kinds.includes(kind)) err(S, `cards.${kind}`, `unknown kind ${lit(kind)}`);
    layout.origins?.forEach((o, j) => {
      checkMarkCondition(o, `cards.${kind}.origins[${j}]`);
      checkFilledText(S, `cards.${kind}.origins[${j}].text`, o.text);
    });
    // The first entry that matches wins: a second one with the same condition would never be printed.
    duplicates((layout.origins ?? []).map(({ label: _, text: __, ...cond }) => canonical(cond))).forEach(() =>
      err(S, `cards.${kind}.origins`, "two entries have the same condition; the second is never printed"),
    );
    layout.fields.forEach((f, j) => {
      if (!statKeys.has(f)) err(S, `cards.${kind}.fields[${j}]`, `no thing has a stat ${lit(f)}`);
    });
    if (layout.uses !== undefined) {
      const carded = [...thingById.values()].filter((t) => t.kind === kind && t.card);
      checkStatRef(`cards.${kind}.uses`, layout.uses, carded, "uses");
    }
  }

  // ------------------------------------------------------------------ texts
  const required = new Map<string, string>(); // key → what it is for
  const optional = new Set<string>();
  const need = (key: string, what: string) => required.set(key, what);
  need("package.name", "name of the package");
  need("package.short", "one-sentence description of the package");
  need("level.name", "word for level");
  need("level.intro", "introduction on the level screen");
  need("level.hint", "hint on the level screen");
  // Common levels, shown as big cards on the level screen with this text.
  for (let n = flow.level.min; n <= flow.level.max; n++) optional.add(`level.pick.${n}`);
  // Headings of long option lists grouped by rank: "Rank 3", or a name of its own per rank.
  optional.add("rank.name");
  for (const r of new Set([...thingById.values()].flatMap((t) => (t.rank !== undefined ? [t.rank] : []))))
    optional.add(`rank.${r}.name`);
  need("summary.line", "summary line in the character list");
  need("sheet.attribution", "source and license line on the sheet");
  for (const k of manifest.kinds) need(`kind.${k}.name`, `name of kind ${lit(k)}`);
  const needExplained = (prefix: string, what: string) => {
    need(`${prefix}.name`, `name of ${what}`);
    need(`${prefix}.short`, `one-sentence summary of ${what}`);
    need(`${prefix}.explain.what`, `plain-language "what it is" of ${what}`);
    need(`${prefix}.explain.table`, `plain-language "at the table" of ${what}`);
    optional.add(`${prefix}.explain.example`);
  };
  for (const t of thingById.values()) {
    needExplained(t.id, `thing ${lit(t.id)}`);
    if (t.addRequires !== undefined) need(`${t.id}.addReason`, `why ${lit(t.id)} cannot be added`);
    optional.add(`${t.id}.goodIf`).add(`${t.id}.rules`);
    for (const input of t.textInputs ?? []) {
      need(`${t.id}.input.${input.id}.label`, `label of text ${lit(input.id)} of ${lit(t.id)}`);
      optional.add(`${t.id}.input.${input.id}.placeholder`);
    }
  }
  for (const c of flow.choices) {
    need(`choice.${c.id}.title`, `step title of choice ${lit(c.id)}`);
    need(`choice.${c.id}.question`, `question of choice ${lit(c.id)}`);
    need(`choice.${c.id}.intro`, `introduction of choice ${lit(c.id)}`);
    optional.add(`choice.${c.id}.missing`);
    if (c.gather !== undefined) optional.add(`choice.${c.id}.from`);
    if (c.kind === "pickOne" || c.kind === "pickMany") {
      for (const b of c.badges ?? []) need(b.text, `badge of choice ${lit(c.id)}`);
      if (c.held) need(c.held.text, `line naming what the character has, in choice ${lit(c.id)}`);
    }
    if (c.kind === "distribute") {
      for (const b of c.badges ?? []) need(b.text, `badge of choice ${lit(c.id)}`);
      for (const v of c.targets) optional.add(`choice.${c.id}.target.${v}`);
    }
  }
  // A variant replaces any of the four texts (and the row texts of a distribute choice); which ones is up to the package.
  const variantTexts = flow.choices.flatMap((c) =>
    (c.textVariants ?? []).map((v) => ({
      choice: c.id,
      variant: v.id,
      keys: [
        ...["title", "question", "intro", "missing"],
        ...(c.kind === "distribute" ? c.targets.map((t) => `target.${t}`) : []),
      ].map((f) => `choice.${c.id}.variant.${v.id}.${f}`),
    })),
  );
  for (const v of variantTexts) for (const k of v.keys) optional.add(k);
  for (const s of flow.steps) {
    if ("gather" in s ? s.together !== undefined : s.choices.length > 1) {
      need(`step.${s.id}.title`, `title of step ${lit(s.id)}`);
      need(`step.${s.id}.question`, `question of step ${lit(s.id)}`);
      need(`step.${s.id}.intro`, `introduction of step ${lit(s.id)}`);
    } else if ("gather" in s) optional.add(`step.${s.id}.title`);
  }
  for (const g of groups) need(`group.${g}.name`, `heading of option group ${lit(g)}`);
  for (const v of values) {
    need(`value.${v.id}.name`, `name of value ${lit(v.id)}`);
    optional.add(`value.${v.id}.explain`);
    optional.add(`value.${v.id}.amount`);
  }
  for (const s of statKeys) need(`stat.${s}.name`, `label of stat ${lit(s)}`);
  for (const k of statTextKeys) need(k, "stat text");
  for (const k of suggestionKeys) need(k, "list of suggestions");
  for (const u of unitDim.keys()) {
    need(`unit.${u}.short`, `short form of unit ${lit(u)}`);
    need(`unit.${u}.long`, `long form of unit ${lit(u)}`);
    optional.add(`unit.${u}.longOne`);
  }
  for (const g of glossaryIds) needExplained(`glossary.${g}`, `glossary entry ${lit(g)}`);
  for (const s of sheet.sections) {
    if (s.kind !== "header") need(`sheet.${s.id}.title`, `title of sheet section ${lit(s.id)}`);
    if (s.kind === "helpBox") need(`sheet.${s.id}.text`, `text of help box ${lit(s.id)}`);
    if (s.kind === "statBoxes")
      for (const b of s.boxes)
        if (b.label !== undefined)
          need(b.label, `label of box ${lit(b.value)} in sheet section ${lit(s.id)}`);
    if (s.kind === "featureTable") {
      const selected = resolveOptions(s.things);
      if (s.byRank) {
        // Each group is headed by `rank.<n>.name`, or by `rank.name` and the number.
        need("rank.name", `word for rank, heading the groups of sheet section ${lit(s.id)}`);
        for (const r of new Set(selected.flatMap((t) => (t.rank !== undefined ? [t.rank] : []))))
          optional.add(`sheet.${s.id}.rank.${r}.hint`);
      }
      for (const m of s.marks ?? []) {
        need(m.text, `sign of a mark in sheet section ${lit(s.id)}`);
        need(m.legend, `legend of a mark in sheet section ${lit(s.id)}`);
      }
      if (s.lead !== undefined)
        for (const t of resolveOptions(s.lead.things)) optional.add(`${t.id}.${s.lead.text}`);
    }
    if (s.kind === "list" && s.detail !== undefined)
      for (const t of resolveOptions(s.things)) optional.add(`${t.id}.${s.detail}`);
    if (s.kind === "header")
      for (const f of s.fields ?? [])
        if (f.label !== undefined)
          need(
            f.label,
            `label of header field ${lit("choice" in f ? f.choice : "tracks" in f ? "tracks" : (f.things.kind ?? "things"))}`,
          );
    if (s.kind === "checkList" && s.strongLegend !== undefined)
      need(s.strongLegend, `legend of the double mark in sheet section ${lit(s.id)}`);
    if (s.kind === "scoreColumn")
      for (const sc of s.scores) {
        if (sc.derivedLabel !== undefined)
          need(sc.derivedLabel, `label of ${lit(sc.derived ?? "")} in sheet section ${lit(s.id)}`);
        if (sc.extraLabel !== undefined)
          need(sc.extraLabel, `label of ${lit(sc.extra ?? "")} in sheet section ${lit(s.id)}`);
      }
    optional.add(`sheet.${s.id}.hint`);
  }
  for (const [kind, layout] of Object.entries(sheet.cards)) {
    need(`card.${kind}.typeLine`, `type line of ${lit(kind)} cards`);
    optional.add(`card.${kind}.hint`);
    for (const o of layout.origins ?? [])
      if (o.label !== undefined) need(o.label, `label of an origin line on ${lit(kind)} cards`);
  }

  const texts: Record<string, Record<string, TextValue>> = {};
  const textOrigins: Record<string, Record<string, TextOrigin>> = {};
  const declaredLangs = new Set(textFiles.map((f) => f.split("/")[1]!));
  for (const lang of declaredLangs) {
    if (!manifest.languages.includes(lang))
      warn(`texts/${lang}/`, "", `language ${lit(lang)} is not in manifest.languages`);
  }
  for (const { file, lang, data } of parsedTexts) {
    checkProvenance(file, "", data.source, data.license);
    const bucket = (texts[lang] ??= {});
    const origins = (textOrigins[lang] ??= {});
    const license = data.license ?? manifest.sources[data.source]?.license ?? "";
    for (const [key, value] of Object.entries(data.entries)) {
      if (key in bucket) {
        err(file, `entries.${key}`, `text ${lit(key)} is also defined in ${origins[key]!.file}`);
        continue;
      }
      bucket[key] = value;
      origins[key] = { file, source: data.source, license };
    }
  }
  // A variant text one language has, every language needs: the screen must not fall back to
  // the base text in one language only.
  for (const v of variantTexts) {
    const present = v.keys.filter((k) => Object.values(texts).some((bucket) => k in bucket));
    if (present.length === 0) {
      const i = flow.choices.findIndex((c) => c.id === v.choice);
      warn(
        F,
        `choices[${i}].textVariants`,
        `text variant ${lit(v.variant)} has no texts and changes nothing`,
      );
    }
    for (const k of present) need(k, `text of variant ${lit(v.variant)} of choice ${lit(v.choice)}`);
  }

  // A list's `detail` that no listed thing has a text for prints nothing: likely a typo.
  sheet.sections.forEach((s, i) => {
    if (s.kind !== "list" || s.detail === undefined) return;
    const keys = resolveOptions(s.things).map((t) => `${t.id}.${s.detail}`);
    if (!keys.some((k) => Object.values(texts).some((bucket) => typeof bucket[k] === "string")))
      warn(S, `sections[${i}].detail`, `no thing listed here has a text ${lit(`<thing>.${s.detail}`)}`);
  });

  // Unit words written as text next to a number, e.g. "9 m" instead of {{length:30}}.
  const unitWords = new Set<string>();
  for (const bucket of Object.values(texts)) {
    for (const u of unitDim.keys()) {
      for (const form of ["short", "long", "longOne"]) {
        const w = bucket[`unit.${u}.${form}`];
        if (typeof w === "string") unitWords.add(w);
      }
    }
  }
  const escaped = [...unitWords].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fixedUnit =
    escaped.length > 0 ? new RegExp(`\\d\\s*(?:${escaped.join("|")})(?![\\p{L}])`, "u") : undefined;
  // The package name may spell out what the package is; the sheet header fits it to its box.
  const LIMITS: [RegExp, number][] = [
    [/^(?!package\.)[^]*\.name$/, 30],
    [/\.goodIf$/, 80],
  ];
  // A thing a feature table prints and no card explains is used at the table from its short
  // text alone, so that text may carry every limit of the rule (10.3).
  const printedAlone = new Set(
    sheet.sections.flatMap((s) =>
      s.kind === "featureTable"
        ? resolveOptions(s.things).flatMap((t) => (t.card ? [] : [`${t.id}.short`]))
        : [],
    ),
  );
  // Official rules texts stay verbatim; their plain units are counted per file, not listed.
  const rulesKeys = new Set([...thingById.values()].map((t) => `${t.id}.rules`));
  const verbatimUnits = new Map<string, number>(); // file → rules texts with a plain unit

  const quantitiesByKey = new Map<string, Map<string, string>>(); // key → lang → quantities signature
  for (const lang of manifest.languages) {
    const bucket = texts[lang];
    if (!bucket) {
      err(`texts/${lang}/`, "", `no texts for language ${lit(lang)}; add texts/${lang}/<name>.json`);
      continue;
    }
    const where = (key: string) => textOrigins[lang]![key]?.file ?? `texts/${lang}/`;
    for (const [key, what] of required) {
      if (!(key in bucket)) err(`texts/${lang}/`, key, `missing text (${what})`);
      else if (bucket[key] === null)
        warn(where(key), `entries.${key}`, `marked missing, not translated yet (${what})`);
    }
    for (const [key, value] of Object.entries(bucket)) {
      const file = where(key);
      const p = `entries.${key}`;
      if (!required.has(key) && !optional.has(key))
        warn(file, p, "text is not used by anything in the package");
      if (value === null) continue;
      if (typeof value === "string") {
        const shown = visibleText(value);
        const limits: [RegExp, number][] = [...LIMITS, [/\.short$/, printedAlone.has(key) ? 240 : 120]];
        for (const [re, max] of limits) {
          if (re.test(key) && !key.startsWith("unit.") && shown.length > max) {
            warn(file, p, `is ${shown.length} characters long as shown; the style limit is ${max}`);
          }
        }
        if (printedAlone.has(key) && sentences(shown).length > 3) {
          warn(file, p, `has ${sentences(shown).length} sentences; the style limit is 3`);
        }
        if (fixedUnit?.test(value.replace(/\{\{[^}]*\}\}/g, "")) && !key.startsWith("unit.")) {
          if (rulesKeys.has(key)) verbatimUnits.set(file, (verbatimUnits.get(file) ?? 0) + 1);
          else
            warn(file, p, "states a unit as plain text; use a placeholder like {{length:30}} so it converts");
        }
      }
      if (/\.explain\.what$/.test(key)) {
        const base = key.slice(0, -".what".length);
        const total = ["what", "table", "example"]
          .map((part) => bucket[`${base}.${part}`])
          .reduce<number>((n, t) => n + (typeof t === "string" ? t.length : 0), 0);
        if (total > 400)
          warn(file, `entries.${base}`, `explanation is ${total} characters long; the style limit is 400`);
      }
      if (suggestionKeys.has(key) !== Array.isArray(value)) {
        err(
          file,
          p,
          suggestionKeys.has(key) ? "must be a list of strings" : "must be a single string, not a list",
        );
      }
      const quantities: string[] = [];
      for (const str of Array.isArray(value) ? value : [value]) {
        let parts;
        try {
          parts = parseTemplate(str);
        } catch (e) {
          if (e instanceof TemplateSyntaxError) {
            err(file, p, e.message);
            continue;
          }
          throw e;
        }
        // The reason a track cannot be added is shown and sent (API) as plain text: a link or a
        // placeholder would appear as raw markup (AND-304).
        if (key.endsWith(".addReason") && parts.some((part) => part.type !== "text")) {
          err(
            file,
            p,
            "is shown as plain text; write it without [[glossary:…]] links and {{…}} placeholders",
          );
        }
        for (const part of parts) {
          // A stat text gets its variables from the stat's `vars`; any other name stays empty.
          const supplied = statTextVars.get(key);
          if (part.type === "var" && supplied && !supplied.has(part.name)) {
            err(file, p, `uses {{var:${part.name}}}, but no stat with this text supplies ${lit(part.name)}`);
          }
          if (part.type === "glossary" && !glossaryIds.has(part.id)) {
            err(file, p, `links unknown glossary entry ${lit(part.id)}`);
          }
          if (part.type === "quantity") {
            const dim = units.dimensions[part.dimension];
            if (!dim)
              err(
                file,
                p,
                `unknown dimension ${lit(part.dimension)} in {{${part.dimension}:${part.amount}}}`,
              );
            else checkAmount(file, p, part.amount, dim.source);
            quantities.push(`${part.dimension}:${part.amount}`);
          }
        }
      }
      const perLang = quantitiesByKey.get(key) ?? new Map<string, string>();
      perLang.set(lang, quantities.sort().join(","));
      quantitiesByKey.set(key, perLang);
    }
  }
  for (const [key, perLang] of quantitiesByKey) {
    const sigs = new Set(perLang.values());
    if (perLang.size > 1 && sigs.size > 1) {
      const detail = [...perLang].map(([l, s]) => `${l}: ${s || "none"}`).join("; ");
      warn("texts/", key, `languages state different quantities (${detail})`);
    }
  }
  for (const [file, n] of verbatimUnits) {
    warn(
      file,
      "",
      `${n} official rules text(s) state a unit as plain text; they stay verbatim, so readers see that unit unconverted`,
    );
  }

  return finish({
    manifest,
    units,
    values,
    things: [...thingById.values()],
    flow,
    sheet,
    glossary,
    texts,
    textOrigins,
  });
}

function duplicates<T>(list: readonly T[]): T[] {
  const seen = new Set<T>();
  const dup = new Set<T>();
  for (const x of list) (seen.has(x) ? dup : seen).add(x);
  return [...dup];
}

/** The same JSON for the same data: keys sorted, lists of names sorted (their order says nothing). */
function canonical(x: unknown): string {
  if (Array.isArray(x)) {
    const items = x.map(canonical);
    return `[${(x.every((i) => typeof i === "string") ? items.sort() : items).join(",")}]`;
  }
  if (x !== null && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}

function known(set: Iterable<string> | Map<string, unknown> | Record<string, unknown>): string {
  const keys =
    set instanceof Map
      ? [...set.keys()]
      : Symbol.iterator in Object(set)
        ? [...(set as Iterable<string>)]
        : Object.keys(set);
  if (keys.length === 0) return "";
  const shown = keys.slice(0, 8).join(", ");
  return ` (known: ${shown}${keys.length > 8 ? ", …" : ""})`;
}

function formulaCycles(values: readonly Value[]): string[][] {
  const deps = new Map<string, string[]>();
  for (const v of values) {
    if (v.byValue !== undefined) deps.set(v.id, [v.byValue]);
    if (v.formula === undefined) continue;
    try {
      deps.set(v.id, [...collectRefs(parseExpr(v.formula)).values]);
    } catch {
      // Syntax errors are reported elsewhere.
    }
  }
  const cycles: string[][] = [];
  const state = new Map<string, "active" | "done">();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "active") {
      cycles.push([...stack.slice(stack.indexOf(id)), id]);
      return;
    }
    state.set(id, "active");
    stack.push(id);
    for (const d of deps.get(id) ?? []) visit(d);
    stack.pop();
    state.set(id, "done");
  };
  for (const id of deps.keys()) visit(id);
  return cycles;
}
