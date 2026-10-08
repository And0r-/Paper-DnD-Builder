"use client";
/**
 * "Get help" (AND-246): the owner shows a help link for this character, as
 * text to send and as a QR code to scan, like the campaign invitation
 * (AND-237). One sentence says what the other person may do. The link is
 * made when the dialog opens (the same one again while it works), and the
 * owner can stop it at once.
 */
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../app-state.tsx";
import { api, ApiError } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { CopyText } from "../components/CopyText.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Callout, Loading } from "../components/Feedback.tsx";
import { QrCode } from "../components/QrCode.tsx";

interface HelpLink {
  url: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

type State =
  | { kind: "loading" }
  | { kind: "link"; link: HelpLink }
  | { kind: "ended" }
  | { kind: "failed"; message: string };

/** "until 22:15", or "until Friday 09:40" when that is not today. */
function untilText(lang: string, iso: string): string {
  const end = new Date(iso);
  const today = end.toDateString() === new Date().toDateString();
  // timeStyle does not mix with weekday: the parts one by one.
  const time = { hour: "2-digit", minute: "2-digit" } as const;
  return new Intl.DateTimeFormat(lang, today ? time : { weekday: "long", ...time }).format(end);
}

export function HelpDialog({
  draftId,
  open,
  onClose,
}: {
  draftId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t, tc, lang } = useApp();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const base = `/api/drafts/${encodeURIComponent(draftId)}/help-link`;

  const failed = useCallback(
    (e: unknown): State => {
      const err = e instanceof ApiError ? e : new ApiError(0, "network");
      if (err.status === 429)
        return {
          kind: "failed",
          message: tc("login.tooMany", Math.max(1, Math.ceil((err.retryAfter ?? 300) / 60))),
        };
      return { kind: "failed", message: err.isNetwork ? t("common.offline") : t("common.loadError") };
    },
    [t, tc],
  );

  const make = useCallback(async () => {
    setBusy(true);
    try {
      const { helpLink } = await api<{ helpLink: HelpLink }>("POST", base);
      setState({ kind: "link", link: helpLink });
    } catch (e) {
      setState(failed(e));
    } finally {
      setBusy(false);
    }
  }, [base, failed]);

  // Opening shows the working link, or makes one: asking for help is why the dialog opened.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ kind: "loading" });
    api<{ helpLink: HelpLink | null }>("GET", base).then(
      ({ helpLink }) => {
        if (!live) return;
        if (helpLink) setState({ kind: "link", link: helpLink });
        else void make();
      },
      (e: unknown) => live && setState(failed(e)),
    );
    return () => {
      live = false;
    };
  }, [open, base, make, failed]);

  const end = async () => {
    setBusy(true);
    try {
      await api("DELETE", base);
      setState({ kind: "ended" });
    } catch (e) {
      setState(failed(e));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (state.kind === "loading") body = <Loading shape="page" count={1} />;
  else if (state.kind === "failed")
    body = (
      <Callout tone="danger" role="alert">
        <p>{state.message}</p>
        <Button variant="secondary" busy={busy} onClick={() => void make()}>
          {t("common.retry")}
        </Button>
      </Callout>
    );
  else if (state.kind === "ended")
    body = (
      <>
        <Callout tone="success" role="status">
          {t("help.ended")}
        </Callout>
        <Button
          variant="secondary"
          icon="refresh"
          busy={busy}
          busyLabel={t("help.making")}
          onClick={() => void make()}
        >
          {t("help.new")}
        </Button>
      </>
    );
  else
    body = (
      <div className="invite__body help-link">
        <div className="invite__link">
          <p>{t("help.text")}</p>
          <p>{t("help.may")}</p>
          <CopyText label={t("help.label")} value={state.link.url} />
          <p className="note">{t("help.until", { time: untilText(lang, state.link.expiresAt) })}</p>
          <Button
            variant="ghost"
            className="btn--danger-text"
            busy={busy}
            busyLabel={t("help.ending")}
            onClick={() => void end()}
          >
            {t("help.end")}
          </Button>
        </div>
        <QrCode value={state.link.url} label={t("help.qr")} />
      </div>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("help.title")}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <div aria-live="polite">{body}</div>
    </Dialog>
  );
}

/** The button that opens "Get help"; only the owner of a character asks for help. */
export function HelpButton({ draftId }: { draftId: string }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon="people" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t("help.button")}
      </Button>
      <HelpDialog draftId={draftId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
