import type { ContentPackage } from "@builder/format";
import { HttpError, json } from "../http.ts";
import type { RequestContext, Route } from "../router.ts";

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
      const packages = [...ctx.app.packages.packages.values()].map(({ pkg }) => {
        const m = pkg.manifest;
        // One language on screen: the wanted one if the package has it, else its first.
        const lang = wanted && m.languages.includes(wanted) ? wanted : m.languages[0]!;
        return {
          id: m.id,
          version: m.version,
          formatVersion: m.formatVersion,
          languages: m.languages,
          language: lang,
          name: text(pkg, lang, "package.name"),
          short: text(pkg, lang, "package.short"),
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
      return json(200, { package: { manifest, units, values, things, flow, sheet, glossary } });
    },
  },
  {
    // Texts of exactly one language; missing texts stay null (never filled from another language).
    method: "GET",
    path: "/api/packages/:id/texts/:lang",
    handler: async (ctx) => {
      await ctx.requireSession();
      const pkg = requirePackage(ctx);
      const lang = ctx.params["lang"]!;
      const texts = pkg.texts[lang];
      if (!pkg.manifest.languages.includes(lang) || !texts) throw new HttpError(404, "languageNotFound");
      return json(200, { language: lang, texts });
    },
  },
];
