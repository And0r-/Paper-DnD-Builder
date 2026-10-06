# HTTP API

JSON over HTTP. All routes live in
[`src/server/api/routes`](src/server/api/routes); the router works on
standard `Request`/`Response`, and Next.js hands it every `/api/*` request
([`app/api/[...path]/route.ts`](app/api/[...path]/route.ts)).

Every route, body, answer and error code is also described in
[`openapi.json`](openapi.json) (OpenAPI 3.1). A test
([`openapi.test.ts`](src/server/api/openapi.test.ts)) compares it with the
router and walks the whole API checking each request and answer against
it, so the file and the server cannot drift apart.

**Conventions**

- Bodies are `application/json` (anything else: `415`). Changes from other
  sites are refused (`403`, `Origin` / `Sec-Fetch-Site` check).
- Two ways to log in. The browser holds an httpOnly session cookie. A
  program (a script, later a language model) sends an
  [access key](#access-keys): `Authorization: Bearer cbk_...`. Routes
  marked 🔒 answer `401` without either: `notLoggedIn` with neither,
  `keyNotValid` for a key that is unknown, withdrawn or malformed.
- A request with an `Authorization` header is judged by the key alone,
  never by a cookie it also carries.
- Errors: `{ "error": { "code": "...", ...details } }`. Codes are stable and
  English; the screen words them in the player's language. All codes:
  [Error codes](#error-codes).
- Responses are never cached (`Cache-Control: no-store`).

## Login and account

| Method & path                    | Body                            | Result                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/password`        | `{ email, language? }`          | `202`. Makes a password and mails it: new account, or new password for an existing one (old one stops working). Same answer either way.                                                                                                                                                                                  |
| `POST /api/auth/login`           | `{ email, password }`           | `200 { account }` + session cookie. `401 wrongMailOrPassword`, `429 tooManyAttempts` (`Retry-After`).                                                                                                                                                                                                                    |
| `POST /api/auth/logout`          | —                               | `204`, cookie cleared.                                                                                                                                                                                                                                                                                                   |
| 🔒 `GET /api/account`            | —                               | `{ account: { email, language, units, print, createdAt } }`                                                                                                                                                                                                                                                              |
| 🔒 `PATCH /api/account/settings` | `{ language?, units?, print? }` | `units` is `{ dimension: unit or null }`; null follows the language again. Units must exist in a loaded package (`422 unknownUnit`). `print` is `{ parts?, design?, state? }`, what the download dialog offers next time (see Print); left-out fields stay. `422 designNotAvailable` for a planned design not drawn yet. |
| 🔒 `POST /api/account/password`  | —                               | `202`. New password by mail; every other session ends.                                                                                                                                                                                                                                                                   |
| 🔒 `DELETE /api/account`         | `{ confirm: true }`             | `204`. Deletes account, sessions, access keys, every draft, the campaigns it leads (players keep their characters) and its places in other campaigns.                                                                                                                                                                    |

## Access keys

A person makes a key on the settings screen and gives it to a program they
trust. The key can do everything the screens can, in this account only.

| Method & path                     | Body | Result                                                                                                                   |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| 🔒 `GET /api/account/keys`        | —    | `{ keys: [{ id, hint, createdAt }] }`, oldest first. `hint` is the first 10 characters of the key.                       |
| 🔒 `POST /api/account/keys`       | `{}` | `201 { key: { id, hint, createdAt, secret } }`. `secret` is the key, in this answer only. `422 tooManyKeys` (`max`, 20). |
| 🔒 `DELETE /api/account/keys/:id` | —    | `204`. Withdrawn at once: the next request with the key gets `401 keyNotValid`. `404 keyNotFound`.                       |

- A key is `cbk_` and 43 random characters (256 bits). The server stores
  only its SHA-256, the hint and the date; nothing about when or what for
  it is used. A leaked database holds no usable key.
- **Making a key needs the browser session.** A request with a key gets
  `403 keyCannotMakeKeys`, so a leaked key cannot make itself a successor
  that outlives withdrawing it. Listing and withdrawing work with a key.
- Deleting the account deletes its keys.
- Same-origin and CSRF rules are unchanged: a program is not a browser and
  sends no `Origin` header; a page on another site cannot set
  `Authorization` without a CORS preflight, which the builder does not
  answer.

## Packages

| Method & path                          | Result                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/packages?lang=de`            | Loaded packages with name and description in one language. Public.                       |
| 🔒 `GET /api/packages/:id`             | Structure without texts: manifest, units, values, things, flow, sheet, glossary.         |
| 🔒 `GET /api/packages/:id/texts/:lang` | All texts of one language. Missing texts are `null`, never filled from another language. |

## Drafts

A draft is one document on the server: `{ level, answers }`. Everything
else is derived by the rule core and returned with every response:

```json
{
  "draft": { "id", "packageId", "version", "status": "draft|finished", "level", "levelBefore", "answers", "owner": { "email" }, "access": "owner|gameMaster", ... },
  "packageAvailable": true,
  "evaluation": { "level", "steps", "choices", "things", "values", "inputs", "raises", "open", "complete", "inactiveAnswers" },
  "summary": { "name", "level", "complete", "line" },
  "levelUp": null
}
```

Every change sends the `version` it was made on. If the draft has moved on,
the answer is `409 versionConflict` with the current state in
`error.current` (optimistic locking).

| Method & path                            | Body                    | Result                                                                                                      |
| ---------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts`                     | —                       | The account's own drafts with summaries (a game master finds the players' in the campaign).                 |
| 🔒 `POST /api/drafts`                    | `{ packageId, level? }` | `201`, new draft at version 1.                                                                              |
| 🔒 `GET /api/drafts/:id`                 | —                       | The draft.                                                                                                  |
| 🔒 `PATCH /api/drafts/:id`               | `{ version, level }`    | Changes the level.                                                                                          |
| 🔒 `PUT /api/drafts/:id/pools/:step`     | `{ version, picks }`    | All picks of a step with a shared list (`steps[].pool`); the core spreads them over the step's choices.     |
| 🔒 `PUT /api/drafts/:id/answers/:choice` | `{ version, answer }`   | Answers one choice; `answer: null` removes it. `422 changeRejected` with the reason if it does not fit now. |
| 🔒 `POST /api/drafts/:id/level-up`       | `{ version, level }`    | Raises a finished character; see [Raising a character](#raising-a-character).                               |
| 🔒 `POST /api/drafts/:id/finish`         | `{ version }`           | Marks the character finished; `422 incomplete` with the open choices.                                       |
| 🔒 `DELETE /api/drafts/:id`              | —                       | `204`.                                                                                                      |

Answer shapes by choice kind: `pickOne` `{ "pick": "thing.key" }`,
`pickMany` `{ "picks": [...] }`, `distribute`
`{ "method": 0, "assign": { "value": 8 } }` (index into `methods`),
`number` `{ "value": 20 }`, `text` `{ "text": "..." }`. `info` choices take
no answer. A partial `pickMany` answer is allowed; the choice stays open.

**Raising values** (format 0.9, a `distribute` choice whose method is
`raise`): the same shape, `{ "method": 0, "assign": { "heart": 2 } }` or
`{ "method": 0, "assign": { "wit": 1, "heart": 1 } }`. `assign` names only
the values that get points; the points are added on top of the value as it
is before this choice, at the choice's level (they do not set its base; from
format 0.10, bonuses of higher levels do not count against the cap). Refused with
`answerDoesNotFit` and `badAssignment` (not a target, or below 0),
`outOfRange` (more than the value may take here) or `overBudget` (more
points than there are). Fewer points than `points` leave the choice open
(`incomplete`, `remaining`), unless no value can take another one.

**Picks among what the character has** (format 0.10, `options.owned`):
answered like any pick choice; `options` lists only things the character
already has. The pick is listed in `marks` and gives nothing.

**Copies of a choice** (format 0.9, things with `repeatable`): a choice
granted by a repeatable thing is asked once per pick of that thing, under
the id `<choice>@<where the thing was picked>`, for example
`boon-raise@boon-8`. It is answered like any choice
(`PUT /api/drafts/:id/answers/boon-raise%40boon-8`); its rules and texts are
those of the declared choice (`copyOf` in the evaluation). Copies of a choice
with `options.owned` (format 0.14) do not offer what another copy marked,
and the repeatable thing is not offered again once nothing is left to mark.

### Fields of `evaluation` for levels (format 0.9)

| Where                              | Field         | Meaning                                                                                                                                                                                            |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps[]`, `choices.*`, `things[]` | `atLevel`     | Character level from which the step, choice or thing is there: `flow.level.min` for flow steps, else the level at which its grant applies. Raising from level n adds the steps with `atLevel > n`. |
| `choices.*` (raise)                | `raise`       | `{ points, before: { value: n }, most: { value: n } }`: points to give, each value before this choice, most points each value can take here (cap and the value's `max` included).                  |
| `choices.*` (raise)                | `recommended` | `{ method, assign }`, always a full answer: the package's assignment as far as it fits, the rest in order.                                                                                         |
| `choices.*` (copy)                 | `copyOf`      | The declared choice a copy uses for rules and texts.                                                                                                                                               |
| `raises`                           | —             | Per value, the points added by raise answers in step order: `{ "heart": [{ "amount": 2, "choice": "boon-raise@boon-4", "atLevel": 4 }] }`.                                                         |
| `marks`                            | —             | Format 0.10: things picked in choices with `options.owned` (they mark what the character has, they give nothing): `{ "knack.warm-glow": ["lantern-mastery"] }`.                                    |

A finished character stays finished while it is complete; a change that
leaves something open makes it a draft again.

### Raising a character

`POST /api/drafts/:id/level-up` with `{ "version": 7, "level": 5 }` raises a
finished character one or more levels. Every answer stays and is not asked
again; what the new levels add is asked on top. Every number that depends
on the level (tables by level, formulas with `level`, grants with
`atLevel`, text variants with `when`) is worked out again at the new level,
on the screen and in the PDF.

- **Something to answer:** the character is a draft again
  (`status: "draft"`, `finishedAt: null`), `draft.levelBefore` is the level
  it was finished at. `POST /finish` works once the open choices are
  answered and then clears `levelBefore`. The PDF is refused
  (`409 notFinished`) until then, as for any draft.
- **Nothing to answer:** the character is finished again at once, with a new
  `finishedAt`; `levelBefore` is `null`.
- **Raising again before finishing** is allowed and keeps the first
  `levelBefore`. Setting the level (`PATCH`) back to `levelBefore` or below
  ends the raise (`levelBefore: null`); the character stays a draft until
  it is finished.

The answer is the usual draft view. While a raise lasts (and in the answer
of the raise itself, also when it finished at once), `levelUp` says what it
brought; otherwise it is `null`:

```json
"levelUp": {
  "from": 1,
  "to": 2,
  "newSteps": [],
  "newChoices": ["extra-talent"],
  "openSteps": ["talents", "knacks"]
}
```

| Field        | Meaning                                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `newSteps`   | Steps with `atLevel > from`, in step order.                                                                                                                                                          |
| `newChoices` | Choices with `atLevel > from`, in step order. A step that was there before can get a new choice (a gather step), so this can name a choice whose step is not in `newSteps`.                          |
| `openSteps`  | Every step not `done`, in step order: the steps with new choices, and older steps that ask for more at the new level (a pick count from a table by level keeps the old picks and asks for the rest). |

The open choices themselves are `evaluation.open`, as always. A copy of a
choice (`<choice>@<step>`) that a new pick brings appears once that pick is
answered.

Errors:

| Status | Code                                                              | When                                                                                                 |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `409`  | `notFinished` (with `open`)                                       | The character is a draft and not in a raise. Build it first, or change its level with `PATCH`.       |
| `422`  | `changeRejected`, `reason: { code: "levelNotHigher", level }`     | The level is not above the current one (`level` is the current one). A raise never lowers the level. |
| `422`  | `changeRejected`, `reason: { code: "levelOutOfRange", min, max }` | Above the package's `flow.level.max` (or not a level at all).                                        |
| `409`  | `versionConflict`                                                 | The draft moved on (see above).                                                                      |
| `400`  | `badRequest`                                                      | `level` is not a whole number.                                                                       |

### Reading `evaluation`: what to answer next

This is how a program (and the screen) goes through a character. Every
draft answer has the full `evaluation`; nothing needs to be worked out on
the client.

1. **`evaluation.open`** lists the choice ids that still need an answer, in
   step order: not answered, not complete, or answered with something that
   no longer fits. Optional choices are never in it. Empty means
   `evaluation.complete` is `true` and `POST /finish` works.
2. **`evaluation.choices[id]`** says how to answer one choice:

   ```json
   {
     "id": "folk",
     "kind": "pickOne",
     "step": "folk",
     "optional": false,
     "status": "missing",
     "atLevel": 1,
     "options": ["folk.moorfolk", "folk.hillfolk", "folk.coastfolk"],
     "recommended": ["folk.moorfolk"]
   }
   ```

   | Field                   | Meaning                                                                                                                                                                                                                                                     |
   | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `kind`                  | The answer shape (see above): `pickOne`, `pickMany`, `distribute`, `number`, `text`; `info` takes no answer.                                                                                                                                                |
   | `status`                | `missing`, `incomplete` (fits, more needed; `remaining`), `invalid` (`problem` says why), `answered`, `info`.                                                                                                                                               |
   | `options`               | Pick choices: the thing keys that may be picked now. Anything else is refused (`notOffered`). On a step with a `pool` a thing counts for one choice: `options` and `recommended` leave out what another choice of that step holds, also one asked after it. |
   | `count`, `upTo`         | `pickMany`: how many to pick; with `upTo`, fewer is complete too.                                                                                                                                                                                           |
   | `recommended`           | Pick choices: good picks, best first. `distribute`: a full answer `{ method, assign }` that can be sent as it is.                                                                                                                                           |
   | `min`, `max`            | `number`: the allowed range.                                                                                                                                                                                                                                |
   | `raise`                 | `distribute` with `raise`: points to give and the most each value can take (see above).                                                                                                                                                                     |
   | `badges`                | Pick choices: a text key per option, a short label such as "gentle start".                                                                                                                                                                                  |
   | `held`                  | Things the character already has that an option is about.                                                                                                                                                                                                   |
   | `copyOf`, `textVariant` | Which texts to use (below).                                                                                                                                                                                                                                 |
   | `step`                  | The step the choice is on. If that step has a `pool` in `evaluation.steps`, its choices can also be answered together.                                                                                                                                      |

3. **Words and explanations** come from the package texts in one language,
   `GET /api/packages/:id/texts/:lang` (key list: package format SPEC,
   section 10.2):

   | For             | Keys                                                                                                                              |
   | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | the question    | `choice.<id>.title`, `.question`, `.intro`; for a copy the `copyOf` id; with `textVariant` v, `choice.<id>.variant.<v>.*` first.  |
   | each option `o` | `<o>.name`, `<o>.short`, `<o>.explain.what` (what it is), `<o>.explain.table` (what you do with it), `<o>.goodIf` (who it suits). |
   | a badge         | the key in `badges[o]`.                                                                                                           |
   | a value         | `value.<id>.name`, `value.<id>.explain`.                                                                                          |

   A missing text is `null`; it is never filled from another language.

4. **Answer** with `PUT /api/drafts/:id/answers/:choice` and the draft's
   current `version`. The answer is the new state: read `open` again.
   Answering a choice can change what comes after it (new steps, other
   options), never what comes before.

### Example: from nothing to the PDF with a key

Everything below needs only the key (made under Settings → Access keys).
The commands use `curl` and `jq`; any HTTP client works.

```sh
BASE=https://builder.example.org
KEY=cbk_...                       # from the settings screen
H=(-H "Authorization: Bearer $KEY" -H "Content-Type: application/json")

# 1. What can be built?
curl -s "${H[@]}" "$BASE/api/packages?lang=en" | jq '.packages[] | {id, name}'

# 2. Start a level-3 character.
VIEW=$(curl -s "${H[@]}" -X POST "$BASE/api/drafts" -d '{"packageId":"demo","level":3}')
ID=$(jq -r .draft.id <<<"$VIEW")

# 3. Answer the first open choice until nothing is open.
while [ "$(jq '.evaluation.open | length' <<<"$VIEW")" -gt 0 ]; do
  CHOICE=$(jq -r '.evaluation.open[0]' <<<"$VIEW")
  ANSWER=$(jq --arg c "$CHOICE" '.evaluation.choices[$c] as $s |
    if   $s.kind == "pickOne"    then {pick: ($s.recommended[0] // $s.options[0])}
    elif $s.kind == "pickMany"   then {picks: (if ($s.recommended | length) == $s.count
                                               then $s.recommended else $s.options[:$s.count] end)}
    elif $s.kind == "distribute" then $s.recommended
    elif $s.kind == "number"     then {value: $s.min}
    else {text: "Mira Fennwick"} end' <<<"$VIEW")
  VERSION=$(jq .draft.version <<<"$VIEW")
  VIEW=$(curl -s "${H[@]}" -X PUT "$BASE/api/drafts/$ID/answers/$(jq -rn --arg c "$CHOICE" '$c|@uri')" \
    -d "{\"version\":$VERSION,\"answer\":$ANSWER}")
done

# 4. Finish and print.
curl -s "${H[@]}" -X POST "$BASE/api/drafts/$ID/finish" -d "{\"version\":$(jq .draft.version <<<"$VIEW")}" >/dev/null
curl -s -H "Authorization: Bearer $KEY" "$BASE/api/drafts/$ID/pdf" -o character.pdf
# Or each part as its own file: the sheet alone, the cards, the rules texts.
curl -s -H "Authorization: Bearer $KEY" "$BASE/api/drafts/$ID/pdf?parts=sheet" -o sheet.pdf
```

A real helper would ask the player instead of taking the recommendation,
using the texts from step 3 above. The same walk is a test:
[`access-keys.test.ts`](src/server/api/access-keys.test.ts) builds a
level-3 character of the demo package this way, from empty to the PDF.

## Campaigns

Whoever makes a campaign leads it (the game master); there is no role on
the account. The game master adds players by mail address and then reaches
**every character of those players**: open, change, raise, print, and make
a new one for a player. The characters stay the players' (`draft.owner`);
only the owner deletes one. A player sees their own characters and the
campaigns they are in, not the other players. Anyone else gets `404`, as
for something that does not exist. Every route checks this on the server;
access keys have the same rights as the screens.

| Method & path                                         | Body                    | Who                       | Result                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/campaigns`                               | —                       | everyone                  | `{ campaigns: [Campaign] }`: the ones you lead or play in, oldest first.                                                                                                                                                                                    |
| 🔒 `POST /api/campaigns`                              | `{ name }`              | everyone                  | `201 { campaign, players: [] }`. You lead it. `422 tooManyCampaigns` (`max`, 50).                                                                                                                                                                           |
| 🔒 `GET /api/campaigns/:id`                           | —                       | game master, player       | `{ campaign, players }`. Game master: `players: [{ id, email, addedAt, characters: [draft list entries] }]`. Player: `players: null`.                                                                                                                       |
| 🔒 `PATCH /api/campaigns/:id`                         | `{ name }`              | game master               | `{ campaign }`.                                                                                                                                                                                                                                             |
| 🔒 `DELETE /api/campaigns/:id`                        | —                       | game master               | `204`. Campaign and player list go; the characters stay with the players.                                                                                                                                                                                   |
| 🔒 `POST /api/campaigns/:id/players`                  | `{ email, language? }`  | game master               | `201 { player: { id, email, addedAt } }`. New address: account made, password mail. Existing account: short mail, password unchanged. Same answer either way. `409 alreadyPlayer`, `422 cannotAddYourself`, `422 tooManyPlayers` (50), `429`, `502`, `503`. |
| 🔒 `DELETE /api/campaigns/:id/players/:playerId`      | —                       | game master; player: `me` | `204`. The game master removes a player; a player leaves with `me`. The characters stay; the game master's reach ends at once. `404 playerNotFound`.                                                                                                        |
| 🔒 `POST /api/campaigns/:id/players/:playerId/drafts` | `{ packageId, level? }` | game master               | `201`, a new draft that belongs to the player (`access: "gameMaster"`). Then build it with the draft routes.                                                                                                                                                |

`Campaign` is `{ id, name, role: "gameMaster|player", gameMaster: { email }, playerCount, createdAt }`.
A player of the campaign gets `403 gameMasterOnly` on the game master's
routes (they know the campaign exists); anyone else `404 campaignNotFound`.

**Who may do what**

| Call                                                                                                 | Game master            | Player                 | Anyone else     |
| ---------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------- | --------------- |
| `GET /api/campaigns`                                                                                 | sees it (`gameMaster`) | sees it (`player`)     | does not see it |
| `GET /api/campaigns/:id`                                                                             | `200`, with players    | `200`, `players: null` | `404`           |
| `PATCH`, `DELETE /api/campaigns/:id`                                                                 | `200` / `204`          | `403`                  | `404`           |
| `POST /api/campaigns/:id/players`                                                                    | `201`                  | `403`                  | `404`           |
| `DELETE /api/campaigns/:id/players/:playerId`                                                        | `204` (any player)     | `204` (`me` only)      | `404`           |
| `POST /api/campaigns/:id/players/:playerId/drafts`                                                   | `201`                  | `403`                  | `404`           |
| `GET /api/drafts`                                                                                    | own only               | own only               | own only        |
| `GET`, `PATCH /api/drafts/:id`, answers, pools, finish, level-up, sheet, pdf of a player's character | `200`                  | `200` (owner)          | `404`           |
| sheet copies (all four) and play state of a player's character                                       | `200` / `201` / `204`  | the same (owner)       | `404`           |
| `DELETE /api/drafts/:id` of a player's character                                                     | `403 ownerOnly`        | `204` (owner)          | `404`           |
| any draft route on the game master's own character                                                   | `200` (owner)          | `404`                  | `404`           |

A game master prints a player's character in the game master's own
language and units. Deleting a player's account removes their characters
and places; the campaign stays. Deleting the game master's account removes
their campaigns and player lists; the players keep their characters.
Tests: [`campaigns.test.ts`](src/server/api/campaigns.test.ts).

## Print

| Method & path                  | Result                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts/:id/sheet` | The finished character's sheet as data (see below). Language and units from the settings of whoever asks, like the PDF. `409 notFinished` (with `open`), `422 languageNotSupported` (with the package's printable `languages`).                                                                                                                             |
| 🔒 `GET /api/drafts/:id/pdf`   | The finished character as one A4 PDF with the parts asked for (below); without `parts`, the sheet and then the cards. Language and units from the settings of whoever asks (a game master prints in theirs). `409 notFinished` (with `open`), `422 languageNotSupported` (with the package's printable `languages`), `429 tooManyRequests` (`Retry-After`). |
| `GET /api/sheet-designs`       | `{ designs: [{ id, name, description }], default }`: the designs the server draws, `name` and `description` per screen language (`{ de, en }`). Public. For now only `verbose` ("Detailed").                                                                                                                                                                |

It is a plain `GET` so the screen can offer it as an ordinary download
link. The PDF is made on every request and never stored.

Query parameters of the PDF, all optional:

- `parts`: comma-separated, one or more of `sheet` (the character sheet),
  `cards` (one card per thing the package marks as a card, nine to a
  page, with cut lines) and `texts` (rules texts to read up on: the full
  texts of every feature and card in two columns, under the name of what
  brought them, no cut lines). In the file they always come in that order,
  with one page count through all of them; the file name names them
  ("Mira - Sheet, Cards.pdf"). **Without `parts` the PDF is exactly what it
  was before parts existed: the sheet, then the cards.** The download
  dialog asks for the sheet alone unless the player picks more.
- `design`: an id from `GET /api/sheet-designs`; default the first one
  (`verbose`). `classic` is planned and answers `400 designNotAvailable`
  until it is drawn. Cards and rules texts look the same in every design.
- `version`: `original` (default), the sheet as the builder makes it now,
  in the account's language and units; or the id of a kept copy
  (`GET /api/drafts/:id/sheet-copies`), printed as kept, in the copy's
  language and units, with its name and the level of the original it was
  made from in the footer ("as of level 4"). A copy's cards and rules
  texts are the original's (in the copy's language and units); a row the
  player wrote into the copy has neither. A copy's sheet alone prints
  even when the character is no longer finished; with cards or rules
  texts it needs the finished original (`409 notFinished`). An id that is
  not a copy of this character answers `404 versionNotFound`.
- `state`: `empty` (default), a sheet to write on, or `filled`: the play
  state (`GET /api/drafts/:id/state`) written into the fields of the sheet
  and the cards. Ticks beyond what a field holds are cut; a field the
  sheet does not have is skipped.
- Any other value answers `400 badQuery` with `parameter` and `value`.

The screen keeps the player's choice of parts and design on the account
(`print` in `GET /api/account`, changed with `PATCH /api/account/settings`);
until one is made it is `{ parts: ["sheet"], design: "verbose", state: "empty" }`.

The sheet model (`components/schemas/SheetModel` in
[`openapi.json`](openapi.json), the Zod schema `sheetModelSchema` in
[`packages/sheet`](../../packages/sheet)) is what the PDF is drawn from,
and what the screen and stored copies show. It is fully resolved: every
text in one language, every quantity in the account's units, sections in
the package's order with their conditions decided. It says nothing about
rules, only sections, words and numbers:

- `origin`: `{ kind: "original", level, builtAt, packageVersion,
changedAt }` for a sheet made now (`changedAt`: when the character last
  changed in the builder); `{ kind: "copy", name, createdAt, fromLevel,
fromPackageVersion, fromChangedAt }` for a copy a player keeps (below).
  If a copy's `from…` differ from the original's, the original changed
  since the copy was made; no models need comparing.
- `field`, `usesField`, `playedByField`: an id for every place a player
  writes or ticks on paper (pencil boxes, squares, circles, use boxes,
  notes, blank lines, the player's name), such as `sheet/primary/stamina`
  or `cards/<thing>/uses`. Made of package keys only, so a place keeps its
  id when the character goes up a level.
- `values`: for each value with a name on the sheet, its text and the
  values that change with it (`dependents`), from the package's formulas.
- `rulesTexts`: the full texts (`rules`, `explain`) of every row and card,
  grouped by the thing that brought them.

It is made on every request and never stored, like the PDF; it has no
rate limit, it costs about as much as `GET /api/drafts/:id`.

## Sheet copies and play state

A **copy** is a sheet model a player keeps and changes freely, like a
printed page: any number, text or row, checked for shape only, never for
rules. It is made from the original as it is now and never follows it
again: a level, other answers, a package update or another account
language leave it exactly as it was. It stays in the language and units it
was made in. The **play state** is what is written and rubbed out at the
table (field id to a number, a text or `{ checks: n }`); one per character,
the same for the original and every copy, so a level or a new copy keeps
it. Both are kept apart from the draft; the builder never reads them.

| Method & path                                    | Body                                                     | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts/:id/sheet-copies`            | —                                                        | `200 { copies: [SheetCopy], original: { level, changedAt, packageVersion, finished }, opened, max }`, oldest first, without models; `opened` is the copy this account opened last (null: the original), `max` the limit. Also while the character is not finished.                                                                                                                                                                                                                                                                |
| 🔒 `POST /api/drafts/:id/sheet-copies`           | `{ name?, model? }`                                      | `201 { copy, model }`: the original now, in the asker's language and units, named "Meine Fassung vom 4. Oktober 2026" (in the account's language) unless `name` is given. With `model`: the original as loaded with the first change in, so the first change makes a copy in one request; its `origin` must be the original now, else `409 originalChanged` (with `original`). `409 notFinished`, `409 tooManyCopies` (50). The new copy becomes the asker's `opened`., `413 copyTooLarge` (512 KiB), `422 languageNotSupported`. |
| 🔒 `GET /api/drafts/:id/sheet-copies/:copyId`    | —                                                        | `200 { copy, model }`; `model.origin` is `{ kind: "copy", … }`. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🔒 `PUT /api/drafts/:id/sheet-copies/:copyId`    | `{ version, name?, model? }`                             | `200 { copy, model }`. A model that is not a `SheetModel` is `400 badRequest`; its `origin` is ignored. `409 versionConflict` (with `current`), `413 copyTooLarge`.                                                                                                                                                                                                                                                                                                                                                               |
| 🔒 `DELETE /api/drafts/:id/sheet-copies/:copyId` | —                                                        | `204`. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🔒 `PUT /api/drafts/:id/sheet-view`              | `{ copyId }`                                             | `200 { opened }`: the version this account opens next time, a copy of this character or `null` for the original. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔒 `GET /api/drafts/:id/state`                   | —                                                        | `200 { state, version, updatedAt }`; `{}` at version `0` while nothing is stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🔒 `PUT /api/drafts/:id/state`                   | `{ version, state }` or `{ version, clearChecks: true }` | `200` as `GET`. `state` replaces the whole state (at most 1000 fields, texts up to 2000 characters); `clearChecks` removes every `{ checks }` and keeps the rest (a rest: the builder does not know what one is, it only rubs out ticks). The first write names version `0`. `409 versionConflict` (with `current`).                                                                                                                                                                                                              |

`SheetCopy` is `{ id, name, createdAt, updatedAt, fromLevel, fromChangedAt,
fromPackageVersion, language, units, version }`.

- **Access** is the character's: owner, game master of the owner's
  campaign (also deleting a copy) and access keys of either. Someone
  else's character is `404 draftNotFound`.
- **Versions** as for drafts: a write names the version it was read at;
  a stale one is `409 versionConflict` with the current state, and the
  screen loads again.
- **Limits**: 50 copies per character (the screen deletes none; at the
  limit it no longer changes the original), a model of at most 512 KiB
  (`JSON` bytes); a body sending a model may be up to 516 KiB, other
  bodies stay at 64 KiB.
- **What the screen does, not the server**: fields of the state the shown
  sheet does not have are skipped, ticks above what a field holds are cut.
  The stored state is never trimmed.
- An unfinished character keeps its copies and state, and they stay
  readable; only a new copy waits for the character to be finished.
  Deleting the character deletes both.

Tests: [`sheet-copies.test.ts`](src/server/api/sheet-copies.test.ts).

## Server

| Method & path     | Result                                                                                                                                                                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health` | `{ "status": "ok", "packages": [{ "id", "version", "formatVersion" }], "warnings": [] }` while the process serves requests, also without packages. `warnings` names rejected package folders, an empty package list or a failed start. Public; used by Docker. |

## Error codes

| Status | Code                   | When                                                                                               |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `400`  | `badJson`              | The body is not JSON.                                                                              |
| `400`  | `badRequest`           | The body has the wrong shape; `issues` lists `{ path, message }`.                                  |
| `400`  | `badQuery`             | A query parameter has a value the API does not know (`parameter`, `value`).                        |
| `400`  | `designNotAvailable`   | A planned sheet design not drawn yet (`designs` lists those that are); `422` in the settings.      |
| `401`  | `notLoggedIn`          | No session cookie and no `Authorization` header.                                                   |
| `401`  | `keyNotValid`          | The access key is unknown, withdrawn or not `Bearer cbk_...`.                                      |
| `401`  | `wrongMailOrPassword`  | Login failed.                                                                                      |
| `403`  | `crossSite`            | A change sent from another site.                                                                   |
| `403`  | `keyCannotMakeKeys`    | Making an access key with an access key.                                                           |
| `403`  | `gameMasterOnly`       | A player of the campaign calls a game master's route.                                              |
| `403`  | `ownerOnly`            | A game master deletes a player's character; only the owner does.                                   |
| `404`  | `notFound`             | No such API path.                                                                                  |
| `404`  | `draftNotFound`        | No draft with this id that you may reach (someone else's looks the same).                          |
| `404`  | `campaignNotFound`     | No campaign with this id that you lead or play in.                                                 |
| `404`  | `playerNotFound`       | No such player in this campaign.                                                                   |
| `404`  | `copyNotFound`         | No kept copy with this id on this character.                                                       |
| `404`  | `keyNotFound`          | No access key with this id in this account.                                                        |
| `404`  | `packageNotFound`      | No loaded package with this id.                                                                    |
| `404`  | `languageNotFound`     | The package has no texts in this language.                                                         |
| `404`  | `versionNotFound`      | No such copy of the sheet: not `original` and not a kept copy of this character.                   |
| `405`  | `methodNotAllowed`     | The path exists, the method does not.                                                              |
| `409`  | `versionConflict`      | The draft, copy or play state moved on; `current` holds it now.                                    |
| `409`  | `notFinished`          | PDF or sheet of a draft, or raising a draft that is not in a raise; `open` lists the open choices. |
| `409`  | `tooManyCopies`        | The character has 10 kept copies (`max`); delete one first.                                        |
| `409`  | `originalChanged`      | A copy made with `model` from an original that changed since; `original` says how it is now.       |
| `409`  | `copyUnreadable`       | A kept copy stored in a shape this server no longer prints; `version` names it.                    |
| `409`  | `alreadyPlayer`        | The address is already a player of this campaign.                                                  |
| `409`  | `packageUnavailable`   | The draft's package is not loaded right now; `packageId` names it.                                 |
| `413`  | `bodyTooLarge`         | Body over 64 KiB (516 KiB for a body with a sheet copy; `max`).                                    |
| `413`  | `copyTooLarge`         | A sheet copy's model over 512 KiB (`max`).                                                         |
| `415`  | `jsonRequired`         | Body not `application/json`.                                                                       |
| `422`  | `changeRejected`       | The rule core refused the change; `reason` is a `ChangeError` (below).                             |
| `422`  | `incomplete`           | Finishing with open choices; `open` lists them.                                                    |
| `422`  | `languageNotSupported` | The account's language cannot be printed with this package; `languages` lists those that can.      |
| `422`  | `cannotAddYourself`    | A game master adds their own address as a player.                                                  |
| `422`  | `tooManyCampaigns`     | The account leads 50 campaigns (`max`).                                                            |
| `422`  | `tooManyPlayers`       | The campaign has 50 players (`max`).                                                               |
| `422`  | `tooManyKeys`          | The account has 20 access keys (`max`).                                                            |
| `422`  | `unknownUnit`          | No loaded package offers this unit (`dimension`, `unit`).                                          |
| `429`  | `tooManyAttempts`      | Too many logins, password mails or invitations; `retryAfter`, also `Retry-After`.                  |
| `429`  | `tooManyRequests`      | Too many PDFs; `Retry-After`.                                                                      |
| `500`  | `internal`             | A bug in the builder.                                                                              |
| `500`  | `packageRuleError`     | The package's rules could not be worked out (a bug in the package); `message`.                     |
| `502`  | `mailFailed`           | The mail server refused the mail (password or invitation); nothing changed.                        |
| `503`  | `mailNotConfigured`    | The server has no mail set up.                                                                     |

`changeRejected` reasons (`error.reason.code`): `levelOutOfRange` (`min`,
`max`), `levelNotHigher` (`level`), `unknownChoice`, `notAsked` (the choice
is not asked now), `unknownStep` (pools: no shared list on that step),
`noAnswerNeeded` (an `info` choice), `answerDoesNotFit` with `problem`:
`badShape`, `duplicate`, `notOffered`, `tooMany`, `badMethod`,
`badAssignment`, `overBudget`, `outOfRange`, `empty`, `tooLong`,
`badCharacters`.

## Screens and browser tests

The screens live in [`app`](app) (routes) and [`src/ui`](src/ui)
(components, design tokens in `src/ui/styles/tokens.css`). Screen texts
are ours, one file per language in [`src/i18n/messages`](src/i18n/messages);
package texts come from the package in the same language.

```sh
pnpm --filter @builder/web test:e2e   # builds, then runs Playwright
```

The browser tests start the server with `DATABASE_URL=pglite:memory`,
the demo package and `MAIL_OUTBOX_DIR=e2e/.outbox`, log in through the real
screens, and fail on any request to another origin. Screenshots land in
`e2e/screenshots` (not committed).
