/**
 * A QR code for a link, drawn as SVG on the page (see qr.ts): no image
 * service learns the link. The link itself is the SVG's title, so a screen
 * reader and a test both find what the code holds.
 */
import { useMemo } from "react";
import { qrDrawing } from "../qr.ts";

export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => qrDrawing(value), [value]);
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <title>{value}</title>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
