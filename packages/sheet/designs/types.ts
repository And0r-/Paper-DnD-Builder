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

export interface SheetScreenProps {
  model: SheetModel;
  ui: SheetUi;
}
