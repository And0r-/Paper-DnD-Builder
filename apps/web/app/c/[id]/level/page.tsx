"use client";
/** Level (flow spec 4.4). The word for "level" and the explanations come from the package. */
import { useId } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { Segmented } from "../../../../src/ui/components/Fields.tsx";
import { RichText } from "../../../../src/ui/components/RichText.tsx";
import { Callout } from "../../../../src/ui/components/Feedback.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { useGuardedChange } from "../../../../src/ui/flow/guard.tsx";
import { LEVEL_KEY } from "../../../../src/ui/flow/model.ts";
import { ptext } from "../../../../src/ui/package-text.ts";

export default function LevelPage() {
  const { t } = useApp();
  const { lp, ev, entries } = useDraft();
  const guard = useGuardedChange();
  const legendId = useId();
  const entry = entries.find((e) => e.key === LEVEL_KEY)!;
  const { min, max } = lp.pkg.flow.level;
  const levelName = ptext(lp, "level.name") ?? "";
  const hint = ptext(lp, "level.hint");
  return (
    <StepFrame
      entry={entry}
      question={t("level.question")}
      introText={ptext(lp, "level.intro")}
      footer={<StepFooter entry={entry} problem={undefined} />}
    >
      <Segmented
        legend={<span id={legendId}>{levelName}</span>}
        name="level"
        options={Array.from({ length: max - min + 1 }, (_, i) => ({
          value: min + i,
          label: String(min + i),
        }))}
        value={ev.level}
        onChange={(level) =>
          guard.request({ type: "setLevel", level }, () => ({
            title: t("level.changeTitle", { levelName }),
            lead: t("level.changeText", { levelName, level }),
            after: t("level.changeAfter", { levelName, old: ev.level }),
          }))
        }
      />
      {hint && (
        <Callout tone="info">
          <RichText lp={lp} text={hint} />
        </Callout>
      )}
      {guard.dialog}
    </StepFrame>
  );
}
