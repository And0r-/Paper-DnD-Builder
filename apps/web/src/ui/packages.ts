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

export async function loadPackage(id: string, lang: string): Promise<LoadedPackage> {
  const structure = await loadPackageStructure(id);
  const shown = packageLanguage(structure, lang);
  const t = await loadPackageTexts(id, shown);
  return {
    pkg: { ...structure, texts: { [shown]: t }, textOrigins: {} },
    lang: shown,
    texts: t,
  };
}

export type Loadable<T> =
  { state: "loading" } | { state: "error"; error: unknown; retry: () => void } | { state: "ready"; value: T };

/** Loads a package for the screen language; reloads when either changes. */
export function usePackage(id: string | undefined, lang: string): Loadable<LoadedPackage> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; value: Loadable<LoadedPackage> } | null>(null);
  const key = `${id}\n${lang}\n${attempt}`;

  useEffect(() => {
    if (!id) return;
    let live = true;
    loadPackage(id, lang).then(
      (value) => live && setResult({ key, value: { state: "ready", value } }),
      (error: unknown) =>
        live && setResult({ key, value: { state: "error", error, retry: () => setAttempt((n) => n + 1) } }),
    );
    return () => {
      live = false;
    };
  }, [id, lang, key]);

  if (result && result.key === key) return result.value;
  // While the other language loads, keep showing nothing rather than mixing languages.
  return { state: "loading" };
}
