"use client";
/**
 * A new character. With one game loaded, this screen is skipped and the
 * draft starts at once (flow spec 4.3, Hick's law). With several, the
 * player picks the game first; that cannot be changed later.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useApp } from "../../src/ui/app-state.tsx";
import { api, type DraftView, type PackageListEntry } from "../../src/ui/api.ts";
import { Button, ButtonLink } from "../../src/ui/components/Button.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../../src/ui/components/Feedback.tsx";
import { AppShell } from "../../src/ui/components/Shell.tsx";
import { QuestionHeader, usePageTitle } from "../../src/ui/flow/frame.tsx";
import { RequireAccount } from "../../src/ui/guards.tsx";
import { loadPackageList } from "../../src/ui/packages.ts";

export default function NewPage() {
  return <RequireAccount>{() => <NewCharacter />}</RequireAccount>;
}

function NewCharacter() {
  const { t, lang } = useApp();
  const router = useRouter();
  usePageTitle([t("new.question")]);
  const [list, setList] = useState<PackageListEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
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
        const r = await api<DraftView>("POST", "/api/drafts", { packageId });
        router.replace(`/c/${r.draft.id}/level`);
      } catch {
        setProblem(t("common.loadError"));
        setBusy(false);
        started.current = false;
      }
    },
    [router, t],
  );

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
    if (list?.length === 1 && !started.current) {
      started.current = true;
      void create(list[0]!.id);
    }
  }, [list, create]);

  let content;
  if (failed) content = <ErrorState onRetry={() => setAttempt((n) => n + 1)} />;
  else if (!list || (list.length === 1 && !problem)) content = <Loading shape="page" count={2} />;
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
    content = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!picked) setProblem(t("new.pickOne"));
          else void create(picked);
        }}
      >
        <QuestionHeader id={headingId} question={t("new.question")} intro={t("new.intro")} />
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
        <p className="note">{t("new.note")}</p>
        {problem && <Callout tone="warning">{problem}</Callout>}
        <div className="step-footer__bar">
          <ButtonLink href="/characters" variant="secondary" icon="arrowLeft">
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
