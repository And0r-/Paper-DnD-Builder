"use client";
/**
 * Overview, "Is everything the way you want it?" (flow spec 4.6): every
 * step in a sentence with a way to change it, the main values, and what is
 * still open. Finishing works once nothing required is open.
 */
import { headTracks, summarize, tracksText } from "@builder/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import type { Campaign } from "../../../../src/ui/api.ts";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { loadMemberCampaigns, NO_CAMPAIGN } from "../../../../src/ui/campaigns.ts";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { Callout } from "../../../../src/ui/components/Feedback.tsx";
import { SelectField } from "../../../../src/ui/components/Fields.tsx";
import { RichText, useMeasure } from "../../../../src/ui/components/RichText.tsx";
import { listNodes, ThingName } from "../../../../src/ui/components/ThingName.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import {
  ProgressHeader,
  QuestionHeader,
  useFooterDock,
  trackLevelText,
  usePageTitle,
} from "../../../../src/ui/flow/frame.tsx";
import { distributeLines, levelGrowth, valueOrigin } from "../../../../src/ui/flow/explain.ts";
import {
  answerThings,
  asks,
  describeAnswer,
  heldTexts,
  OVERVIEW_KEY,
  positionOf,
} from "../../../../src/ui/flow/model.ts";
import { LevelGrowth } from "../../../../src/ui/flow/growth.tsx";
import { Origins } from "../../../../src/ui/flow/origins.tsx";
import { HelpButton } from "../../../../src/ui/live/help-dialog.tsx";
import { summaryLineText } from "../../../../src/ui/characters.tsx";
import { choiceOf, choiceTexts, formatValue, ptext, thingName } from "../../../../src/ui/package-text.ts";

