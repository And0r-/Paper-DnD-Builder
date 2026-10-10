"use client";
/**
 * The frame of every logged-in screen: skip link, top bar with menu and
 * language switch, the menu drawer (step list while building, characters,
 * campaigns, settings, feedback, MCP, log out).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Explained } from "./Explained.tsx";
import { FeedbackDialog } from "./FeedbackDialog.tsx";
import { Toast } from "./Fields.tsx";
import { Icon } from "./Icon.tsx";
import { LanguageMenu } from "./LanguageSelect.tsx";

/** The API reference (app/api/docs/route.ts): a plain page, not part of the app. */
export const API_DOCS_PATH = "/api/docs";

export function SkipLink() {
  const { t } = useApp();
  return (
    <a className="skip-link" href="#main">
      {t("common.skipToContent")}
    </a>
  );
}

export function AppShell({
  title,
  status,
  bar,
  tools,
  menuExtra,
  menuMark,
  sidebar,
  aside,
  children,
  wide,
}: {
  /** Shown in the top bar (e.g. character name and level). */
  title?: ReactNode;
  /** Right side of the top bar (save status). */
  status?: ReactNode;
  /** A row under the top bar that stays with it (who else builds along); it may render nothing. */
  bar?: ReactNode;
  /** Lists of the screen's own beside the language, on large screens only (the sheet's version and style). */
  tools?: ReactNode;
  /** Extra content at the top of the menu (the step list). */
  menuExtra?: ReactNode;
  /** A short mark on the menu button (steps that came or went while the menu is shut). */
  menuMark?: ReactNode;
  /** Left column on large screens (the step list). */
  sidebar?: ReactNode;
  /** Right column on large screens (the explanation). */
  aside?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [thanks, setThanks] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  /** "Feedback" was chosen in the menu: its dialog opens once the menu is shut. */
  const feedbackNext = useRef(false);

  useEffect(() => {
    // The drawer closed in its own effect, before this one: one modal dialog at a time. The menu
    // button has the focus first, so the feedback dialog gives it back there, not to nowhere.
    if (menuOpen || !feedbackNext.current) return;
    feedbackNext.current = false;
    menuButton.current?.focus();
    setFeedbackOpen(true);
  }, [menuOpen]);

  const layout = sidebar || aside ? "shell--columns" : wide ? "shell--wide" : "";
  const header = (
    <header className="topbar">
      <button
        ref={menuButton}
        type="button"
        className="topbar__menu"
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(true)}
      >
        <Icon name="menu" />
        <span className="topbar__menu-word">{t("menu.open")}</span>
        {menuMark}
      </button>
      <div className={title === undefined ? "topbar__title topbar__title--app" : "topbar__title"}>
        {title ?? (
          <Explained hint={t("app.about")}>
            <Link href="/characters">{t("app.name")}</Link>
          </Explained>
        )}
      </div>
      <div className="topbar__status">{status}</div>
      {tools && <div className="topbar__tools">{tools}</div>}
      <LanguageMenu />
    </header>
  );
  return (
    <div className={`shell ${layout}`}>
      <SkipLink />
      {bar ? (
        // The row under the top bar stays with it: one sticky block.
        <div className="shell__top">
          {header}
          {bar}
        </div>
      ) : (
        header
      )}
      <MenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onFeedback={() => {
          feedbackNext.current = true;
        }}
      >
        {menuExtra}
      </MenuDrawer>
      <FeedbackDialog
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        onSent={() => setThanks(true)}
      />
      {thanks && <Toast message={t("feedback.thanks")} duration={6000} onDone={() => setThanks(false)} />}
      <div className="shell__body">
        {sidebar && (
          <nav className="shell__sidebar" aria-label={t("flow.steps")}>
            {sidebar}
          </nav>
        )}
        <main id="main" className="shell__main" tabIndex={-1}>
          {children}
        </main>
        {aside && <aside className="shell__aside">{aside}</aside>}
      </div>
    </div>
  );
}

function MenuDrawer({
  open,
  onClose,
  onFeedback,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** "Feedback" was chosen; the menu closes as for any marked button. */
  onFeedback: () => void;
  children?: ReactNode;
}) {
  const { t, logout, account } = useApp();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const devTitleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-label={t("menu.title")}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
        // Following any link inside closes the menu, as does a button marked to: what it did shows.
        if ((e.target as HTMLElement).closest("a, [data-closes-menu]")) onClose();
      }}
    >
      {open && (
        <div className="drawer__box">
          <div className="drawer__head">
            <p className="drawer__title">{t("menu.title")}</p>
            <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
              <Icon name="close" />
            </button>
          </div>
          {children}
          <ul className="drawer__links">
            <li>
              <Link href="/characters">{t("menu.characters")}</Link>
            </li>
            <li>
              <Link href="/campaigns">{t("menu.campaigns")}</Link>
            </li>
            <li>
              <Link href="/settings">{t("menu.settings")}</Link>
            </li>
            <li>
              {/* A button, not a link: a dialog opens over the page, which stays. */}
              <button type="button" data-closes-menu onClick={onFeedback}>
                {t("menu.feedback")}
              </button>
            </li>
            {account?.role === "admin" && (
              <li>
                <Link href="/admin">{t("menu.admin")}</Link>
              </li>
            )}
            <li className="drawer__logout">
              {/* Red and set apart, so nobody taps it by mistake. */}
              <button
                type="button"
                onClick={async () => {
                  onClose();
                  await logout().catch(() => {});
                  router.push("/login");
                }}
              >
                {t("menu.logout")}
              </button>
            </li>
          </ul>
          {/* For those who connect programs; kept out of the way of players. More links go into this list. */}
          <div className="drawer__group">
            <p className="drawer__group-title" id={devTitleId}>
              {t("menu.devTitle")}
            </p>
            <ul className="drawer__links" aria-labelledby={devTitleId}>
              <li>
                <Link href="/mcp/setup">{t("menu.mcp")}</Link>
              </li>
              <li>
                {/* A plain link: the reference is its own page, outside the app. */}
                <a href={API_DOCS_PATH}>{t("menu.api")}</a>
              </li>
            </ul>
          </div>
        </div>
      )}
    </dialog>
  );
}

/** Logged-out screens: language switch top right, content centred. */
export function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="guest">
      <SkipLink />
      <header className="guest__head">
        <LanguageMenu />
      </header>
      <main id="main" className="guest__main" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
