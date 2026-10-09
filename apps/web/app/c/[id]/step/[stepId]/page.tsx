"use client";
/**
 * One step of the package's flow, in the shared frame. The step, its
 * question, options and explanations all come from the package.
 */
import type { ChoiceState } from "@builder/core";
import type { Choice } from "@builder/format/pure";
import { useParams } from "next/navigation";
import { useId, useState } from "react";
import { useApp } from "../../../../../src/ui/app-state.tsx";
import { ButtonLink } from "../../../../../src/ui/components/Button.tsx";
import { EmptyState } from "../../../../../src/ui/components/Feedback.tsx";
import { RichText } from "../../../../../src/ui/components/RichText.tsx";
import {
  DistributeChoice,
  InfoChoice,
  NumberChoice,
  PickChoice,
  TextChoice,
} from "../../../../../src/ui/flow/choices.tsx";
import { chooseForMe as chooseForMeChanges, suggestedAnswer } from "../../../../../src/ui/flow/choose.ts";
import { useDraft } from "../../../../../src/ui/flow/draft-state.tsx";
import { PoolList, poolMissingText } from "../../../../../src/ui/flow/pool.tsx";
import { ChoiceSource } from "../../../../../src/ui/flow/source.tsx";
import { StepFooter, StepFrame, StepShortcuts, usePageTitle } from "../../../../../src/ui/flow/frame.tsx";
import { firstOpen, missingText } from "../../../../../src/ui/flow/model.ts";
import { choiceOf, choiceTexts, stepTexts, thingName } from "../../../../../src/ui/package-text.ts";
import { useMeasure } from "../../../../../src/ui/components/RichText.tsx";

function settled(c: ChoiceState): boolean {
  return c.status === "answered" || c.status === "info" || (c.optional && c.status === "missing");
}

