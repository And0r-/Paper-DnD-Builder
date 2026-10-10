"use client";
/**
 * Feedback to the operator (AND-354), opened from the menu only: nothing on
 * the pages points to it. The text is the one field that must be filled;
 * kind and rating are optional, and the page's path and the language come
 * along by themselves (the dialog says so). Not to be confused with
 * Feedback.tsx, the states of anything that loads.
 */
import { useId, useState, type FormEvent } from "react";
import { api, ApiError, type FeedbackKind } from "../api.ts";
import { useApp } from "../app-state.tsx";
import { Button } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";
import { Callout } from "./Feedback.tsx";
import { Segmented, TextField } from "./Fields.tsx";

/** The longest text the server takes (api/routes/feedback.ts). */
const MAX_LENGTH = 2000;

const KINDS = [
  { value: "wrong", key: "feedback.kindWrong" },
  { value: "idea", key: "feedback.kindIdea" },
  { value: "other", key: "feedback.kindOther" },
] as const;

export function FeedbackDialog({
  open,
  onClose,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  /** After the server took it; the dialog is closed by then. */
  onSent: () => void;
}) {
  const { t, tc } = useApp();
  const formId = useId();
  const ratingId = useId();
  const [kind, setKind] = useState<FeedbackKind>("other");
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  function reset() {
    setKind("other");
    setRating(null);
    setText("");
    setMissing(false);
    setError(undefined);
  }

  function cancel() {
    if (busy) return;
    setMissing(false);
    setError(undefined);
    onClose();
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!text.trim()) {
      setMissing(true);
      document.getElementById(`${formId}-text`)?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // The path only: a query or a hash could hold a token.
      await api("POST", "/api/feedback", { kind, rating, text, page: window.location.pathname });
      reset();
      onClose();
      onSent();
    } catch (err) {
      const failure = err instanceof ApiError ? err : new ApiError(0, "network");
      if (failure.status === 429) {
        setError(tc("login.tooMany", Math.max(1, Math.ceil((failure.retryAfter ?? 300) / 60))));
      } else if (failure.code === "keyCannotFeedback") setError(t("feedback.keyCannotFeedback"));
      else setError(failure.isNetwork ? t("common.offline") : t("feedback.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={cancel}
      title={t("feedback.title")}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} icon="send" busy={busy} busyLabel={t("feedback.sending")}>
            {t("feedback.send")}
          </Button>
        </>
      }
    >
      <form id={formId} className="feedback-form" noValidate onSubmit={send}>
        <p>{t("feedback.intro")}</p>
        <Segmented
          legend={t("feedback.kind")}
          options={KINDS.map((k) => ({ value: k.value, label: t(k.key) }))}
          value={kind}
          onChange={setKind}
        />
        <fieldset className="rating">
          <legend className="segmented__legend">{t("feedback.rating")}</legend>
          <div className="rating__row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className="rating__star"
                aria-pressed={rating === n}
                aria-label={t("feedback.ratingValue", { rating: n })}
                aria-describedby={ratingId}
                data-filled={rating !== null && n <= rating ? "" : undefined}
                // Tapping the chosen one again takes the rating back: it is optional.
                onClick={() => setRating((r) => (r === n ? null : n))}
              >
                <span aria-hidden="true">{rating !== null && n <= rating ? "★" : "☆"}</span>
              </button>
            ))}
          </div>
          <p className="segmented__help" id={ratingId}>
            {t("feedback.ratingHelp")}
          </p>
        </fieldset>
        <TextField
          id={`${formId}-text`}
          label={t("feedback.text")}
          multiline
          rows={5}
          maxLength={MAX_LENGTH}
          value={text}
          error={missing ? t("feedback.textMissing") : undefined}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (missing) setMissing(false);
          }}
        />
        <p className="feedback-form__note">{t("feedback.note")}</p>
        <div aria-live="polite">
          {error && (
            <Callout tone="danger" role="alert">
              {error}
            </Callout>
          )}
        </div>
      </form>
    </Dialog>
  );
}
