"use client";
/**
 * The frame of every logged-in screen: skip link, top bar with menu and
 * language switch, the menu drawer (step list while building, characters,
 * campaigns, settings, MCP, log out).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useApp } from "../app-state.tsx";
import { Explained } from "./Explained.tsx";
import { Icon } from "./Icon.tsx";
import { LanguageMenu } from "./LanguageSelect.tsx";

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
  const layout = sidebar || aside ? "shell--columns" : wide ? "shell--wide" : "";
  return (
    <div className={`shell ${layout}`}>
      <SkipLink />
      <header className="topbar">
        <button
          type="button"
          className="topbar__menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" />
          <span>{t("menu.open")}</span>
          {menuMark}
        </button>
        <div className="topbar__title">
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
      <MenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        {menuExtra}
      </MenuDrawer>
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
  children,
}: {
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t, logout } = useApp();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

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
              <Link href="/mcp/setup">{t("menu.mcp")}</Link>
            </li>
            <li>
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
