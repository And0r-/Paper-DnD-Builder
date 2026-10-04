# @builder/demo-package — Mistland

Demo content package with an invented world. The builder is developed and
tested against this package only. It must never contain text from a
published rulebook.

```sh
pnpm validate-package packages/demo-package
```

## What it covers

Every feature of format 0.6 is used at least once (see
[`packages/format/SPEC.md`](../format/SPEC.md)):

| Feature                 | Where                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| 3 callings, 1 path each | `things/callings-and-paths.json`; paths filtered with `requires`                               |
| 3 folks, 2 upbringings  | `things/folks-and-upbringings.json`                                                            |
| 20 knacks               | `things/knacks.json`; cards, ranks, groups, tags, a shared knack                               |
| Gear                    | `things/items.json`, `things/community.json` (second source and license)                       |
| Levels 1–3              | `flow.json` `level`; `atLevel` grants; `when: level >= 2` step                                 |
| Long list with search   | `borrowed-knack`: 14 knacks, granted to herbalists from level 2 (search shows from 12 options) |
| All six choice kinds    | pickOne, pickMany (count by expression), distribute (point buy and array), number, text, info  |
| Dependencies            | granted choices, `requires`, `has(...)` in recommendations                                     |
| Derived values          | `values.json` formulas; grants add to values                                                   |
| Units                   | `units.json`: ft→m and lb→kg tables with fallback, language defaults                           |
| Two languages           | `texts/de`, `texts/en`, complete; glossary links and unit placeholders                         |
| Print hints             | `sheet.json`: every section kind, card layout for knacks                                       |
| Sheet conditions        | `sheet.json`: section `path` has `when: level >= 3`                                            |
| Box labels              | `sheet.json`: box `nerve` in `primary` has its own `label`                                     |
| Option badges           | `flow.json`: choice `calling` gives `calling.lantern-bearer` the badge "Gentle start"          |
| What the character has  | `handling-river-runner` (`held`): `things/handling.json` are `about` items the character has   |

## Layout

The package is the JSON in this folder. `package.json`, `src/` and this
README are workspace plumbing and are ignored by the loader. `src/index.ts`
exports `DEMO_PACKAGE_DIR` so code can find the package.
