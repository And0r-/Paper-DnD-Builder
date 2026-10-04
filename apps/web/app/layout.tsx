import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { MESSAGES } from "../src/i18n/index.ts";
import { firstPaint } from "../src/server/screen-language.ts";
import { AppStateProvider, LANGUAGE_COOKIE } from "../src/ui/app-state.tsx";
import { GlossaryProvider } from "../src/ui/components/RichText.tsx";
import "../src/ui/styles/tokens.css";
import "../src/ui/styles/base.css";
import "../src/ui/styles/components.css";
import "../src/ui/styles/flow.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfaf7",
};

/** The account's language when logged in; before login the one chosen earlier, else the browser's. */
async function initialState() {
  const h = await headers();
  return firstPaint(h.get("cookie"), (await cookies()).get(LANGUAGE_COOKIE)?.value, h.get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: MESSAGES[(await initialState()).language]["app.name"] };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { language: lang, maybeSignedIn } = await initialState();
  return (
    <html lang={lang}>
      <body>
        <AppStateProvider initialLanguage={lang} maybeSignedIn={maybeSignedIn}>
          <GlossaryProvider>{children}</GlossaryProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
