# @builder/sheet

The character sheet as plain data: one model that the screen, the PDF
([`@builder/print`](../print)), stored copies and other readers all show.
No layout, no PDF library, and nothing about any game.

- `buildSheetModel(pkg, draft, { language, units, createdAt })` — every
  text looked up in one language, every quantity converted by the
  package's unit tables, sections in the package's order with their
  conditions decided. This is the only place that reads package texts for
  the sheet, so "one language per sheet" is decided here.
- `sheetModelSchema` — the Zod schema of the model; the model's types are
  inferred from it. A stored copy of a sheet is checked with it.
- `sheetFields(model)` — every place a player writes or ticks on paper.

What the model has besides words and numbers:

- **Field ids** (`field`, `usesField`, `playedByField`) for pencil boxes,
  squares, circles, use boxes, notes and blank lines, made of package keys
  only: `sheet/<section>/<value>`, `sheet/<section>/<thing>/uses`,
  `cards/<thing>/uses`. A place keeps its id when the character goes up a
  level.
- **Origin**: `{ kind: "original", level, builtAt, packageVersion,
changedAt? }`; a kept copy is `{ kind: "copy", name, createdAt,
fromLevel, fromPackageVersion, fromChangedAt? }`, the same facts of the
  original it was made from. Any difference: the original changed since.
- **Dependents** per value: the values that change with it, from the
  package's formulas and the grants of the character's things
  (`dependentValues` in `@builder/core`).
- **Rules texts**: the full texts of every row and card thing, grouped by
  the thing that brought them.

The builder's own words ("played by", "page 1 of 2") are in
`src/messages.ts`; a language without an entry there has no sheet, rather
than one mixed with another language.
