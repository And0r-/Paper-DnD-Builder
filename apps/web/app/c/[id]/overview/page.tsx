"use client";
/**
 * Overview, "Is everything the way you want it?" (flow spec 4.6): every
 * step in a sentence with a way to change it, the main values, and what is
 * still open. Finishing works once nothing required is open.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { Callout } from "../../../../src/ui/components/Feedback.tsx";
import { RichText, useMeasure } from "../../../../src/ui/components/RichText.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import {
  ProgressHeader,
  QuestionHeader,
  useFooterDock,
  usePageTitle,
} from "../../../../src/ui/flow/frame.tsx";
import { describeAnswer, OVERVIEW_KEY } from "../../../../src/ui/flow/model.ts";
import { choiceTexts, formatValue, ptext } from "../../../../src/ui/package-text.ts";

export default function OverviewPage() {
  const { t, tc, list } = useApp();
  const { lp, ev, entries, draft, finish } = useDraft();
  const ctx = useMeasure(lp);
  const router = useRouter();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const dock = useFooterDock();
  const entry = entries.find((e) => e.key === OVERVIEW_KEY)!;
  const index = entries.indexOf(entry);
  usePageTitle([t("overview.question"), t("flow.progress", { current: index + 1, total: entries.length })]);

  const openSteps = entries.filter((e) => e.kind === "step" && e.status !== "done");
  const steps = entries.filter((e) => e.kind !== "overview");

  const onFinish = async () => {
    if (!ev.complete) {
      setProblem(t("overview.finishBlocked"));
      return;
    }
    setBusy(true);
    setProblem(undefined);
    const r = await finish();
    setBusy(false);
    if (r === "ok") router.push(`/c/${draft.id}/done`);
    else if (r === "incomplete") setProblem(t("overview.finishBlocked"));
    else setProblem(t("save.error"));
  };

  return (
    <div className="step">
      <ProgressHeader entry={entry} />
      <QuestionHeader id={headingId} question={t("overview.question")} intro={t("overview.intro")} />

      {openSteps.length > 0 && (
        <Callout tone="warning" title={t("overview.openTitle")}>
          <p>{tc("overview.open", openSteps.length, { steps: list(openSteps.map((s) => s.title)) })}</p>
          <p>
            <Link href={openSteps[0]!.href}>{t("flow.goTo", { step: openSteps[0]!.title })}</Link>
          </p>
        </Callout>
      )}

      <section className="values" aria-labelledby={`${headingId}-values`}>
        <h2 className="section-title" id={`${headingId}-values`}>
          {t("overview.values")}
        </h2>
        <ul className="values__list">
          {lp.pkg.flow.summary.fields.map((id) => {
            const shown = formatValue(lp, ctx, id, ev.values[id] ?? 0);
            return (
              <li className="value" key={id}>
                <span className="value__number">{shown}</span>
                <span className="value__name">{ptext(lp, `value.${id}.name`)}</span>
                {ptext(lp, `value.${id}.explain`) && (
                  <span className="value__explain">
                    <RichText lp={lp} text={ptext(lp, `value.${id}.explain`)} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <ul className="summary">
        {steps.map((s) => {
          const lines =
            s.kind === "level"
              ? [String(ev.level)]
              : s.choices.map((c) => {
                  const state = ev.choices[c]!;
                  const text = describeAnswer(lp, ctx, state, list);
                  const prefix = s.choices.length > 1 ? `${choiceTexts(lp, c).title}: ` : "";
                  return (
                    prefix +
                    (text ??
                      (state.optional && state.status === "missing"
                        ? t("overview.leftEmpty")
                        : t("overview.nothingChosen")))
                  );
                });
          return (
            <li key={s.key} className={`summary__item summary__item--${s.status}`}>
              <div className="summary__text">
                <h2 className="summary__title">
                  {s.status !== "done" && <span className="summary__flag">! </span>}
                  {s.title}
                </h2>
                {lines.map((l, i) => (
                  <p key={i} className="summary__line">
                    {l}
                  </p>
                ))}
              </div>
              <ButtonLink
                href={`${s.href}?from=overview`}
                variant="ghost"
                aria-label={t("overview.changeLabel", { step: s.title })}
              >
                {t("overview.change")}
              </ButtonLink>
            </li>
          );
        })}
      </ul>

      <div className="step-footer">
        {!ev.complete && <p className="note">{t("overview.finishBlocked")}</p>}
        <div className="step-footer__dock" ref={dock}>
          <div aria-live="polite">
            {problem && (
              <div className="step-footer__reason">
                <Callout tone="warning">{problem}</Callout>
              </div>
            )}
          </div>
          <div className="step-footer__bar">
            <ButtonLink href={entries[index - 1]!.href} variant="secondary" icon="arrowLeft">
              {t("common.back")}
            </ButtonLink>
            <Button icon="printer" onClick={onFinish} busy={busy} busyLabel={t("overview.finishing")}>
              {t("overview.finish")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
