"use client";
/**
 * A new character. With one game loaded, this screen is skipped and the
 * draft starts at once (flow spec 4.3, Hick's law). With several, the
 * player picks the game first; that cannot be changed later.
 *
 * The campaign is not asked here: it is the first step of the character
 * (AND-333), changeable like any other. A member of a campaign (player or
 * game master) starts there, with the campaign they joined last chosen:
 * most come here straight from the invitation. `?campaign=<id>` chooses
 * that campaign instead (from the invitation page, AND-237). With `&joined`
 * (just joined from the invitation) that step says once that one plays in
 * that campaign now. Without a campaign there is no such step.
 *
 * `?campaign=<id>&player=<id>`: a game master builds for a player of their
 * campaign. The character is the player's from the start and belongs to
 * that campaign.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, ApiError, type CampaignView, type DraftView, type PackageListEntry } from "../../src/ui/api.ts";
import { loadMemberCampaigns } from "../../src/ui/campaigns.ts";
import { Button, ButtonLink } from "../../src/ui/components/Button.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { PackageLanguageNote } from "../../src/ui/components/PackageLanguageNote.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { QuestionHeader, usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { rememberJoined } from "../../src/ui/joined.ts";
import { loadPackageList } from "../../src/ui/packages.ts";

export default function NewPage() {
  return (
    <Suspense>
      <RequireAccount>{() => <NewCharacter />}</RequireAccount>
    </Suspense>
  );
}

/** Whom a game master builds for; `null` while loading, `"missing"` if not a player of a campaign they lead. */
type ForPlayer = { campaignId: string; playerId: string; name: string };

function useForPlayer(): ForPlayer | null | "missing" | undefined {
  const params = useSearchParams();
  const campaignId = params.get("campaign");
  const playerId = params.get("player");
  const [found, setFound] = useState<{ key: string; value: ForPlayer | "missing" }>();
  const key = `${campaignId}/${playerId}`;
  useEffect(() => {
    if (!campaignId || !playerId) return;
    let live = true;
    api<CampaignView>("GET", `/api/campaigns/${encodeURIComponent(campaignId)}`).then(
      (v) => {
        const p = v.players?.find((x) => x.id === playerId);
        if (live) setFound({ key, value: p ? { campaignId, playerId, name: p.name } : "missing" });
      },
      (e) => {
        if (live && e instanceof ApiError && e.status < 500 && !e.isNetwork)
          setFound({ key, value: "missing" });
      },
    );
    return () => {
      live = false;
    };
  }, [campaignId, playerId, key]);
  if (!campaignId || !playerId) return undefined;
  return found?.key === key ? found.value : null;
}

