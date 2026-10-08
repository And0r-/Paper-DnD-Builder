/**
 * A QR code as one SVG path, made here from the text: no image service sees
 * the invitation link (AND-237). Medium error correction, so a code shown
 * on a scratched phone screen still reads; the quiet zone of four modules
 * is part of the drawing.
 */
import QRCode from "qrcode";

export const QUIET_ZONE = 4;

export interface QrDrawing {
  /** Modules per side, quiet zone included: the SVG's viewBox is `0 0 size size`. */
  size: number;
  /** One path of 1×1 squares for the dark modules. */
  path: string;
}

export function qrDrawing(text: string): QrDrawing {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let path = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      // A run of dark modules in a row is one rectangle: a shorter path.
      if (!modules.get(y, x) || (x > 0 && modules.get(y, x - 1))) continue;
      let w = 1;
      while (x + w < n && modules.get(y, x + w)) w++;
      path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h${w}v1h-${w}z`;
    }
  }
  return { size: n + 2 * QUIET_ZONE, path };
}