export default function StepPage() {
  const { stepId } = useParams<{ stepId: string }>();
  const key = decodeURIComponent(stepId);
  const { t, list } = useApp();
  const { lp, doc, ev, entries, allEntries, change } = useDraft();
  const ctx = useMeasure(lp);
  const headingId = useId();
  // The way of sharing out each distribute choice shows right now; the
  // package's "missing" sentence speaks of points and fits only that way.
  const [ways, setWays] = useState<Record<string, number>>({});
  // During a level up an earlier step is not in the flow, but the overview leads to it.
  const entry = [...entries, ...allEntries].find((e) => e.kind === "step" && e.key === key);
  usePageTitle(entry ? [] : [t("flow.stepNotFound")]);

  if (!entry) {
    return (
      <div className="page">
        <EmptyState title={t("flow.stepNotFound")}>
          <ButtonLink href={firstOpen(entries).href}>{t("flow.toFirstOpen")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }

  const step = ev.steps.find((s) => s.id === entry.key);
  const texts = stepTexts(lp, step ?? { id: entry.key, choices: entry.choices }, ev, ctx);
  const pool = step?.pool;
  const choices = entry.choices
    .map((id) => ({ def: choiceOf(lp, id), state: ev.choices[id] }))
    .filter((x): x is { def: Choice; state: ChoiceState } => x.def !== undefined && x.state !== undefined);
  // A gather step always shows its choices as sections under its own question.
  const single = choices.length === 1 && step?.gather === undefined;
  const open = choices.filter((c) => !settled(c.state));
  const head = open[0];
  const way = head?.def.kind === "distribute" ? head.def.methods[ways[head.def.id] ?? 0] : undefined;
  const problem = !head
    ? undefined
    : pool && head.state.status !== "invalid"
      ? poolMissingText(lp, ctx, ev, pool, t, list)
      : way?.method === "array" && head.state.status !== "invalid"
        ? t("dist.arrayMissing")
        : missingText(lp, ctx, head.state, t);
  const isInfo = choices.length > 0 && choices.every((c) => c.def.kind === "info");

  // "Choose for me": the package's recommendation for every open choice,
  // keeping what is already picked and leaving out what the character has
  // from elsewhere (choose.ts). Worked out on the click; here only whether it can.
  const canChoose =
    open.length > 0 &&
    (pool
      ? pool.recommended.length > 0 || pool.picks.length > 0
      : open.every((c) => suggestedAnswer(lp, c.def, c.state, new Set()) !== undefined));
  const chooseForMe = canChoose
    ? () => chooseForMeChanges(lp, doc, ev, entry.key)?.forEach((c) => change(c))
    : undefined;

  // The first answer of the open choice, not the search box above the list:
  // an empty search field says nothing about what is missing.
  const focusTarget = () => {
    if (pool) {
      // The first option that can still be picked.
      return document.querySelector<HTMLElement>(
        "#block-pool .option:not(.option--checked):not(.option--blocked) input",
      );
    }
    const block = open[0] && document.getElementById(`block-${open[0].def.id}`);
    return (
      block?.querySelector<HTMLElement>("[data-open-target]") ??
      block?.querySelector<HTMLElement>("input:not([type='search']), select, textarea, button") ??
      block?.querySelector<HTMLElement>("input") ??
      null
    );
  };

  const render = (def: Choice, state: ChoiceState, labelledBy: string, label: string) => {
    switch (def.kind) {
      case "pickOne":
      case "pickMany":
        return <PickChoice choice={def} state={state} labelledBy={labelledBy} />;
      case "distribute":
        return (
          <DistributeChoice
            choice={def}
            state={state}
            labelledBy={labelledBy}
            onMethod={(m) => setWays((w) => (w[def.id] === m ? w : { ...w, [def.id]: m }))}
          />
        );
      case "number":
        return <NumberChoice choice={def} state={state} labelledBy={labelledBy} />;
      case "text":
        return <TextChoice choice={def} state={state} label={label} />;
      case "info":
        return <InfoChoice state={state} />;
    }
  };

  return (
    <StepFrame
      key={entry.key}
      entry={entry}
      headingId={headingId}
      question={texts.question}
      introText={texts.intro}
      introVars={texts.vars}
      laterLink={<StepShortcuts entry={entry} open={open.length > 0} onChooseForMe={chooseForMe} />}
      footer={
        <StepFooter
          entry={entry}
          problem={problem}
          onChooseForMe={chooseForMe}
          focusTarget={focusTarget}
          {...(isInfo ? { nextLabel: t("info.continue") } : {})}
        />
      }
    >
      {pool && step ? (
        <div id="block-pool">
          <PoolList step={{ ...step, pool }} labelledBy={headingId} />
        </div>
      ) : (
        choices.map(({ def, state }) => {
          const ct = choiceTexts(lp, def.id, state, ctx);
          if (single) {
            return (
              <div id={`block-${def.id}`} key={def.id}>
                <ChoiceSource def={def} state={state} />
                {render(def, state, headingId, texts.question)}
              </div>
            );
          }
          const subId = `q-${def.id}`;
          return (
            <section
              className="subquestion"
              id={`block-${def.id}`}
              key={def.id}
              {...(def.kind !== "text" ? { "aria-labelledby": subId } : {})}
            >
              {/* A choice of an added track says which, above its question (concept AND-262, 6.3). */}
              {state.track !== undefined && state.track !== ev.tracks?.first && (
                <p className="subquestion__track">{thingName(lp, state.track)}</p>
              )}
              {def.kind !== "text" && (
                <h2 className="subquestion__title" id={subId}>
                  {ct.question}
                </h2>
              )}
              {ct.intro && (
                <p className="subquestion__intro">
                  <RichText lp={lp} text={ct.intro} vars={ct.vars} />
                </p>
              )}
              <ChoiceSource def={def} state={state} />
              {render(def, state, subId, ct.question)}
            </section>
          );
        })
      )}
    </StepFrame>
  );
}
