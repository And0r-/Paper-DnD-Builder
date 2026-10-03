# UX specification, phase 1

File names and headings are in English. The body text of each document is in German.

These documents define how the builder looks, speaks and prints. They are written for any rule set: every step, choice, explanation and sheet section comes from a package. All examples use the fictional demo setting "Nebelland". No rulebook content appears here.

| Document | What it covers |
| --- | --- |
| [flow.md](flow.md) | Guided character creation: screens, step frame, choice types, back and change without loss, sign-in, settings, print. Requirements for the package format. |
| [style-guide.md](style-guide.md) | Writing rules for German and English UI text and plain-language explanations, words that need an explanation, five example entries. |
| [design-system.md](design-system.md) | Spacing scale, typography (self-hosted, no CDN), colours with contrast ratios, phase 1 components, empty/loading/error states. Mobile first. |
| [print-layout.md](print-layout.md) | A4 character sheet and 63 × 88 mm cards on A4 with cut marks. Units come from the account setting. |

## Sketches

- [render/character-sheet-a4.png](render/character-sheet-a4.png) and [render/cards-a4.png](render/cards-a4.png): rendered previews.
- [render/print-example.pdf](render/print-example.pdf): two-page A4 example.
- [render/gen.cjs](render/gen.cjs): generates the SVGs (in millimetres) and, with `pdfkit` and `svg-to-pdfkit` available, the PDF: `node docs/ux/render/gen.cjs <outDir> [nodeModulesDir]`.
