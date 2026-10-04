import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { isUiLanguage, MESSAGES, pickLanguage } from "../src/i18n/index.ts";
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

/** Before login: the language chosen earlier (cookie), else the browser's, else German. */
async function initialLanguage() {
  const chosen = (await cookies()).get(LANGUAGE_COOKIE)?.value;
  if (isUiLanguage(chosen)) return chosen;
  return pickLanguage((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: MESSAGES[await initialLanguage()]["app.name"] };
}

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const lang = await initialLanguage();
  return (
    <html lang={lang}>
      <body>
        <AppStateProvider initialLanguage={lang}>
          <GlossaryProvider>{children}</GlossaryProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
