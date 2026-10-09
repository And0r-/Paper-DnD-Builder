# HTTP API

JSON over HTTP. All routes live in
[`src/server/api/routes`](src/server/api/routes); the router works on
standard `Request`/`Response`, and Next.js hands it every `/api/*` request
([`app/api/[...path]/route.ts`](app/api/[...path]/route.ts)). The one
WebSocket, the [live help](#live-help), lives in
[`src/server/live`](src/server/live).

Every route, body, answer and error code is also described in
[`openapi.json`](openapi.json) (OpenAPI 3.1). A test
([`openapi.test.ts`](src/server/api/openapi.test.ts)) compares it with the
router and walks the whole API checking each request and answer against
it, so the file and the server cannot drift apart.

The running server shows it as a page at `/api/docs` (Scalar, every route
to read and to try with an access key; the bundle, fonts and requests all
stay on this server) and serves the file itself at `/api/openapi.json`.
Both need no login.

**Conventions**

- Bodies are `application/json` (anything else: `415`). Changes from other
  sites are refused (`403`, `Origin` / `Sec-Fetch-Site` check).
- Two ways to log in. The browser holds an httpOnly session cookie. A
  program (a script, later a language model) sends an
  [access key](#access-keys): `Authorization: Bearer cbk_...`. Routes
  marked 🔒 answer `401` without either: `notLoggedIn` with neither,
  `keyNotValid` for a key that is unknown, withdrawn, past its end or
  malformed.
- A request with an `Authorization` header is judged by the key alone,
  never by a cookie it also carries.
- Errors: `{ "error": { "code": "...", ...details } }`. Codes are stable and
  English; the screen words them in the player's language. All codes:
  [Error codes](#error-codes).
- Responses are never cached (`Cache-Control: no-store`).

## Login and account

| Method & path                          | Body                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup`                | `{ name, email?, language? }`                                 | `201 { account, password: { id, name, origin, createdAt, secret } }` + session cookie. A new account, logged in at once. `secret` is the password (five words and a number), in this answer only. `email` is optional, only a way back in. `429 tooManyAttempts` (10 per hour per IP).                                                                                                                                                                                                                                                                                           |
| `POST /api/auth/login`                 | `{ login, password }`                                         | `200 { account }` + session cookie, for every account. `login` is the account's name or its address, `password` one of its passwords; case and outer spaces do not matter, nor spaces instead of dashes in the password. An account from before (its password was mailed) logs in once with its address and that password: `200 { account, password }` like sign-up, the old password swapped for the new one. One answer for every failure: `401 wrongLogin`. `429 tooManyAttempts` (30 failures in 15 minutes per IP, 10 per address for accounts from before; `Retry-After`). |
| `POST /api/auth/reset`                 | `{ email, language? }`                                        | `202 { status: "sent" }`, the same whether the address has an account or not. Mails one link per account with this address, in one mail, named with each account's name; a link works once, for 30 minutes. The mail holds no password. Needs SMTP and `BASE_URL`: `503 mailNotConfigured`, `502 mailFailed`. `429 tooManyAttempts` (3 per hour per address, 10 per IP).                                                                                                                                                                                                         |
| `POST /api/auth/reset/use`             | `{ token }`                                                   | The token from the link `/login/reset/<token>`: `200 { account, password }` + session cookie, like sign-up. A new password with `origin: "reset"` and no name; every other password of the account ends, logged-in devices stay. `404 resetLinkInvalid` if unknown, used or expired. `429 tooManyAttempts` (20 per 15 minutes per IP).                                                                                                                                                                                                                                           |
| `POST /api/auth/logout`                | —                                                             | `204`, cookie cleared.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 🔒 `GET /api/account`                  | —                                                             | `{ account: { name, email, language, units, print, mailReminder, createdAt } }`; `email` is null when none was given; `mailReminder` whether to remind to add one                                                                                                                                                                                                                                                                                                                                                                                                                |
| 🔒 `PATCH /api/account/settings`       | `{ name?, email?, language?, units?, print?, mailReminder? }` | `name` is what the player is called (game masters see it); `email` the way back in, `null` removes it. `units` is `{ dimension: unit or null }`; null follows the language again. Units must exist in a loaded package (`422 unknownUnit`). `print` is `{ parts?, design?, state? }`, what the download dialog offers next time (see Print); left-out fields stay. `422 designNotAvailable` for a planned design not drawn yet (none at the moment). `mailReminder: false` ("Later") ends the reminder to add an address, for good.                                              |
| 🔒 `GET /api/account/passwords`        | —                                                             | `{ passwords: [{ id, name, origin, createdAt }] }`, oldest first. Each one logs in. `name` is null when the server made it (`origin` `first` or `reset`) or the owner gave none.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🔒 `POST /api/account/passwords`       | `{ name? }`                                                   | `201 { password: { id, name, origin, createdAt, secret } }`, `secret` in this answer only. Without a name, `name` is null. Session cookie only: `403 keyCannotMakePasswords` with a key. `422 tooManyPasswords` (10).                                                                                                                                                                                                                                                                                                                                                            |
| 🔒 `DELETE /api/account/passwords/:id` | —                                                             | `204`; it stops working at once. `422 lastPassword` for the last one, `404 passwordNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 🔒 `DELETE /api/account`               | `{ confirm: true }`                                           | `204`. Deletes account, sessions, passwords, access keys, every draft, the campaigns it leads (players keep their characters) and its places in other campaigns.                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Access keys

A person makes a key on the settings screen and gives it to a program they
trust. The key can do everything the screens can, in this account only.

| Method & path                     | Body       | Result                                                                                                                                                                                     |
| --------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔒 `GET /api/account/keys`        | —          | `{ keys: [{ id, name, hint, createdAt }] }`, oldest first. `hint` is the first 10 characters of the key.                                                                                   |
| 🔒 `POST /api/account/keys`       | `{ name }` | `201 { key: { id, name, hint, createdAt, secret } }`. `secret` is the key, in this answer only. `400 badRequest` for a name that is not 1 to 80 characters. `422 tooManyKeys` (`max`, 20). |
| 🔒 `DELETE /api/account/keys/:id` | —          | `204`. Withdrawn at once: the next request with the key gets `401 keyNotValid`. `404 keyNotFound`.                                                                                         |

- A key is `cbk_` and 43 random characters (256 bits). The server stores
  only its SHA-256, the hint, the name and the date; nothing about when it
  is used. A leaked database holds no usable key.
- `name` says what the key is for, in the owner's words ("the laptop at
  home"): trimmed, 1 to 80 characters, one line. Display only. Keys made
  before names existed are named by the day they were made (`2026-10-04`).
- A key can carry an end; past it, the key gets `401 keyNotValid` like a
  withdrawn one. Nothing sets an end yet: keys made on the settings screen
  last until withdrawn.
- **Making a key needs the browser session.** A request with a key gets
  `403 keyCannotMakeKeys`, so a leaked key cannot make itself a successor
  that outlives withdrawing it. Listing and withdrawing work with a key.
- Deleting the account deletes its keys.
- Same-origin and CSRF rules are unchanged: a program is not a browser and
  sends no `Origin` header; a page on another site cannot set
  `Authorization` without a CORS preflight, which the builder does not
  answer.

## MCP

Two ways for a language model to use this builder, both through the API
with an access key and nothing else. The server never calls out and has no
language model in it; the person chooses the model in their own program.

### The public MCP server: `POST /mcp`

An MCP server inside the web app (Streamable HTTP without sessions), for
programs that speak MCP over HTTP with a header (Claude Code, Cursor, Open
WebUI, ...):

```sh
claude mcp add --transport http character-builder https://builder.example/mcp \
  --header "Authorization: Bearer cbk_..."
```

- **Only `Authorization: Bearer cbk_...`**, on every request. No session
  cookie, no key in the address. Without a valid key (none, unknown,
  withdrawn, past its end): `401` with `WWW-Authenticate: Bearer` and a
  message that says where to make a key. A withdrawn key is refused with
  the very next request.
- **Stateless:** no session id, every request is answered on its own as
  plain JSON (`enableJsonResponse`), never as an open event stream. Works
  behind any proxy. Only the package texts are kept between requests, once
  per package and language, shared by all keys.
- **The tools** are the ones of the zip ([`packages/mcp`](../../packages/mcp)).
  They reach the API **in process**: their requests go straight into the same
  API handler as `/api`, never through a socket, so nothing leaves the server.
  They can do exactly what the key can do over the API; they never touch the
  database.
- **Refusals**, in this order, as JSON-RPC errors without an id:
  `429` (more than 120 requests a minute from one address, with or without
  a key; `Retry-After`), `413` (body over 1 MB), `403` (an `Origin` other
  than `BASE_URL`; programs send none, a page on another site cannot reach
  in), `401`.
- **`GET /mcp`** from a browser (`Accept` with `text/html`) goes to the page
  `/mcp/setup` (`303`). Anything else gets `405`: POST only.
- Keys are never logged.

### The zip to run it yourself: `GET /downloads/builder-mcp.zip`

The same for everyone, **without a login**: `curl -O https://builder.example/downloads/builder-mcp.zip`
works on a server without a screen. No key, nothing personal in it.

| File in the zip              | What                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server.mjs`                 | The MCP server, one file, Node 20 or newer. With a key (in `config.json` or `BUILDER_KEY`): private, over stdio. Without one: public, over HTTP at `/mcp` (port `PORT`, 8787). |
| `config.json`                | `{ "baseUrl", "key": "" }`. `baseUrl` is the configured public address (`BASE_URL`), never the `Host` header.                                                                  |
| `claude_desktop_config.json` | A ready `mcpServers` entry with the placeholders `PATH` and `KEY` the guides say to replace.                                                                                   |
| `README.md`, `ANLEITUNG.md`  | The guide in English and in German, both always: the link knows nobody.                                                                                                        |

- Made **once when the server starts** (`instrumentation.ts`) and then only
  served. `ETag` and `Cache-Control: no-cache`: a cache asks again and gets
  `304` while the zip is the same.
- `503 baseUrlNotSet`: the server has no `BASE_URL`. `503 mcpPackageMissing`:
  the build has no `server.mjs`.
- The key goes in by hand, from the settings (`POST /api/account/keys`).
  Keys from zips of the earlier per-account download (named
  `MCP package, <date>`) keep working until withdrawn.

## Packages

| Method & path                          | Result                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/packages?lang=de`            | Loaded packages with name and description in one language (the one asked for if the package has it, else English, else its first; `language` says which), each with the `extensions` a character may switch on (`id`, `version`, `languages`, `dependsOn`, `publishable`, `name`, `short`). Public. |
| 🔒 `GET /api/packages/:id`             | Structure without texts: manifest, units, values, things, flow, sheet, glossary, `extensions`.                                                                                                                                                                                                      |
| 🔒 `GET /api/packages/:id/texts/:lang` | All texts of one language. Missing texts are `null`, never filled from another language, except an extension's (see below); `fallbacks` names those.                                                                                                                                                |

**Extensions** (package format SPEC 17). An extension adds to a package:
more options, things, choices. A character switches it on for itself
(`extensions` of the draft); a new character has none. `:id` may name a
package with extensions, `base+ext1+ext2` with the extensions sorted
(`demo+demo-tides`): that is the package a draft with those extensions is
evaluated with. An extension's text a language lacks comes from the
extension's first language; `fallbacks` maps such keys to that language,
so a screen can mark them ("only in English"). `publishable: false` means
content that may not be shared; the sheet of a character with such
content says so in its `attribution`.

## Drafts

A draft is one document on the server: `{ level, answers }`. Everything
else is derived by the rule core and returned with every response:

```json
{
  "draft": { "id", "packageId", "extensions", "version", "status": "draft|finished", "level", "levelBefore", "answers", "owner": { "name" }, "access": "owner|gameMaster|helper", ... },
  "packageAvailable": true,
  "evaluation": { "level", "steps", "choices", "things", "values", "inputs", "raises", "open", "complete", "inactiveAnswers" },
  "summary": { "name", "level", "complete", "line" },
  "levelUp": null
}
```

Every change sends the `version` it was made on. If the draft has moved on,
the answer is `409 versionConflict` with the current state in
`error.current` (optimistic locking). Opening and changing a draft also
works for a [helper](#live-help) with `?help=<token>` (`access: "helper"`).

#### Changes from several places

Several people, windows and programs may change one draft (live help).
The server never takes a change made on an old version, also not a list
step's picks (`pools`): an answer or a list always replaces the whole
answer, so a client that sent its old copy would undo what others did
meanwhile. A client that gets `409 versionConflict`, or a newer `state`
over the live channel while its own change is not saved yet (also after
it was offline), puts its change on top of the current state and sends it
again with the new version:

- What it changed is still as it was before in `current`: send it.
- Someone else changed the same answer (the same level, the tracks, a pick of
  the same list step) meanwhile: theirs counts; drop yours and say so.
- A `distribute` answer (numbers over several values, such as scores)
  counts value by value: take `current`'s `assign`, set only the values you
  changed, and send that. A value someone else changed meanwhile stays
  theirs; yours to other values are saved next to it. Same `method` only:
  another way of spreading counts as a new answer.

The browser does exactly this (`src/ui/flow/rebase.ts`) and says what
happened: "Changed elsewhere meanwhile: Scores (Might 9). Your choice is
saved too."

| Method & path                            | Body                                              | Result                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts`                     | —                                                 | The account's own drafts with summaries (a game master finds the players' in the campaign).                                                                                                               |
| 🔒 `POST /api/drafts`                    | `{ packageId, level?, extensions?, campaignId? }` | `201`, new draft at version 1. `campaignId`: a campaign you play in or lead; else `404 campaignNotFound`. `extensions`: ids from `GET /api/packages`; else `404 extensionNotFound`.                       |
| 🔒 `GET /api/drafts/:id`                 | —                                                 | The draft.                                                                                                                                                                                                |
| 🔒 `GET /api/drafts/:id/explain/:value`  | —                                                 | Where one number comes from: its parts and their sources; see [Explaining a value](#explaining-a-value). `404 valueNotFound`.                                                                             |
| 🔒 `PATCH /api/drafts/:id`               | `{ version, level?, extensions? }`                | Changes the level, or the extensions switched on (all of them, as a list). One goes off only while no answer comes from it: else `409 extensionInUse` with `extension` and the `choices` to change first. |
| 🔒 `PUT /api/drafts/:id/pools/:step`     | `{ version, picks }`                              | All picks of a step with a shared list (`steps[].pool`); the core spreads them over the step's choices.                                                                                                   |
| 🔒 `PUT /api/drafts/:id/answers/:choice` | `{ version, answer }`                             | Answers one choice; `answer: null` removes it. `422 changeRejected` with the reason if it does not fit now.                                                                                               |
| 🔒 `PUT /api/drafts/:id/tracks`          | `{ version, tracks }`                             | With tracks only: the track of each level from 2 on; see [Tracks](#tracks-levels-in-more-than-one-thing).                                                                                                 |
| 🔒 `POST /api/drafts/:id/level-up`       | `{ version, level, tracks? }`                     | Raises a finished character; see [Raising a character](#raising-a-character).                                                                                                                             |
| 🔒 `POST /api/drafts/:id/finish`         | `{ version }`                                     | Marks the character finished; `422 incomplete` with the open choices and the tracks that do not fit.                                                                                                      |
| 🔒 `PUT /api/drafts/:id/campaign`        | `{ campaignId }`                                  | Owner only. Puts the character into a campaign you play in or lead, or into none (`null`). The `version` stays.                                                                                           |
| 🔒 `DELETE /api/drafts/:id`              | —                                                 | `204`.                                                                                                                                                                                                    |

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

### Tracks: levels in more than one thing

Since format 0.21 a package may let a character split its levels between
several things of one choice (`flow.level.tracks`, package format SPEC
9.7), for example two callings. Without it nothing here applies. The draft
keeps `draft.tracks`: the track (a thing id) of each level from 2 on, in
level order; level 1 always goes to the answer of the tracks choice, and
a level left out goes there too. An empty list means one track, as before.

`evaluation.tracks` says how it stands:

```json
"tracks": {
  "choice": "calling",
  "first": "calling.lantern-bearer",
  "levels": ["calling.lantern-bearer", "calling.lantern-bearer", "calling.lantern-bearer", "calling.herbalist", "calling.herbalist"],
  "list": [
    { "thing": "calling.lantern-bearer", "levels": 3, "from": 1, "added": false },
    { "thing": "calling.herbalist", "levels": 2, "from": 4, "added": true }
  ],
  "options": [
    { "thing": "calling.lantern-bearer", "allowed": true },
    { "thing": "calling.river-runner", "allowed": false, "notMet": ["calling.river-runner"] },
    { "thing": "calling.herbalist", "allowed": true }
  ],
  "unfit": [],
  "unfitNotMet": {}
}
```

| Field         | Meaning                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `options`     | For the next level (a raise): every thing of the tracks choice. A track the character has is always allowed. A new one needs its `addRequires` (with `addRequiresCurrent`, also those of the tracks it has) to hold now. |
| `notMet`      | The things whose condition does not hold, the track itself first. The package's sentence for each is the text `<thing>.addReason`.                                                                                       |
| `unfit`       | Added tracks whose condition no longer holds, checked as the character was before the level that added them. They still count; the character is not complete until the player resolves it.                               |
| `unfitNotMet` | For each track in `unfit`: the things whose condition does not hold, as `notMet`. It may name only a track the character had, not the one added (a paladin's own condition fails, the warlock's holds).                  |

What else changes with more than one track:

- A thing that came through a track (the track itself, what it grants,
  what is picked in a choice it grants, and so on) has `track` in
  `evaluation.things`. Its grants with `atLevel` and its tables by level
  count the levels in that track: a track added at level 4 gives its
  level-2 grants at character level 5. `level` stays the character level.
- A choice that comes through an added track is a copy
  `<choice>@<track>` with an answer of its own; the first track keeps the
  plain ids. Steps and choices carry `track`, steps also `trackLevel`.
- `explain` names the track and the level in it for a part from a thing in a track.
- `summary.line` gives a `{ tracks }` argument as a list
  `[{ "thing": "calling.lantern-bearer", "levels": 3 }, …]`, most levels
  first; the screens write it "Lantern bearer 3 / Herbalist 2".

**Setting the levels while building:** `PUT /api/drafts/:id/tracks` with
`{ "version": 7, "tracks": ["calling.lantern-bearer", "calling.herbalist"] }`.
Every entry must be a thing of the tracks choice, at most `level - 1` of
them. A track whose condition does not hold is still taken and shows in
`unfit`, so the levels can be set before the numbers that decide it.
Answers of a track taken away stay and count again once it is back.
Changing the answer of the tracks choice moves the levels that named the
old first track to the new one.

**Raising into a track:** `POST /api/drafts/:id/level-up` with
`{ "version": 7, "level": 6, "tracks": ["calling.herbalist"] }`: one entry
per new level, in order; a level left out goes to the track of the level
before. Here the condition is checked for the character as it is before
each new level.

| Status | Code                                                                          | When                                                                               |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `422`  | `changeRejected`, `reason: { code: "noTracks" }`                              | The package has no tracks.                                                         |
| `422`  | `changeRejected`, `reason: { code: "unknownTrack", thing }`                   | Not a thing of the tracks choice.                                                  |
| `422`  | `changeRejected`, `reason: { code: "tooManyTracks", most }`                   | More entries than levels to give them to.                                          |
| `422`  | `changeRejected`, `reason: { code: "trackNotAllowed", thing, level, notMet }` | Raising only: the track may not be added at that level (`notMet` as in `options`). |

### Explaining a value

`GET /api/drafts/:id/explain/:value` answers where a number of the character
comes from, as the screen explains it ("7 from the scores + 1 from Ferry
Child = 8"). Data, not sentences: the sources name ids, their words are in
the package texts, as everywhere in the draft view.

```json
{
  "value": "grace",
  "total": 8,
  "parts": [
    { "amount": 7, "source": { "kind": "choice", "choice": "scores" } },
    { "amount": 1, "source": { "kind": "thing", "thing": "upbringing.ferry-child" } }
  ]
}
```

| `source.kind` | Meaning                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `start`       | The fixed number the value starts at, or a number in its formula.                                                                          |
| `choice`      | Set or raised by the answer to `choice` (for a copy, the copy's id). A choice a thing brought along has that thing in `steps[].grantedBy`. |
| `thing`       | Given by `thing`, which the character has.                                                                                                 |
| `values`      | Worked out from these other `values` (`level` included).                                                                                   |
| `unclear`     | Two ways gave the same number; no source rather than a wrong one.                                                                          |

Parts from the same source are added up, parts of 0 left out; the amounts
add up to `total` (a part can be negative). `parts` is `null` if the value
cannot be told apart as a sum (a minimum or maximum cut it). A value id the
package does not have answers `404 valueNotFound`.

The screen works the same explanation out in the browser with the same
function of the rule core (`explainValue`), on the package and draft it
loaded over the API; it also explains numbers a player is still moving,
before they are saved. A test holds the route and the screen to the same
parts for every value of a demo character.

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
   | `empty`                 | Pick choices: `true` when nothing may be picked now (`options` is empty, for example a skill to deepen that the character does not have). Not asked, never in `open`; a stored answer is kept but not judged until an option comes back.                    |
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
the account. The game master invites players with the campaign's one
invitation link (`campaign.inviteUrl`, `<BASE_URL>/join/<token>`), which
they send themselves or show as a QR code; the builder mails no
invitations. Whoever opens the link and joins is a player. The game master
sees players by name, never by address. Then they reach
**the players' characters that belong to this campaign** (`campaignId`):
open, change, raise, print, and make a new one for a player. A character
in no campaign or in another stays private. When a player leaves or is
removed, their characters leave the campaign too. The characters stay the players' (`draft.owner`);
only the owner deletes one. A player sees their own characters and the
campaigns they are in, not the other players. The game master is a member
of their own campaign without being a player: their own characters can
belong to it, and `playerCount` does not count them. Anyone else gets `404`, as
for something that does not exist. Every route checks this on the server;
access keys have the same rights as the screens.

| Method & path                                         | Body                    | Who                       | Result                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/campaigns`                               | —                       | everyone                  | `{ campaigns: [Campaign] }`: the ones you lead or play in, oldest first.                                                                                                                                                                                                                                          |
| 🔒 `POST /api/campaigns`                              | `{ name }`              | everyone                  | `201 { campaign, characters: [], players: [] }`. You lead it. `422 tooManyCampaigns` (`max`, 50).                                                                                                                                                                                                                 |
| 🔒 `GET /api/campaigns/:id`                           | —                       | game master, player       | `{ campaign, characters, players }`. Game master: `campaign.inviteUrl`; `characters`: their own in this campaign (draft list entries); `players: [{ id, name, addedAt, characters }]`. Player: both `null`.                                                                                                       |
| 🔒 `PATCH /api/campaigns/:id`                         | `{ name }`              | game master               | `{ campaign }`.                                                                                                                                                                                                                                                                                                   |
| 🔒 `DELETE /api/campaigns/:id`                        | —                       | game master               | `204`. Campaign and player list go; every character stays with its owner, in no campaign.                                                                                                                                                                                                                         |
| 🔒 `POST /api/campaigns/:id/invite`                   | —                       | game master               | `{ inviteUrl }`, a new link; the old one stops working at once, the players stay. `429` (30 per hour).                                                                                                                                                                                                            |
| `GET /api/invites/:token`                             | —                       | anyone                    | `{ campaign: { id, name }, gameMaster: { name }, you }`, shown before joining. Logged in, `you` is `gameMaster` or `player` if you are in the campaign already, else null; a member gets this for a replaced link too, nobody else does. `404 inviteNotFound`. `429`: 60 lookups and joins per 15 minutes per IP. |
| 🔒 `POST /api/invites/:token/join`                    | —                       | everyone                  | `{ campaignId }`. You play in the campaign now; joining again, or as its game master, changes nothing. `404 inviteNotFound`, `422 tooManyPlayers` (50), `429`.                                                                                                                                                    |
| 🔒 `DELETE /api/campaigns/:id/players/:playerId`      | —                       | game master; player: `me` | `204`. The game master removes a player; a player leaves with `me`. The characters stay and leave the campaign; the game master's reach ends at once. `404 playerNotFound`.                                                                                                                                       |
| 🔒 `POST /api/campaigns/:id/players/:playerId/drafts` | `{ packageId, level? }` | game master               | `201`, a new draft that belongs to the player (`access: "gameMaster"`) and to this campaign. Then build it with the draft routes.                                                                                                                                                                                 |

`Campaign` is `{ id, name, role: "gameMaster|player", gameMaster: { name }, playerCount, createdAt, joinedAt }`; `joinedAt` is null for the game master. On a single campaign (`GET`, `POST`) its game master also gets `inviteUrl`; a player never does.
A player of the campaign gets `403 gameMasterOnly` on the game master's
routes (they know the campaign exists); anyone else `404 campaignNotFound`.

**Who may do what**

| Call                                                                                                 | Game master            | Player              | Anyone else     |
| ---------------------------------------------------------------------------------------------------- | ---------------------- | ------------------- | --------------- |
| `GET /api/campaigns`                                                                                 | sees it (`gameMaster`) | sees it (`player`)  | does not see it |
| `GET /api/campaigns/:id`                                                                             | `200`, with players    | `200`, `null` lists | `404`           |
| `PATCH`, `DELETE /api/campaigns/:id`                                                                 | `200` / `204`          | `403`               | `404`           |
| `POST /api/campaigns/:id/players`                                                                    | `201`                  | `403`               | `404`           |
| `DELETE /api/campaigns/:id/players/:playerId`                                                        | `204` (any player)     | `204` (`me` only)   | `404`           |
| `POST /api/campaigns/:id/players/:playerId/drafts`                                                   | `201`                  | `403`               | `404`           |
| `GET /api/drafts`                                                                                    | own only               | own only            | own only        |
| `GET`, `PATCH /api/drafts/:id`, answers, pools, finish, level-up, sheet, pdf of a player's character | `200`                  | `200` (owner)       | `404`           |
| sheet copies (all four) and play state of a player's character                                       | `200` / `201` / `204`  | the same (owner)    | `404`           |
| `DELETE /api/drafts/:id` of a player's character                                                     | `403 ownerOnly`        | `204` (owner)       | `404`           |
| any draft route on the game master's own character                                                   | `200` (owner)          | `404`               | `404`           |

A game master prints a player's character in the game master's own
language and units. Deleting a player's account removes their characters
and places; the campaign stays. Deleting the game master's account removes
their campaigns and player lists; the players keep their characters.
Tests: [`campaigns.test.ts`](src/server/api/campaigns.test.ts).

## Live help

Several people build one character together, at the same time: everyone
on it sees who else is there (and how: browser, program, MCP), on which
step and pointing at what, and hears of every stored change of the
character the moment it is made: whoever made it, in which role, and which
way (over this channel, the HTTP API with the cookie or a key, or the MCP
server). A change of the draft comes with the character's new state.
Everyone on it may answer. This is the one live channel: a screen that
only wants to know when something changed subscribes here, too. Who may
join:

- its **owner**;
- the **game master** of the campaign it belongs to, without a link (the
  same reach as on the draft routes);
- **anyone else with an account**, with the character's **help link**:
  the owner makes it (`/help/<token>` on `BASE_URL`), hands it over or
  shows it as a QR code. One link per character; it ends after 12 hours,
  when the owner makes a new one, or withdraws it, and whoever helps with
  it is out at once. A helper opens and changes the character (also over
  the draft routes, with `?help=<token>`), nothing else of the owner's: no
  list, no prints, no kept sheets, no deleting.

Anyone else gets `404` (live: close code `4404`), as for a character that
does not exist. Every check is on the server, when connecting and again
before every change. The character is stored as always; the live channel
keeps nothing but who is connected. A lost connection loses nothing:
connect again with the same URL (and the same link while it works).

| Method & path                         | Body | Who       | Result                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ---- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts/:id/help-link`    | —    | owner     | `{ helpLink }`: `{ url, token, expiresAt, createdAt }` while it works, else `null`.                                                                                                                                                                                                                  |
| 🔒 `POST /api/drafts/:id/help-link`   | —    | owner     | `201 { helpLink }`, a new link for 12 hours; the one before stops working. `429` (30 per hour).                                                                                                                                                                                                      |
| 🔒 `DELETE /api/drafts/:id/help-link` | —    | owner     | `204`. The link stops working.                                                                                                                                                                                                                                                                       |
| `GET /api/help/:token`                | —    | anyone    | `{ draftId, owner: { name }, expiresAt, yours, live }`, shown before helping; `yours` is true for the owner; `live` is the channel's path with the link. `404 helpLinkNotFound` (unknown, replaced, withdrawn, ended). `429`: 60 lookups per 15 minutes per IP.                                      |
| 🔒 `GET /api/live/drafts/:id`         | —    | see above | The live channel, a **WebSocket** (`ws://` or `wss://`, same host and port). Login by the session cookie (the browser sends it itself) or `Authorization: Bearer cbk_...`; the handshake must come from this site (`Origin`, else `403`). Helpers add `?help=<token>`, a window its id `?clientId=`. |

A game master gets `403 ownerOnly` on the help link routes; a helper and
anyone else `404 draftNotFound`.

### On the screens

The owner asks for help from the menu or the overview ("Get help": the
link, its QR code, "Stop this link"); `/help/<token>` gets a newcomer
started or logs them in and opens the character. A game master opens a
player's character from the campaign ("Help out"). On the character, a
row under the top bar shows who else is there and on which step, what
they point at, the last hint and a lost connection; the step list marks
where the others are. Changes go over the channel while someone else is
there, over HTTP otherwise. Every change made elsewhere shows at once, with
a short line from `source` and `change` ("Changed over MCP: Level", "Vexa
(game master) made a change: Folk", "Changed in another window"); the sheet
reads the play state, a kept sheet or the original again, names the play
state fields that changed ("Vexa (game master) made a change: Stamina") and
shows "Here now" too. A field that still has the cursor takes the new value
unless something written in it is not kept yet. An unsaved change
of the window to the same question gives way to the stored one, and the
line says so. Code: [`src/ui/live`](src/ui/live); browser tests:
[`e2e/live-help.spec.ts`](e2e/live-help.spec.ts),
[`e2e/live-sources.spec.ts`](e2e/live-sources.spec.ts).

### Where a change comes from

Two request headers name the source of a change; both are labels for the
screen, not a login:

- `X-Builder-Client-Id: <id>`: a browser window's own id (1–64 characters
  `A-Z a-z 0-9 _ -`, else ignored), on its HTTP changes and as
  `?clientId=<id>` on the channel's address. It comes back as
  `source.clientId`, so the window knows its own changes, and in
  `presence`, so it finds itself.
- `X-Builder-Client: mcp`: sent by the MCP server (`/mcp` and the zip) with
  a key. Its changes show `via: "mcp"`; other key requests `via: "api"`,
  cookie requests `via: "browser"`.

### In the browser

```js
const clientId = crypto.randomUUID().replaceAll("-", "");
const live = new WebSocket(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live/drafts/${id}` +
    `?clientId=${clientId}` +
    (token ? `&help=${token}` : ""),
);
live.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "state") show(m); // the same shape as GET /api/drafts/:id
  if (m.source && m.source.clientId !== clientId) tell(m.source, m.event ?? m.type, m.change); // "Lio changed this over MCP"
};
live.onclose = (e) => {
  if (e.code === 4404 || e.code === 4401) return gone(e.code); // no reach (anymore), or not logged in
  setTimeout(reconnect, 1000); // anything else: connect again with the same URL
};
live.send(
  JSON.stringify({ type: "answer", ref: "a1", version, choice: "folk", answer: { pick: "folk.hillfolk" } }),
);
// The same change over HTTP, labelled with the window:
fetch(`/api/drafts/${id}/answers/folk`, {
  method: "PUT",
  headers: { "content-type": "application/json", "x-builder-client-id": clientId },
  body: JSON.stringify({ version, answer: { pick: "folk.hillfolk" } }),
});
```

The CSP's `connect-src 'self'` allows this: same host, same port. Keep the
`state` with the highest `draft.version`; the server sends them in order.

### Messages

Text frames, one JSON object each, at most 64 KiB. `ref` is optional on
every change: any string up to 100 characters, given back on the answer
to that change, to the sender only.

**To the server**

| `type`     | Fields                                | Does                                                                                      |
| ---------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `answer`   | `version`, `choice`, `answer`, `ref?` | As `PUT /api/drafts/:id/answers/:choice`; `answer: null` removes it.                      |
| `pool`     | `version`, `step`, `picks`, `ref?`    | As `PUT /api/drafts/:id/pools/:step`.                                                     |
| `tracks`   | `version`, `tracks`, `ref?`           | As `PUT /api/drafts/:id/tracks`.                                                          |
| `setLevel` | `version`, `level`, `ref?`            | As `PATCH /api/drafts/:id`.                                                               |
| `levelUp`  | `version`, `level`, `tracks?`, `ref?` | As `POST /api/drafts/:id/level-up`.                                                       |
| `finish`   | `version`, `ref?`                     | As `POST /api/drafts/:id/finish`.                                                         |
| `step`     | `step`: string (≤ 200) or `null`      | Where you are now (a step id, `overview`, …: the screen's own words). Goes to `presence`. |
| `point`    | `target`: string (≤ 200) or `null`    | What you point at ("this card": a thing, choice or value id). Goes to `presence`.         |
| `hint`     | `text`: 1–500 characters              | A short note to everyone on the character ("Look at the spells step").                    |

**From the server**

Every message has `type` and `draftId`.

| `type`      | Fields                                                                                                                                                                                | When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `welcome`   | `you: Person`                                                                                                                                                                         | First, once connected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `presence`  | `people: [Person]`                                                                                                                                                                    | When someone joins or leaves, or changes `step` or `point`; to everyone. In the order they joined.                                                                                                                                                                                                                                                                                                                                                                                         |
| `state`     | `draft`, `packageAvailable`, `evaluation`, `summary`, `levelUp` (as `GET /api/drafts/:id`), `version`, `by`, `ref?`, `stale?`; after a change also `event`, `at`, `source`, `change?` | On joining; and after every change of the draft, by anyone, live, over the HTTP API or over MCP; to everyone. `event` is `changed` (`change`: `{ kind: "answer", choice }`, `{ kind: "pool", step }`, `{ kind: "tracks" }` or `{ kind: "level", level }`), `levelUp` (`change: { kind: "levelUp", level }`) or `finished`. `by: { id, name }` is the connection that changed it live, else `null`; `source` says who and how, for every change. `ref` only to the one who sent the change. |
| `playState` | `version`, `at`, `source`, `change: { kind: "state" \| "clearChecks", stateVersion, fields, more }`                                                                                   |
| `copies`    | `version`, `at`, `source`, `change: { kind: "copyCreated" \| "copyChanged" \| "copyDeleted", copyId }`                                                                                | A kept sheet was made, changed or deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `campaign`  | `version`, `at`, `source`                                                                                                                                                             | The character moved into another campaign or none; a game master who lost it is closed with `4404` right after.                                                                                                                                                                                                                                                                                                                                                                            |
| `deleted`   | `version`, `at`, `source`                                                                                                                                                             | The owner deleted the character; everyone is closed with `4404` right after. Do not reconnect.                                                                                                                                                                                                                                                                                                                                                                                             |
| `hint`      | `from: { id, name }`, `text`                                                                                                                                                          | Someone sent a hint; to everyone, the sender too.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `error`     | `code`, `ref?`, details as the HTTP error                                                                                                                                             | A change the rules refuse (`changeRejected`, `incomplete`, `notFinished`, `packageUnavailable`), a message of the wrong shape (`badJson`, `badRequest` with `issues`), too many messages (`tooManyRequests`: 60 per 10 seconds). To the sender only. Before a close: `notLoggedIn`, `keyNotValid`, `draftNotFound`, `tooManyPeople`.                                                                                                                                                       |

`version` is the draft's version (`playState`, `copies` and `campaign`
leave it as it was); `at` the time the change was stored. `source` is who
made it:
`{ via: "browser|api|mcp", name, role: "owner|gameMaster|helper", clientId, connectionId }`.
`clientId` is the window's id (or `null`), `connectionId` the `id` of the
connection that sent it over this channel (`null` over HTTP and MCP).
Every change of a character is told, however it was made.

`Person` is `{ id, name, role: "owner|gameMaster|helper", via, clientId, step, point }`.
`id` is the connection's (one person in two tabs is there twice); `name`
the account's name, never an address; `via` and `clientId` as in `source`.
No account ids go over the channel.

**The server is the truth.** A change sent with an old `version` changes
nothing and is no error: the sender gets the current `state` with
`stale: true` (and its `ref`), and answers again on that.

**Close codes**: `4401` not logged in or key not valid (also once the
login ends: logout, a withdrawn key, a deleted account); `4404` no such
character, or no reach (anymore: a help link withdrawn, replaced or ended,
the character deleted, or out of the game master's campaign);
`4429` more than 20 connections on one character. Access is checked again
on every change of who may reach what, and every 30 seconds. Anything else
(`1001`, `1006`, …) is the connection: connect again. The server pings
every 30 seconds and drops a connection that does not answer.

### Example

The owner (left) and a helper with the link (right); then the owner's
MCP program changes the level:

```text
helper → open  wss://builder.example/api/live/drafts/7b1e…?help=Qm9va3MgYXJlIGdyZWF0IQ&clientId=w2
helper ← { "type": "welcome", "draftId": "7b1e…", "you": { "id": "k3J…", "name": "Mara", "role": "helper", "via": "browser", "clientId": "w2", "step": null, "point": null } }
both   ← { "type": "presence", "draftId": "7b1e…", "people": [ { "id": "a9x…", "name": "Lio", "role": "owner", … }, { "id": "k3J…", "name": "Mara", "role": "helper", … } ] }
helper ← { "type": "state", "draftId": "7b1e…", "version": 4, "by": null, "draft": { "version": 4, "access": "helper", … }, "evaluation": { … }, … }
helper → { "type": "hint", "text": "Look at the spells step" }
both   ← { "type": "hint", "draftId": "7b1e…", "from": { "id": "k3J…", "name": "Mara" }, "text": "Look at the spells step" }
owner  → { "type": "answer", "ref": "r7", "version": 4, "choice": "folk", "answer": { "pick": "folk.hillfolk" } }
owner  ← { "type": "state", "ref": "r7", "version": 5, "event": "changed", "by": { "id": "a9x…", "name": "Lio" }, "source": { "via": "browser", "name": "Lio", "role": "owner", "clientId": "w1", "connectionId": "a9x…" }, "change": { "kind": "answer", "choice": "folk" }, "draft": { "version": 5, … }, … }
helper ← { "type": "state", "version": 5, "event": "changed", "by": { "id": "a9x…", "name": "Lio" }, "source": { … the same … }, "change": { "kind": "answer", "choice": "folk" }, "draft": { "version": 5, … }, … }
helper → { "type": "answer", "version": 4, "choice": "folk", "answer": { "pick": "folk.coastfolk" } }
helper ← { "type": "state", "stale": true, "by": null, "draft": { "version": 5, … }, … }
both   ← { "type": "state", "version": 6, "event": "changed", "by": null, "source": { "via": "mcp", "name": "Lio", "role": "owner", "clientId": null, "connectionId": null }, "change": { "kind": "level", "level": 3 }, "draft": { "version": 6, … }, … }
```

## Print

| Method & path                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🔒 `GET /api/drafts/:id/sheet` | The finished character's sheet as data (see below). Language and units from the settings of whoever asks, like the PDF; a language the package lacks gives English (else its first), one language per document. `409 notFinished` (with `open`), `422 languageNotSupported` (with the package's printable `languages`).                                                                                                  |
| 🔒 `GET /api/drafts/:id/pdf`   | The finished character as one A4 PDF with the parts asked for (below); without `parts`, the sheet and then the cards. Language and units from the settings of whoever asks (a game master prints in theirs); a language the package lacks gives English (else its first). `409 notFinished` (with `open`), `422 languageNotSupported` (with the package's printable `languages`), `429 tooManyRequests` (`Retry-After`). |
| `GET /api/sheet-designs`       | `{ designs: [{ id, name, description }], default }`: the designs the server draws, `name` and `description` per screen language (`{ de, en, fr, it, es }`). Public. Two today: `verbose` ("Detailed") and `classic` ("Classic").                                                                                                                                                                                         |

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
- `design`: an id from `GET /api/sheet-designs` (`verbose`, `classic`);
  default the first one (`verbose`). A design that is planned but not drawn
  yet answers `400 designNotAvailable`. Cards and rules texts look the same
  in every design.
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
- `tz`: the reader's time zone (`Europe/Zurich`), optional. A copy that
  kept the name it was made with is printed as the screen names it, by the
  minute it was made in that zone ("Meine Fassung vom 7. Oktober, 09:40");
  without `tz`, in the server's zone. The file name of a copy says which
  copy, so it is not taken for the original: "Mira - Fassung 7. Oktober
  09-40 - Klassisch - Bogen.pdf" (with the sheet in it, the design is
  named too). The ASCII `filename=` for old browsers shortens only the
  character's name. An unknown zone answers `400 badQuery`.
- `state`: `empty` (default), a sheet to write on, or `filled`: the play
  state (`GET /api/drafts/:id/state`) written into the fields of the sheet
  and the cards. Ticks beyond what a field holds are cut; a field the
  sheet does not have is skipped.
- Any other value answers `400 badQuery` with `parameter` and `value`.

The screen keeps the player's choice of parts and design on the account
(`print` in `GET /api/account`, changed with `PATCH /api/account/settings`);
until one is made it is `{ parts: ["sheet", "cards"], design: "verbose", state: "filled" }`.
That is only where the dialog starts; the PDF itself, without `parts` and
`state`, stays the sheet and the cards, empty.

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
  values that change with it (`dependents`), from the package's formulas;
  only values the sheet shows somewhere are named as dependents. A kept
  copy has none (`[]`): its numbers are what is written on its page.
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
| 🔒 `GET /api/drafts/:id/sheet-copies`            | —                                                        | `200 { copies: [SheetCopy], original: { level, changedAt, packageVersion, finished }, opened, max }`, oldest first, without models; `opened` is the version this account opens: the copy it opened last, or null for the original; also null when the original changed (`level` or `changedAt` not the copy's `from…`) after that copy was last picked, `max` the limit. Also while the character is not finished.                                                                                                                |
| 🔒 `POST /api/drafts/:id/sheet-copies`           | `{ name?, model? }`                                      | `201 { copy, model }`: the original now, in the asker's language and units, named "Meine Fassung vom 4. Oktober 2026" (in the account's language) unless `name` is given. With `model`: the original as loaded with the first change in, so the first change makes a copy in one request; its `origin` must be the original now, else `409 originalChanged` (with `original`). `409 notFinished`, `409 tooManyCopies` (50). The new copy becomes the asker's `opened`., `413 copyTooLarge` (512 KiB), `422 languageNotSupported`. |
| 🔒 `GET /api/drafts/:id/sheet-copies/:copyId`    | —                                                        | `200 { copy, model }`; `model.origin` is `{ kind: "copy", … }`. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 🔒 `PUT /api/drafts/:id/sheet-copies/:copyId`    | `{ version, name?, model? }`                             | `200 { copy, model }`. A model that is not a `SheetModel` is `400 badRequest`; its `origin` is ignored. `409 versionConflict` (with `current`), `413 copyTooLarge`.                                                                                                                                                                                                                                                                                                                                                               |
| 🔒 `DELETE /api/drafts/:id/sheet-copies/:copyId` | —                                                        | `204`. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 🔒 `PUT /api/drafts/:id/sheet-view`              | `{ copyId }`                                             | `200 { opened }`: the version this account opens next time, a copy of this character or `null` for the original. `404 copyNotFound`.                                                                                                                                                                                                                                                                                                                                                                                              |
| 🔒 `POST /api/drafts/:id/sheet-places`           | `{ model, design }`                                      | `200 { pages, sections: [{ page, col, cols } \| null] }`: where the PDF of `model` (the sheet alone, the character's play state written in) starts each section, page and grid column from 0, and the columns it takes on that page, so the screen breaks its pages as the paper does. `400 badRequest` (also an unknown design), `422 languageNotSupported`, `429 tooManyRequests` (120 in 10 minutes).                                                                                                                          |
| 🔒 `GET /api/drafts/:id/state`                   | —                                                        | `200 { state, version, updatedAt }`; `{}` at version `0` while nothing is stored.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 🔒 `PUT /api/drafts/:id/state`                   | `{ version, state }` or `{ version, clearChecks: true }` | `200` as `GET`. `state` replaces the whole state (at most 1000 fields, texts up to 2000 characters); `clearChecks` removes every `{ checks }` and keeps the rest (a rest: the builder does not know what one is, it only rubs out ticks). The first write names version `0`. `409 versionConflict` (with `current`).                                                                                                                                                                                                              |

`SheetCopy` is `{ id, name, createdAt, updatedAt, fromLevel, fromChangedAt,
fromPackageVersion, language, units, version }`.

- **Access** is the character's: owner, game master of the character's
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

| Method & path           | Result                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`       | `{ "status": "ok", "packages": [{ "id", "version", "formatVersion" }], "warnings": [] }` while the process serves requests, also without packages. `warnings` names rejected package folders, an empty package list or a failed start. Public; used by Docker. |
| `GET /api/openapi.json` | `openapi.json` as it is in the repository. Public.                                                                                                                                                                                                             |
| `GET /api/docs`         | The API reference (Scalar), an HTML page: every route to read and to try with an access key. Public.                                                                                                                                                           |

## Error codes

| Status | Code                     | When                                                                                                                              |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `badJson`                | The body is not JSON.                                                                                                             |
| `400`  | `badRequest`             | The body has the wrong shape; `issues` lists `{ path, message }`.                                                                 |
| `400`  | `badQuery`               | A query parameter has a value the API does not know (`parameter`, `value`).                                                       |
| `400`  | `designNotAvailable`     | A planned sheet design not drawn yet (`designs` lists those that are); `422` in the settings.                                     |
| `401`  | `notLoggedIn`            | No session cookie and no `Authorization` header.                                                                                  |
| `401`  | `keyNotValid`            | The access key is unknown, withdrawn, past its end or not `Bearer cbk_...`.                                                       |
| `401`  | `wrongLogin`             | No account fits this name or address and this password.                                                                           |
| `403`  | `crossSite`              | A change sent from another site.                                                                                                  |
| `403`  | `keyCannotMakeKeys`      | Making an access key with an access key.                                                                                          |
| `403`  | `keyCannotMakePasswords` | Making a password with an access key.                                                                                             |
| `403`  | `gameMasterOnly`         | A player of the campaign calls a game master's route.                                                                             |
| `403`  | `ownerOnly`              | A game master deletes a player's character or calls a help link route; only the owner does.                                       |
| `404`  | `notFound`               | No such API path.                                                                                                                 |
| `404`  | `draftNotFound`          | No draft with this id that you may reach (someone else's looks the same).                                                         |
| `404`  | `campaignNotFound`       | No campaign with this id that you lead or play in.                                                                                |
| `404`  | `playerNotFound`         | No such player in this campaign.                                                                                                  |
| `404`  | `copyNotFound`           | No kept copy with this id on this character.                                                                                      |
| `404`  | `keyNotFound`            | No access key with this id in this account.                                                                                       |
| `404`  | `passwordNotFound`       | No password with this id in this account.                                                                                         |
| `404`  | `resetLinkInvalid`       | The link back in is unknown, used already or older than 30 minutes.                                                               |
| `404`  | `packageNotFound`        | No loaded package with this id.                                                                                                   |
| `404`  | `extensionNotFound`      | No loaded extension of the draft's package with this id; `extension` names it.                                                    |
| `404`  | `languageNotFound`       | The package has no texts in this language.                                                                                        |
| `404`  | `helpLinkNotFound`       | No character has this help link (unknown, replaced, withdrawn or older than 12 hours).                                            |
| `404`  | `inviteNotFound`         | No campaign has this invitation link (unknown, or replaced by a new one).                                                         |
| `404`  | `valueNotFound`          | The draft's package has no value with this id (explaining a value).                                                               |
| `404`  | `versionNotFound`        | No such copy of the sheet: not `original` and not a kept copy of this character.                                                  |
| `405`  | `methodNotAllowed`       | The path exists, the method does not.                                                                                             |
| `409`  | `versionConflict`        | The draft, copy or play state moved on; `current` holds it now.                                                                   |
| `409`  | `notFinished`            | PDF or sheet of a draft, or raising a draft that is not in a raise; `open` lists the open choices.                                |
| `409`  | `tooManyCopies`          | The character has 10 kept copies (`max`); delete one first.                                                                       |
| `409`  | `originalChanged`        | A copy made with `model` from an original that changed since; `original` says how it is now.                                      |
| `409`  | `copyUnreadable`         | A kept copy stored in a shape this server no longer prints; `version` names it.                                                   |
| `409`  | `packageUnavailable`     | The draft's package or one of its extensions is not loaded right now; `packageId` and `extensions` name them.                     |
| `409`  | `extensionInUse`         | Switching off an extension an answer still comes from; `extension`, and `choices` to change first.                                |
| `413`  | `bodyTooLarge`           | Body over 64 KiB (516 KiB for a body with a sheet copy; `max`).                                                                   |
| `413`  | `copyTooLarge`           | A sheet copy's model over 512 KiB (`max`).                                                                                        |
| `415`  | `jsonRequired`           | Body not `application/json`.                                                                                                      |
| `422`  | `changeRejected`         | The rule core refused the change; `reason` is a `ChangeError` (below).                                                            |
| `422`  | `incomplete`             | Finishing with open choices; `open` lists them. With a track in `unfit`, also `unfit: [{ "thing", "notMet": [...] }]`.            |
| `422`  | `languageNotSupported`   | The account's language cannot be printed with this package; `languages` lists those that can.                                     |
| `422`  | `tooManyCampaigns`       | The account leads 50 campaigns (`max`).                                                                                           |
| `422`  | `tooManyPlayers`         | The campaign has 50 players (`max`).                                                                                              |
| `422`  | `tooManyKeys`            | The account has 20 access keys (`max`).                                                                                           |
| `422`  | `tooManyPasswords`       | The account has 10 passwords (`max`).                                                                                             |
| `422`  | `lastPassword`           | Deleting the account's last password.                                                                                             |
| `422`  | `unknownUnit`            | No loaded package offers this unit (`dimension`, `unit`).                                                                         |
| `429`  | `tooManyAttempts`        | Too many failed logins, new accounts, new or opened invitation or help links, or links back in; `retryAfter`, also `Retry-After`. |
| `429`  | `tooManyRequests`        | Too many PDFs; `Retry-After`.                                                                                                     |
| `500`  | `internal`               | A bug in the builder.                                                                                                             |
| `500`  | `packageRuleError`       | The package's rules could not be worked out (a bug in the package); `message`.                                                    |
| `502`  | `mailFailed`             | The mail server refused the mail with a link back in; nothing changed.                                                            |
| `503`  | `mailNotConfigured`      | The server has no mail (or no `BASE_URL` for links back in) set up.                                                               |
| `503`  | `baseUrlNotSet`          | The server has no public address (`BASE_URL`); the MCP zip cannot say where the builder is.                                       |
| `503`  | `mcpPackageMissing`      | This build has no `server.mjs` for the MCP zip.                                                                                   |

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
