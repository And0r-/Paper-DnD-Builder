/**
 * The screen part of every sheet design, by design id. The list of designs
 * with their names is `SHEET_DESIGNS` (`../src/printouts.ts`), shared with
 * the PDF; a design listed there has its screen here. React, so only the
 * browser imports this file. The geometries are `./geometry.ts` and
 * `./<id>/index.ts`, plain data shared with the PDF.
 */
import type { ComponentType } from "react";
import { SHEET_DESIGNS } from "../src/printouts.ts";
import { ClassicSheet } from "./classic/screen.tsx";
import type { SheetScreenProps } from "./types.ts";
import { VerboseSheet } from "./verbose/screen.tsx";

export type {
  PrintPlaces,
  SheetFieldProps,
  SheetRowProps,
  SheetScreenProps,
  SheetTextProps,
  SheetUi,
} from "./types.ts";

export const SCREEN_DESIGNS: Readonly<Record<string, ComponentType<SheetScreenProps>>> = {
  verbose: VerboseSheet,
  classic: ClassicSheet,
};

/** The screen of design `id`, or of the default design for one this build does not draw. */
export function screenDesign(id: string): ComponentType<SheetScreenProps> {
  return SCREEN_DESIGNS[id] ?? SCREEN_DESIGNS[SHEET_DESIGNS[0]!.id]!;
}
