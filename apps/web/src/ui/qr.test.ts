/** The QR code reads back as the text it was made from, as a phone camera would read it. */
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { qrDrawing, QUIET_ZONE } from "./qr.ts";

/** Paints the path's rectangles black on white, `scale` pixels per module. */
function rasterize(drawing: { size: number; path: string }, scale = 4) {
  const side = drawing.size * scale;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (const [, x, y, w] of drawing.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let py = Number(y) * scale; py < (Number(y) + 1) * scale; py++) {
      for (let px = Number(x) * scale; px < (Number(x) + Number(w)) * scale; px++) {
        rgba.fill(0, (py * side + px) * 4, (py * side + px) * 4 + 3);
      }
    }
  }
  return { rgba, side };
}

describe("qrDrawing", () => {
  it("draws a code that decodes to the invitation link", () => {
    const url = "https://builder.example/join/q8tWm3-Zr0_KpLx2YbN7aQ";
    const drawing = qrDrawing(url);
    const { rgba, side } = rasterize(drawing);
    expect(jsQR(rgba, side, side)?.data).toBe(url);
  });

  it("keeps the code small for a 22-character token, quiet zone included", () => {
    const drawing = qrDrawing("https://builder.example/join/q8tWm3-Zr0_KpLx2YbN7aQ");
    // Version 4 (33 modules) at most for a link this long, plus four on each side.
    expect(drawing.size).toBeLessThanOrEqual(33 + 2 * QUIET_ZONE);
    // Only path commands: nothing from the text ends up in the markup.
    expect(drawing.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
  });
});
