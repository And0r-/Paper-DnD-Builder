# Character builder with a language model

With this package, a language model helps you with the character builder on
**{{BASE_URL}}**. You write to it, for example, "Build a new level 3
character with me" or "Why does my character have an 8 here?". The language
model then reads your characters, explains values and enters your answers.

The package holds no access key and nothing personal. It is the same for
everyone. (Deutsch: siehe `ANLEITUNG.md`.)

> **Privacy**
>
> - The program in this package (`server.mjs`) talks only to the character
>   builder on {{BASE_URL}}. To no one else.
> - You choose the language model yourself, in your program (for example
>   Claude Desktop or Cursor). **That is where your character data goes**
>   once the language model reads it. What its provider does with it is in
>   the provider's terms, not ours.
> - **An access key is a password.** Do not give it to anyone and do not
>   upload it anywhere. If someone else runs this server for you, they can
>   use the key you send them. If you suspect misuse, withdraw the key.

## Two ways to run it

The same `server.mjs` runs in one of two ways. Which one depends on whether
it has a key.

|                  | private                                         | public                                                      |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| When             | a key is in `config.json` or in `BUILDER_KEY`   | no key is set                                               |
| Connection       | your program starts `node server.mjs` ("stdio") | `node server.mjs` waits on port 8787, address `/mcp` (HTTP) |
| Whose characters | always those of the key you entered             | those of the key each request sends; without a key, nothing |
| For whom         | one person on their own computer                | someone who runs it for several people                      |

When it starts, it writes one line: `private, stdio` or
`public, HTTP on port 8787`.

A server with a fixed key over HTTP does not exist on purpose: anyone who
could reach it would get into your account.

## Your access key

1. Log in on {{BASE_URL}} and open **Settings → Access keys**.
2. Make a new key and copy it. It starts with `cbk_`. It is shown only once.

## Install Node

The program needs Node, version 20 or newer. Download and install it here:
<https://nodejs.org/>

To check: open a terminal (Windows: "Command Prompt") and type
`node --version`. You should see a number from `v20` up.

Unpack the zip into a folder that stays, for example
`Documents/character-builder`. Note the full path to `server.mjs`, for
example `C:\Users\you\Documents\character-builder\server.mjs` or
`/Users/you/Documents/character-builder/server.mjs`. Below it is written as
`PATH/server.mjs`.

## Private: on your own computer

### Claude Desktop

1. In Claude Desktop, open **Settings → Developer → Edit Config**. The file
   `claude_desktop_config.json` opens.
2. Copy the `character-builder` entry from the file
   `claude_desktop_config.json` in this package into it (under
   `mcpServers`).
3. Replace `PATH/server.mjs` with your path (on Windows, double every `\`:
   `C:\\Users\\...`) and `KEY` with your key. Save and restart Claude
   Desktop.

### Other programs (Claude Code, Cursor, ...)

1. Open `config.json` from this package in a text editor. Put your key
   between the quotes after `"key"`, like this: `"key": "cbk_..."`. Save.
2. Add the server to your program. Claude Code, in a terminal:

   ```sh
   claude mcp add character-builder -- node "PATH/server.mjs"
   ```

   Any other program that speaks MCP over "stdio" starts it with
   `node PATH/server.mjs`.

3. Restart the program.

Instead of `config.json`, the environment variables `BUILDER_BASE_URL` and
`BUILDER_KEY` work too.

## Public: for several people

1. Leave `"key"` in `config.json` empty and do not set `BUILDER_KEY`.
2. Start `node server.mjs`. It listens on port 8787 (another one with
   `PORT=9000 node server.mjs`), at the address `/mcp`.
3. Each person sets it up in their program as an HTTP MCP server with the
   address `http://your-server:8787/mcp` and the header
   `Authorization: Bearer cbk_...` with their own key. Claude Code:

   ```sh
   claude mcp add --transport http character-builder http://your-server:8787/mcp \
     --header "Authorization: Bearer cbk_..."
   ```

Without a valid key the server answers `401` and does nothing. Each request
is checked on its own; there are no sessions, so it works behind any proxy.
Put HTTPS in front of it (a proxy) when it is reachable from the internet.

Browsers may call it only from addresses you allow:
`ALLOWED_ORIGINS=https://example.org,https://other.example`. Programs and
`curl` send no such address and are always let through.

## What the language model can do

- list and read your characters: level, values, what they have, what is
  still open
- explain where a number comes from
- show the open choices, with every option and explanation from the builder
- enter your answers; the builder checks each answer against the rules and
  says when one does not fit
- start a new character, change the level, raise a finished character,
  finish a character
- get the character sheet, as data or as a PDF

## What it cannot do

- delete characters, delete your account, manage keys
- campaigns
- see or change anything in other accounts: only the characters of the key
- get around the rules: what the builder refuses is not saved

The language model can be wrong when it explains. The numbers on the sheet
are always worked out by the builder, not by the language model.

## Withdraw a key

If you no longer need a key, or it got into the wrong hands: log in on
{{BASE_URL}}, open **Settings → Access keys** and withdraw it. From then on
the builder refuses the key at once.
