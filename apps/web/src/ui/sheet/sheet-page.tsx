"use client";
/**
 * The online sheet of a character (sheet plan, section 5; screen as
 * approved in round 2 of the sketches): the sheet in the account's design,
 * the original or one of the player's own versions, changed in place.
 *
 * At a desk the version and the look are lists in the top bar, beside the
 * language (AND-227), and the rest of the tools a bar above the page: clear
 * all ticks, level up, to the builder, download. On a phone the top bar has
 * only the menu, the name, "saved" and the language; the tools are the
 * group "Sheet" at the top of the app's menu. The language is the top
 * bar's, as on every screen: the sheet follows it from the app state.
 */
import { sheetFieldNames, type SheetModel } from "@builder/sheet";
import { cardCount } from "@builder/sheet/cards";
import { screenDesign } from "@builder/sheet/designs/screens";
import type { PrintPlaces } from "@builder/sheet/designs/screens";
import { SHEET_DESIGNS, type PrintChoice } from "@builder/sheet/printouts";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { api, type Account, type SheetDesignInfo } from "../api.ts";
import { useApp } from "../app-state.tsx";
import { Button, ButtonLink } from "../components/Button.tsx";
import { Callout, EmptyState, ErrorState, Loading } from "../components/Feedback.tsx";
import { CompactSelect, type CompactOption } from "../components/Fields.tsx";
import { PackageLanguageNote } from "../components/PackageLanguageNote.tsx";
import { AppShell } from "../components/Shell.tsx";
import { useDraft } from "../flow/draft-state.tsx";
import { LiveBar } from "../live/live-bar.tsx";
import { SaveLine as SaveStatusLine, usePageTitle } from "../flow/frame.tsx";
import { ptext } from "../package-text.ts";
import { PrintDialog } from "../flow/print-dialog.tsx";
import { copyChoice, newestFirst } from "./copy-name.ts";
import { ORIGINAL, useSheet, type SheetController } from "./sheet-state.ts";
import { SHEET_UI, SheetUiProvider } from "./sheet-ui.tsx";

/** "Saved", and for a short while after clearing all ticks or crossing out a row, "Undo" beside it. */
function SaveLine({ sheet }: { sheet: SheetController }) {
  const { t } = useApp();
  return (
    <div className="sheet-save">
      <SaveStatusLine state={sheet.save} />
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
  const { t, account, setAccount } = useApp();
  const { lp, ev, draft, listen } = useDraft();
  const sheet = useSheet(draft.id, listen);
  const [printing, setPrinting] = useState(false);
  const [designs, setDesigns] = useState<SheetDesignInfo[]>(
    SHEET_DESIGNS.map((d) => ({ id: d.id, name: { ...d.name }, description: { ...d.description } })),
  );
  const nameState = ev.choices[lp.pkg.flow.characterName];
  const name = (nameState?.answer as { text?: string } | undefined)?.text?.trim();
  usePageTitle([name ?? t("common.unnamed"), t("sheet.group")]);
  // A change made elsewhere names the field as this sheet calls it: "Stamina".
  const fieldNames = useMemo(() => (sheet.model ? sheetFieldNames(sheet.model) : null), [sheet.model]);
  const fieldName = useMemo(() => (id: string) => fieldNames?.get(id) ?? null, [fieldNames]);
  const hasCards = useMemo(() => cardCount(lp.pkg, ev) > 0, [lp.pkg, ev]);

  useEffect(() => {
    api<{ designs: SheetDesignInfo[] }>("GET", "/api/sheet-designs")
      .then((r) => setDesigns(r.designs))
      .catch(() => {});
  }, []);

  const design = account?.print.design ?? SHEET_DESIGNS[0]!.id;
  const Design = screenDesign(design);
  const nameOnSheet = useNameInView(sheet.model !== null, design);
  const places = usePrintPlaces(draft.id, sheet.model, design);
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
    canRaise,
    draftId: draft.id,
    onDownload: () => setPrinting(true),
  };

  return (
    <AppShell
      // The name once at the top: in the bar only once the sheet's own has scrolled away.
      title={
        <span className="sheet-topbar__name" hidden={nameOnSheet}>
          {name ?? t("common.unnamed")}
        </span>
      }
      status={<SaveLine sheet={sheet} />}
      bar={<LiveBar fieldName={fieldName} />}
      tools={<SheetLists {...tools} />}
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
              <Design model={sheet.model} ui={SHEET_UI} places={places} />
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

/**
 * Where the PDF breaks the pages of the sheet as shown, for the design to
 * break its pages on screen there too: asked a short pause after the model
 * or the design last changed. Null until known, or when asking failed (the design
 * then breaks by its own rule).
 */
function usePrintPlaces(draftId: string, model: SheetModel | null, design: string): PrintPlaces | null {
  const [places, setPlaces] = useState<{ design: string; places: PrintPlaces } | null>(null);
  useEffect(() => {
    if (!model) return;
    let gone = false;
    const timer = setTimeout(() => {
      api<PrintPlaces>("POST", `/api/drafts/${draftId}/sheet-places`, { model, design })
        .then((p) => !gone && setPlaces({ design, places: p }))
        .catch(() => {});
    }, 400);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [draftId, model, design]);
  // The places of an earlier state of the model hold until the new ones come: a row more
  // rarely moves a page break, and the pages do not jump twice.
  return places?.design === design && places.places.sections.length === model?.sections.length
    ? places.places
    : null;
}

/** Whether the name at the head of the sheet is on screen. */
function useNameInView(shown: boolean, design: string): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const name = shown ? document.querySelector("article[lang] h1") : null;
    if (!name) return setInView(false);
    const seen = new IntersectionObserver(([e]) => setInView(e?.isIntersecting ?? false));
    seen.observe(name);
    return () => seen.disconnect();
  }, [shown, design]);
  return inView;
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
  const { lp } = useDraft();
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
  return (
    <>
      <PackageLanguageNote shown={lp.lang} />
      {children}
    </>
  );
}