function NewCharacter() {
  const { t, lang } = useApp();
  const router = useRouter();
  const forPlayer = useForPlayer();
  const params = useSearchParams();
  const preferred = params.get("campaign");
  const justJoined = params.has("joined");
  const [list, setList] = useState<PackageListEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * Where the character starts, once known: in the campaign joined last or
   * the one the invitation named (null: in none, or the viewer is in no
   * campaign), and the name of a campaign just joined ("You now play in …").
   * Not asked when a game master builds for a player.
   */
  const [start, setStart] = useState<{ campaign: string | null; step: boolean; joined?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);
  const headingId = useId();

  const create = useCallback(
    async (packageId: string) => {
      setBusy(true);
      setProblem(undefined);
      try {
        const r =
          forPlayer && forPlayer !== "missing"
            ? await api<DraftView>(
                "POST",
                `/api/campaigns/${forPlayer.campaignId}/players/${forPlayer.playerId}/drafts`,
                { packageId },
              )
            : await api<DraftView>("POST", "/api/drafts", { packageId, campaignId: start?.campaign ?? null });
        if (start?.joined) rememberJoined(r.draft.id, start.joined);
        // A member of a campaign starts at the step "Campaign", to see where the character goes.
        router.replace(`/c/${r.draft.id}/${start?.step ? "campaign" : "level"}`);
      } catch {
        setProblem(t("common.loadError"));
        setBusy(false);
        started.current = false;
      }
    },
    [router, t, forPlayer, start],
  );
  // Building for a player waits until the player is known; one's own waits for the campaigns.
  const ready = forPlayer === undefined ? start !== undefined : forPlayer !== null && forPlayer !== "missing";
  usePageTitle([t("new.question")]);

  useEffect(() => {
    let live = true;
    loadPackageList(lang).then(
      (l) => live && (setList(l), setFailed(false)),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [lang, attempt]);

  useEffect(() => {
    if (forPlayer !== undefined) return;
    let live = true;
    loadMemberCampaigns().then(
      (c) => {
        if (!live) return;
        const named = c.find((x) => x.id === preferred);
        setStart({
          campaign: (named ?? c[0])?.id ?? null,
          step: c.length > 0,
          ...(named && justJoined && { joined: named.name }),
        });
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [forPlayer, preferred, justJoined, attempt]);

  useEffect(() => {
    if (list?.length === 1 && ready && !started.current) {
      started.current = true;
      void create(list[0]!.id);
    }
  }, [list, create, ready]);

  const back = forPlayer && forPlayer !== "missing" ? `/campaigns/${forPlayer.campaignId}` : "/characters";

  let content;
  if (forPlayer === "missing") {
    content = (
      <EmptyState title={t("campaign.notFound")}>
        <ButtonLink href="/campaigns">{t("menu.campaigns")}</ButtonLink>
      </EmptyState>
    );
  } else if (failed) content = <ErrorState onRetry={() => setAttempt((n) => n + 1)} />;
  else if (!list || !ready || (list.length === 1 && !problem)) content = <Loading shape="page" count={2} />;
  else if (list.length === 0) {
    content = (
      <EmptyState title={t("new.noneTitle")}>
        <p>{t("new.noneText")}</p>
        <ButtonLink href="/characters" variant="secondary">
          {t("menu.characters")}
        </ButtonLink>
      </EmptyState>
    );
  } else if (list.length === 1) {
    content = <ErrorState message={problem} onRetry={() => void create(list[0]!.id)} />;
  } else {
    const foreign = list.find((p) => p.language !== lang);
    content = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!picked) setProblem(t("new.pickOne"));
          else void create(picked);
        }}
      >
        <QuestionHeader id={headingId} question={t("new.question")} intro={t("new.intro")} />
        {forPlayer && <Callout tone="info">{t("new.forPlayer", { name: forPlayer.name })}</Callout>}
        <fieldset className="options" aria-labelledby={headingId}>
          <div className="options__list">
            {list.map((p) => (
              <label
                key={p.id}
                className={`option option--simple${picked === p.id ? " option--checked" : ""}`}
              >
                <span className="option__head">
                  <input
                    className="option__input"
                    type="radio"
                    name="package"
                    value={p.id}
                    checked={picked === p.id}
                    onChange={() => setPicked(p.id)}
                  />
                  <span className="option__mark" aria-hidden="true" />
                  <span className="option__name" lang={p.language}>
                    {p.name}
                  </span>
                </span>
                {p.short && (
                  <span className="option__short" lang={p.language}>
                    {p.short}
                  </span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        {foreign && <PackageLanguageNote shown={foreign.language} />}
        <p className="note">{t("new.note")}</p>
        {problem && <Callout tone="warning">{problem}</Callout>}
        <div className="step-footer__bar">
          <ButtonLink href={back} variant="secondary" icon="arrowLeft">
            {t("common.back")}
          </ButtonLink>
          <Button type="submit" busy={busy} busyLabel={t("new.creating")} iconAfter="arrowRight">
            {t("new.start")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <AppShell>
      <div className="page">{content}</div>
    </AppShell>
  );
}
