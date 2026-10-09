"use client";
/**
 * The builder's step "Your levels" (concept AND-262, 6.2): with a package
 * whose levels may go to more than one thing, which thing each level from
 * 2 on goes to. Most characters leave it as it is; the step says so in one
 * sentence and opens the list only on request.
 */
import { useId } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { firstOpen, TRACKS_KEY } from "../../../../src/ui/flow/model.ts";
import { levelWord, ptext } from "../../../../src/ui/package-text.ts";
import { planOf } from "../../../../src/ui/tracks/model.ts";
import { TrackStep } from "../../../../src/ui/tracks/screens.tsx";

export default function TracksPage() {
  const { t } = useApp();
  const { lp, doc, ev, entries, allEntries, change } = useDraft();
  const headingId = useId();
  const entry = [...entries, ...allEntries].find((e) => e.key === TRACKS_KEY);
  const tracks = ev.tracks;
  if (!entry || !tracks) {
    return (
      <div className="page">
        <EmptyState title={t("flow.stepNotFound")}>
          <ButtonLink href={firstOpen(entries).href}>{t("flow.toFirstOpen")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }
  const word = levelWord(lp);
  const plan = planOf(doc, ev);
  const choiceStep = allEntries.find((e) => e.choices.includes(tracks.choice));
  const choiceTitle = ptext(lp, `choice.${tracks.choice}.title`) ?? choiceStep?.title ?? "";
  const problem = !plan
    ? t("tracks.step.noFirst", { step: choiceTitle })
    : tracks.unfit.length > 0
      ? t("tracks.step.unfitTitle")
      : undefined;
  return (
    <StepFrame
      key={entry.key}
      entry={entry}
      headingId={headingId}
      question={t("tracks.step.question", { levelName: word })}
      intro={t("tracks.step.intro")}
      footer={<StepFooter entry={entry} problem={problem} />}
    >
      {plan ? (
        <TrackStep
          lp={lp}
          choice={tracks.choice}
          plan={plan}
          options={tracks.options}
          unfit={tracks.unfit}
          unfitNotMet={tracks.unfitNotMet}
          onChange={(next) => change({ type: "tracks", tracks: [...next.tracks] })}
        />
      ) : (
        <EmptyState title={t("tracks.step.noFirst", { step: choiceTitle })}>
          {choiceStep && (
            <ButtonLink href={choiceStep.href}>{t("flow.goTo", { step: choiceStep.title })}</ButtonLink>
          )}
        </EmptyState>
      )}
    </StepFrame>
  );
}
