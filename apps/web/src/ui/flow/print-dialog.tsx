"use client";
/**
 * The download dialog of the done screen (sheet plan, sections 2 and 6):
 * which parts go into the PDF (sheet, cards, rules texts), in which design,
 * which version and whether the play state is filled in. Sheet, cards and
 * the play state are ticked until the player picks otherwise (the owner's
 * answer on the sheet plan); the choice is kept on the account and offered
 * again next time. The version is the original unless
 * the character has kept copies; then the player picks one (the sheet
 * screen opens the dialog on the copy it shows).
 */
import {
  DEFAULT_PRINT_CHOICE,
  PRINT_PARTS,
  type PrintChoice,
  type PrintPart,
} from "@builder/sheet/printouts";
import { useEffect, useId, useState } from "react";
import { copyChoice, newestFirst } from "../sheet/copy-name.ts";
import { useApp } from "../app-state.tsx";
import { api, type Account, type SheetDesignInfo } from "../api.ts";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { Callout } from "../components/Feedback.tsx";
import { Segmented } from "../components/Fields.tsx";
import { Icon } from "../components/Icon.tsx";
import { ptext } from "../package-text.ts";
import { useDraft } from "./draft-state.tsx";
import { fileNameOf } from "./file-name.ts";

type PdfState = "idle" | "preparing" | "error" | "notYet";

/** A kept copy of the sheet, as the list of copies gives it. */
interface CopyEntry {
  id: string;
  createdAt: string;
  fromLevel: number;
}

const PART_KEYS = {
  sheet: { name: "print.sheet", text: "print.sheetText" },
  cards: { name: "print.cards", text: "print.cardsText" },
  texts: { name: "print.texts", text: "print.textsText" },
} as const satisfies Record<PrintPart, { name: string; text: string }>;

