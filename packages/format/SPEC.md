# Content package format — specification

Format version **0.3**. This document describes everything a content
package contains and every rule a valid package follows. After reading it
you should be able to write your own package. The demo package in
[`packages/demo-package`](../demo-package) uses every feature and is the
best companion to this text.

The Zod schemas in [`src/schema.ts`](src/schema.ts) and the checks in
[`src/validate.ts`](src/validate.ts) are the executable version of this
document. If the two disagree, that is a bug; please report it.

## Contents

1. [Ideas behind the format](#1-ideas-behind-the-format)
2. [Package layout](#2-package-layout)
3. [Keys](#3-keys)
4. [Provenance: sources and licenses](#4-provenance-sources-and-licenses)
5. [manifest.json](#5-manifestjson)
6. [Things](#6-things)
7. [Values](#7-values)
8. [Expressions](#8-expressions)
9. [The flow: steps and choices](#9-the-flow-steps-and-choices)
10. [Texts](#10-texts)
11. [Glossary](#11-glossary)
12. [Units](#12-units)
13. [Print: sheet and cards](#13-print-sheet-and-cards)
14. [Validation](#14-validation)
15. [Versioning](#15-versioning)
16. [A minimal package](#16-a-minimal-package)
17. [Reserved for later versions](#17-reserved-for-later-versions)

## 1. Ideas behind the format

- **The builder knows no game.** It knows things, choices, values, texts and
  units. Everything that makes a game a game is data in the package. If a
  new class, species or spell would need a code change, the format is wrong.
- **Stable keys.** Everything has a fixed, language-independent key. Texts
  hang on keys. Keys never change, even if a name changes.
- **One source of truth.** Every fact is stated once, in its source unit.
  Derived numbers are computed by the rule core from formulas in the
  package.
- **Provenance on every entry.** Every thing, value, choice, glossary entry
  and text file names its source and license, so anyone can check what may
  be published.
- **Complete or marked.** A text that is not translated yet is marked as
  missing (`null`), never silently left out.
- **Schema first.** The builder refuses to start with an invalid package
  and says exactly what is wrong and where.

## 2. Package layout

A package is a folder of JSON files (UTF-8). The folder name should equal
the package `id`.

```
my-package/
  manifest.json        what the package is: key, version, languages, sources, licenses
  units.json           unit dimensions and conversion tables
  values.json          numbers a character has (scores, derived values)
  flow.json            the guided creation: level range, steps, choices, summary
  sheet.json           print layout hints: sheet sections and card layouts
  glossary.json        glossary entries (optional file)
  things/*.json        the things: one or more files, any names
  texts/<lang>/*.json  texts per language: one or more files per language
```

All files except `glossary.json` are required. Any other file in the folder
(a README, a `package.json`) is ignored. File names under `things/` and
`texts/<lang>/` are free; use them to organize content, for example one
file per source.

The builder reads packages from a mounted directory: each subfolder that
contains a `manifest.json` is one package.

## 3. Keys

| Key of                                       | Pattern                                   | Example               |
| -------------------------------------------- | ----------------------------------------- | --------------------- |
| package                                      | lowercase words joined by `-`             | `demo`                |
| thing, choice, step, kind, glossary, section | lowercase words joined by `-` and `.`     | `knack.fog-hop`       |
| value, stat                                  | camelCase, starts with a lowercase letter | `mightBonus`          |
| unit                                         | short lowercase word                      | `ft`                  |
| tag, group, source, license                  | like thing keys                           | `for-herbalist`       |
| text                                         | words joined by `.` and `-`               | `knack.fog-hop.short` |
| language                                     | ISO 639 code, optional region             | `de`, `pt-BR`         |

Rules:

- Keys are unique within their kind (two things cannot share a key; a
  thing and a choice can, but avoid it).
- Value keys can be used inside expressions, so they may not contain `-`
  or `.`. `level` is built in and cannot be declared.
- Thing keys are also text key prefixes, so a thing key may not start with
  a reserved prefix: `package.`, `level.`, `kind.`, `choice.`, `step.`,
  `group.`, `value.`, `stat.`, `unit.`, `glossary.`, `summary.`, `sheet.`,
  `card.`. Convention: start thing keys with their kind (`knack.fog-hop`).
- **Never rename a key once a package is in use.** Saved characters refer
  to keys. Change the text instead.

## 4. Provenance: sources and licenses

`manifest.json` declares every source and license used in the package.
Then:

- every thing, value, choice and glossary entry has `"source": "<source key>"`
  and may override the source's license with `"license": "<license key>"`;
- every text file has `"source"` (and optional `"license"`) for all its
  texts. Keep texts from different sources in different files.

The effective license of an entry is its own `license`, else its source's
`license`. The validator checks that every source and license key resolves.
The loaded package records the origin (file, source, license) of every
text, so a check like "is every German rules text from the official
translation?" is a simple query.

`publishable` on a license says whether content under it may be
distributed publicly. The builder does not act on it; it is there for the
people who distribute packages.

## 5. manifest.json

```json
{
  "formatVersion": "0.6",
  "id": "demo",
  "version": "0.1.0",
  "languages": ["de", "en"],
  "kinds": ["folk", "upbringing", "calling", "path", "talent", "trait", "knack", "item"],
  "sources": {
    "mistland": {
      "title": "Mistland demo world",
      "version": "0.1.0",
      "retrieved": "2026-10-04",
      "license": "agpl"
    }
  },
  "licenses": {
    "agpl": { "name": "GNU Affero General Public License v3.0", "spdx": "AGPL-3.0-only", "publishable": true }
  }
}
```

| Field           | Required | Meaning                                                                               |
| --------------- | -------- | ------------------------------------------------------------------------------------- |
| `formatVersion` | yes      | Format version the package is written for, `"MAJOR.MINOR"`. See [15](#15-versioning). |
| `id`            | yes      | Package key. Never changes.                                                           |
| `version`       | yes      | Version of the content, semantic versioning (`1.2.0`).                                |
| `languages`     | yes      | Languages with complete text sets. Each needs `texts/<lang>/`.                        |
| `kinds`         | yes      | Categories of things (see [6](#6-things)).                                            |
| `sources`       | yes      | Source key → `{ title, url?, version?, retrieved? (YYYY-MM-DD), license }`.           |
| `licenses`      | yes      | License key → `{ name, spdx?, url?, publishable }`.                                   |

The package's display name and description are texts: `package.name` and
`package.short`.

## 6. Things

A **thing** is anything a character can have: a class, a species, a
background, a spell, a piece of gear, a feature, a trained skill. The
builder does not know these words. It only knows things, each with a
**kind** that the package declares in `manifest.kinds`. Kinds group things
(for option lists, sheet sections and cards); they carry no rules.

How common concepts map to things (the demo's kind in brackets):

| Concept in many games   | In this format                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| class (calling)         | a thing; its `grants` give values per level, items and further choices |
| subclass (path)         | a thing offered by a choice granted at a level; `requires` the class   |
| species, origin (folk)  | a thing chosen in a step; grants speed, features                       |
| background (upbringing) | a thing; grants skills and items                                       |
| spell, maneuver (knack) | a thing with `stats`, `rank` and `card: true`                          |
| equipment (item)        | a thing with stats such as weight; may add to values                   |
| feature, trait (trait)  | a thing granted by another thing                                       |
| trained skill (talent)  | a thing; "has it" means trained                                        |

Each `things/*.json` file is an array of things:

```json
{
  "id": "knack.fog-hop",
  "kind": "knack",
  "source": "mistland",
  "rank": 1,
  "group": "daring",
  "tags": ["current"],
  "requires": "level >= 1",
  "stats": {
    "reach": { "amount": 30, "unit": "ft" },
    "duration": { "text": "stat-value.instant" },
    "uses": 2,
    "focus": { "text": "stat-value.water" }
  },
  "grants": [{ "value": "pace", "add": 5, "atLevel": 2 }],
  "card": true
}
```

| Field      | Required | Meaning                                                                                                                                                                    |
| ---------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | yes      | Thing key.                                                                                                                                                                 |
| `kind`     | yes      | One of `manifest.kinds`.                                                                                                                                                   |
| `source`   | yes      | Source key. `license` optional.                                                                                                                                            |
| `rank`     | no       | The thing's own tier (for example a spell level). Shown on cards. Not the character level.                                                                                 |
| `group`    | no       | Heading under which the thing appears in long option lists. Text: `group.<group>.name`.                                                                                    |
| `tags`     | no       | Free labels for selecting things (`options`, `count()`).                                                                                                                   |
| `requires` | no       | [Expression](#8-expressions). The thing is offered as an option only while it is true.                                                                                     |
| `stats`    | no       | Fixed facts shown on cards and in details: number, `true`/`false`, quantity `{amount, unit}` or `{text}` (a text key, for words like "instant"). Label: `stat.<key>.name`. |
| `grants`   | no       | What having this thing gives, see below.                                                                                                                                   |
| `card`     | no       | Print a card for this thing. Needs a card layout for its kind in `sheet.json`.                                                                                             |

### Grants

A grant gives exactly one of three things, from `atLevel` on (default 1):

| Grant                                | Effect                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `{ "thing": "item.rope" }`           | The character has that thing too (and everything it grants).                                    |
| `{ "choice": "path", "atLevel": 3 }` | The player is asked that choice; it becomes a step (see [9.4](#94-building-the-list-of-steps)). |
| `{ "value": "stamina", "add": 5 }`   | Adds a number or an expression result to a value (see [7](#7-values)).                          |

### What a character has

A character **has** a thing if

1. the player picked it in a `pickOne` or `pickMany` choice that is currently
   asked, or
2. a thing the character has grants it with `atLevel` ≤ the character's level.

This is evaluated after every change. If a pick stops being valid (its
choice is no longer asked, or the picked thing's `requires` became false),
the pick is kept in the draft but does not count; the step is marked as
needing a new answer. Going back restores it if it becomes valid again.

## 7. Values

`values.json` is an array of the numbers a character has.

```json
[
  { "id": "might", "source": "mistland", "default": 6, "min": 6, "max": 12 },
  { "id": "mightBonus", "source": "mistland", "formula": "floor(might / 3) - 2" },
  { "id": "stamina", "source": "mistland", "formula": "mightBonus * level", "min": 1 },
  { "id": "pace", "source": "mistland", "unit": "ft", "default": 0 }
]
```

| Field      | Meaning                                                                        |
| ---------- | ------------------------------------------------------------------------------ |
| `id`       | Value key (camelCase). Text: `value.<id>.name`, optional `value.<id>.explain`. |
| `source`   | Source key. `license` optional.                                                |
| `formula`  | Expression for the base value. Cannot be combined with `default`.              |
| `default`  | Base value if no formula and no player input. Default `0`.                     |
| `unit`     | The value is a quantity in this unit (see [12](#12-units)).                    |
| `min, max` | The final value is clamped to this range.                                      |

How the rule core computes a value:

```
base  = formula result            if the value has a formula
      = the player's input        if a distribute or number choice sets it
      = default (or 0)            otherwise
value = clamp(base + sum of all "add" grants of things the character has
              whose atLevel <= level, min, max)
```

Formulas may refer to other values; circular formulas are rejected by the
validator. An `add` expression must not depend on the value it adds to.

`level` is always available: the character level chosen by the player,
between `flow.level.min` and `flow.level.max`.

## 8. Expressions

Conditions (`requires`, `when`) and formulas (`formula`, `add`, `count`,
`min`, `max`) are short expressions in one small language. The rule core
evaluates them; the format defines their syntax.

```
floor(might / 3) - 2
if(level >= 2, 3, 2)
has('calling.herbalist') and level >= 3
count('lantern') >= 2
```

| Element    | Syntax                                                        |
| ---------- | ------------------------------------------------------------- |
| numbers    | `3`, `0.5`                                                    |
| strings    | `'text'` or `"text"` (only as arguments of `has` and `count`) |
| booleans   | `true`, `false`                                               |
| values     | a value key or `level`                                        |
| arithmetic | `+ - * /`, unary `-`, parentheses                             |
| comparison | `== != < <= > >=`                                             |
| logic      | `and`, `or`, `not`                                            |

Precedence, lowest first: `or`, `and`, `not`, comparison, `+ -`, `* /`,
unary `-`. Arithmetic is on real numbers; use `floor`, `ceil` or `round`
where whole numbers matter. Arithmetic on booleans is an error.

Functions:

| Function                                    | Result                                                |
| ------------------------------------------- | ----------------------------------------------------- |
| `floor(x)`, `ceil(x)`, `round(x)`, `abs(x)` | as usual                                              |
| `min(a, b, ...)`, `max(a, b, ...)`          | smallest / largest argument                           |
| `if(cond, a, b)`                            | `a` if `cond` is true, else `b`                       |
| `has('thing.key')`                          | true if the character has that thing                  |
| `count('tag')`                              | number of things the character has that carry the tag |

The validator checks that every expression parses, every value exists and
every `has()` names an existing thing. `count()` of a tag that no thing
carries is a warning.

## 9. The flow: steps and choices

`flow.json` describes the guided creation.

```json
{
  "level": { "min": 1, "max": 3, "default": 1 },
  "steps": [
    { "id": "calling", "choices": ["calling"] },
    { "id": "extra-talent", "choices": ["extra-talent"], "when": "level >= 2" },
    { "id": "identity", "choices": ["name", "age", "looks"] }
  ],
  "choices": [ ... ],
  "characterName": "name",
  "summary": {
    "fields": ["stamina", "guard", "pace", "luck"],
    "line": { "calling": { "choice": "calling" }, "level": { "value": "level" } }
  }
}
```

### 9.1 Level

The player chooses the level first (the builder shows this screen; its texts
are `level.name`, `level.intro`, `level.hint`). `max` may be raised later
without changing anything else; grants with `atLevel` above `max` are
allowed and simply never apply until then.

### 9.2 Steps

`steps` lists the fixed steps in order. A step shows one choice, or a few
small related choices on one screen (then it needs its own texts
`step.<id>.title`, `.question`, `.intro`). `when` hides the step while the
expression is false.

### 9.3 Choices

Every choice has `id`, `kind`, `source` (and optional `license`) and
`optional: true` if the character can be finished without an answer. Texts:
`choice.<id>.title` (short step name), `.question`, `.intro`, and optional
`.missing` (what is still missing; see [10.4](#104-placeholders)).

**Text variants.** A choice may say something different to some
characters, for example name a language they already know. `textVariants`
lists conditions; the first entry whose `when` is true is the active
variant. For each of the four texts, the screen shows
`choice.<id>.variant.<variant>.<text>` if the package has it, else the
base text. A variant only needs the texts it changes.

```json
{
  "id": "tongues",
  "kind": "pickMany",
  "source": "mistland",
  "options": { "kind": "tongue" },
  "count": "1 + count('extra-tongue')",
  "textVariants": [{ "id": "reed-cant", "when": "has('tongue.reed-cant')" }]
}
```

```json
"choice.tongues.intro": "Everyone speaks Mistish. Pick {{var:count}} more.",
"choice.tongues.variant.reed-cant.intro": "Everyone speaks Mistish. You also know Reed Cant. Pick {{var:count}} more."
```

Conditions see the character as it is before this choice, like `count`
and `recommend`.

There are six kinds:

**`pickOne`** — pick exactly one thing.

```json
{
  "id": "folk",
  "kind": "pickOne",
  "source": "mistland",
  "options": { "kind": "folk" },
  "recommend": [{ "pick": ["folk.moorfolk"] }]
}
```

**`pickMany`** — pick `count` things (a number or an expression); with
`"upTo": true`, up to `count`.

```json
{
  "id": "knacks-lantern",
  "kind": "pickMany",
  "source": "mistland",
  "options": { "kind": "knack", "tags": ["lantern"] },
  "count": "if(level >= 2, 3, 2)",
  "recommend": [
    { "when": "level >= 2", "pick": ["knack.warm-glow", "knack.glow-thread", "knack.quiet-word"] },
    { "pick": ["knack.warm-glow", "knack.glow-thread"] }
  ]
}
```

`options` selects things: all things that match `kind` (if given), are
listed in `ids` (if given) and carry every tag in `tags` (if given). From
these, the builder offers those whose `requires` is true and that the
character does not already have from somewhere else.

`recommend` is a list; the first entry whose `when` is true (or that has
no `when`) is the recommendation. It drives the "recommended" badge and
the "choose for me" button. A `pickOne` recommends exactly one thing.

**`distribute`** — spread points or fixed numbers over values.

```json
{
  "id": "scores",
  "kind": "distribute",
  "source": "mistland",
  "targets": ["might", "grace", "wit", "heart"],
  "methods": [
    {
      "method": "pointBuy",
      "budget": 14,
      "costs": { "6": 0, "7": 1, "8": 2, "9": 3, "10": 4, "11": 6, "12": 8 }
    },
    { "method": "array", "values": [11, 10, 9, 7] }
  ],
  "recommend": [
    { "when": "has('calling.herbalist')", "assign": { "might": 7, "grace": 8, "wit": 11, "heart": 9 } }
  ]
}
```

- `pointBuy`: `costs` gives the total cost of reaching each score. Every
  target starts at the lowest score; the sum of costs may not exceed
  `budget`. Scores must be consecutive and costs may not fall.
- `array`: each number is assigned to exactly one target.
- With several methods the player picks one.
- Targets must be values without a formula; the answer becomes their base.

**`number`** — a number between `min` and `max` (numbers or expressions),
stored as the base of value `target`. Optional `default`.

**`text`** — free text up to `maxLength` characters, `multiline` for longer
text. `suggestions` names a text key whose value is a list ("roll a
suggestion"). `characterName` must point to a text choice: its answer is
the character's name.

**`info`** — no answer; shows what the thing picked in the `pickOne` choice
`of` gives at the current level (things, value changes, new choices).

### 9.4 Building the list of steps

1. Take `steps` in order. Drop each step whose `when` is false.
2. After a step, insert one step per choice granted (with `atLevel` ≤
   level) by things the character has because of an answer in that step,
   directly or through further grants. Insert in grant order. A granted
   choice becomes a step whose id is the choice id. Apply this again to the
   inserted steps.
3. A choice granted by several things appears once, at its first position.
4. A choice is either listed in `steps` or granted by things, never both.
   A choice that is neither is never asked (a warning).
5. The builder adds its own overview step at the end.

Dependencies follow from the same data: a step depends on the steps whose
answers gave the things that grant its choice, and on every thing named in
`has()` of its options' `requires`. When an earlier answer changes, the rule
core re-evaluates and marks later answers that no longer fit.

### 9.5 Summary

- `summary.fields`: values shown large on the overview screen.
- `summary.line`: arguments for the text `summary.line` (shown in the list
  of characters). Each argument is `{ "choice": id }` (the name of the
  picked thing) or `{ "value": id }` (a number; `level` allowed).

## 10. Texts

### 10.1 Files

Texts live in `texts/<lang>/*.json`, one folder per language in
`manifest.languages`:

```json
{
  "source": "mistland",
  "entries": {
    "knack.fog-hop.name": "Fog Hop",
    "knack.fog-hop.short": "You vanish into the fog and appear a short way off.",
    "names.suggestions": ["Mira", "Tobin"],
    "knack.fog-hop.rules": null
  }
}
```

A text is a string, a list of strings (only for `suggestions` keys), or
`null`. **`null` means: known to be missing, not translated yet.** The
validator warns about it (and fails with `--strict`). A builder shows only
one language on screen; it must not fill a missing text from another
language. It may hide a language that still has missing texts.

A key may be defined in only one file per language.

### 10.2 Keys

Text keys follow from the keys of the things they belong to.

| Key                                                                      | Required                         | For                                                     |
| ------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------- |
| `package.name`, `package.short`                                          | yes                              | name and description of the package                     |
| `level.name`, `level.intro`, `level.hint`                                | yes                              | the level screen (the word for "level" is package text) |
| `kind.<kind>.name`                                                       | yes                              | name of a kind (card type line, headings)               |
| `<thing>.name`                                                           | yes                              | name, at most 30 characters                             |
| `<thing>.short`                                                          | yes                              | one sentence, at most 120 characters                    |
| `<thing>.explain.what`                                                   | yes                              | plain language: what it is                              |
| `<thing>.explain.table`                                                  | yes                              | plain language: what you do with it at the table        |
| `<thing>.explain.example`                                                | no                               | a small scene                                           |
| `<thing>.goodIf`                                                         | no                               | who it suits, at most 80 characters                     |
| `<thing>.rules`                                                          | no                               | the official rules text, verbatim                       |
| `choice.<id>.title`, `.question`, `.intro`                               | yes                              | a choice's step                                         |
| `choice.<id>.missing`                                                    | no                               | what is still missing                                   |
| `choice.<id>.variant.<variant>.title`, `.question`, `.intro`, `.missing` | no; once in one language, in all | a text variant (9.3)                                    |
| `step.<id>.title`, `.question`, `.intro`                                 | if the step has several choices  | a combined step                                         |
| `group.<group>.name`                                                     | yes, per group used              | heading in option lists                                 |
| `value.<id>.name`                                                        | yes                              | name of a value                                         |
| `value.<id>.explain`                                                     | no                               | one-line explanation                                    |
| `stat.<key>.name`                                                        | yes, per stat used               | label of a stat                                         |
| any key used in `{ "text": ... }` stats or `suggestions`                 | yes                              | stat words, suggestion lists                            |
| `unit.<unit>.short`, `unit.<unit>.long`                                  | yes                              | unit forms ("m", "meters")                              |
| `unit.<unit>.longOne`                                                    | no                               | singular long form for the amount 1 ("foot")            |
| `glossary.<id>.name`, `.short`, `.explain.what`, `.explain.table`        | yes                              | a glossary entry                                        |
| `glossary.<id>.explain.example`                                          | no                               | example for a glossary entry                            |
| `summary.line`                                                           | yes                              | one-line summary in the character list                  |
| `sheet.attribution`                                                      | yes                              | source and license line on the printed sheet            |
| `sheet.<section>.title`                                                  | yes, except header               | sheet section title                                     |
| `sheet.<section>.text`                                                   | for `helpBox`                    | help box content                                        |
| `sheet.<section>.hint`                                                   | no                               | one-line hint under a section                           |
| `card.<kind>.typeLine`                                                   | yes, per card layout             | first line of a card                                    |

The validator reports every required key missing in a language, and warns
about keys nothing uses (often typos). Length limits come from the style
rules and are warnings.

`explain.*` and `goodIf` are always the package's own words. `rules` holds
an official rules text, unchanged; a package that ships official
translations takes `rules` and `name` from them.

### 10.3 Style

Plain-language texts follow the style rules of the user interface: short
sentences, "you", active voice, numbers as digits, no unexplained jargon
(link it to the glossary), no units written out (use placeholders). The
validator flags texts that write a unit as plain text next to a number
(`9 m`), using the package's own unit words.

### 10.4 Placeholders

| Placeholder                     | Shows                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `{{length:30}}`                 | 30 in the source unit of dimension `length`, converted to the reader's unit, long form: "9 meters" / "30 feet" |
| `{{length:30\|short}}`          | the same with the short form: "9 m" / "30 ft"                                                                  |
| `[[glossary:stamina\|Stamina]]` | "Stamina", marked as a glossary link to entry `stamina`                                                        |
| `{{var:name}}`                  | a value the screen supplies (table below)                                                                      |

| Text                                                              | Variables                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `summary.line`                                                    | the names in `flow.summary.line`                                      |
| `card.<kind>.typeLine`                                            | `kind` (name of the kind), `rank` (the thing's rank), `level`         |
| `choice.<id>.missing`                                             | `remaining` (how many are still missing), `count` (how many in total) |
| `choice.<id>.title`, `.question`, `.intro` of a `pickMany` choice | `count` (how many to pick, worked out for this character)             |

The same variables apply to the texts of a text variant.

Amounts in placeholders are always in the dimension's source unit, so all
languages state the same amount. The validator warns if languages of one
key state different quantities.

## 11. Glossary

`glossary.json` lists the glossary entries; their texts are
`glossary.<id>.*` (see the table above). Any text may link to an entry
with `[[glossary:<id>|shown words]]`; the validator checks that the entry
exists.

```json
[{ "id": "stamina", "source": "mistland" }]
```

## 12. Units

Every quantity is stored once, in the unit of its source. The reader
chooses units in their account settings, independent of the language. The
builder converts for display **by table**, so a package can keep the
rounding conventions its players expect (5 ft shown as 1.5 m, not 1.524 m).

```json
{
  "dimensions": {
    "length": { "source": "ft", "units": ["ft", "m"] },
    "weight": { "source": "lb", "units": ["lb", "kg"] }
  },
  "languageDefaults": {
    "de": { "length": "m", "weight": "kg" },
    "en": { "length": "ft", "weight": "lb" }
  },
  "conversions": [
    {
      "from": "ft",
      "to": "m",
      "table": [
        [5, 1.5],
        [10, 3],
        [30, 9]
      ],
      "fallback": { "factor": 0.3, "step": 0.5 }
    }
  ]
}
```

- A **dimension** groups units; `source` is the unit placeholders use.
- `languageDefaults` gives the starting units for a new account per
  language. Every language needs a default for every dimension.
- A **conversion** has a `table` of exact display values. Amounts missing
  from the table use the optional `fallback`: amount × `factor`, rounded to
  the nearest `step`. The table always wins.
- **Coverage rule:** every amount the package states (in stats and in text
  placeholders) must be convertible to every other unit of its dimension:
  either by a table row or by a fallback. Values with a `unit` are computed,
  so their results cannot be listed in advance; give their conversions a
  fallback (otherwise a warning).
- Unit words come from texts: `unit.<u>.short` on sheets and cards,
  `unit.<u>.long` in running text, `unit.<u>.longOne` for the amount 1.
  Number format (decimal comma or point) follows the language.

`convertAmount(units, amount, from, to)` in this package implements the
rule, so every part of the builder converts the same way.

## 13. Print: sheet and cards

`sheet.json` describes the printed character sheet (A4) and the cards. The
builder owns the visual design; the package says what goes where.

```json
{
  "sections": [
    { "id": "header", "kind": "header", "span": 12 },
    {
      "id": "primary",
      "kind": "statBoxes",
      "span": 12,
      "boxes": [
        { "value": "stamina", "style": "pencil" },
        { "value": "luck", "style": "circles" },
        { "value": "nerve", "style": "number", "label": "sheet.primary.nerve" }
      ]
    },
    {
      "id": "scores",
      "kind": "scoreColumn",
      "span": 4,
      "scores": [{ "value": "might", "derived": "mightBonus" }]
    },
    { "id": "talents", "kind": "checkList", "span": 8, "things": { "kind": "talent" }, "note": "score" },
    { "id": "knacks", "kind": "featureTable", "span": 6, "things": { "kind": "knack" }, "uses": "uses" },
    { "id": "path", "kind": "featureTable", "span": 6, "things": { "kind": "path" }, "when": "level >= 3" }
  ],
  "cards": { "knack": { "fields": ["reach", "duration", "uses", "focus"], "uses": "uses" } }
}
```

The sheet is a 12-column grid. Sections fill it row by row; `span` is the
width (3, 4, 6, 8 or 12). The first section should be the header. Section
kinds:

| Kind           | Shows                                                                                                                                     | Fields                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `header`       | character name, `summary.line`, "played by", package name                                                                                 | —                                          |
| `statBoxes`    | up to 6 large boxes; `number` = computed value, `pencil` = value as a starting number to overwrite, `circles` = that many circles to tick | `boxes[]: { value, style, label?, when? }` |
| `scoreColumn`  | stacked boxes: value large, `derived` value small                                                                                         | `scores[]: { value, derived? }`            |
| `checkList`    | all things selected; marked if the character has them; `note` stat small next to the name                                                 | `things` (like `options`), `note?`         |
| `featureTable` | the selected things the character has: name, `short`, use boxes from the `uses` stat                                                      | `things`, `uses?`                          |
| `list`         | the selected things the character has, plus blank lines                                                                                   | `things`, `blankLines`                     |
| `answers`      | answers to text and number choices                                                                                                        | `choices[]`                                |
| `helpBox`      | the text `sheet.<id>.text`                                                                                                                | —                                          |
| `notes`        | blank lines                                                                                                                               | `lines`                                    |

**Conditions** (`when`, on every section and on each box of a
`statBoxes` section). An expression (section 8) evaluated with the
finished character: every value, `level`, `has()` and `count()`. If it is
false, the section is not printed at all, title and hint included, and the
sections after it move up to fill the grid. A box with a false `when` is
left out and the other boxes of its row share the width; a `statBoxes`
section whose boxes are all left out is not printed. Without `when`, a
section or box is always printed. Typical use: a section that only some
characters need, for example `"when": "level >= 3"` or
`"when": "has('calling.herbalist')"`, or a box row that only makes sense
when a value is above zero (`"when": "glow > 0"`). The validator checks
that the expression parses and names existing values and things, as for
`requires`.

**Box labels** (`label`, on each box of a `statBoxes` section). A box is
labeled with the name of its value (`value.<id>.name`). Six boxes in a row
are narrow, so a long name is printed small and may wrap. If the section
title already says what the boxes have in common, give the box a shorter
label: `label` is a text key (any key, for example `value.might.name` or
`sheet.<section>.<box>`) printed instead of the value name. Example: a
section "Resistances" with boxes "Might", "Grace" instead of "Might
resistance", "Grace resistance". The builder prints a label as large as
fits, down to 7 pt, and splits a word between letters only if it does not
fit even then; keep labels to one word of about 15 letters.

**Use boxes** (`uses`, on `featureTable` sections and on card layouts).
Names a stat key. The builder knows no stat names, so this field is the
only way it learns which stat counts the uses. Per thing:

| The thing's stat                  | Printed                        |
| --------------------------------- | ------------------------------ |
| whole number n > 0                | n empty boxes to tick (□ □)    |
| `{ "text": "stat-value.always" }` | the text, for example "always" |
| 0, or the thing has no such stat  | nothing                        |

Every value of that stat on the selected things must be a whole number
≥ 0 or a `{text}`; quantities and true/false are errors. At least one
selected thing must have the stat. The count is fixed per thing for now;
a count that depends on the level would later become an expression.
Explain the boxes in the section hint (`sheet.<id>.hint`, for example
"□ = used once: tick it. Erase after a rest.").

**Note** (`note`, on `checkList` sections). Names a stat key; its value is
printed small next to each name, formatted like a card field (numbers as
they are, quantities converted, `{text}` as the text). Typical use: the
score a skill is rolled with. To show the name of a value, point the text
at the value's own name, so the word exists only once:
`"stats": { "score": { "text": "value.might.name" } }`. True/false values
are errors; at least one selected thing must have the stat; things
without it show no note.

**Cards.** Every thing with `card: true` gets a card. `cards.<kind>.fields`
names exactly four stat keys for the 2×2 grid on the card; quantities are
converted. A card shows `card.<kind>.typeLine`, the name, the four stats,
`explain.table` ("at the table") and, below it, `rules` if present. The
footer shows the character name and level and, if `cards.<kind>.uses` is
set, the use boxes as described above.

`sheet.attribution` is printed in the footer of the last page.

## 14. Validation

```sh
pnpm validate-package <dir> [more dirs] [--strict]
```

Prints one line per problem and a summary, and exits with 1 if the package
is invalid (with `--strict`, also if there are warnings):

```
error    things/gadgets.json  [0].grants[0].choice: unknown choice "tune" (known: pick, name)
error    texts/en/  gadget.whistle.name: missing text (name of thing "gadget.whistle")
FAILED  packages/broken: 2 error(s), 0 warning(s)
```

Validation runs in two stages. First every file is checked against its
schema (shape, types, key patterns, unknown fields). Only if all files are
well-formed does the second stage check the rules between files:

- format version supported; keys unique; no reserved prefixes;
- every reference resolves: kinds, sources, licenses, things, choices,
  values, tags, glossary entries, units;
- every expression parses and refers to existing values and things;
  formulas are not circular;
- option sources select at least one thing; recommendations are among the
  options; distribute and number targets take input; point-buy costs are
  consecutive and do not fall; arrays fit the targets;
- each choice is asked exactly one way; `characterName` is a text choice;
- sheet sections and card fields refer to existing values, choices and
  stats; section and box conditions (`when`) parse and refer to existing
  values and things; box labels (`label`) exist in every language; things with `card: true` have a layout; `uses` stats are whole
  numbers or texts, `note` stats are not true/false;
- text variants: ids unique per choice, conditions parse; a variant text
  that exists in one language exists in every language;
- units: every language has defaults; every stated amount can be converted;
- texts: every required key exists in every language; placeholders and
  glossary links are well-formed and resolve; suggestion keys are lists.

Warnings: texts marked `null`; unused texts; style length limits; units
written as plain text; quantities that differ between languages; choices
never asked; computed quantities without a conversion fallback; text
variants without any text.

In code: `validatePackageDir(dir)` returns `{ ok, errors, warnings,
package }`; `package` is the typed, loaded content including the origin of
every text.

## 15. Versioning

**Format version** (`manifest.formatVersion`, `"MAJOR.MINOR"`). The
builder declares the version it understands (`PACKAGE_FORMAT_VERSION`).

- From 1.0 on: a package is accepted if its major version equals the
  builder's and its minor version is not higher. Minor versions only add
  optional things, so older packages keep working. Anything that can break
  a valid package raises the major version.
- Before 1.0 (now): the minor version must match exactly, because any 0.x
  change may break packages.
- Every format change gets a new version, an entry in the changelog below
  and either a migration (what to change in a package, ideally a script)
  or the reason why old packages keep working.

**Package version** (`manifest.version`, semantic versioning) describes
the content: patch for text fixes, minor for new things, major when keys
are removed (saved characters may lose picks). Keys are never renamed.

### Changelog

| Version | Date       | Change                                                                                                                                                  | Migration                                                                                                                                               |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-04 | First version.                                                                                                                                          | —                                                                                                                                                       |
| 0.2     | 2026-10-04 | Optional `uses` on `featureTable` sections and card layouts (use boxes), optional `note` on `checkList` sections.                                       | Set `formatVersion` to `"0.2"`. Nothing else changes: both fields are optional, so every valid 0.1 package is a valid 0.2 package.                      |
| 0.3     | 2026-10-04 | Optional `when` (condition) on every sheet section and on each box of a `statBoxes` section: false means not printed.                                   | Set `formatVersion` to `"0.3"`. Nothing else changes: the field is optional, so every valid 0.2 package is a valid 0.3 package.                         |
| 0.4     | 2026-10-04 | Optional `label` (text key) on each box of a `statBoxes` section, printed instead of the value name.                                                    | Set `formatVersion` to `"0.4"`. Nothing else changes: the field is optional, so every valid 0.3 package is a valid 0.4 package.                         |
| 0.6     | 2026-10-04 | Optional `textVariants` on every choice (other texts while a condition holds); `{{var:count}}` in the title, question and intro of a `pickMany` choice. | Set `formatVersion` to `"0.6"`. Nothing else changes: the field is optional and the variable is new, so every valid 0.5 package is a valid 0.6 package. |

## 16. A minimal package

The smallest useful package: one choice between two things, a name, one
language. The validator accepts it as is.

`manifest.json`

```json
{
  "formatVersion": "0.6",
  "id": "tiny",
  "version": "1.0.0",
  "languages": ["en"],
  "kinds": ["role"],
  "sources": { "me": { "title": "My own notes", "license": "cc0" } },
  "licenses": { "cc0": { "name": "Creative Commons Zero 1.0", "spdx": "CC0-1.0", "publishable": true } }
}
```

`units.json`

```json
{ "dimensions": {}, "languageDefaults": { "en": {} }, "conversions": [] }
```

`values.json`

```json
[{ "id": "grit", "source": "me", "default": 3 }]
```

`things/roles.json`

```json
[
  { "id": "role.scout", "kind": "role", "source": "me", "grants": [{ "value": "grit", "add": 1 }] },
  { "id": "role.cook", "kind": "role", "source": "me" }
]
```

`flow.json`

```json
{
  "level": { "min": 1, "max": 1, "default": 1 },
  "steps": [
    { "id": "role", "choices": ["role"] },
    { "id": "name", "choices": ["name"] }
  ],
  "choices": [
    { "id": "role", "kind": "pickOne", "source": "me", "options": { "kind": "role" } },
    { "id": "name", "kind": "text", "source": "me", "maxLength": 30 }
  ],
  "characterName": "name",
  "summary": { "fields": ["grit"], "line": { "role": { "choice": "role" } } }
}
```

`sheet.json`

```json
{
  "sections": [
    { "id": "header", "kind": "header", "span": 12 },
    { "id": "grit", "kind": "statBoxes", "span": 12, "boxes": [{ "value": "grit", "style": "number" }] }
  ],
  "cards": {}
}
```

`texts/en/main.json`

```json
{
  "source": "me",
  "entries": {
    "package.name": "Tiny",
    "package.short": "A tiny example.",
    "level.name": "Level",
    "level.intro": "There is only one level.",
    "level.hint": "Pick level 1.",
    "summary.line": "{{var:role}}",
    "sheet.attribution": "Tiny, CC0.",
    "kind.role.name": "Role",
    "role.scout.name": "Scout",
    "role.scout.short": "You see things first.",
    "role.scout.explain.what": "You walk ahead of the group.",
    "role.scout.explain.table": "You get 1 more grit.",
    "role.cook.name": "Cook",
    "role.cook.short": "You keep everyone fed.",
    "role.cook.explain.what": "You carry the pots.",
    "role.cook.explain.table": "Everyone likes you.",
    "choice.role.title": "Role",
    "choice.role.question": "What do you do in the group?",
    "choice.role.intro": "Pick one.",
    "choice.name.title": "Name",
    "choice.name.question": "What is your name?",
    "choice.name.intro": "Any name works.",
    "value.grit.name": "Grit",
    "sheet.grit.title": "Grit"
  }
}
```

## 17. Reserved for later versions

Not part of 0.3; listed so nobody builds on a different idea:

- **Packages that extend other packages** (an expansion adding things to a
  base package). Planned: `manifest.dependsOn` and keys of the form
  `<package>:<key>`.
- **Levelling up an existing character** needs no format change: it is
  "raise the level, ask the newly granted choices".
- **Loading packages over HTTP** uses the same files.
- **Showing original terms** next to translated ones (an optional later
  setting) would read the other language's `name`; no format change.
