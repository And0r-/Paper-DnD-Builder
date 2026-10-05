"use client";
/**
 * My campaigns: the ones I lead and the ones I play in, each in its own
 * group (common region), and a field to start a new one. A player sees
 * who leads each campaign and can leave it.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type Campaign, type CampaignView } from "../../src/ui/api.ts";
import { Button, ButtonLink } from "../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../src/ui/components/Dialog.tsx";
import { Callout, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { TextField, Toast } from "../../src/ui/components/Fields.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";

export default function CampaignsPage() {
  return <RequireAccount>{() => <Campaigns />}</RequireAccount>;
}

function Campaigns() {
  const { t, tc } = useApp();
  const router = useRouter();
  usePageTitle([t("campaigns.title")]);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [leave, setLeave] = useState<Campaign>();
  const [error, setError] = useState<string>();
  const [toast, setToast] = useState<string>();

  useEffect(() => {
    let live = true;
    api<{ campaigns: Campaign[] }>("GET", "/api/campaigns").then(
      (r) => live && (setCampaigns(r.campaigns), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(t("campaigns.nameMissing"));
      return;
    }
    setBusy(true);
    setNameError(undefined);
    try {
      const r = await api<CampaignView>("POST", "/api/campaigns", { name: trimmed });
      router.push(`/campaigns/${r.campaign.id}`);
    } catch (e) {
      setNameError(
        e instanceof ApiError && e.code === "tooManyCampaigns"
          ? t("campaigns.tooMany", { max: Number(e.details["max"]) })
          : t("common.loadError"),
      );
      setBusy(false);
    }
  }

  const leading = campaigns?.filter((c) => c.role === "gameMaster") ?? [];
  const playing = campaigns?.filter((c) => c.role === "player") ?? [];

  let list;
  if (failed)
    list = <ErrorState message={t("campaigns.loadError")} onRetry={() => setAttempt((n) => n + 1)} />;
  else if (!campaigns) list = <Loading shape="cards" count={2} />;
  else if (campaigns.length === 0) {
    list = (
      <div className="campaigns__empty">
        <p className="section-title">{t("campaigns.emptyTitle")}</p>
        <p>{t("campaigns.emptyText")}</p>
      </div>
    );
  } else {
    list = (
      <>
        {leading.length > 0 && (
          <section className="campaigns__group" aria-labelledby="c-leading">
            <h2 className="section-title" id="c-leading">
              {t("campaigns.leading")}
            </h2>
            <ul className="campaign-list">
              {leading.map((c) => (
                <li key={c.id} className="campaign">
                  <div className="campaign__main">
                    <h3 className="campaign__name">{c.name}</h3>
                    <p className="campaign__meta">{tc("campaigns.players", c.playerCount)}</p>
                  </div>
                  <ButtonLink
                    href={`/campaigns/${c.id}`}
                    iconAfter="arrowRight"
                    aria-label={t("campaigns.openLabel", { name: c.name })}
                  >
                    {t("campaigns.open")}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          </section>
        )}
        {playing.length > 0 && (
          <section className="campaigns__group" aria-labelledby="c-playing">
            <h2 className="section-title" id="c-playing">
              {t("campaigns.playing")}
            </h2>
            <ul className="campaign-list">
              {playing.map((c) => (
                <li key={c.id} className="campaign">
                  <div className="campaign__main">
                    <h3 className="campaign__name">{c.name}</h3>
                    <p className="campaign__meta">{t("campaigns.ledBy", { email: c.gameMaster.email })}</p>
                  </div>
                  <div className="campaign__actions">
                    <ButtonLink
                      href={`/campaigns/${c.id}`}
                      variant="secondary"
                      aria-label={t("campaigns.openLabel", { name: c.name })}
                    >
                      {t("campaigns.open")}
                    </ButtonLink>
                    <Button
                      variant="ghost"
                      aria-label={t("campaigns.leaveLabel", { name: c.name })}
                      onClick={() => setLeave(c)}
                    >
                      {t("campaigns.leave")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <AppShell>
      <div className="page campaigns">
        <h1 className="page__title">{t("campaigns.title")}</h1>
        <p>{t("campaigns.intro")}</p>
        <form
          className="campaigns__new"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <TextField
            label={t("campaigns.newLabel")}
            help={t("campaigns.newHelp")}
            error={nameError}
            value={name}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => {
              setName(e.currentTarget.value);
              if (nameError) setNameError(undefined);
            }}
          />
          <Button type="submit" icon="plus" busy={busy} busyLabel={t("campaigns.creating")}>
            {t("campaigns.create")}
          </Button>
        </form>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
        {list}
      </div>
      <ConfirmDialog
        open={leave !== undefined}
        title={t("campaigns.leaveTitle", { name: leave?.name ?? "" })}
        confirmLabel={t("campaigns.leave")}
        danger
        busy={busy}
        onCancel={() => setLeave(undefined)}
        onConfirm={async () => {
          const c = leave!;
          setBusy(true);
          setError(undefined);
          try {
            await api("DELETE", `/api/campaigns/${c.id}/players/me`);
            setCampaigns((all) => all?.filter((x) => x.id !== c.id) ?? null);
            setToast(t("campaigns.left", { name: c.name }));
          } catch (e) {
            // Already out (removed meanwhile): the list is right without it.
            if (e instanceof ApiError && e.status === 404) {
              setCampaigns((all) => all?.filter((x) => x.id !== c.id) ?? null);
            } else setError(t("common.loadError"));
          } finally {
            setBusy(false);
            setLeave(undefined);
          }
        }}
      >
        <p>{t("campaigns.leaveText")}</p>
      </ConfirmDialog>
      {toast && <Toast message={toast} duration={6000} onDone={() => setToast(undefined)} />}
    </AppShell>
  );
}
