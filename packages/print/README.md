# @builder/print

The printed character: the character sheet (A4) followed by cards
(63 × 88 mm, nine per A4 page, with cut lines and crop marks), as one PDF
made on the server.

- `buildPrintModel(pkg, draft, { language, units })` — everything that goes
  on paper, as plain strings in exactly one language, with every quantity
  converted by the package's unit tables. This is the only place that reads
  package texts, so "one language per document" is decided here.
- `renderPdf(model)` — lays the model out and returns the PDF bytes.

The package says what goes where (`sheet.json`, see the format SPEC,
section 13); this module owns the visual design and knows nothing about
any game. Its own words on paper ("page 1 of 2", "played by") are in
`src/messages.ts`; a language without an entry there cannot be printed,
rather than being mixed with another one.

**Why pdfkit.** The layout is a fixed grid measured in millimetres, and the
cards need exact sizes and crop marks. Drawing the PDF directly gives exact
geometry, an embedded font and extractable text without running a browser
on the server (no Chromium in the image, no extra process to keep alive).

**Font.** Atkinson Hyperlegible Next (SIL Open Font License 1.1, see
`fonts/OFL.txt`), embedded as a subset. The PDF follows PDF/A-2b: no
links, no form fields, no scripts, nothing outside the file.

Sample PDFs of a demo character (German with meters, English with feet):

```sh
node packages/print/scripts/sample.ts <outDir>
```
