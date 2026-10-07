"use client";
/**
 * Help from a language model, in the settings above the access keys: a link
 * to the public MCP zip (`GET /downloads/builder-mcp.zip`, the same for
 * everyone, no key in it). The page /mcp/setup takes this place later.
 */
import { useApp } from "../app-state.tsx";
import { Icon } from "./Icon.tsx";

export const MCP_ZIP_PATH = "/downloads/builder-mcp.zip";

export function LanguageModelHelp() {
  const { t } = useApp();
  return (
    <section className="settings__section" aria-labelledby="s-language-model">
      <h2 className="section-title" id="s-language-model">
        {t("settings.languageModel")}
      </h2>
      <p>{t("settings.languageModelText")}</p>
      <div>
        {/* A real link: saved by the browser as the file it is, and its address can be copied. */}
        <a className="btn btn--secondary" href={MCP_ZIP_PATH} download>
          <Icon name="download" />
          <span>{t("settings.languageModelDownload")}</span>
        </a>
      </div>
    </section>
  );
}
