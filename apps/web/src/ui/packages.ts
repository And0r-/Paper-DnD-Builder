"use client";
/**
 * Package data in the browser: the structure once per package, the texts
 * once per package and language. Kept for the whole visit; packages only
 * change when the server restarts.
 */
import type { ContentPackage } from "@builder/format/pure";
import { useEffect, useState } from "react";
import { api, type PackageListEntry, type PackageStructure, type PackageTexts } from "./api.ts";

const structures = new Map<string, Promise<PackageStructure>>();
const texts = new Map<string, Promise<PackageTexts>>();
const lists = new Map<string, Promise<PackageListEntry[]>>();

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = load();
    map.set(key, p);
    // A failed load is not remembered: "try again" must really try again.
    p.catch(() => map.delete(key));
  }
  return p;
}

export function loadPackageList(lang: string): Promise<PackageListEntry[]> {
  return cached(lists, lang, () =>
    api<{ packages: PackageListEntry[] }>("GET", `/api/packages?lang=${encodeURIComponent(lang)}`).then(
      (r) => r.packages,
    ),
  );
}

export function loadPackageStructure(id: string): Promise<PackageStructure> {
  return cached(structures, id, () =>
    api<{ package: PackageStructure }>("GET", `/api/packages/${encodeURIComponent(id)}`).then(
      (r) => r.package,
    ),
  );
}

export function loadPackageTexts(id: string, lang: string): Promise<PackageTexts> {
  return cached(texts, `${id}\n${lang}`, () =>
    api<{ texts: PackageTexts }>(
      "GET",
      `/api/packages/${encodeURIComponent(id)}/texts/${encodeURIComponent(lang)}`,
    ).then((r) => r.texts),
  );
}

/** A package with the texts of one language, ready for the rule core and for display. */
export interface LoadedPackage {
  pkg: ContentPackage;
  lang: string;
  texts: PackageTexts;
}

/** The language a package is shown in: the screen language if the package has it, else its first. */
export function packageLanguage(structure: PackageStructure, lang: string): string {
  return structure.manifest.languages.includes(lang) ? lang : structure.manifest.languages[0]!;
}

/** Packages already loaded, by id and screen language: a screen can show them without waiting a render. */
const ready = new Map<string, LoadedPackage>();

export async function loadPackage(id: string, lang: string): Promise<LoadedPackage> {
  const known = ready.get(`${id}\n${lang}`);
  if (known) return known;
  const structure = await loadPackageStructure(id);
  const shown = packageLanguage(structure, lang);
  const t = await loadPackageTexts(id, shown);
  const lp: LoadedPackage = {
    pkg: { ...structure, texts: { [shown]: t }, textOrigins: {} },
    lang: shown,
    texts: t,
  };
  ready.set(`${id}\n${lang}`, lp);
  return lp;
}

/**
 * Loads every package seen so far in another language, before the screen
 * switches to it. The switch then happens in one render: no screen falls
 * back to "loading" and loses what is open or typed on it.
 */
export async function preloadLanguage(lang: string): Promise<void> {
  await Promise.all([loadPackageList(lang), ...[...structures.keys()].map((id) => loadPackage(id, lang))]);
}

/**
 * The languages offered to switch to: those the builder has screen texts
 * for and every installed package has, too. The packages decide; the
 * builder's own list only rules out languages it cannot show.
 */
export function offeredLanguages<L extends string>(
  builder: readonly L[],
  packages: readonly PackageListEntry[],
): L[] {
  return builder.filter((l) => packages.every((p) => p.languages.includes(l)));
}

/** {@link offeredLanguages} for the installed packages; the builder's list until they are known. */
export function useOfferedLanguages<L extends string>(builder: readonly L[], lang: string): readonly L[] {
  const [packages, setPackages] = useState<readonly PackageListEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    loadPackageList(lang).then(
      (list) => live && setPackages(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [lang]);
  return packages ? offeredLanguages(builder, packages) : builder;
}

export type Loadable<T> =
  { state: "loading" } | { state: "error"; error: unknown; retry: () => void } | { state: "ready"; value: T };

/** Loads a package for the screen language; reloads when either changes. */
export function usePackage(id: string | undefined, lang: string): Loadable<LoadedPackage> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: Loadable<LoadedPackage> } | null>(null);
  const key = `${id}\n${lang}\n${attempt}`;
  const known = id ? ready.get(`${id}\n${lang}`) : undefined;

  useEffect(() => {
    if (!id || known) return;
    let live = true;
    loadPackage(id, lang).then(
      (value) => live && setResult({ key, value: { state: "ready", value } }),
      (error: unknown) =>
        live && setResult({ key, value: { state: "error", error, retry: () => setAttempt((n) => n + 1) } }),
    );
    return () => {
      live = false;
    };
  }, [id, lang, key, known]);

  if (known) return { state: "ready", value: known };
  if (result && result.key === key) return result.value;
  // While the other language loads, keep showing nothing rather than mixing languages.
  return { state: "loading" };
}
