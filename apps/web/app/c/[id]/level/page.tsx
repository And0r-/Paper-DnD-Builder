"use client";
/**
 * Level (flow spec 4.4). The word for "level" and the explanations come from
 * the package. Not one button per level (20 would be a wall of numbers):
 * the levels the package names as common (`level.pick.<n>`) stand as big
 * cards, any other level is one card with a number to step or type.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { RichText } from "../../../../src/ui/components/RichText.tsx";
import { Callout } from "../../../../src/ui/components/Feedback.tsx";
import { Icon } from "../../../../src/ui/components/Icon.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { useGuardedChange } from "../../../../src/ui/flow/guard.tsx";
import { LEVEL_KEY } from "../../../../src/ui/flow/model.ts";
import { levelWord, ptext } from "../../../../src/ui/package-text.ts";

export default function LevelPage() {
  const { t } = useApp();
  const { lp, ev, entries, raise, draft } = useDraft();
  const router = useRouter();
  const guard = useGuardedChange();
  const legendId = useId();
  const otherId = useId();
  const entry = entries.find((e) => e.key === LEVEL_KEY);
  const { min, max } = lp.pkg.flow.level;
  const recommended = lp.pkg.flow.level.default ?? min;
  const levelName = ptext(lp, "level.name") ?? "";
  const word = levelWord(lp);
  const hint = ptext(lp, "level.hint");
  // The common levels: those the package says something about, else only the recommended one.
  const named = Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(
    (n) => ptext(lp, `level.pick.${n}`) !== undefined,
  );
  const quick = named.length > 0 ? named : [recommended];
  const [other, setOther] = useState(!quick.includes(ev.level));
  const [text, setText] = useState(String(ev.level));
  const otherChosen = other || !quick.includes(ev.level);
  // During a level up the level is chosen on the level-up screen, only above the old one.
  useEffect(() => {
    if (raise) router.replace(`/c/${draft.id}/raise`);
  }, [raise, draft.id, router]);
  if (!entry) return null;

  const setLevel = (level: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(level)));
    setText(String(clamped));
    if (clamped === ev.level) return;
    guard.request({ type: "setLevel", level: clamped }, () => ({
      title: t("level.changeTitle", { levelName }),
      lead: t("level.changeText", { levelName, level: clamped }),
      after: t("level.changeAfter", { levelName, old: ev.level }),
    }));
  };

  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) setLevel(n);
    else setText(String(ev.level));
  };

  return (
    <StepFrame
      entry={entry}
      question={t("level.question", { levelName: word })}
      introText={ptext(lp, "level.intro")}
      footer={<StepFooter entry={entry} problem={undefined} />}
    >
      <fieldset className="options levels" aria-labelledby={legendId}>
        <legend className="visually-hidden" id={legendId}>
          {levelName}
        </legend>
        <div className="options__list">
          {quick.map((n) => {
            const checked = !otherChosen && ev.level === n;
            const note = ptext(lp, `level.pick.${n}`);
            return (
              <label
                key={n}
                className={`option option--simple level-card${checked ? " option--checked" : ""}`}
              >
                <span className="option__head">
                  <input
                    className="option__input"
                    type="radio"
                    name="level"
                    value={n}
                    checked={checked}
                    onChange={() => {
                      setOther(false);
                      setLevel(n);
                    }}
                  />
                  <span className="option__mark" aria-hidden="true">
                    {checked && <Icon name="dot" size={14} />}
                  </span>
                  <span className="option__name">{t("flow.atLevel", { levelName, level: n })}</span>
                  {n === recommended && <span className="badge">{t("common.recommended")}</span>}
                </span>
                {note && (
                  <span className="option__short">
                    <RichText lp={lp} text={note} />
                  </span>
                )}
              </label>
            );
          })}
          <div className={`option option--simple level-card${otherChosen ? " option--checked" : ""}`}>
            <label className="option__head">
              <input
                className="option__input"
                type="radio"
                name="level"
                value="other"
                checked={otherChosen}
                onChange={() => {
                  setOther(true);
                  setText(String(ev.level));
                }}
              />
              <span className="option__mark" aria-hidden="true">
                {otherChosen && <Icon name="dot" size={14} />}
              </span>
              <span className="option__name">{t("level.another", { levelName: word })}</span>
            </label>
            {otherChosen && (
              <div className="level-other">
                <div className="stepper stepper--wide">
                  <button
                    type="button"
                    className="stepper__btn"
                    aria-label={t("level.lower", { levelName: word })}
                    aria-controls={otherId}
                    aria-disabled={ev.level <= min || undefined}
                    onClick={() => ev.level > min && setLevel(ev.level - 1)}
                  >
                    <Icon name="minus" />
                  </button>
                  <input
                    id={otherId}
                    className="stepper__input"
                    type="number"
                    inputMode="numeric"
                    min={min}
                    max={max}
                    value={text}
                    aria-label={levelName}
                    aria-describedby={`${otherId}-range`}
                    // A typed level counts once it is complete (on Enter or on leaving
                    // the field): "12" must not pass through level 1 on the way.
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commit();
                    }}
                    onBlur={commit}
                  />
                  <button
                    type="button"
                    className="stepper__btn"
                    aria-label={t("level.higher", { levelName: word })}
                    aria-controls={otherId}
                    aria-disabled={ev.level >= max || undefined}
                    onClick={() => ev.level < max && setLevel(ev.level + 1)}
                  >
                    <Icon name="plus" />
                  </button>
                </div>
                <p className="field__help" id={`${otherId}-range`}>
                  {t("number.range", { min, max })}
                </p>
              </div>
            )}
          </div>
        </div>
      </fieldset>
      {hint && (
        <Callout tone="info">
          <RichText lp={lp} text={hint} />
        </Callout>
      )}
      {guard.dialog}
    </StepFrame>
  );
}