interface ToolProps {
  sheet: SheetController;
  designs: SheetDesignInfo[];
  design: string;
  setDesign: (id: string) => void;
  canRaise: boolean;
  draftId: string;
  onDownload: () => void;
}

/** The versions to choose from, newest first after the original, as in the download dialog; and the looks. */
function useListOptions(sheet: SheetController, designs: SheetDesignInfo[]) {
  const { t, lang } = useApp();
  const { lp } = useDraft();
  const levelName = ptext(lp, "level.name") ?? "";
  const versions: CompactOption[] = [
    { value: ORIGINAL, label: t("sheet.original") },
    ...newestFirst(sheet.copies).map((c) => ({ value: c.id, label: copyChoice(t, lang, levelName, c) })),
  ];
  const looks: CompactOption[] = designs.map((d) => ({ value: d.id, label: d.name[lang] ?? d.id }));
  return { versions, looks };
}

/** Version and look in the top bar at a desk: an icon each for its name, a fixed width, a long name cut with "…". */
function SheetLists({ sheet, designs, design, setDesign }: ToolProps) {
  const { t } = useApp();
  const { versions, looks } = useListOptions(sheet, designs);
  return (
    <>
      <CompactSelect
        className="compact-select--version"
        label={t("sheet.version")}
        icon="copies"
        value={sheet.version}
        options={versions}
        onChange={sheet.select}
      />
      <CompactSelect
        className="compact-select--design"
        label={t("sheet.design")}
        icon="palette"
        value={design}
        options={looks}
        onChange={setDesign}
      />
    </>
  );
}

function SheetTools({
  variant,
  sheet,
  designs,
  design,
  setDesign,
  canRaise,
  draftId,
  onDownload,
}: ToolProps & { variant: "bar" | "menu" }) {
  const { t } = useApp();
  const id = useId();
  const { versions, looks } = useListOptions(sheet, designs);
  const select = (
    key: string,
    label: string,
    value: string,
    options: CompactOption[],
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
    // In the menu it closes the menu, so the sheet shows the ticks gone and "Undo" beside "Saved".
    <Button
      variant="secondary"
      onClick={sheet.clearChecks}
      disabled={sheet.load !== "ready"}
      data-closes-menu={variant === "menu" ? "" : undefined}
    >
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
      {/* At a desk the lists are in the top bar. */}
      {variant === "menu" && (
        <>
          {select("version", t("sheet.version"), sheet.version, versions, sheet.select)}
          {select("design", t("sheet.design"), design, looks, setDesign)}
        </>
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
