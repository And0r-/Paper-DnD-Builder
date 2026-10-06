# Content package format — specification

Format version **0.14**. This document describes everything a content
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
  "formatVersion": "0.14",
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

| Field        | Required | Meaning                                                                                                                                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | yes      | Thing key.                                                                                                                                                                                  |
| `kind`       | yes      | One of `manifest.kinds`.                                                                                                                                                                    |
| `source`     | yes      | Source key. `license` optional.                                                                                                                                                             |
| `rank`       | no       | The thing's own tier (for example a spell level). Shown on cards. Not the character level.                                                                                                  |
| `group`      | no       | Heading under which the thing appears in long option lists. Text: `group.<group>.name`.                                                                                                     |
| `tags`       | no       | Free labels for selecting things (`options`, `count()`).                                                                                                                                    |
| `requires`   | no       | [Expression](#8-expressions). The thing is offered as an option only while it is true.                                                                                                      |
| `stats`      | no       | Facts shown on cards and in details: number, `true`/`false`, quantity `{amount, unit}`, `{text}` (a text key, for words like "instant") or `{value}` (see below). Label: `stat.<key>.name`. |
| `grants`     | no       | What having this thing gives, see below.                                                                                                                                                    |
| `about`      | no       | Another thing this one is about, for example skill with one tool → that tool. Used by choices with `held` ([9.3](#93-choices)).                                                             |
| `card`       | no       | Print a card for this thing. Needs a card layout for its kind in `sheet.json`.                                                                                                              |
| `repeatable` | no       | May be picked again in a later choice although the character has it; each pick asks the choices it grants anew (see below).                                                                 |

**Stats that grow.** A stat is fixed per thing, except `{ "value": "<value>" }`:
it shows the character's value with that key (with its unit, if it has
one). Use it for a number that changes with the level or with other
things, for example how often a feature may be used:

```json
{ "id": "trait.bloom-ward", "kind": "trait", "stats": { "uses": { "value": "bloomWardUses" } } }
```

with a value `{ "id": "bloomWardUses", "byLevel": [0, 0, ..., 2, 2, 3, 3] }`
(or a formula, or `practice` itself for "as often as your practice").
The use boxes on the sheet and the cards follow that value
([13](#13-print-sheet-and-cards)).

**Texts with the character's numbers.** A `{text}` stat may name values
to fill in: `{ "text": "<key>", "vars": { "<name>": "<value>" } }`. The
text writes `{{var:<name>}}` (the number as it is) or
`{{var:<name>|signed}}` (always with its sign: "+3", "+0", "-1") where
the character's value goes ([10.4](#104-placeholders)). Use it for a
fact that is partly fixed and partly the character's, for example the
harm of an item: dice and kind of harm are the item's, the bonus is the
character's.

```json
{
  "id": "item.sling",
  "kind": "item",
  "stats": {
    "hit": { "value": "slingHit" },
    "harm": { "text": "stat-value.item.sling.harm", "vars": { "bonus": "slingHarm" } }
  }
}
```

with the text `"1d4 {{var:bonus|signed}}, blunt"`, printed "1d4 +2, blunt"
for a character whose `slingHarm` is 2. The builder knows no rules: what
is added to what is the package's formula for the value.

### Grants

A grant gives exactly one of three things, from `atLevel` on (default 1):

| Grant                                | Effect                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `{ "thing": "item.rope" }`           | The character has that thing too (and everything it grants).                                    |
| `{ "choice": "path", "atLevel": 3 }` | The player is asked that choice; it becomes a step (see [9.4](#94-building-the-list-of-steps)). |
| `{ "value": "stamina", "add": 5 }`   | Adds a number, an expression result or a table by level to a value (see [7](#7-values)).        |

A thing grant may say **how many** with `count` (a whole number ≥ 1,
default 1): `{ "thing": "item.arrow", "count": 20 }`. A thing that some
grant in the package gives with a `count` is counted: every grant that
gives it adds its count (a kit with 20 arrows and another with 8 give 28),
and the sheet prints "28 × Arrow". A thing no grant gives with a `count`
is had once, however many grants give it (a skill from two sources is one
skill). The count changes nothing else: `has()`, `count()` and the
thing's own grants stay as for one.

A value grant's `add` may be a **table by level** instead of a number:
`{ "value": "lanternSlots1", "add": { "byLevel": [1, 2, 2, 3, ...] } }`
adds the entry of the character's level (entry 0 at `flow.level.min`, one
entry per level up to `flow.level.max`). Use it for numbers that only the
characters with this thing have, such as slots per rank of one class.

### Repeatable things

Normally a thing counts once, and a pick choice does not offer a thing the
character already has. A thing with `"repeatable": true` is offered again,
for example a boon "raise two scores" that may be taken at levels 4, 8 and 12. It still counts once for `has()`, `count()` and its `thing` and
`value` grants; what repeats are the **choices it grants**: each pick asks
them again, as a copy with the id `<choice>@<where the thing was picked>`
(the choice it was picked in, or the thing that granted it):

```json
{
  "id": "boon.raise",
  "kind": "boon",
  "source": "mistland",
  "repeatable": true,
  "grants": [{ "choice": "boon-raise" }]
}
```

Picked in `boon-4` and `boon-8`, it asks `boon-raise@boon-4` and
`boon-raise@boon-8`. A copy follows every rule and uses every text of the
declared choice (`choice.boon-raise.*`); its answer is stored under the
copy's id, so changing the pick in `boon-4` leaves the answer of
`boon-raise@boon-8` alone. The declared choice itself is never asked.

**Copies that mark** (a granted choice with `options.owned`). Copies of
the same declared choice mark different things: a copy does not offer what
another copy of that choice has marked by then (in step order), and its
recommendation moves on to the first thing still free when the package's
pick is taken. A repeatable thing the character has is offered again only
while each such choice it grants still has something to mark, judged by
what the character has when the repeatable thing is offered; otherwise its
copy could never be answered. So ask the things to be marked in steps
before the step that offers the repeatable thing. An `answers` section that
names the declared choice prints the answers of all copies in one row
([13](#13-print-sheet-and-cards)).

### What a character has

A character **has** a thing if

1. the player picked it in a `pickOne` or `pickMany` choice that is currently
   asked, or
2. a thing the character has grants it with `atLevel` ≤ the character's level.

The character has it **from a level** on (`atLevel` in the evaluation): a
picked thing from the level of the step it was picked in, a granted one
from the higher of its granter's level and the grant's `atLevel`.

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
| `formula`  | Expression for the base value. Cannot be combined with `default` or `byLevel`. |
| `byLevel`  | The base value as a table by level: one number per level, see below.           |
| `default`  | Base value if no formula and no player input. Default `0`.                     |
| `unit`     | The value is a quantity in this unit (see [12](#12-units)).                    |
| `min, max` | The final value is clamped to this range.                                      |

How the rule core computes a value:

```
base  = formula result            if the value has a formula
      = byLevel[level - min]      if the value has a table by level
      = the player's input        if a distribute or number choice sets it
      = default (or 0)            otherwise
value = clamp(base + sum of all "add" grants of things the character has
              whose atLevel <= level
            + sum of all points raise answers gave it, min, max)
```

Formulas may refer to other values; circular formulas are rejected by the
validator. An `add` expression must not depend on the value it adds to.

`level` is always available: the character level chosen by the player,
between `flow.level.min` and `flow.level.max`.

**Tables by level.** Many numbers follow a table with one row per level
(slots per rank, how many things to prepare, a bonus). An `if()` chain
can say that, but nobody can read twenty of them. `byLevel` is the table:
entry 0 applies at `flow.level.min`, the last at `flow.level.max`, so it
has exactly `max - min + 1` entries (the validator checks). The same form
works for a grant's `add` and a `pickMany` choice's `count`.

```json
{
  "id": "knackRank",
  "source": "mistland",
  "byLevel": [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]
}
```

A bonus that grows by a rule is still a formula:
`{ "id": "practice", "formula": "floor((level - 1) / 4) + 2" }`.

## 8. Expressions

Conditions (`requires`, `when`) and formulas (`formula`, `add`, `count`,
`min`, `max`, `cap`) are short expressions in one small language. The rule core
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
are `level.name`, `level.intro` and `level.hint`; the level is one number
field starting at `level.default`, and the hint is one sentence under it). `max` may be raised later;
grants with `atLevel` above `max` are allowed and simply never apply until
then. Tables by level (`byLevel`) have one entry per level, so raising
`max` means adding entries to them.

### 9.2 Steps

`steps` lists the fixed steps in order. A step shows one choice, or a few
small related choices on one screen (then it needs its own texts
`step.<id>.title`, `.question`, `.intro`). `when` hides the step while the
expression is false.

A **gather step** has no `choices`. It is the place where granted choices
of one gather group are asked (see `gather` in [9.3](#93-choices) and
[9.4](#94-building-the-list-of-steps)):

```json
{ "id": "talents", "gather": "talents", "together": "list" }
```

- `gather`: the group. Each group has at most one gather step.
- `together` (optional): how the gathered choices are shown. Missing: each
  one is its own step here, as if it had been granted right here.
  `"sections"`: one step with all of them, like a step with several
  choices. `"list"`: one step with one shared list of options for all of
  them (pick choices only, see below).
- `when` (optional): as on other steps. A hidden gather step still asks
  its gathered choices, each as its own step at its place.
- With `together`, the step needs its own texts `step.<id>.title`,
  `.question`, `.intro`. Without `together`, `step.<id>.title` is
  optional: the progress line names the gathered choices by it ("Spells,
  part 2 of 4") instead of by the first choice's title.

**One shared list** (`"together": "list"`). The player sees one list and
picks from it; each pick counts for exactly one of the gathered choices.
Every choice's options are worked out as before the step, so each choice
offers its full list; the list is all of them together, without things
the character already has. A thing picked for one choice cannot also count
for another. The builder assigns picks to choices: a pick goes to a choice
that offers it, no choice gets more than its `count`, and earlier picks
stay where they are unless a new pick needs their place. Answers are still
stored one per choice. The recommendation is the choices' recommendations
together, each thing once, filled up from the list until every place is
taken, so "choose for me" always finishes the step. The optional text
`choice.<id>.from` names where a choice's places come from ("from your
calling") for the counter "2 from your calling, 1 from your folk"; without
it the builder names the thing that granted the choice.

### 9.3 Choices

Every choice has `id`, `kind`, `source` (and optional `license`) and
`optional: true` if the character can be finished without an answer. Texts:
`choice.<id>.title` (short step name), `.question`, `.intro`, and optional
`.missing` (what is still missing; see [10.4](#104-placeholders)).

**Gather group.** `gather` (optional) names a group for a granted choice.
Instead of right after the step that grants it, the choice is asked at the
gather step of that group, if that step comes later ([9.4](#94-building-the-list-of-steps)).
This keeps the basic steps together and asks details once everything that
gives things for free is known:

```json
{ "id": "talents-lantern-bearer", "kind": "pickMany", "gather": "talents", ... }
```

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

**`pickMany`** — pick `count` things (a number, an expression or a table by
level, `{ "byLevel": [2, 3, 3, ...] }`); with `"upTo": true`, up to `count`.

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

**The level a pick sees.** A `pickOne`, and a `pickMany` whose `count` is
a number, is a pick made once, at the level of its step (the higher of
the granter's level and the grant's `atLevel`, see
[What a character has](#what-a-character-has)). Its `requires` and the
`when` of its `recommend` see `level` and the values at that level, so a
character built at level 20 is not offered a thing with
`"requires": "level >= 19"` on its level-4 step, and the step does not
recommend it. `has()` and `count()` see what the character has by the
time the step is asked, as the options do: a thing it gets at a later
level is not offered or recommended a second time. A `pickMany` whose
`count` is an expression or a table by level is the character's list at
its level (for example knacks that grow with the level): it sees the
character at its level. `count` and `textVariants` always see the
character at its level.

**Picking among what the character has** (`"owned": true` in `options`).
Some choices pick from what the character already has, for example "two
of your knacks become your favourites". With `owned`, the builder offers
only the selected things the character has by the time the choice is
asked (in step order; put the choice behind the steps that give those
things, for example with a gather step). A pick does not give the thing a
second time and gives nothing it grants; it only **marks** it: the
evaluation lists the marked things with their choices, and an `answers`
section on the sheet prints the picks ([13](#13-print-sheet-and-cards)).
If the character no longer has a picked thing (an earlier answer
changed), the pick no longer fits and the step needs a new answer.
Everything else (`count`, `recommend`, `badges`, `requires`) works as for
other pick choices. An `owned` choice cannot be gathered in a `list`
gather step: that list leaves out what the character has.

**Only what was picked in some choices** (`"ownedFrom": [<choice>, …]`
next to `"owned": true`). The builder offers only the selected things the
character picked in one of these choices (or in a copy of one); what came
another way (granted by a thing, picked in another choice) is left out.
Typical use: a choice "which of the knacks in your book do you keep at
hand", where a knack borrowed from elsewhere is always at hand anyway and
must not take a place. Name pick choices without `owned`: those give what
is picked in them.

```json
{
  "id": "lantern-mastery",
  "kind": "pickMany",
  "source": "mistland",
  "options": { "kind": "knack", "owned": true },
  "count": 2,
  "gather": "mastery"
}
```

`recommend` is a list; the first entry whose `when` is true (or that has
no `when`) is the recommendation. It drives the "recommended" badge and
the "choose for me" button. A `pickOne` recommends exactly one thing. For a
`pickMany` the recommendation is the entry's offered picks, then the other
options in order, cut to `count`: a count that grows with the level needs
no recommendation per count, and "choose for me" always finishes.

`badges` (optional, `pickOne` and `pickMany`) puts a short label of the
package's own on some options, for example how easy they are to play.
Each entry lists `things` (options of this choice) and a `text` key (any
key, for example `choice.<id>.badge.<name>`) that must exist in every
language. A thing has at most one badge per choice. The builder shows the
badge where it would show "recommended", and instead of it: an option
with a badge never shows "recommended", but "choose for me" still picks
the recommendation. Use badges when "recommended" on one option would push
every player to the same pick.

```json
"badges": [
  { "things": ["calling.lantern-bearer"], "text": "choice.calling.badge.gentle" }
]
```

`held` (optional, `pickOne` and `pickMany`) helps the player pick options
that fit what the character already has. It needs options with `about`
(see [6](#6-things)). An offered option whose `about` thing the character
has is recommended first, options also in `recommend` first among them;
the `recommend` entry fills the remaining places, and the list is cut to
`count` (one for `pickOne`). Above the
list the builder shows the text `text` with `{{var:things}}`: the names of
those things as a list ("A, B and C"), in option order. If the character
has none of them, nothing is shown and `recommend` applies as usual.

```json
"options": { "kind": "handling" },
"held": { "text": "choice.handling-river-runner.held" }
```

with `"choice.handling-river-runner.held": "In your pack you have: {{var:things}}."`
and things like `{ "id": "handling.rope", "kind": "handling", "about": "item.rope", ... }`.

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
- `raise`: adds points **on top of** the targets as they are before this
  choice, instead of setting their base. "Before this choice" means at the
  choice's level: grants, raises and things from a higher level do not
  count yet, tables by level and `level` give the entry of the choice's
  level. So a bonus at level 20 does not use up the cap of a raise at
  level 4. The same holds for `cap` and the `when` of `recommend`. `points` in all, at most
  `maxPerTarget` on one target (default: `points`), and no target above
  `cap` (a number or an expression; the value's own `max` applies too).
  The answer names only the targets that get points:
  `{ "method": 0, "assign": { "heart": 2 } }`. Fewer points are complete
  only when no target can take another one. Several raise choices (on
  different levels) add up. A `raise` method cannot stand next to other
  methods, and its targets may be any values, also ones with a formula.
- With several methods the player picks one.
- Targets of `pointBuy` and `array` must be values without a formula or
  table; the answer becomes their base.

How the builder shows a row (no field needed): the row is named after the
value the target adds up to, if exactly one value is a plain sum using it
(`"strength": "strengthBase + strengthBonus"`); otherwise after the target.
It shows that value's sum ("15 + 2 from … = 17") and, if a `scoreColumn`
entry of `sheet.json` prints that value (or a value that is a plain sum of
it) with a `derived` value, the derived number too, so a player sees what
the number does while choosing it.

`badges` (optional) puts a short label on rows: each entry lists `targets`
(of this choice), a `text` key and an optional `when`. The first entry whose
`when` holds labels a row; use it to say which values matter most for the
character ("Key for a lantern bearer"). Each row may also carry a sentence,
the text `choice.<id>.target.<target>`, or, while a text variant is active,
`choice.<id>.variant.<variant>.target.<target>`: what this value does for
this character at the table. Without it the row shows `value.<value>.explain`.
A package should keep the point-buy rule out of the intro: the builder says
it in one sentence from `costs`.

```json
"textVariants": [{ "id": "lantern-bearer", "when": "has('calling.lantern-bearer')" }],
"badges": [
  {
    "when": "has('calling.lantern-bearer')",
    "targets": ["heartBase", "witBase"],
    "text": "choice.scores.badge.lantern-bearer"
  }
]
```

```json
{
  "id": "boon-raise",
  "kind": "distribute",
  "source": "mistland",
  "targets": ["might", "grace", "wit", "heart"],
  "methods": [{ "method": "raise", "points": 2, "maxPerTarget": 2, "cap": 15 }],
  "recommend": [
    { "when": "has('calling.lantern-bearer') and heart <= 13", "assign": { "heart": 2 } },
    { "when": "has('calling.lantern-bearer')", "assign": { "wit": 2 } }
  ]
}
```

For a raise, the recommendation is always a full answer: the entry's
assignment as far as it fits, the points left over to its targets and then
to the others in order. Write it as "the most important score first", with
a `when` that moves on once that score is near the cap.

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
4. Exception: a granted choice with `gather` whose gather step comes later
   is not inserted after the step; it waits at the gather step, in grant
   order. If the gather step was already passed, or there is none, rule 2
   applies. At the gather step the waiting choices become one step each
   (no `together`; rule 2 applies to them) or one step with all of them
   (`together`, step id = gather step id). A gather step with no waiting
   choice is not shown.
5. A choice is either listed in `steps` or granted by things, never both.
   A choice that is neither is never asked (a warning).
6. The builder adds its own overview step at the end.
7. A choice granted by a repeatable thing is inserted once per pick, as a
   copy `<choice>@<where picked>` (see [6](#6-things)); copies follow rules
   2 to 4 like any granted choice.

Every step has a **level** (`atLevel` in the evaluation): the steps of
`steps` have `flow.level.min`; a granted step has the level at which its
grant applies, following the grants back to the step where the player
picked (a choice granted at level 1 by a thing granted at level 3 comes
with level 3); a step granted by several things has the lowest. Raising a
character from level n to a higher level adds exactly the steps with
`atLevel > n`. A step listed in `steps` with a `when` on the level keeps
`flow.level.min`; grant level-bound choices instead.

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

| Key                                                                      | Required                                                            | For                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `package.name`, `package.short`                                          | yes                                                                 | name and description of the package                                        |
| `level.name`, `level.intro`, `level.hint`                                | yes                                                                 | the level screen (the word for "level" is package text)                    |
| `level.pick.<n>`                                                         | no                                                                  | not shown any more; older packages stay valid                              |
| `rank.name`, `rank.<n>.name`                                             | no                                                                  | headings of a long list grouped by rank (10.2.1)                           |
| `kind.<kind>.name`                                                       | yes                                                                 | name of a kind (card type line, headings)                                  |
| `<thing>.name`                                                           | yes                                                                 | name, at most 30 characters                                                |
| `<thing>.short`                                                          | yes                                                                 | one sentence, at most 120 characters; see 10.3                             |
| `<thing>.explain.what`                                                   | yes                                                                 | plain language: what it is                                                 |
| `<thing>.explain.table`                                                  | yes                                                                 | plain language: what you do with it at the table                           |
| `<thing>.explain.example`                                                | no                                                                  | a small scene                                                              |
| `<thing>.goodIf`                                                         | no                                                                  | who it suits, at most 80 characters                                        |
| `<thing>.rules`                                                          | no                                                                  | the official rules text, verbatim                                          |
| `choice.<id>.title`, `.question`, `.intro`                               | yes                                                                 | a choice's step                                                            |
| `choice.<id>.missing`                                                    | no                                                                  | what is still missing                                                      |
| `choice.<id>.variant.<variant>.title`, `.question`, `.intro`, `.missing` | no; once in one language, in all                                    | a text variant (9.3)                                                       |
| `step.<id>.title`, `.question`, `.intro`                                 | if the step has several choices or is a gather step with `together` | a combined step                                                            |
| `step.<id>.title` of a gather step without `together`                    | no; once in one language, in all                                    | the name of its gathered choices in the progress line                      |
| `choice.<id>.from`                                                       | no                                                                  | where a gathered choice's places come from (9.2)                           |
| `group.<group>.name`                                                     | yes, per group used                                                 | heading in option lists                                                    |
| `value.<id>.name`                                                        | yes                                                                 | name of a value                                                            |
| `value.<id>.explain`                                                     | no                                                                  | one-line explanation                                                       |
| `value.<id>.amount`                                                      | no                                                                  | how the builder writes the value, `{{var:n}}` is the number ("d{{var:n}}") |
| `stat.<key>.name`                                                        | yes, per stat used                                                  | label of a stat                                                            |
| any key used in `{ "text": ... }` stats or `suggestions`                 | yes                                                                 | stat words, suggestion lists                                               |
| `unit.<unit>.short`, `unit.<unit>.long`                                  | yes                                                                 | unit forms ("m", "meters")                                                 |
| `unit.<unit>.longOne`                                                    | no                                                                  | singular long form for the amount 1 ("foot")                               |
| `glossary.<id>.name`, `.short`, `.explain.what`, `.explain.table`        | yes                                                                 | a glossary entry                                                           |
| `glossary.<id>.explain.example`                                          | no                                                                  | example for a glossary entry                                               |
| `summary.line`                                                           | yes                                                                 | one-line summary in the character list                                     |
| `sheet.attribution`                                                      | yes                                                                 | source and license line on the printed sheet                               |
| `sheet.<section>.title`                                                  | yes, except header                                                  | sheet section title                                                        |
| `sheet.<section>.text`                                                   | for `helpBox`                                                       | help box content                                                           |
| `sheet.<section>.hint`                                                   | no                                                                  | one-line hint under a section                                              |
| `card.<kind>.typeLine`                                                   | yes, per card layout                                                | first line of a card                                                       |
| `card.<kind>.hint`                                                       | no                                                                  | short hint on every card of the kind, above the footer                     |

#### 10.2.1 Long builds

The level screen is one number field, whatever the highest level. It starts
at `level.default`. `level.pick.<n>` is no longer shown (the cards it filled
were dropped after a player test); a package may still carry it.

A list of 12 options or more gets a search, shows the recommended options
first and, if its options have no `group` but different ranks, groups them
by rank. The heading is `rank.<n>.name`, else `rank.name` and the number
("Rank 3"). Without `rank.name` the list is not grouped by rank.

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

Length limits count characters as the reader sees them: a glossary link
counts as its words, a quantity as 8 characters ("9 meters"), a variable as
2 ("+3"). They are warnings:

| Text                          | Limit                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<thing>.name`                | 30 characters (`package.name` has no limit; the sheet header fits it to its box)                                                                                                                                  |
| `<thing>.short`               | 120 characters                                                                                                                                                                                                    |
| `<thing>.short` printed alone | 3 sentences and 240 characters, for a thing a `featureTable` section lists and that has no `card`: at the table its short text is all there is, so it carries every limit of the rule (how often, when, how many) |
| `<thing>.goodIf`              | 80 characters                                                                                                                                                                                                     |
| `<thing>.explain.*`           | 400 characters for `what`, `table` and `example` together                                                                                                                                                         |

`<thing>.rules` is an official text and stays verbatim, so units written in
it are not listed one by one; the validator counts them in one warning per
file.

### 10.4 Placeholders

| Placeholder                     | Shows                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `{{length:30}}`                 | 30 in the source unit of dimension `length`, converted to the reader's unit, long form: "9 meters" / "30 feet" |
| `{{length:30\|short}}`          | the same with the short form: "9 m" / "30 ft"                                                                  |
| `[[glossary:stamina\|Stamina]]` | "Stamina", marked as a glossary link to entry `stamina`                                                        |
| `{{var:name}}`                  | a value the screen supplies (table below)                                                                      |
| `{{var:name\|signed}}`          | the same, a number always with its sign: "+3", "+0", "-1"                                                      |

| Text                                                              | Variables                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| `summary.line`                                                    | the names in `flow.summary.line`                                      |
| `card.<kind>.typeLine`                                            | `kind` (name of the kind), `rank` (the thing's rank), `level`         |
| `choice.<id>.missing`                                             | `remaining` (how many are still missing), `count` (how many in total) |
| `choice.<id>.title`, `.question`, `.intro` of a `pickMany` choice | `count` (how many to pick, worked out for this character)             |
| the `held` text of a choice                                       | `things` (names of the things the character has: "A, B and C")        |
| a `{text}` stat with `vars` ([6](#6-things))                      | the names in `vars`, each the character's value                       |
| `value.<id>.amount`                                               | `n` (the value or the amount a thing gives)                           |

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

| Kind           | Shows                                                                                                                                                                                         | Fields                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `header`       | character name, `summary.line`, the answers of `fields`, "played by", package name                                                                                                            | `fields?[]: { choice, label? }`                                      |
| `statBoxes`    | up to 6 large boxes; `number` = computed value, `pencil` = value as a starting number to overwrite, `circles` = number + tickable circles, `boxes` = squares to tick                          | `boxes[]: { value, style, label?, text?, when? }`                    |
| `scoreColumn`  | stacked boxes: value large, `derived` value small, `extra` value small beside it                                                                                                              | `scores[]: { value, derived?, extra?, extraLabel? }`                 |
| `checkList`    | all things selected; marked if the character has them, marked twice if it has a `strong` thing about them; `note` stat small next to the name; `total` value in the box                       | `things` (like `options`), `note?`, `total?`, `strong?`              |
| `statTable`    | the selected things the character has, one row each: name, then one column per stat                                                                                                           | `things`, `columns[]: { stat, signed?, wrap? }`                      |
| `featureTable` | the selected things the character has: name, `note` stat under it, `short`, use boxes from the `uses` stat; grouped by rank (`byRank`) or by origin (`groupBy`), marked, with a lead sentence | `things`, `uses?`, `note?`, `byRank?`, `groupBy?`, `marks?`, `lead?` |
| `list`         | the selected things the character has ("3 × Rope" for counted things), plus blank lines                                                                                                       | `things`, `blankLines`                                               |
| `answers`      | answers to text and number choices, and the picks of choices with `owned` options; all copies of a choice in one row, no row for a choice not asked                                           | `choices[]`                                                          |
| `helpBox`      | the text `sheet.<id>.text`                                                                                                                                                                    | —                                                                    |
| `notes`        | blank lines                                                                                                                                                                                   | `lines`                                                              |

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

**Header answers** (`fields`, on the `header` section, 1 to 4). Each is
printed small under the summary line, after its label, and names either

- a `choice`: its answer is printed; the label is the text key `label`, or
  else the choice's title (`choice.<id>.title`). An unanswered choice gets
  a line to write on. A choice asked as copies (see "Repeatable things")
  prints the answers of all copies, in step order, separated by commas; so
  does its row in an `answers` section. An `answers` section leaves out
  the row of a choice the character was not asked at all, not even as a
  copy, and is not printed without any row.
- `things`, selected like `options`: the names of those the character has
  are printed, joined by commas, e.g. the one thing of a kind every folk
  grants, whether fixed or picked. The label is `label`, or else the name
  of `things.kind` (`kind.<kind>.name`); without a `kind`, `label` is
  needed. If the character has none of them, a line to write on.

Use it for what a game master asks first and the summary line does not
say, for example
`[{ "choice": "folk" }, { "choice": "upbringing" }, { "things": { "kind": "build" } }]`.
Four fields share the width of the page, about 45 mm each; keep labels
and answers short.

**Squares and box texts** (`style: "boxes"` and `text`, on each box of a
`statBoxes` section). A `boxes` box draws as many squares to tick as its
value (rounded; several rows if they do not fit one, the row of boxes
grows for them; above 24 the number is printed instead). `text` is a text
filled with the character's values, printed large instead of the number
(above the squares or circles), in the shape of a `{text}` stat:
`{ "text": "sheet.recovery.rest-dice", "vars": { "count": "restDice", "die": "restDie" } }`
with the text `"{{var:count}} × d{{var:die}}"` prints "3 × d8" over three
squares. A `pencil` box takes no `text`. Typical use: dice to spend on a
rest, a few tries before something runs out (a value with `"default": 3`).

**A further number per score** (`extra`, `extraLabel`, on each score of a
`scoreColumn`). A value printed small, with its sign, between the score and
its `derived` circle, under the label `extraLabel` (a text key; default
`value.<extra>.name`). Typical use: a roll made with the score, so it needs
no row of boxes of its own.

**Marked twice** (`strong`, on `checkList` sections). Selects things like
`things` does; every one of them the character has marks the thing it is
`about` ([6](#6-things)) a second time: printed ◉ instead of ●. Say what ◉
means in the text key `strongLegend`: it is printed after the section hint only if
a row is marked twice, so a sheet without one does not explain it. The
builder draws ●, ○ and ◉ in hints and legends as shapes. At least one
selected thing must be `about` a thing of the list.

**Use boxes** (`uses`, on `featureTable` sections and on card layouts).
Names a stat key. The builder knows no stat names, so this field is the
only way it learns which stat counts the uses. Per thing:

| The thing's stat                  | Printed                                    |
| --------------------------------- | ------------------------------------------ |
| whole number n > 0                | n empty boxes to tick (□ □)                |
| `{ "value": "bloomWardUses" }`    | as many boxes as the character's value has |
| `{ "text": "stat-value.always" }` | the text, for example "always"             |
| 0, or the thing has no such stat  | nothing                                    |

Every value of that stat on the selected things must be a whole number
≥ 0, a `{value}` or a `{text}`; quantities and true/false are errors. At
least one selected thing must have the stat. A count that changes with
the level is a `{value}` stat ([6](#6-things)); the builder rounds the
value and prints at most 12 boxes.
Explain the boxes in the section hint (`sheet.<id>.hint`, for example
"□ = used once: tick it. Erase after a rest.").

**Groups by rank** (`byRank: true`, on `featureTable` sections). The
rows are grouped by the things' `rank`, lowest first, by name inside a
group; things without a rank come last, without a heading. Each group is
headed by `rank.<n>.name` if the package has it (for example a word of its
own for rank 0), else by `rank.name` and the number ("Rank 2"); `rank.name`
is then required. `sheet.<section>.rank.<n>.hint`, if present, is printed
small beside the heading (for example what that rank costs to use). A table
that goes on on the next page repeats the heading of the group it is in.
Typical use: a long list of things of several ranks, read rank by rank,
next to the boxes that count the uses per rank.

**Marks** (`marks`, on `featureTable` sections). Short signs (a letter or
two, the text `text`) printed next to a row's name, and explained under the
table: one entry "sign = legend" (the text `legend`) per mark that is on at
least one row. A mark is on every row whose thing matches all of its fields:

| Field      | The row's thing                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `tags`     | carries all these tags                                                                                            |
| `how`      | `picked`: was picked in a choice; `granted`: was given by another thing                                           |
| `from`     | came from one of these things (like `options`): the thing that granted it, or that granted its choice             |
| `pickedIn` | was picked in one of these choices (or a copy of one)                                                             |
| `marked`   | was marked by one of these choices with `options.owned` (or a copy of one)                                        |
| `unmarked` | was marked by none of these choices with `options.owned`, while at least one of them (or a copy) was asked at all |

A mark needs at least one of them. `not` (an object with the same fields)
takes rows away: a row that also matches all fields of `not` does not get
the mark. A row may carry several marks, in the order of `marks`. Marks with
the same `text` and the same `legend` are one mark: a row gets the sign
once, and the legend has one entry. So one sign can stand for "this or
that". Typical use: where something comes from (picked from the calling,
given by the path, from a boon), and a property worth seeing at a glance (a
tag such as "lasts while you stay steady").

`unmarked` says nothing before its choice is asked: a character who never
gets the choice has no row with that mark, and `not` with `unmarked` takes
no row away. Typical use: a book of knacks (picked in one choice) of which
a second, `owned` choice keeps some at hand. The knacks at hand keep the
usual sign, the others get their own:

```json
"marks": [
  {
    "text": "sheet.knacks.mark.calling",
    "legend": "sheet.knacks.mark.calling.legend",
    "how": "picked",
    "from": { "kind": "calling" },
    "not": { "pickedIn": ["knacks-root"], "unmarked": ["rooted-focus"] }
  },
  {
    "text": "sheet.knacks.mark.book",
    "legend": "sheet.knacks.mark.book.legend",
    "pickedIn": ["knacks-root"],
    "unmarked": ["rooted-focus"]
  }
]
```

```json
{
  "id": "knacks",
  "kind": "featureTable",
  "span": 8,
  "things": { "kind": "knack" },
  "byRank": true,
  "marks": [
    {
      "text": "sheet.knacks.mark.calling",
      "legend": "sheet.knacks.mark.calling.legend",
      "how": "picked",
      "from": { "kind": "calling" }
    },
    { "text": "sheet.knacks.mark.path", "legend": "sheet.knacks.mark.path.legend", "how": "granted" },
    { "text": "sheet.knacks.mark.steady", "legend": "sheet.knacks.mark.steady.legend", "tags": ["steady"] }
  ],
  "lead": { "things": { "kind": "calling" }, "text": "knacks.change" }
}
```

**Lead** (`lead`, on `featureTable` sections). A sentence above the rows
for each thing the character has among `lead.things`: the text
`<thing>.<lead.text>`, for example `calling.lantern-bearer.knacks.change`
("After each long rest you may swap one knack."). A thing without that text
adds no sentence, so the package writes it only where it has something to
say.

**Note** (`note`, on `checkList` sections). Names a stat key; its value is
printed small next to each name, formatted like a card field (numbers as
they are, quantities converted, `{text}` as the text). Typical use: the
score a skill is rolled with. To show the name of a value, point the text
at the value's own name, so the word exists only once:
`"stats": { "score": { "text": "value.might.name" } }`. True/false values
are errors; at least one selected thing must have the stat; things
without it show no note.

**Total** (`total`, on `checkList` sections). Names a stat key; each
selected thing's stat must be `{ "value": "<value>" }`. The character's
value is printed in the thing's box, always with its sign ("+5"), and,
if it is made of two parts or more, where it comes from small under the
name ("Grace bonus +2 · Practice +2"), taken apart from the value's
formula as on screen. Things without
the stat get an empty box. Typical use: the number a skill adds to a
roll, so a player at the table reads it instead of adding it up. The
formula decides what counts, for example
`graceBonus + if(has('talent.sneaking'), practice, 0)`.

**Tables** (`statTable`). One row per selected thing the character has:
its name, then one column per entry of `columns` (1 to 4), headed by
`stat.<stat>.name`. A cell shows the thing's stat as a card field does
(quantities converted, `{text}` with its `vars` filled in, `{value}` as
the character's value); `signed: true` writes numbers with their sign.
A row is kept to one line (no origins under the numbers), so a handful of
rows fits next to other sections, except in a column with `wrap: true`:
that column holds words (for example a list of properties), takes the room
the numbers leave, never more than it needs, and wraps. A thing without the stat shows "—". Each column must be a stat that at least one
selected thing has and that is not true/false. Typical use: what a
character attacks with, how well it hits and how much harm it does.

```json
{
  "id": "attacks",
  "kind": "statTable",
  "span": 6,
  "things": { "tags": ["armed"] },
  "columns": [{ "stat": "hit", "signed": true }, { "stat": "harm" }, { "stat": "range" }]
}
```

**Feature tables** (`note`, `groupBy`, on `featureTable` sections). `note`
names a stat printed small under each name, as in a `checkList`; typical
use: a word that names what the thing does at the table. With
`"groupBy": "origin"` the rows are grouped under the name of what brought
them: followed up through the things that granted them and the things that
granted the choice they were picked in, to a thing picked in one of the
package's own steps (a calling, a folk). Groups come in the order of their
first row.

**Cards.** Every thing with `card: true` gets a card. `cards.<kind>.fields`
names exactly four stat keys for the 2×2 grid on the card; quantities are
converted. A card shows `card.<kind>.typeLine`, the name, the four stats,
`explain.table` ("at the table") and, below it, `rules` if present. The
footer shows the character name and level and, if `cards.<kind>.uses` is
set, the use boxes as described above.
`card.<kind>.hint`, if present, is printed small above the footer of every
card of the kind, continuation cards included: the place to explain what the
card's abbreviations mean to someone holding only the cards. It gets at most
two lines; a longer text is cut with "…". Its room comes from the rules,
which move to a continuation card sooner.

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
- `{value}` stats and the `vars` of `{text}` stats name existing values; a
  stat text with `vars` uses no other variable;
- option sources select at least one thing; recommendations are among the
  options; badges name options, at most one per thing, and their texts
  exist in every language; `about` names another existing thing; `held`
  needs options with `about`, and its text exists in every language; distribute and number targets take input; point-buy costs are
  consecutive and do not fall; arrays fit the targets; a `raise` method
  stands alone, its `cap` parses, and its recommendations stay within
  `points` and `maxPerTarget`; every table by level has one entry per level;
  a `count` table asks for no more than there are options;
- each choice is asked exactly one way; `characterName` is a text choice;
  each gather group has at most one gather step; a `list` gather step
  gathers only `pickOne` and `pickMany` choices, and none with `owned`
  options; `answers` sections show text and number choices and choices
  with `owned` options;
- sheet sections and card fields refer to existing values, choices and
  stats; section and box conditions (`when`) parse and refer to existing
  values and things; box labels (`label`) exist in every language; things with `card: true` have a layout; `uses` stats are whole
  numbers or texts, `note` stats and table columns are not true/false,
  `total` stats are `{value}`; `byRank` tables select things with a rank
  and `rank.name` exists; mark tags and `from`, and `lead.things`, select
  things; mark `pickedIn` names pick choices without `owned`, `marked` and
  `unmarked` name choices with `owned` (also inside `not`); mark signs and
  legends exist in every language;
- `ownedFrom` goes only with `"owned": true` and names pick choices
  without `owned`;
- text variants: ids unique per choice, conditions parse; a variant text
  that exists in one language exists in every language;
- units: every language has defaults; every stated amount can be converted;
- texts: every required key exists in every language; placeholders and
  glossary links are well-formed and resolve; suggestion keys are lists.

Warnings: texts marked `null`; unused texts; style length limits; units
written as plain text; quantities that differ between languages; choices
never asked; computed quantities without a conversion fallback; text
variants without any text; a gather group without a gather step; a choice
with `gather` that is listed in a fixed step; a gather step that no choice
is gathered in; a repeatable thing that grants no choice; `maxPerTarget`
above `points`.

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

| Version | Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | 2026-10-04 | First version.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 0.2     | 2026-10-04 | Optional `uses` on `featureTable` sections and card layouts (use boxes), optional `note` on `checkList` sections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Set `formatVersion` to `"0.2"`. Nothing else changes: both fields are optional, so every valid 0.1 package is a valid 0.2 package.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 0.3     | 2026-10-04 | Optional `when` (condition) on every sheet section and on each box of a `statBoxes` section: false means not printed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `formatVersion` to `"0.3"`. Nothing else changes: the field is optional, so every valid 0.2 package is a valid 0.3 package.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 0.4     | 2026-10-04 | Optional `label` (text key) on each box of a `statBoxes` section, printed instead of the value name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Set `formatVersion` to `"0.4"`. Nothing else changes: the field is optional, so every valid 0.3 package is a valid 0.4 package.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 0.5     | 2026-10-04 | Optional `badges` on `pickOne` and `pickMany` choices: a package text shown on options instead of "recommended".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Set `formatVersion` to `"0.5"`. Nothing else changes: the field is optional, so every valid 0.4 package is a valid 0.5 package.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 0.6     | 2026-10-04 | Optional `textVariants` on every choice (other texts while a condition holds); `{{var:count}}` in the title, question and intro of a `pickMany` choice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Set `formatVersion` to `"0.6"`. Nothing else changes: the field is optional and the variable is new, so every valid 0.5 package is a valid 0.6 package.                                                                                                                                                                                                                                                                                                                                                                                              |
| 0.7     | 2026-10-04 | Optional `about` on things and `held` on `pickOne` and `pickMany` choices: recommend and name what the character has.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `formatVersion` to `"0.7"`. Nothing else changes: both fields are optional, so every valid 0.6 package is a valid 0.7 package.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 0.9     | 2026-10-05 | Levels up to 20: `distribute` method `raise` (points on top of values, `maxPerTarget`, `cap`); tables by level (`byLevel` on values, `{ "byLevel": [...] }` for a grant's `add` and a `pickMany` `count`); `repeatable` on things (choices asked again per pick as `<choice>@<where>`). A `pickMany` recommendation is cut to `count` and filled up from the options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `formatVersion` to `"0.9"`. Nothing else changes: every field is optional, and a recommendation that already had `count` picks is the same, so every valid 0.8 package is a valid 0.9 package.                                                                                                                                                                                                                                                                                                                                                   |
| 0.10    | 2026-10-05 | Stats `{ "value": "<value>" }`: show the character's value, and give use boxes that grow with the level. `"owned": true` in a pick choice's `options`: pick among what the character has; a pick marks the thing instead of giving it, `answers` sections print the picks. A `raise` sees the values, `cap` and `recommend` conditions at the choice's level, not at the character's level.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Set `formatVersion` to `"0.10"`. The new fields are optional. A `raise` on a level below the character's no longer counts what later levels give: a package that worked around this (for example a second value for the printed score) can drop the workaround. Saved raises stay valid; a raise that left points over because a later bonus filled the cap may now ask for them.                                                                                                                                                                    |
| 0.11    | 2026-10-05 | `total` on `checkList` sections: the character's value in each box, with where it comes from. Section kind `statTable`: the things the character has, one column per stat. `{text}` stats may fill in values (`vars`); placeholder `{{var:name\|signed}}` writes a number with its sign.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Set `formatVersion` to `"0.11"`. Nothing else changes: every field is optional and the placeholder is new, so every valid 0.10 package is a valid 0.11 package.                                                                                                                                                                                                                                                                                                                                                                                      |
| 0.12    | 2026-10-05 | Optional `badges` on `distribute` choices (a label on rows while `when` holds); optional row texts `choice.<id>.target.<target>` and `choice.<id>.variant.<variant>.target.<target>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Set `formatVersion` to `"0.12"`. Nothing else changes: the field and the texts are optional, so every valid 0.11 package is a valid 0.12 package.                                                                                                                                                                                                                                                                                                                                                                                                    |
| 0.13    | 2026-10-06 | Optional `byRank`, `marks` and `lead` on `featureTable` sections: rows grouped by rank under `rank.<n>.name` or `rank.name` with an optional `sheet.<id>.rank.<n>.hint`, short signs with a legend by tags, picked or granted, and where a row came from, and a sentence `<thing>.<text>` above the rows. `count` on thing grants (how many; counted things add up, the sheet prints "8 × Arrow"). Sheet: `fields` on the header (answers under the summary line); box style `boxes` (squares to tick) and box `text` (filled text instead of the number); `extra` and `extraLabel` on scores; `strong` on `checkList` (marked twice, ◉); `wrap` on `statTable` columns; `note` and `groupBy: "origin"` on `featureTable`. Optional text `value.<id>.amount`: how the builder writes a value ("d{{var:n}}").                                                                                                                                                                                                                                                                                                             | Set `formatVersion` to `"0.13"`. Nothing else changes: every field is optional, and without `count` a thing is had once as before, so every valid 0.12 package is a valid 0.13 package.                                                                                                                                                                                                                                                                                                                                                              |
| 0.14    | 2026-10-06 | Sheet: a header field may name `things` instead of a `choice` (the names of the selected things the character has, e.g. a size; label by default `kind.<kind>.name`). Optional `strongLegend` on `checkList` sections: what ◉ means, printed after the section hint only if a row is marked twice. Copies of a choice with `options.owned` (asked again by a repeatable thing) mark different things: a copy leaves out what another copy marked, its recommendation moves on to the first free thing, and a repeatable thing is no longer offered when its copy would have nothing left to mark. Header fields and `answers` rows print the answers of every copy of the named choice in one row; an `answers` row of a choice not asked is left out, a section without rows is not printed. `options.ownedFrom`: an `owned` choice offers only what was picked in these choices. Marks on `featureTable` rows: new fields `pickedIn`, `marked` and `unmarked` (picked in, marked or left unmarked by these choices) and `not` (rows that also match it get no sign); marks with the same sign and legend are one mark. | Set `formatVersion` to `"0.14"`. Nothing else has to change: both are optional, so every valid 0.13 package is a valid 0.14 package. To print the ◉ explanation only where it applies, move it from `sheet.<id>.hint` into a text of its own and name that in `strongLegend`. The new fields are optional. A package that let two copies mark the same thing loses that; put the steps that give the marked things before the step that offers the repeatable thing. A package with two marks of the same sign and legend now prints that sign once. |
| 0.8     | 2026-10-04 | Gather steps (`gather`, optional `together`: `sections` or one shared `list`) in `flow.steps`, optional `gather` on choices, optional text `choice.<id>.from`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Set `formatVersion` to `"0.8"`. Nothing else changes: a package without gather steps builds the same steps as before, so every valid 0.7 package is a valid 0.8 package.                                                                                                                                                                                                                                                                                                                                                                             |

## 16. A minimal package

The smallest useful package: one choice between two things, a name, one
language. The validator accepts it as is.

`manifest.json`

```json
{
  "formatVersion": "0.14",
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

Not part of 0.11; listed so nobody builds on a different idea:

- **Packages that extend other packages** (an expansion adding things to a
  base package). Planned: `manifest.dependsOn` and keys of the form
  `<package>:<key>`.
- **Levelling up an existing character** needs no format change: it is
  "raise the level, ask the steps with a higher `atLevel`".
- **Loading packages over HTTP** uses the same files.
- **Showing original terms** next to translated ones (an optional later
  setting) would read the other language's `name`; no format change.
