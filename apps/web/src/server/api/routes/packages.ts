import { shownLanguage, type ContentPackage } from "@builder/format";
import { HttpError, json } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";

/** A base package (`demo`) or a base with extensions (`demo+demo-tides`), as a draft names it. */
function requirePackage(ctx: RequestContext): ContentPackage {
  const pkg = ctx.app.packages.get(ctx.params["id"]!);
  if (!pkg) throw new HttpError(404, "packageNotFound");
  return pkg;
}

const text = (pkg: ContentPackage, lang: string, key: string) => {
  const t = pkg.texts[lang]?.[key];
  return typeof t === "string" ? t : null;
};

export const packageRoutes: Route[] = [
  {
    // Public: the start screen may list what can be built before anyone logs in.
    method: "GET",
    path: "/api/packages",
    handler: async (ctx) => {
      const wanted = ctx.url.searchParams.get("lang") ?? (await ctx.session())?.account.language;
      const extensions = [...ctx.app.packages.extensions.values()];
      const packages = [...ctx.app.packages.packages.values()].map(({ pkg }) => {
        const m = pkg.manifest;
        // One language on screen: the wanted one if the package has it, else English, else its first.
        const lang = shownLanguage(m.languages, wanted);
        return {
          id: m.id,
          version: m.version,
          formatVersion: m.formatVersion,
          languages: m.languages,
          language: lang,
          name: text(pkg, lang, "package.name"),
          short: text(pkg, lang, "package.short"),
          // What a character of this package may switch on (SPEC 17), named in the same language.
          extensions: extensions
            .filter((e) => e.base === m.id)
            .map(({ info, dependsOn }) => ({
              id: info.id,
              version: info.version,
              languages: info.languages,
              dependsOn,
              publishable: info.publishable,
              name: info.name[lang] ?? null,
              short: info.short[lang] ?? null,
            })),
        };
      });
      return json(200, { packages });
    },
  },
  {
    // Everything the screens need about a package except its texts.
    method: "GET",
    path: "/api/packages/:id",
    handler: async (ctx) => {
      await ctx.requireSession();
      const pkg = requirePackage(ctx);
      const { manifest, units, values, things, flow, sheet, glossary } = pkg;
      const extensions = pkg.extensions ?? [];
      return json(200, { package: { manifest, units, values, things, flow, sheet, glossary, extensions } });
    },
  },
  {
    // Texts of exactly one language; missing texts stay null. The one exception: an extension's
    // text this language lacks comes from the extension's fallback language, named in `fallbacks`.
    method: "GET",
    path: "/api/packages/:id/texts/:lang",
    handler: async (ctx) => {
      await ctx.requireSession();
      const pkg = requirePackage(ctx);
      const lang = ctx.params["lang"]!;
      const texts = pkg.texts[lang];
      if (!pkg.manifest.languages.includes(lang) || !texts) throw new HttpError(404, "languageNotFound");
      const fallbacks: Record<string, string> = {};
      for (const [key, o] of Object.entries(pkg.textOrigins[lang] ?? {}))
        if (o.fallbackFrom) fallbacks[key] = o.fallbackFrom;
      return json(200, { language: lang, texts, fallbacks });
    },
  },
];
