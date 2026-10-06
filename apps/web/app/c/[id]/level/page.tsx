"use client";
/**
 * Level (flow spec 4.4). The word for "level" and the explanations come from
 * the package. One number field, starting at the package's default level,
 * with a button lower and a button higher (AND-95): no cards, no range line.
 * Under the field at most the package's one-sentence hint.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { RichText } from "../../../../src/ui/components/RichText.tsx";
import { Icon } from "../../../../src/ui/components/Icon.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { StepFooter, StepFrame } from "../../../../src/ui/flow/frame.tsx";
import { useGuardedChange } from "../../../../src/ui/flow/guard.tsx";
import { LEVEL_KEY } from "../../../../src/ui/flow/model.ts";
import { typedLevel } from "../../../../src/ui/flow/typed-level.ts";
import { levelWord, ptext } from "../../../../src/ui/package-text.ts";

/** How long a typed level that may still grow waits for the next digit. */
const WAIT_MS = 700;

export default function LevelPage() {
  const { t } = useApp();
  const { lp, ev, entries, raise, draft } = useDraft();
  const router = useRouter();
  const guard = useGuardedChange();
  const fieldId = useId();
  const entry = entries.find((e) => e.key === LEVEL_KEY);
  const { min, max } = lp.pkg.flow.level;
  const levelName = ptext(lp, "level.name") ?? "";
  const word = levelWord(lp);
  const hint = ptext(lp, "level.hint");
  const [text, setText] = useState(String(ev.level));
  // A typed level that may still grow by a digit ("1" on the way to "12") waits a moment.
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pending.current), []);
  // During a level up the level is chosen on the level-up screen, only above the old one.
  useEffect(() => {
    if (raise) router.replace(`/c/${draft.id}/raise`);
  }, [raise, draft.id, router]);
  if (!entry) return null;

  const setLevel = (level: number) => {
    clearTimeout(pending.current);
    const clamped = Math.min(max, Math.max(min, Math.round(level)));
    setText(String(clamped));
    if (clamped === ev.level) return;
    // Kept as it was (or refused): the field shows the level again.
    const keep = () => setText(String(ev.level));
    const asked = guard.request(
      { type: "setLevel", level: clamped },
      () => ({
        title: t("level.changeTitle", { levelName }),
        lead: t("level.changeText", { levelName, level: clamped }),
        after: t("level.changeAfter", { levelName, old: ev.level }),
      }),
      keep,
    );
    if (!asked) keep();
  };

  // A typed level counts as soon as it is complete, so the top bar shows what the field says.
  const type = (value: string) => {
    setText(value);
    clearTimeout(pending.current);
    const typed = typedLevel(value, min, max);
    if (typed.level === undefined) return;
    const level = typed.level;
    if (typed.complete) setLevel(level);
    else pending.current = setTimeout(() => setLevel(level), WAIT_MS);
  };

  const commit = () => {
    clearTimeout(pending.current);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) setLevel(n);
    else setText(String(ev.level));
  };

  // The range is only said when the typed number is outside it.
  const invalid = typedLevel(text, min, max).invalid;
  const described = [invalid && `${fieldId}-error`, hint && `${fieldId}-hint`].filter(Boolean).join(" ");
  return (
    <StepFrame
      entry={entry}
      question={t("level.question", { levelName: word })}
      introText={ptext(lp, "level.intro")}
      footer={<StepFooter entry={entry} problem={undefined} />}
    >
      <div className="field level-field">
        <label className="field__label" htmlFor={fieldId}>
          {levelName}
        </label>
        <div className="stepper">
          <button
            type="button"
            className="stepper__btn"
            aria-label={t("level.lower", { levelName: word })}
            aria-controls={fieldId}
            aria-disabled={ev.level <= min || undefined}
            onClick={() => ev.level > min && setLevel(ev.level - 1)}
          >
            <Icon name="minus" />
          </button>
          <input
            id={fieldId}
            className="stepper__input"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={text}
            aria-describedby={described || undefined}
            aria-invalid={invalid || undefined}
            onChange={(e) => type(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              // The same Enter must not also press the button of the dialog that may open now.
              e.preventDefault();
              commit();
            }}
            onBlur={commit}
          />
          <button
            type="button"
            className="stepper__btn"
            aria-label={t("level.higher", { levelName: word })}
            aria-controls={fieldId}
            aria-disabled={ev.level >= max || undefined}
            onClick={() => ev.level < max && setLevel(ev.level + 1)}
          >
            <Icon name="plus" />
          </button>
        </div>
        {invalid && (
          <p className="field__error" id={`${fieldId}-error`}>
            {t("number.range", { min, max })}
          </p>
        )}
        {hint && (
          <p className="field__help" id={`${fieldId}-hint`}>
            <RichText lp={lp} text={hint} />
          </p>
        )}
      </div>
      {guard.dialog}
    </StepFrame>
  );
}
