"use client";
/**
 * The online sheet of a character (sheet plan, section 5; screen as
 * approved in round 2 of the sketches): the sheet in the account's design,
 * the original or one of the player's own versions, changed in place.
 *
 * At a desk the tools are a bar above the page: version, look, language,
 * clear all ticks, level up, to the builder, download. On a phone the top
 * bar has only the menu, the name and "saved"; the tools are the group
 * "Sheet" at the top of the app's menu.
 */
import { cardCount } from "@builder/sheet/cards";
import { screenDesign } from "@builder/sheet/designs/screens";
import { SHEET_DESIGNS, type PrintChoice } from "@builder/sheet/printouts";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { LANGUAGE_NAMES, UI_LANGUAGES, isUiLanguage } from "../../i18n/index.ts";
import { api, type Account, type SheetDesignInfo } from "../api.ts";
import { useApp } from "../app-state.tsx";
import { Button, ButtonLink } from "../components/Button.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../components/Feedback.tsx";
import { AppShell } from "../components/Shell.tsx";
import { useDraft } from "../flow/draft-state.tsx";
import { usePageTitle } from "../flow/frame.tsx";
import { PrintDialog } from "../flow/print-dialog.tsx";
import { copyName } from "./copy-name.ts";
import { ORIGINAL, useSheet, type SaveState, type SheetController } from "./sheet-state.ts";
import { SHEET_UI, SheetUiProvider } from "./sheet-ui.tsx";

/** "Saved", and for a short while after clearing all ticks or crossing out a row, "Undo" beside it. */
function SaveLine({ sheet }: { sheet: SheetController }) {
  const { t } = useApp();
  const save: SaveState = sheet.save;
  return (
    <div className="sheet-save">
      <p className={`save-status save-status--${save}`} aria-live="polite">
        {save === "idle" ? "" : t(`save.${save}`)}
      </p>
      {sheet.undo && (
        <button
          type="button"
          className="sheet-undo"
          aria-label={t(sheet.undo === "checks" ? "sheet.undoChecks" : "sheet.undoRow")}
          onClick={sheet.runUndo}
        >
          {t("sheet.undo")}
        </button>
      )}
    </div>
  );
}

export function SheetPage() {
  const { t, account, setAccount, setLanguage } = useApp();
  const { lp, ev, draft } = useDraft();
  const sheet = useSheet(draft.id);
  const [printing, setPrinting] = useState(false);
  const [designs, setDesigns] = useState<SheetDesignInfo[]>(
    SHEET_DESIGNS.map((d) => ({ id: d.id, name: { ...d.name }, description: { ...d.description } })),
  );
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name = (nameState?.answer as { text?: string } | undefined)?.text?.trim();
  usePageTitle([name ?? t("common.unnamed"), t("sheet.group")]);
  const hasCards = useMemo(() => cardCount(lp.pkg, ev) > 0, [lp.pkg, ev]);

  useEffect(() => {
    api<{ designs: SheetDesignInfo[] }>("GET", "/api/sheet-designs")
      .then((r) => setDesigns(r.designs))
      .catch(() => {});
  }, []);

  const design = account?.print.design ?? SHEET_DESIGNS[0]!.id;
  const Design = screenDesign(design);
  const finished = draft.status === "finished";
  const canRaise = finished && ev.level < lp.pkg.flow.level.max;
  const tools = {
    sheet,
    designs,
    design,
    setDesign: (next: string) => {
      api<{ account: Account }>("PATCH", "/api/account/settings", {
        print: { design: next as PrintChoice["design"] },
      })
        .then((r) => setAccount(r.account))
        .catch(() => {});
    },
    setLanguage: (next: string) => {
      if (isUiLanguage(next)) setLanguage(next).catch(() => {});
    },
    canRaise,
    draftId: draft.id,
    onDownload: () => setPrinting(true),
  };

  return (
    <AppShell
      title={<span className="sheet-topbar__name">{name ?? t("common.unnamed")}</span>}
      status={<SaveLine sheet={sheet} />}
      menuExtra={<SheetTools {...tools} variant="menu" />}
      wide
    >
      <div className="sheet-screen">
        <SheetTools {...tools} variant="bar" />
        {sheet.notice && (
          <Callout tone="info" role="status">
            {t(`sheet.${sheet.notice}`, { max: sheet.max })}
          </Callout>
        )}
        {sheet.atLimit && !sheet.notice && (
          <Callout tone="info">{t("sheet.limit", { max: sheet.max })}</Callout>
        )}
        <SheetBody sheet={sheet} draftId={draft.id}>
          {sheet.model && (
            <SheetUiProvider sheet={sheet}>
              <Design model={sheet.model} ui={SHEET_UI} />
            </SheetUiProvider>
          )}
        </SheetBody>
      </div>
      <PrintDialog
        open={printing}
        onClose={() => setPrinting(false)}
        draftId={draft.id}
        name={name}
        hasCards={hasCards}
        version={sheet.version}
      />
    </AppShell>
  );
}

