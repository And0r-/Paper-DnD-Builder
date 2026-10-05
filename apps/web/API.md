# HTTP API

JSON over HTTP, same origin only. All routes live in
[`src/server/api/routes`](src/server/api/routes); the router works on
standard `Request`/`Response`, and Next.js hands it every `/api/*` request
([`app/api/[...path]/route.ts`](app/api/[...path]/route.ts)).

**Conventions**

- Bodies are `application/json` (anything else: `415`). Changes from other
  sites are refused (`403`, `Origin` / `Sec-Fetch-Site` check).
- Login state is an httpOnly session cookie. Routes marked 🔒 answer `401`
  without it.
- Errors: `{ "error": { "code": "...", ...details } }`. Codes are stable and
  English; the screen words them in the player's language.
- Responses are never cached (`Cache-Control: no-store`).

## Login and account

| Method & path                    | Body                    | Result                                                                                                                                  |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/password`        | `{ email, language? }`  | `202`. Makes a password and mails it: new account, or new password for an existing one (old one stops working). Same answer either way. |
| `POST /api/auth/login`           | `{ email, password }`   | `200 { account }` + session cookie. `401 wrongMailOrPassword`, `429 tooManyAttempts` (`Retry-After`).                                   |
| `POST /api/auth/logout`          | —                       | `204`, cookie cleared.                                                                                                                  |
| 🔒 `GET /api/account`            | —                       | `{ account: { email, language, units, createdAt } }`                                                                                    |
| 🔒 `PATCH /api/account/settings` | `{ language?, units? }` | `units` is `{ dimension: unit or null }`; null follows the language again. Units must exist in a loaded package (`422 unknownUnit`).    |
| 🔒 `POST /api/account/password`  | —                       | `202`. New password by mail; every other session ends.                                                                                  |
| 🔒 `DELETE /api/account`         | `{ confirm: true }`     | `204`. Deletes account, sessions and every draft.                                                                                       |

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
  "draft": { "id", "packageId", "version", "status": "draft|finished", "level", "answers", ... },
  "packageAvailable": true,
  "evaluation": { "level", "steps", "choices", "things", "values", "inputs", "raises", "open", "complete", "inactiveAnswers" },
  "summary": { "name", "level", "complete", "line" }
}
```

Every change sends the `version` it was made on. If the draft has moved on,
the answer is `409 versionConflict` with the current state in
`error.current` (optimistic locking).

| Method & path                            | Body                    | Result                                                                                                      |
| ---------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts`                     | —                       | The account's drafts with summaries.                                                                        |
| 🔒 `POST /api/drafts`                    | `{ packageId, level? }` | `201`, new draft at version 1.                                                                              |
| 🔒 `GET /api/drafts/:id`                 | —                       | The draft.                                                                                                  |
| 🔒 `PATCH /api/drafts/:id`               | `{ version, level }`    | Changes the level.                                                                                          |
| 🔒 `PUT /api/drafts/:id/answers/:choice` | `{ version, answer }`   | Answers one choice; `answer: null` removes it. `422 changeRejected` with the reason if it does not fit now. |
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
is before this choice (they do not set its base). Refused with
`answerDoesNotFit` and `badAssignment` (not a target, or below 0),
`outOfRange` (more than the value may take here) or `overBudget` (more
points than there are). Fewer points than `points` leave the choice open
(`incomplete`, `remaining`), unless no value can take another one.

**Copies of a choice** (format 0.9, things with `repeatable`): a choice
granted by a repeatable thing is asked once per pick of that thing, under
the id `<choice>@<where the thing was picked>`, for example
`boon-raise@boon-8`. It is answered like any choice
(`PUT /api/drafts/:id/answers/boon-raise%40boon-8`); its rules and texts are
those of the declared choice (`copyOf` in the evaluation).

### Fields of `evaluation` for levels (format 0.9)

| Where                              | Field         | Meaning                                                                                                                                                                                            |
| ---------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps[]`, `choices.*`, `things[]` | `atLevel`     | Character level from which the step, choice or thing is there: `flow.level.min` for flow steps, else the level at which its grant applies. Raising from level n adds the steps with `atLevel > n`. |
| `choices.*` (raise)                | `raise`       | `{ points, before: { value: n }, most: { value: n } }`: points to give, each value before this choice, most points each value can take here (cap and the value's `max` included).                  |
| `choices.*` (raise)                | `recommended` | `{ method, assign }`, always a full answer: the package's assignment as far as it fits, the rest in order.                                                                                         |
| `choices.*` (copy)                 | `copyOf`      | The declared choice a copy uses for rules and texts.                                                                                                                                               |
| `raises`                           | —             | Per value, the points added by raise answers in step order: `{ "heart": [{ "amount": 2, "choice": "boon-raise@boon-4" }] }`.                                                                       |

A finished character stays finished while it is complete; a change that
leaves something open makes it a draft again.

## Print

| Method & path                | Result                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔒 `GET /api/drafts/:id/pdf` | The finished character as one A4 PDF: sheet, then cards. Language and units from the account settings. `409 notFinished` (with `open`), `422 languageNotSupported` (with the package's printable `languages`), `429 tooManyRequests` (`Retry-After`). |

It is a plain `GET` so the screen can offer it as an ordinary download
link. The PDF is made on every request and never stored.

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
