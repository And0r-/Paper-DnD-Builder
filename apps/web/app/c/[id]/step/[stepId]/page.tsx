"use client";
/**
 * One step of the package's flow, in the shared frame. The step, its
 * question, options and explanations all come from the package.
 */
import type { ChoiceState, DraftChange } from "@builder/core";
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
import { useDraft } from "../../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame, StepShortcuts, usePageTitle } from "../../../../../src/ui/flow/frame.tsx";
import { firstOpen, missingText } from "../../../../../src/ui/flow/model.ts";
import { choiceTexts, plist, stepTexts } from "../../../../../src/ui/package-text.ts";
import { useMeasure } from "../../../../../src/ui/components/RichText.tsx";

function settled(c: ChoiceState): boolean {
  return c.status === "answered" || c.status === "info" || (c.optional && c.status === "missing");
}

export default function StepPage() {
  const { stepId } = useParams<{ stepId: string }>();
  const key = decodeURIComponent(stepId);
  const { t } = useApp();
  const { lp, ev, entries, change } = useDraft();
  const ctx = useMeasure(lp);
  const headingId = useId();
  // The way of sharing out each distribute choice shows right now; the
  // package's "missing" sentence speaks of points and fits only that way.
  const [ways, setWays] = useState<Record<string, number>>({});
  const entry = entries.find((e) => e.kind === "step" && e.key === key);
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

  const texts = stepTexts(lp, { id: entry.key, choices: entry.choices }, ev, ctx);
  const choices = entry.choices
    .map((id) => ({ def: lp.pkg.flow.choices.find((c) => c.id === id), state: ev.choices[id] }))
    .filter((x): x is { def: Choice; state: ChoiceState } => x.def !== undefined && x.state !== undefined);
  const single = choices.length === 1;
  const open = choices.filter((c) => !settled(c.state));
  const head = open[0];
  const way = head?.def.kind === "distribute" ? head.def.methods[ways[head.def.id] ?? 0] : undefined;
  const problem = !head
    ? undefined
    : way?.method === "array" && head.state.status !== "invalid"
      ? t("dist.arrayMissing")
      : missingText(lp, ctx, head.state, t);
  const isInfo = choices.length > 0 && choices.every((c) => c.def.kind === "info");

  // "Choose for me": the package's recommendation (or a good default) for every open choice.
  const recommendation = (def: Choice, state: ChoiceState): DraftChange | undefined => {
    const rec = state.recommended;
    if (def.kind === "pickOne" && Array.isArray(rec) && rec[0])
      return { type: "answer", choice: def.id, answer: { pick: rec[0] } };
    if (def.kind === "pickMany" && Array.isArray(rec) && rec.length > 0)
      return { type: "answer", choice: def.id, answer: { picks: rec.slice(0, state.count ?? rec.length) } };
    if (def.kind === "distribute" && rec && !Array.isArray(rec))
      return { type: "answer", choice: def.id, answer: rec };
    if (def.kind === "number" && def.default !== undefined)
      return { type: "answer", choice: def.id, answer: { value: def.default } };
    if (def.kind === "text" && def.suggestions) {
      const list = plist(lp, def.suggestions);
      if (list.length > 0)
        return {
          type: "answer",
          choice: def.id,
          answer: { text: list[Math.floor(Math.random() * list.length)]! },
        };
    }
    return undefined;
  };
  const recs = open.map((c) => recommendation(c.def, c.state));
  const chooseForMe =
    open.length > 0 && recs.every(Boolean) ? () => recs.forEach((r) => r && change(r)) : undefined;

  // The first answer of the open choice, not the search box above the list:
  // an empty search field says nothing about what is missing.
  const focusTarget = () => {
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
      {choices.map(({ def, state }) => {
        const ct = choiceTexts(lp, def.id, state, ctx);
        if (single) {
          return (
            <div id={`block-${def.id}`} key={def.id}>
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
            {render(def, state, subId, ct.question)}
          </section>
        );
      })}
    </StepFrame>
  );
}
