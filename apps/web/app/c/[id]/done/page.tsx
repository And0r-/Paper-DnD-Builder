"use client";
/**
 * The end (flow spec 4.7). It shapes the memory of everything before it:
 * calm, clear, and the printout one tap away. No confetti.
 */
import { cardCount } from "@builder/print/cards";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../../../../src/ui/app-state.tsx";
import { Button, ButtonLink } from "../../../../src/ui/components/Button.tsx";
import { Callout, EmptyState } from "../../../../src/ui/components/Feedback.tsx";
import { Icon } from "../../../../src/ui/components/Icon.tsx";
import { useDraft } from "../../../../src/ui/flow/draft-state.tsx";
import { usePageTitle } from "../../../../src/ui/flow/frame.tsx";
import { Origins } from "../../../../src/ui/flow/origins.tsx";

type PdfState = "idle" | "preparing" | "error" | "notYet";

export default function DonePage() {
  const { t } = useApp();
  const { lp, ev, draft } = useDraft();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pdf, setPdf] = useState<PdfState>("idle");
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name = (nameState?.answer as { text?: string } | undefined)?.text?.trim();
  const title = name ? t("done.title", { name }) : t("done.titleUnnamed");
  usePageTitle([title]);
  // Only promise cards when the PDF has some: not every character has things that are cards.
  const hasCards = useMemo(() => cardCount(lp.pkg, ev) > 0, [lp.pkg, ev]);
  useEffect(() => headingRef.current?.focus(), []);

  if (draft.status !== "finished") {
    return (
      <div className="page">
        <EmptyState title={t("done.notFinished")}>
          <ButtonLink href={`/c/${draft.id}/overview`}>{t("done.toOverview")}</ButtonLink>
        </EmptyState>
      </div>
    );
  }

  // The PDF comes from the server (AND-8). Until that route exists, say so plainly.
  const download = async () => {
    setPdf("preparing");
    try {
      const res = await fetch(`/api/drafts/${draft.id}/pdf`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.status === 404 && !res.headers.get("content-type")?.includes("pdf")) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        setPdf(body?.error?.code === "draftNotFound" ? "error" : "notYet");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name || "character"}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPdf("idle");
    } catch {
      setPdf("error");
    }
  };

  return (
    <div className="page done">
      <Icon name="check" size={56} className="done__icon" />
      <h1 className="done__title" tabIndex={-1} ref={headingRef}>
        {title}
      </h1>
      <p className="done__text">{t(hasCards ? "done.text" : "done.textSheetOnly")}</p>
      <div className="done__pdf">
        <Button
          icon="printer"
          block
          busy={pdf === "preparing"}
          busyLabel={t("done.preparing")}
          onClick={download}
        >
          {t("done.download")}
        </Button>
        <div aria-live="polite">
          {pdf === "error" && (
            <Callout tone="danger" role="alert">
              {t("done.pdfError")}{" "}
              <button type="button" className="link-button" onClick={download}>
                {t("common.retry")}
              </button>
            </Callout>
          )}
          {pdf === "notYet" && <Callout tone="info">{t("done.pdfNotYet")}</Callout>}
        </div>
        <p className="done__tip">{t(hasCards ? "done.tip" : "done.tipSheetOnly")}</p>
      </div>
      <Origins />
      <p className="note">{t("done.editHint")}</p>
      <div className="done__next">
        <ButtonLink href="/characters" variant="secondary">
          {t("done.toList")}
        </ButtonLink>
        <ButtonLink href="/new" variant="secondary" icon="plus">
          {t("done.another")}
        </ButtonLink>
      </div>
    </div>
  );
}