function SheetBody({
  sheet,
  draftId,
  children,
}: {
  sheet: SheetController;
  draftId: string;
  children: ReactNode;
}) {
  const { t } = useApp();
  if (sheet.load === "loading") return <Loading shape="page" count={3} />;
  if (sheet.load === "error") return <ErrorState onRetry={() => void sheet.reload()} />;
  if (sheet.problem === "notFinished") {
    return (
      <EmptyState title={t("sheet.notFinishedTitle")}>
        <p>{t("sheet.notFinishedText")}</p>
        <ButtonLink href={`/c/${draftId}/overview`}>{t("sheet.toBuilder")}</ButtonLink>
      </EmptyState>
    );
  }
  if (sheet.problem === "language") return <EmptyState title={t("sheet.languageMissing")} />;
  if (sheet.problem === "package") return <EmptyState title={t("flow.packageUnavailable")} />;
  return <>{children}</>;
}

function SheetTools({
  variant,
  sheet,
  designs,
  design,
  setDesign,
  setLanguage,
  canRaise,
  draftId,
  onDownload,
}: {
  variant: "bar" | "menu";
  sheet: SheetController;
  designs: SheetDesignInfo[];
  design: string;
  setDesign: (id: string) => void;
  setLanguage: (lang: string) => void;
  canRaise: boolean;
  draftId: string;
  onDownload: () => void;
}) {
  const { t, lang } = useApp();
  const id = useId();
  // Newest first, after the original.
  const copies = [...sheet.copies].reverse();
  const select = (
    key: string,
    label: string,
    value: string,
    options: ReactOption[],
    onChange: (v: string) => void,
  ) => (
    <div className="sheet-tools__field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <select
        id={`${id}-${key}`}
        className="sheet-tools__select"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} lang={o.lang}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  const clear = (
    <Button variant="secondary" onClick={sheet.clearChecks} disabled={sheet.load !== "ready"}>
      {t("sheet.clearChecks")}
    </Button>
  );
  const raise = canRaise && (
    <ButtonLink href={`/c/${draftId}/raise`} variant="secondary">
      {t("raise.button")}
    </ButtonLink>
  );
  const toBuilder = (
    <ButtonLink href={`/c/${draftId}/overview`} variant="secondary">
      {t("sheet.toBuilder")}
    </ButtonLink>
  );
  const download = (
    <Button icon="printer" onClick={onDownload} aria-haspopup="dialog" disabled={sheet.load !== "ready"}>
      {t("sheet.download")}
    </Button>
  );
  const body = (
    <>
      {select(
        "version",
        t("sheet.version"),
        sheet.version,
        [
          { value: ORIGINAL, label: t("sheet.original") },
          ...copies.map((c) => ({ value: c.id, label: copyName(t, lang, c) })),
        ],
        sheet.select,
      )}
      {select(
        "design",
        t("sheet.design"),
        design,
        designs.map((d) => ({ value: d.id, label: d.name[lang] ?? d.id })),
        setDesign,
      )}
      {select(
        "language",
        t("sheet.language"),
        lang,
        UI_LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l], lang: l })),
        setLanguage,
      )}
      <div className="sheet-tools__actions">
        {variant === "bar" ? (
          <>
            {clear}
            {raise}
            {toBuilder}
            {download}
          </>
        ) : (
          // In the menu as in the sketch: what one comes for first, leaving the sheet last.
          <>
            {raise}
            {download}
            {clear}
            {toBuilder}
          </>
        )}
      </div>
    </>
  );
  return variant === "bar" ? (
    <div className="sheet-tools sheet-tools--bar" role="group" aria-label={t("sheet.tools")}>
      {body}
    </div>
  ) : (
    <section className="sheet-tools sheet-tools--menu" aria-labelledby={`${id}-group`}>
      <h2 className="sheet-tools__group" id={`${id}-group`}>
        {t("sheet.group")}
      </h2>
      {body}
    </section>
  );
}

interface ReactOption {
  value: string;
  label: string;
  lang?: string;
}
