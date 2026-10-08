# Example characters with more than one calling

Three draft documents (format 0.21, `tracks`) for tests of the rule core.
Everything is invented, like the rest of the package. The loader ignores
this folder.

| File                          | Character                                   | What it shows                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lantern-herbalist.json`      | Lantern Bearer 3 / Herbalist 2              | Shared glow slots by `glowLevel` (full plus half, rounded up); `only: "first"` and `"added"`; copies `<choice>@calling.herbalist`; `rankUpTo` per calling; `cardValues` per knack choice |
| `herbalist-river-runner.json` | Herbalist 1 / River Runner 4                | Shared glow slots of the herbalist next to the river runner's own current slots; a boon at river runner level 4 (character level 5); a path from the added calling                       |
| `refused-lantern-bearer.json` | River Runner 2, lantern bearer refused at 3 | `addRequiresCurrent`: the lantern bearer's own condition holds, the river runner's (grace 10) does not                                                                                   |

`expected.json` lists, per file, the numbers and facts a correct rule core
works out: levels per calling, values, counts, what the character has and
has not, the character level of each step of a calling, picks per choice,
the limits of the knack choices, and the numbers on knack cards.
