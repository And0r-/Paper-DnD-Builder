"use client";
/**
 * The builder's step "Rules" (AND-336): which package the character is
 * built with, right after the campaign. Changeable at any time, but every
 * answer goes with it (AND-335): the steps of one package are not those of
 * another. So a dialog asks first; only campaign and level stay. Afterwards
 * the list shows the new package's steps, all open, and the person goes on
 * at the first of them.
 *
 * The owner and a game master building for a player may switch; someone
 * helping through a link sees the step to look at only.
 */
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../../../src/ui/components/Dialog.tsx";
import { Callout, EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { PackageCards } from "../../../../src/ui/components/PackageCards.tsx";
import { PackageLanguageNote } from "../../../../src/ui/components/PackageLanguageNote.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { firstOpen, RULES_KEY } from "../../../../src/ui/flow/model.ts";
import { levelWord } from "../../../../src/ui/package-text.ts";

export default function RulesPage() {
  const { t, lang } = useApp();
  const router = useRouter();
  const { lp, draft, packages, entries, allEntries, switchPackage } = useDraft();
  const headingId = useId();
  // The card picked but not yet confirmed: the dialog asks about it.
  const [asked, setAsked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const entry = [...entries, ...allEntries].find((e) => e.key === RULES_KEY);
  if (!entry) {
    return (
      <div className="page">
        <EmptyState title={t("flow.stepNotFound")}>
          <ButtonLink href={firstOpen(entries).href}>{t("flow.toFirstOpen")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }
  const mayChange = draft.access !== "helper";
  const current = packages.find((p) => p.id === draft.packageId);
  const foreign = packages.find((p) => p.language !== lang);

  const confirm = async () => {
    if (!asked) return;
    setBusy(true);
    setFailed(false);
    const start = await switchPackage(asked);
    if (start) {
      // This screen goes with the old package; the new flow starts at its first open step.
      router.push(start);
      return;
    }
    setBusy(false);
    setAsked(null);
    setFailed(true);
  };

  return (
    <StepFrame
      entry={entry}
      headingId={headingId}
      question={t("rules.question")}
      intro={t("rules.intro")}
      footer={<StepFooter entry={entry} problem={undefined} />}
    >
      {mayChange ? (
        <>
          <PackageCards
            list={packages}
            picked={asked ?? draft.packageId}
            onPick={(id) => {
              setFailed(false);
              if (id !== draft.packageId) setAsked(id);
            }}
            labelledBy={headingId}
            disabled={busy}
          />
          {foreign && <PackageLanguageNote shown={foreign.language} />}
          {!current && <p className="note">{t("rules.none")}</p>}
          <div aria-live="polite">{failed && <Callout tone="warning">{t("save.error")}</Callout>}</div>
          <ConfirmDialog
            open={asked !== null}
            title={t("rules.switchTitle")}
            confirmLabel={t("rules.switch")}
            busy={busy}
            busyLabel={t("rules.switching")}
            danger
            onCancel={() => !busy && setAsked(null)}
            onConfirm={() => void confirm()}
          >
            <p>{t("rules.switchText", { old: current?.name ?? "", levelName: levelWord(lp) })}</p>
            {draft.status === "finished" && <p>{t("rules.switchFinished")}</p>}
          </ConfirmDialog>
        </>
      ) : (
        // To look at: the answer as text, not cards that cannot be used.
        <div className="campaign-step">
          <dl className="campaign-step__answer">
            <dt>{t("rules.title")}</dt>
            <dd lang={current?.language}>{current?.name ?? t("rules.none")}</dd>
          </dl>
          <p className="note">{t("rules.ownerOnly", { name: draft.owner.name })}</p>
        </div>
      )}
    </StepFrame>
  );
}
