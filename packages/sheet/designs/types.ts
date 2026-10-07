/**
 * What a sheet design gets from the screen that shows it. A design draws a
 * sheet model by its section kinds; it does not know what a section means,
 * whether the model is the original or a kept copy, or what happens on a
 * change. Every text it shows goes through `ui.Text`, every place to write
 * or tick through `ui.Field`, rows are added and crossed out through
 * `ui.AddRow` and `ui.RemoveRow`; the screen decides what each one does.
 */
import type { ComponentType } from "react";
import type { ModelPath, PlayField } from "../src/edit.ts";
import type { SheetModel } from "../src/model.ts";

export interface SheetTextProps {
  /** Where the text is in the model. */
  path: ModelPath;
  value: string;
  /** What it is, for screen readers ("Schutz"); the design's own words. */
  label: string;
  /** Paragraphs rather than one line. */
  multiline?: boolean;
  /** What to show while not changing it, if not `value` as it is (steps a line each); changed is `value`. */
  shown?: string;
}

export interface SheetFieldProps {
  field: PlayField;
  label: string;
  /** How ticks look: circles or squares. */
  shape?: "circle" | "square";
  /** Lines to write on, for a text field. */
  lines?: number;
  /**
   * For a pencil field: the value to count from while nothing is written
   * ("18"). Given, the field has − and + beside it on a phone.
   */
  start?: string;
}

export interface SheetRowProps {
  /** Index of the section in the model. */
  section: number;
  /** The section's title, to say which rows. */
  label: string;
}

export interface SheetUi {
  Text: ComponentType<SheetTextProps>;
  Field: ComponentType<SheetFieldProps>;
  AddRow: ComponentType<SheetRowProps>;
  RemoveRow: ComponentType<SheetRowProps & { row: number }>;
}

/**
 * Where the PDF starts each section (page and grid column from 0, and the
 * columns it takes on that page; null for one it does not show), and how
 * many pages it has: a design that breaks
 * pages on screen breaks them there too, though its sections are taller.
 */
export interface PrintPlaces {
  pages: number;
  sections: ({ page: number; col: number; cols: number[] } | null)[];
}

export interface SheetScreenProps {
  model: SheetModel;
  ui: SheetUi;
  /** The PDF's places for this model, once known. */
  places?: PrintPlaces | null;
}
