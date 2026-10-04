"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface Common {
  variant?: ButtonVariant;
  icon?: IconName;
  iconAfter?: IconName;
  /** Full width on every screen size. */
  block?: boolean;
  children: ReactNode;
}

function classes(variant: ButtonVariant, block: boolean | undefined, extra?: string) {
  return ["btn", `btn--${variant}`, block ? "btn--block" : "", extra ?? ""].filter(Boolean).join(" ");
}

/**
 * A button. While `busy`, the label changes to `busyLabel` (a word, not a
 * spinner) and clicks are ignored, but the button stays focusable.
 */
export function Button({
  variant = "primary",
  icon,
  iconAfter,
  block,
  busy,
  busyLabel,
  children,
  className,
  onClick,
  type = "button",
  ...rest
}: Common &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    busy?: boolean;
    busyLabel?: string;
  }) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, block, className)}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {icon && <Icon name={icon} />}
      <span>{busy && busyLabel ? busyLabel : children}</span>
      {iconAfter && <Icon name={iconAfter} />}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  icon,
  iconAfter,
  block,
  children,
  className,
  ...rest
}: Common & { href: string; className?: string; "aria-label"?: string }) {
  return (
    <Link href={href} className={classes(variant, block, className)} {...rest}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
      {iconAfter && <Icon name={iconAfter} />}
    </Link>
  );
}
