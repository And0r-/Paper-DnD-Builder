"use client";
/**
 * How to connect a language model over MCP: what it is, the address, the
 * key, a short block per program, the zip to run it yourself, and privacy.
 * Readable without an account; logged in, it sits in the app frame with the
 * menu and links straight to making a key.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { usePageTitle } from "../flow/frame.tsx";
import { ButtonLink } from "./Button.tsx";
import { CopyText } from "./CopyText.tsx";
import { Callout, Loading } from "./Feedback.tsx";
import { Icon } from "./Icon.tsx";
import { API_DOCS_PATH, AppShell, GuestShell } from "./Shell.tsx";

/** The public zip (GET, the same for everyone, no key in it). */
export const MCP_ZIP_PATH = "/downloads/builder-mcp.zip";
/** Where the settings open the form for a new key. */
export const NEW_KEY_ANCHOR = "new-key";

export function McpSetup({ origin }: { origin: string }) {
  const { t, account, accountError } = useApp();
  usePageTitle([t("mcp.title")]);
  const url = `${origin}/mcp`;
  const key = t("mcp.keyPlaceholder");
  const name = t("mcp.serverName");
  const signedIn = Boolean(account);

  const claudeCode = `claude mcp add --transport http ${name} ${url} --header "Authorization: Bearer ${key}"`;
  const cursor = JSON.stringify(
    { mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );

  const content = (
    <article className="mcp-setup prose">
      <h1 className="page__title">{t("mcp.title")}</h1>
      {/* A newcomer who ended up here learns first that they can leave (AND-272). */}
      <Callout tone="info">
        <p>{t("mcp.onlyIf")}</p>
        <p>
          <Link href={signedIn ? "/characters" : "/login"}>
            {signedIn ? t("mcp.toCharacters") : t("mcp.keyLoginButton")}
          </Link>
        </p>
      </Callout>
      <p className="mcp-setup__lead">{t("mcp.intro")}</p>
      <p>{t("mcp.choose")}</p>
      <p className="note">{t("mcp.what")}</p>

      <Section id="mcp-address" title={t("mcp.address")}>
        <p>{t("mcp.addressText")}</p>
        <CopyText label={t("mcp.addressLabel")} value={url} />
      </Section>

      <Section id="mcp-key" title={t("mcp.key")}>
        <p>{t("mcp.keyText")}</p>
        {signedIn ? (
          <div>
            <ButtonLink variant="secondary" icon="plus" href={`/settings#${NEW_KEY_ANCHOR}`}>
              {t("mcp.keyCreate")}
            </ButtonLink>
          </div>
        ) : (
          <>
            <p>{t("mcp.keyLogin")}</p>
            <div>
              <ButtonLink variant="secondary" href="/login">
                {t("mcp.keyLoginButton")}
              </ButtonLink>
            </div>
          </>
        )}
      </Section>

      <Section id="mcp-programs" title={t("mcp.programs")}>
        <p>{t("mcp.programsText", { key })}</p>
        <Program title="Claude Code">
          <p>{t("mcp.claudeCodeText")}</p>
          <CopyText label={t("mcp.claudeCodeLabel")} value={claudeCode} />
        </Program>
        <Program title="Cursor">
          <p>{t("mcp.cursorText")}</p>
          <CopyText label={t("mcp.cursorLabel")} value={cursor} />
        </Program>
        <Program title="Open WebUI">
          <p>{t("mcp.openWebUiText")}</p>
        </Program>
        <Program title={t("mcp.otherPrograms")}>
          <p>{t("mcp.otherText")}</p>
          <CopyText label={t("mcp.otherLabel")} value={`Authorization: Bearer ${key}`} />
          <p>
            {t("mcp.otherApi")} <a href={API_DOCS_PATH}>{t("menu.api")}</a>.
          </p>
        </Program>
        <Program title={t("mcp.local")}>
          <p>{t("mcp.localText")}</p>
        </Program>
      </Section>

      <Section id="mcp-self" title={t("mcp.self")}>
        <div>
          {/* A real link: saved by the browser as the file it is, and its address can be copied. */}
          <a className="btn btn--secondary" href={MCP_ZIP_PATH} download>
            <Icon name="download" />
            <span>{t("mcp.download")}</span>
          </a>
        </div>
        <p>{t("mcp.selfText")}</p>
        <ul>
          <li>{t("mcp.selfPrivate")}</li>
          <li>{t("mcp.selfPublic")}</li>
          <li>{t("mcp.selfForeign")}</li>
        </ul>
      </Section>

      <Callout tone="info" title={t("mcp.privacy")}>
        <p>{t("mcp.privacyText")}</p>
        <p className="mcp-setup__key">{t("mcp.privacyKey")}</p>
        <p className="mcp-setup__links">
          <Link href="/privacy">{t("mcp.privacyLink")}</Link>
          {signedIn && <Link href={`/settings#${NEW_KEY_ANCHOR}`}>{t("mcp.keysLink")}</Link>}
        </p>
      </Callout>
    </article>
  );

  // Not yet known whether logged in: no frame that would swap a moment later.
  if (account === undefined && !accountError) {
    return (
      <div className="page-loading">
        <Loading shape="page" count={2} />
      </div>
    );
  }
  // Logged in: the app frame with the menu. Otherwise the open frame with the language switch.
  if (signedIn) {
    return (
      <AppShell>
        <div className="page">{content}</div>
      </AppShell>
    );
  }
  return (
    <GuestShell>
      <div className="auth auth--wide">
        <div className="auth__card">{content}</div>
      </div>
    </GuestShell>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="mcp-setup__section" aria-labelledby={id}>
      <h2 className="section-title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Program({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mcp-setup__program">
      <h3 className="mcp-setup__program-title">{title}</h3>
      {children}
    </div>
  );
}
