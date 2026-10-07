"use client";
import { useRouter } from "next/navigation";
import { useApp } from "../../src/ui/app-state.tsx";
import { Button } from "../../src/ui/components/Button.tsx";
import { LanguageSelect } from "../../src/ui/components/LanguageSelect.tsx";
import { GuestShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";

/** "What we store": readable without logging in. */
export default function PrivacyPage() {
  const { t } = useApp();
  const router = useRouter();
  usePageTitle([t("privacy.title")]);
  return (
    <GuestShell corner={<LanguageSelect compact />}>
      <div className="auth auth--wide">
        <article className="auth__card prose">
          <h1 className="auth__title">{t("privacy.title")}</h1>
          <p className="auth__intro">{t("privacy.intro")}</p>
          <h2 className="section-title">{t("privacy.stored")}</h2>
          <ul>
            <li>{t("privacy.email")}</li>
            <li>{t("privacy.password")}</li>
            <li>{t("privacy.settings")}</li>
            <li>{t("privacy.characters")}</li>
            <li>{t("privacy.keys")}</li>
            <li>{t("privacy.campaigns")}</li>
            <li>{t("privacy.membership")}</li>
            <li>{t("privacy.invitations")}</li>
            <li>{t("privacy.cookies")}</li>
          </ul>
          <h2 className="section-title">{t("privacy.notStored")}</h2>
          <ul>
            <li>{t("privacy.noTracking")}</li>
            <li>{t("privacy.noThirdParty")}</li>
            <li>{t("privacy.languageModel")}</li>
          </ul>
          <p>{t("privacy.delete")}</p>
          <Button variant="secondary" icon="arrowLeft" onClick={() => router.back()}>
            {t("privacy.back")}
          </Button>
        </article>
      </div>
    </GuestShell>
  );
}