export function PrintDialog({
  open,
  onClose,
  draftId,
  name,
  hasCards,
  version: startVersion = "original",
}: {
  open: boolean;
  onClose: () => void;
  draftId: string;
  /** The character's name, for the file if the server gives none. */
  name: string | undefined;
  /** Whether the character has things that are cards; if not, cards cannot be ticked. */
  hasCards: boolean;
  /** The version picked when it opens: `original` or the id of a kept copy. */
  version?: string;
}) {
  const { t, lang, account, setAccount } = useApp();
  const levelName = ptext(useDraft().lp, "level.name") ?? "";
  const [parts, setParts] = useState<Set<PrintPart>>(new Set());
  const [design, setDesign] = useState<PrintChoice["design"]>("verbose");
  const [filled, setFilled] = useState(false);
  const [version, setVersion] = useState(startVersion);
  const [copies, setCopies] = useState<CopyEntry[]>([]);
  const [designs, setDesigns] = useState<SheetDesignInfo[]>([]);
  const [pdf, setPdf] = useState<PdfState>("idle");
  const [noPart, setNoPart] = useState(false);
  const id = useId();

  // Every time it opens, it starts from what the account picked last.
  useEffect(() => {
    if (!open) return;
    const stored = account?.print ?? DEFAULT_PRINT_CHOICE;
    setParts(new Set(stored.parts));
    setDesign(stored.design);
    setFilled(stored.state === "filled");
    setVersion(startVersion);
    setPdf("idle");
    setNoPart(false);
    api<{ designs: SheetDesignInfo[] }>("GET", "/api/sheet-designs")
      .then((r) => setDesigns(r.designs))
      .catch(() => setDesigns([]));
    api<{ copies: CopyEntry[] }>("GET", `/api/drafts/${draftId}/sheet-copies`)
      .then((r) => setCopies(r.copies))
      .catch(() => setCopies([]));
  }, [open, account?.print, draftId, startVersion]);

  // A copy is named by when it was kept, in the screen's language ("7. Oktober, 14:20"), as in the sketch.
  const usable = (p: PrintPart) => p !== "cards" || hasCards;
  const chosen = PRINT_PARTS.filter((p) => parts.has(p) && usable(p));

  const toggle = (p: PrintPart) => {
    setNoPart(false);
    setParts((old) => {
      const next = new Set(old);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const download = async () => {
    if (chosen.length === 0) {
      setNoPart(true);
      return;
    }
    setPdf("preparing");
    // Kept for next time; a character without cards does not unlearn that cards were wanted.
    const keep = PRINT_PARTS.filter((p) => (usable(p) ? parts.has(p) : account?.print.parts.includes(p)));
    const state = filled ? "filled" : "empty";
    api<{ account: Account }>("PATCH", "/api/account/settings", { print: { parts: keep, design, state } })
      .then((r) => setAccount(r.account))
      .catch(() => {});
    const query = new URLSearchParams({
      parts: chosen.join(","),
      design,
      // A copy deleted meanwhile prints the original rather than nothing.
      version: copies.some((c) => c.id === version) ? version : "original",
      state,
      // A copy is named by the minute it was made, as on this screen: in this device's time zone.
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    try {
      const res = await fetch(`/api/drafts/${draftId}/pdf?${query}`, {
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
      a.download = fileNameOf(res.headers.get("content-disposition"), `${name || "character"}.pdf`);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setPdf("idle");
      onClose();
    } catch {
      setPdf("error");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("print.title")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            icon="printer"
            busy={pdf === "preparing"}
            busyLabel={t("done.preparing")}
            onClick={download}
          >
            {t("print.download")}
          </Button>
        </>
      }
    >
      <fieldset className="print-parts" aria-describedby={noPart ? `${id}-none` : undefined}>
        <legend className="print-parts__legend">{t("print.parts")}</legend>
        {PRINT_PARTS.map((p) => {
          const inputId = `${id}-${p}`;
          const off = !usable(p);
          const checked = parts.has(p) && !off;
          return (
            <div
              key={p}
              className={`option option--compact${checked ? " option--checked" : ""}${off ? " option--blocked" : ""}`}
              onClick={(e) => {
                // The whole card ticks, as on the choice screens.
                if (off || (e.target as HTMLElement).closest("input, label")) return;
                toggle(p);
              }}
            >
              <div className="option__head">
                <input
                  className="option__input"
                  type="checkbox"
                  id={inputId}
                  name={`${id}-parts`}
                  value={p}
                  checked={checked}
                  disabled={off}
                  onChange={() => toggle(p)}
                  aria-describedby={`${inputId}-text`}
                />
                <span className="option__mark" aria-hidden="true">
                  {checked && <Icon name="check" size={18} />}
                </span>
                <label className="option__name" htmlFor={inputId}>
                  {t(PART_KEYS[p].name)}
                </label>
              </div>
              <p className="option__short" id={`${inputId}-text`}>
                {off ? t("print.cardsNone") : t(PART_KEYS[p].text)}
              </p>
            </div>
          );
        })}
      </fieldset>
      {noPart && (
        <Callout tone="danger" role="alert" id={`${id}-none`}>
          {t("print.noPart")}
        </Callout>
      )}
      {designs.length > 1 && (
        <Segmented
          legend={t("print.design")}
          options={designs.map((d) => ({
            value: d.id as PrintChoice["design"],
            label: d.name[lang] ?? d.id,
          }))}
          value={design}
          onChange={setDesign}
          help={designs.find((d) => d.id === design)?.description[lang]}
        />
      )}
      {copies.length === 0 ? (
        <div className="print-line">
          <span className="print-line__label">{t("print.version")}</span>
          <span>{t("sheet.original")}</span>
        </div>
      ) : (
        <div className="print-version">
          <label className="print-line__label" htmlFor={`${id}-version`}>
            {t("print.version")}
          </label>
          <select
            className="select print-version__select"
            id={`${id}-version`}
            value={copies.some((c) => c.id === version) ? version : "original"}
            onChange={(e) => setVersion(e.target.value)}
          >
            <option value="original">{t("sheet.original")}</option>
            {newestFirst(copies).map((c) => (
              <option key={c.id} value={c.id}>
                {copyChoice(t, lang, levelName, c)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        className={`option option--compact${filled ? " option--checked" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("input, label")) return;
          setFilled((f) => !f);
        }}
      >
        <div className="option__head">
          <input
            className="option__input"
            type="checkbox"
            id={`${id}-state`}
            checked={filled}
            onChange={() => setFilled((f) => !f)}
            aria-describedby={`${id}-state-text`}
          />
          <span className="option__mark" aria-hidden="true">
            {filled && <Icon name="check" size={18} />}
          </span>
          <label className="option__name" htmlFor={`${id}-state`}>
            {t("print.state")}
          </label>
        </div>
        <p className="option__short" id={`${id}-state-text`}>
          {t("print.stateText")}
        </p>
      </div>
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
    </Dialog>
  );
}
