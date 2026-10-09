# @builder/mcp

An MCP server for a language model, and the tool list a later assistant in
the web app shares. `server.mjs` runs in one of two modes:

- **private**, with a key in `config.json` or `BUILDER_KEY`: over stdio, for
  one person's MCP program (Claude Desktop, Claude Code, Cursor, ...).
- **public**, without a key: over HTTP at `/mcp` on `PORT` (8787), stateless
  ("Streamable HTTP" without sessions, plain JSON answers). Each request
  brings its own `Authorization: Bearer cbk_...`; without a valid one, `401`.
  A browser `Origin` must be in `ALLOWED_ORIGINS`; requests without one
  (programs, curl) pass. Never a fixed key over HTTP.

It writes `private, stdio` or `public, HTTP on port 8787` to stderr on start.

It talks to the builder **only over the public HTTP API**
([`apps/web/API.md`](../../apps/web/API.md),
[`openapi.json`](../../apps/web/openapi.json)) with an access key
(`Authorization: Bearer cbk_...`), and says what it is with
`X-Builder-Client: mcp`: the builder's live channel shows the changes it
makes as made over MCP (a label, not a login). It imports neither the database nor the
rule core; from `@builder/format` it uses only the placeholder parser and
the unit conversion, to write package texts for the reader.

## Parts

| File                | What                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/api-client.ts` | `ApiClient({ baseUrl, key, fetch, packages })`. Keeps each character's `version` and sends it with every change; on `409 versionConflict` it takes the current state and reports what changed (it does not retry). Loads the account (language, units) once; each package's structure and texts once per `PackageCache`, which clients with different keys may share. |
| `src/words.ts`      | Package texts in one language for a reader: placeholders filled, quantities converted by the package's table into the account's units.                                                                                                                                                                                                                                |
| `src/tools/`        | The shared tool list `TOOLS`: per tool a name, a description (`descriptions.ts`), a Zod input shape and `run(client, input)`. Depends on nothing but an `ApiClient`.                                                                                                                                                                                                  |
| `src/server.ts`     | `createMcpServer(client)`: registers the list on an MCP server.                                                                                                                                                                                                                                                                                                       |
| `src/main.ts`       | Entry point of `server.mjs`: reads `config.json` next to the file (`{ "baseUrl", "key" }`), overridable by `BUILDER_BASE_URL` and `BUILDER_KEY` (`src/config.ts`). With a key it serves over stdio, without one over HTTP.                                                                                                                                            |
| `src/http.ts`       | `createHttpHandler({ apiBaseUrl, publicUrl, allowedOrigins, fetch, packages })`: a web `Request` with a Bearer key in, a `Response` out. Checks `Origin`, then the key (`GET /api/account`), then runs the shared tools for that one request. The web app's route `/mcp` uses it as is.                                                                               |
| `src/node-http.ts`  | Serves a handler at `/mcp` on Node's own HTTP server, body capped at 1 MB.                                                                                                                                                                                                                                                                                            |
| `src/download.ts`   | The text files of the public download zip: `zipTextFiles(baseUrl, guides)`, no key, the same for everyone.                                                                                                                                                                                                                                                            |
| `templates/zip/`    | The guides of the public zip: `README.md` (English) and `ANLEITUNG.md` (German), both always in it; `{{BASE_URL}}` is filled in.                                                                                                                                                                                                                                      |

## Tools

`list_packages`, `list_characters`, `get_character`, `explain_value`,
`list_open_choices`, `list_options`, `set_answer`, `answer_pool`,
`start_character`, `set_level`, `set_tracks`, `level_up`, `finish_character`,
`get_sheet`. With a package whose characters split their levels between
several things (tracks), `get_character` shows them and which may be added
next, `level_up` names the track of each new level and `set_tracks` sets
them while building. They speak of characters, choices, options, values and things;
every name in their answers comes from the package texts, in the account's
language. A tool answers JSON text; an answer the builder refused is marked
as an error and says why in words. `get_sheet` returns the sheet model as
data, or the PDF as an embedded resource.

Not in this round: campaigns, deleting characters or the account, managing
keys.

## Build

```sh
pnpm --filter @builder/mcp build   # dist/server.mjs, one file, Node 20 or newer, no node_modules
```

The web app's `build` and `dev` run this first; the unit tests run it once
as Vitest global setup (`scripts/test-setup.ts`). The Docker image copies
`dist/` and `templates/` next to the web server.

## Tests

- [`apps/web/src/server/api/mcp.test.ts`](../../apps/web/src/server/api/mcp.test.ts):
  the tools against the real API with the demo package and a key: a level-3
  character from empty to finished, raised to 5, sheet and PDF; a refused
  answer; a change made elsewhere; a withdrawn key; someone else's
  character. The level-3 run again over the HTTP handler with the MCP
  library's client; over HTTP: 401 without, with a wrong and with a withdrawn
  key; key A never sees B's characters; the version read afresh per request
  and package texts loaded once; a foreign `Origin` refused.
- `src/stdio.test.ts`: the private server as a child process registers
  exactly `TOOLS` and says `private, stdio`; configuration and modes.
- `src/http.test.ts`: the public server as a child process: 401, `Origin`,
  `/mcp` and POST only, no key from the address.
- `src/download.test.ts`: the files of the public zip.
- `src/no-rulebook-words.test.ts`: none of the 75 rulebook terms in this
  package (the terms: `src/rulebook-terms.ts`).
- [`apps/web/src/server/mcp-route.test.ts`](../../apps/web/src/server/mcp-route.test.ts):
  the web app's `/mcp` (401, two accounts kept apart, browser redirect,
  limit per address) and the public zip `/downloads/builder-mcp.zip` (no
  login, no key, no rulebook term in any file of it).
