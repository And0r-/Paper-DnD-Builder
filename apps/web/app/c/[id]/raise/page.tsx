"use client";
/**
 * Level up a finished character (plan 4.2): to which level, and in a
 * sentence what happens (everything chosen stays, only the new questions
 * come). The same cards as the level screen, but only levels above the
 * current one; one level higher is recommended. Nothing changes before the
 * button is pressed, and a raise under way can be stopped here.
 */
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { ConfirmDialog } from "../../../../src/ui/components/Dialog.tsx";
import { Callout, EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { Icon } from "../../../../src/ui/components/Icon.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { usePageTitle } from "../../../../src/ui/flow/frame.tsx";
import { firstOpen } from "../../../../src/ui/flow/model.ts";
import { typedLevel } from "../../../../src/ui/flow/typed-level.ts";
import { levelWord, ptext } from "../../../../src/ui/package-text.ts";

export default function RaisePage() {
  const { t } = useApp();
  const router = useRouter();
  const { lp, ev, draft, raise, entries, change, flush, finish, levelUp } = useDraft();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const legendId = useId();
  const otherId = useId();
  const keepId = useId();
  const levelName = ptext(lp, "level.name") ?? "";
  const word = levelWord(lp);
  const { max } = lp.pkg.flow.level;
  // A raise under way may go to any level above where it started.
  const base = raise?.from ?? ev.level;
  const min = base + 1;
  const [target, setTarget] = useState(() => (raise ? raise.to : Math.min(max, base + 1)));
  const [other, setOther] = useState(target !== min);
  const [text, setText] = useState(String(target));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  // After the raise the flow is the new one: go to its first step once it is there.
  const [go, setGo] = useState(false);
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name = (nameState?.answer as { text?: string } | undefined)?.text?.trim() ?? "";
  const question = name
    ? t("raise.question", { levelName: word, name })
    : t("raise.questionUnnamed", { levelName: word });
  usePageTitle([question]);
  useEffect(() => headingRef.current?.focus(), []);
  useEffect(() => {
    if (go && raise) router.push(entries[0]!.href);
  }, [go, raise, entries, router]);

  if (!raise && draft.status !== "finished") {
    return (
      <div className="page">
        <EmptyState title={t("raise.notFinished")}>
          <ButtonLink href={firstOpen(entries).href}>{t("raise.toFirstOpen")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }
  if (base >= max) {
    return (
      <div className="page">
        <EmptyState title={t("raise.atTop", { levelName, level: base })}>
          <ButtonLink href={`/c/${draft.id}/done`}>{t("done.toList")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }

  const pick = (n: number) => {
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setTarget(clamped);
    setText(String(clamped));
    setFailed(false);
  };
  // A typed level counts at once, so the button and the hint never name another level than the field.
  const type = (value: string) => {
    setText(value);
    const typed = typedLevel(value, min, max);
    if (typed.level !== undefined) {
      setTarget(typed.level);
      setFailed(false);
    }
  };
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) pick(n);
    else setText(String(target));
  };

  const start = async () => {
    setBusy(true);
    setFailed(false);
    if (raise && target < raise.to) {
      // Fewer levels than before: the answers of the levels left out stay remembered.
      change({ type: "setLevel", level: target });
      const ok = await flush();
      setBusy(false);
      if (ok) setGo(true);
      else setFailed(true);
      return;
    }
    if (raise && target === raise.to) {
      setBusy(false);
      setGo(true);
      return;
    }
    const r = await levelUp(target);
    setBusy(false);
    if (r === "failed") setFailed(true);
    else if (r === "finished") router.push(`/c/${draft.id}/done?from=${base}&asked=0`);
    else setGo(true);
  };

  const stop = async () => {
    if (!raise) return;
    setStopping(true);
    setStopFailed(false);
    change({ type: "setLevel", level: raise.from });
    const r = await finish();
    setStopping(false);
    if (r === "failed") {
      setStopFailed(true);
      setConfirmStop(false);
      return;
    }
    router.push(r === "ok" ? `/c/${draft.id}/done` : `/c/${draft.id}/overview`);
  };

  const invalid = typedLevel(text, min, max).invalid;
  const oneUp = Math.min(max, base + 1);
  const otherChosen = other || target !== oneUp;
  return (
    <div className="page raise">
      <div className="question">
        <h1 className="question__title" tabIndex={-1} ref={headingRef}>
          {question}
        </h1>
        <p className="question__intro">{t("raise.now", { levelName, level: base })}</p>
      </div>

      <fieldset className="options levels" aria-labelledby={legendId} aria-describedby={keepId}>
        <legend className="visually-hidden" id={legendId}>
          {levelName}
        </legend>
        <div className="options__list">
          <label className={`option option--simple level-card${!otherChosen ? " option--checked" : ""}`}>
            <span className="option__head">
              <input
                className="option__input"
                type="radio"
                name="raise"
                value={oneUp}
                checked={!otherChosen}
                onChange={() => {
                  setOther(false);
                  pick(oneUp);
                }}
              />
              <span className="option__mark" aria-hidden="true">
                {!otherChosen && <Icon name="dot" size={14} />}
              </span>
              <span className="option__name">{t("flow.atLevel", { levelName, level: oneUp })}</span>
              <span className="badge">{t("common.recommended")}</span>
            </span>
            <span className="option__short">
              {t("raise.oneUp", { levelName: word })}. {t("raise.oneUpNote")}
            </span>
          </label>
          {oneUp < max && (
            <div className={`option option--simple level-card${otherChosen ? " option--checked" : ""}`}>
              <label className="option__head">
                <input
                  className="option__input"
                  type="radio"
                  name="raise"
                  value="other"
                  checked={otherChosen}
                  onChange={() => {
                    setOther(true);
                    pick(Math.max(target, oneUp + 1));
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
                      aria-disabled={target <= min || undefined}
                      onClick={() => target > min && pick(target - 1)}
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
                      aria-invalid={invalid || undefined}
                      onChange={(e) => type(e.target.value)}
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
                      aria-disabled={target >= max || undefined}
                      onClick={() => target < max && pick(target + 1)}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                  <p className={invalid ? "field__error" : "field__help"} id={`${otherId}-range`}>
                    {t("number.range", { min, max })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </fieldset>

      <div id={keepId}>
        <Callout tone="info">
          {t(target === base + 1 ? "raise.keep" : "raise.keepRange", { levelName, level: target })}
        </Callout>
      </div>

      <div aria-live="polite">
        {failed && (
          <Callout tone="danger" role="alert">
            {t("raise.error")}
          </Callout>
        )}
        {stopFailed && (
          <Callout tone="danger" role="alert">
            {t("raise.cancelError")}
          </Callout>
        )}
      </div>

      <div className="raise__actions">
        <ButtonLink
          href={raise ? `/c/${draft.id}/overview` : `/c/${draft.id}/done`}
          variant="secondary"
          icon="arrowLeft"
        >
          {t("common.back")}
        </ButtonLink>
        <Button iconAfter="arrowRight" onClick={start} busy={busy} busyLabel={t("raise.going")}>
          {t("raise.go", { levelName, level: target })}
        </Button>
      </div>
      {raise && (
        <p className="raise__stop">
          <button type="button" className="link-button" onClick={() => setConfirmStop(true)}>
            {t("raise.cancel")}
          </button>
        </p>
      )}

      <ConfirmDialog
        open={confirmStop}
        title={t("raise.cancelTitle")}
        cancelLabel={t("raise.cancelKeep")}
        confirmLabel={t("raise.cancelConfirm")}
        busy={stopping}
        busyLabel={t("raise.going")}
        onCancel={() => setConfirmStop(false)}
        onConfirm={stop}
      >
        <p>
          {name
            ? t("raise.cancelText", { name, levelName, level: base })
            : t("raise.cancelTextUnnamed", { levelName, level: base })}
        </p>
      </ConfirmDialog>
    </div>
  );
}