export default function OverviewPage() {
  const { t, tc, list } = useApp();
  const { lp, doc, ev, entries, allEntries, draft, raise, finish } = useDraft();
  const ctx = useMeasure(lp);
  const router = useRouter();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const dock = useFooterDock();
  const entry = entries.find((e) => e.key === OVERVIEW_KEY)!;
  const index = entries.indexOf(entry);
  usePageTitle([t("overview.question"), t("flow.progress", positionOf(entries, entry))]);

  // Numbers of the section "what grows with your level" are not repeated in the lines below,
  // nor one track's share of a number two tracks raise (that section has the character's).
  const growth = levelGrowth(lp, ev);
  const line = ev.tracks ? summaryLineText(lp, summarize(lp.pkg, doc, ev).line) : "";
  const grown = new Set([
    ...growth.own,
    ...growth.shared,
    ...growth.summed,
    ...growth.byThing.flatMap((g) => g.values),
  ]);
  const openSteps = entries.filter((e) => asks(e) && e.status !== "done");
  // During a level up the earlier steps stay here, to look at and to change.
  const steps = allEntries.filter((e) => e.kind !== "overview");
  // Each score is summed up once, at the first step that sets it; later steps show their part.
  const summed = new Set<string>();

  const onFinish = async () => {
    if (!ev.complete) {
      setProblem(t("overview.finishBlocked"));
      return;
    }
    setBusy(true);
    setProblem(undefined);
    // Finishing ends a level up: the end screen then says what it brought.
    const from = raise?.from;
    const r = await finish();
    setBusy(false);
    if (r === "ok") router.push(`/c/${draft.id}/done${from !== undefined ? `?from=${from}` : ""}`);
    else if (r === "incomplete") setProblem(t("overview.finishBlocked"));
    else setProblem(t("save.error"));
  };

  return (
    <div className="step">
      <ProgressHeader entry={entry} />
      <QuestionHeader id={headingId} question={t("overview.question")} intro={t("overview.intro")} />
      {/* With tracks the levels are split: the head says how ("Lantern bearer 3 / Herbalist 2"). */}
      {line && <p className="overview-line">{line}</p>}

      {openSteps.length > 0 && (
        <Callout tone="warning" title={t("overview.openTitle")}>
          <p>{tc("overview.open", openSteps.length, { steps: list(openSteps.map((s) => s.title)) })}</p>
          <p>
            <Link href={openSteps[0]!.href}>{t("flow.goTo", { step: openSteps[0]!.title })}</Link>
          </p>
        </Callout>
      )}

      <CampaignField />

      {draft.access === "owner" && (
        <div className="overview-help">
          <p>{t("overview.helpHint")}</p>
          <HelpButton draftId={draft.id} />
        </div>
      )}

      <section className="values" aria-labelledby={`${headingId}-values`}>
        <h2 className="section-title" id={`${headingId}-values`}>
          {t("overview.values")}
        </h2>
        <ul className="values__list">
          {lp.pkg.flow.summary.fields.map((id) => {
            const shown = formatValue(lp, ctx, id, ev.values[id] ?? 0);
            const origin = valueOrigin(lp, ctx, ev, id, { t, list });
            return (
              <li className="value" key={id}>
                <span className="value__number">{shown}</span>
                <span className="value__name">{ptext(lp, `value.${id}.name`)}</span>
                {origin && <span className="value__from">{origin}</span>}
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

      <LevelGrowth />

      <Origins />

      <ul className="summary">
        {steps.map((s) => {
          const lines: ReactNode[] =
            s.kind === "level"
              ? [String(ev.level)]
              : s.kind === "tracks"
                ? [ev.tracks ? tracksText(headTracks(ev), (id) => thingName(lp, id)) : ""]
                : s.choices.flatMap((c): ReactNode[] => {
                    const state = ev.choices[c]!;
                    const choice = choiceOf(lp, c);
                    const assign = (state.answer as { assign?: Record<string, number> } | undefined)?.assign;
                    // Each score on its own line: the whole sum once ("15 from … + 2 from … = 17"), later only "+ 2".
                    if (choice?.kind === "distribute" && assign && state.status !== "invalid") {
                      // Raised values: only those that got points.
                      const raise = choice.methods[0]?.method === "raise";
                      const targets = raise
                        ? choice.targets.filter((v) => (assign[v] ?? 0) > 0)
                        : choice.targets;
                      return distributeLines(lp, ctx, ev, state, targets, assign, { t, list }, summed);
                    }
                    // Names of things explain themselves on hover and tap: their text is not on this screen.
                    const named = answerThings(lp, ctx, state, grown, ev.values);
                    const text =
                      named && named.things.length + named.values.length > 0
                        ? listNodes(t, [
                            ...named.things.map((id) => (
                              <Fragment key={id}>
                                <ThingName lp={lp} id={id} />
                                {heldTexts(ev, id)}
                              </Fragment>
                            )),
                            ...named.values,
                          ])
                        : describeAnswer(lp, ctx, state, list, grown, ev.values);
                    // A choice of an added track says which: its title is the same as in the first one.
                    const title = choiceTexts(lp, c, state, ctx).title;
                    const added = state.track !== undefined && state.track !== ev.tracks?.first;
                    const prefix =
                      s.choices.length > 1
                        ? `${added ? t("tracks.ofTrack", { title, thing: thingName(lp, state.track!) }) : title}: `
                        : "";
                    return [
                      <>
                        {prefix}
                        {text ??
                          (state.optional && state.status === "missing"
                            ? t("overview.leftEmpty")
                            : t("overview.nothingChosen"))}
                      </>,
                    ];
                  });
          return (
            <li key={s.key} className={`summary__item summary__item--${s.status}`}>
              <div className="summary__text">
                <h2 className="summary__title">
                  {s.status !== "done" && <span className="summary__flag">! </span>}
                  {s.title}
                  {/* A real space: read aloud or copied, "Subclass Level 3" is not "SubclassLevel 3". */}
                  {(s.track !== undefined || s.atLevel > lp.pkg.flow.level.min) && " "}
                  {s.track !== undefined ? (
                    <span className="summary__level">{trackLevelText(lp, t, s)}</span>
                  ) : (
                    s.atLevel > lp.pkg.flow.level.min && (
                      <span className="summary__level">
                        {t("flow.atLevel", { levelName: ptext(lp, "level.name") ?? "", level: s.atLevel })}
                      </span>
                    )
                  )}
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

/**
 * Which campaign the character belongs to; its owner changes it here, saved
 * at once. Shown only to an owner who plays in or leads a campaign, or whose
 * character is in one.
 */
function CampaignField() {
  const { t } = useApp();
  const { draft, setCampaign } = useDraft();
  const [campaigns, setCampaigns] = useState<Campaign[]>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const owner = draft.access === "owner";

  useEffect(() => {
    if (!owner) return;
    let live = true;
    // Without the list there is nothing to choose from; the field stays away.
    loadMemberCampaigns().then(
      (c) => live && setCampaigns(c),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [owner]);

  if (!owner || !campaigns || (campaigns.length === 0 && !draft.campaignId)) return null;
  const known = campaigns.some((c) => c.id === draft.campaignId);
  return (
    <div className="overview-campaign">
      <SelectField
        label={t("overview.campaign")}
        value={known ? draft.campaignId! : NO_CAMPAIGN}
        busy={busy}
        onChange={async (v) => {
          setBusy(true);
          setFailed(false);
          setFailed(!(await setCampaign(v || null)));
          setBusy(false);
        }}
        options={[
          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
          { value: NO_CAMPAIGN, label: t("new.noCampaign") },
        ]}
      />
      {failed && <Callout tone="warning">{t("save.error")}</Callout>}
    </div>
  );
}
