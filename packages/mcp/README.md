# @builder/mcp

An MCP server for a language model on the player's own computer (Claude
Desktop, Claude Code, Cursor, any MCP program over stdio), and the tool list
a later assistant in the web app shares.

It talks to the builder **only over the public HTTP API**
([`apps/web/API.md`](../../apps/web/API.md),
[`openapi.json`](../../apps/web/openapi.json)) with an access key
(`Authorization: Bearer cbk_...`). It imports neither the database nor the
rule core; from `@builder/format` it uses only the placeholder parser and
the unit conversion, to write package texts for the reader.

## Parts

| File                    | What                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/api-client.ts`     | `ApiClient({ baseUrl, key, fetch })`. Keeps each character's `version` and sends it with every change; on `409 versionConflict` it takes the current state and reports what changed (it does not retry). Loads the account (language, units), each package's structure and its texts once. |
| `src/words.ts`          | Package texts in one language for a reader: placeholders filled, quantities converted by the package's table into the account's units.                                                                                                                                                     |
| `src/tools/`            | The shared tool list `TOOLS`: per tool a name, a description (`descriptions.ts`), a Zod input shape and `run(client, input)`. Depends on nothing but an `ApiClient`.                                                                                                                       |
| `src/server.ts`         | `createMcpServer(client)`: registers the list on an MCP server.                                                                                                                                                                                                                            |
| `src/stdio.ts`          | Entry point of `server.mjs`: reads `config.json` next to the file (`{ "baseUrl", "key" }`), overridable by `BUILDER_BASE_URL` and `BUILDER_KEY`, and serves over stdio.                                                                                                                    |
| `src/download.ts`       | The text files of the download zip (`renderGuide`, `configFile`, `desktopConfigFile`); `POST /api/account/mcp-package` zips them with `server.mjs`.                                                                                                                                        |
| `templates/README.*.md` | The guide that goes into the download zip, in German and English. `{{BASE_URL}}`, `{{KEY_NAME}}` and the sections `{{#KEY}}`/`{{^KEY}}` (with or without a key) are filled in by `renderGuide`.                                                                                            |

## Tools

`list_packages`, `list_characters`, `get_character`, `explain_value`,
`list_open_choices`, `list_options`, `set_answer`, `answer_pool`,
`start_character`, `set_level`, `level_up`, `finish_character`,
`get_sheet`. They speak of characters, choices, options, values and things;
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
  character.
- `src/stdio.test.ts`: the stdio server as a child process registers exactly
  `TOOLS`; configuration.
- `src/no-rulebook-words.test.ts`: none of the 75 rulebook terms in this
  package (the terms: `src/rulebook-terms.ts`).
- [`apps/web/src/server/api/mcp-package.test.ts`](../../apps/web/src/server/api/mcp-package.test.ts):
  the download zip: four files, address and key, the key works, no key
  without a session, the guide in the account's language, no rulebook term
  in any file of it.
