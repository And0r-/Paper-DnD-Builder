# @builder/core

Rule-system-neutral rule core. It evaluates what a content package declares
— steps, choices, conditions, formulas and unit tables — and has no
knowledge of any specific game. Tests use the invented demo package only.
It runs on the server and in the browser.

- `evaluateDraft(pkg, doc)` — from a draft (level + raw answers) derive the
  steps in order (with granted steps inserted), the options of every choice,
  what the character has, every value, and whether it is complete.
- `applyChange(pkg, doc, change)` — the only way a draft changes: set the
  level or answer a choice. New answers must fit the choice as asked now;
  later answers that stop fitting are kept and marked, so going back
  restores them.
- `formatMeasure`, `convertMeasure`, `effectiveUnits`, `renderText` —
  quantities and texts for display, converted by the package's tables into
  the reader's units.

Conditions are evaluated step by step with what earlier steps gave, so a
step only ever depends on steps before it.
