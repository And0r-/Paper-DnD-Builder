"use client";
/**
 * When even the root layout failed (for example its code could not be
 * loaded after the server was rebuilt). Replaces the whole document, so it
 * brings its own <html>, styles and language: without it Next.js shows its
 * built-in page, in English only.
 */
import { useMemo, useSyncExternalStore } from "react";
import { DEFAULT_LANGUAGE, translator } from "../src/i18n/index.ts";
import { documentLanguage, PageError, useReloadOnChunkError } from "../src/ui/components/PageError.tsx";
import "../src/ui/styles/tokens.css";
import "../src/ui/styles/base.css";
import "../src/ui/styles/components.css";

const noSubscription = () => () => {};

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Read once from the page that failed; on the server the default language.
  const lang = useSyncExternalStore(noSubscription, documentLanguage, () => DEFAULT_LANGUAGE);
  const { t } = useMemo(() => translator(lang), [lang]);
  useReloadOnChunkError(error);
  return (
    <html lang={lang}>
      <body>
        <title>{t("app.name")}</title>
        <div className="guest">
          <main id="main" className="guest__main" tabIndex={-1}>
            <div className="auth">
              <PageError t={t} />
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
