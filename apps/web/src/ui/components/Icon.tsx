/**
 * Local SVG icons. Nothing is fetched; icons are drawn here. They are
 * decorative (aria-hidden): every icon sits next to a word.
 */
const PATHS = {
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert: "M12 8v5M12 16.5v.5M10.3 3.9L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  info: "M12 11v6M12 7.5v.5M12 21a9 9 0 110-18 9 9 0 010 18z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M6 15l6-6 6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  dice: "M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1zM8.5 8.5h.01M15.5 15.5h.01M12 12h.01",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  printer: "M7 9V4h10v5M7 17H5a1 1 0 01-1-1v-5a2 2 0 012-2h12a2 2 0 012 2v5a1 1 0 01-1 1h-2M7 14h10v6H7z",
  figure:
    "M12 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5 20.5c0-3.9 3.1-7 7-7s7 3.1 7 7M18.5 4.5l1 1M20.5 2.5l-1 1M3.5 5.5l1-1",
  circle: "M12 20a8 8 0 110-16 8 8 0 010 16z",
  dot: "M12 16a4 4 0 110-8 4 4 0 010 8z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24, className }: { name: IconName; size?: number; className?: string }) {
  const filled = name === "dot";
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
