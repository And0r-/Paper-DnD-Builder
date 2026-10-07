"use client";
/**
 * Help from a language model, in the settings above the access keys: download
 * the package with the program a language model runs on the player's own
 * computer (see API.md, `POST /api/account/mcp-package`). With a key in it, the
 * key is shown once here and then stands in the list of access keys below.
 */
import { useId, useState } from "react";
import { useApp } from "../app-state.tsx";
import { ApiError } from "../api.ts";
import { fileNameOf } from "../flow/file-name.ts";
import { Button } from "./Button.tsx";
import { Callout } from "./Feedback.tsx";
import { FreshKey } from "./FreshKey.tsx";
import { Icon } from "./Icon.tsx";

const PATH = "/api/account/mcp-package";

/** The package as a file, and the new key when the server made one. */
async function fetchPackage(withKey: boolean): Promise<{ blob: Blob; name: string; key: string | null }> {
  let res: Response;
  try {
    res = await fetch(PATH, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ withKey }),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) {
    let error: ({ code?: string } & Record<string, unknown>) | undefined;
    try {
      error = ((await res.json()) as { error?: typeof error }).error;
    } catch {
      error = undefined;
    }
    throw new ApiError(res.status, error?.code ?? (res.status >= 500 ? "server" : "unknown"), error ?? {});
  }
  return {
    blob: await res.blob(),
    name: fileNameOf(res.headers.get("content-disposition"), "builder-mcp.zip"),
    key: res.headers.get("X-Builder-Key"),
  };
}

export function LanguageModelHelp({ onKeyMade }: { onKeyMade: () => void }) {
  const { t } = useApp();
  const id = useId();
  const [withKey, setWithKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [fresh, setFresh] = useState<string>();

  async function download() {
    setBusy(true);
    setError(undefined);
    setDone(false);
    setFresh(undefined);
    try {
      const pkg = await fetchPackage(withKey);
      const url = URL.createObjectURL(pkg.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pkg.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setDone(true);
      if (pkg.key) {
        setFresh(pkg.key);
        onKeyMade();
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : "";
      setError(
        code === "tooManyKeys"
          ? t("settings.languageModelTooMany", {
              max: Number((e as ApiError).details["max"]),
              section: t("settings.keys"),
            })
          : code === "baseUrlNotSet" || code === "mcpPackageMissing"
            ? t("settings.languageModelUnavailable")
            : t("settings.saveError"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings__section" aria-labelledby="s-language-model">
      <h2 className="section-title" id="s-language-model">
        {t("settings.languageModel")}
      </h2>
      <p>{t("settings.languageModelText")}</p>

      <div className={`option option--compact${withKey ? " option--checked" : ""}`}>
        <div className="option__head">
          <input
            className="option__input"
            type="checkbox"
            id={`${id}-key`}
            checked={withKey}
            onChange={() => setWithKey((k) => !k)}
            aria-describedby={`${id}-key-text`}
          />
          <span className="option__mark" aria-hidden="true">
            {withKey && <Icon name="check" size={18} />}
          </span>
          <label className="option__name" htmlFor={`${id}-key`}>
            {t("settings.languageModelWithKey")}
          </label>
        </div>
        <p className="option__short" id={`${id}-key-text`}>
          {withKey ? t("settings.languageModelWithKeyText") : t("settings.languageModelWithoutKeyText")}
        </p>
      </div>

      <div>
        <Button
          variant="secondary"
          icon="download"
          busy={busy}
          busyLabel={t("settings.languageModelPreparing")}
          onClick={() => void download()}
        >
          {t("settings.languageModelDownload")}
        </Button>
      </div>

      <div aria-live="polite">
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        {done && <Callout tone="success">{t("settings.languageModelDone")}</Callout>}
      </div>

      {fresh && (
        <FreshKey
          key={fresh}
          secret={fresh}
          title={t("settings.languageModelKeyTitle")}
          label={t("settings.languageModelKeyText")}
          onDone={() => setFresh(undefined)}
        >
          <p>{t("settings.languageModelKeyListed", { section: t("settings.keys") })}</p>
        </FreshKey>
      )}
    </section>
  );
}
