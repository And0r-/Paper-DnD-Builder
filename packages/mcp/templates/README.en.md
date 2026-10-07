# Character builder with a language model

With this package, a language model on your computer helps you with the
character builder. You write to it, for example, "Build a new level 3
character with me" or "Why does my character have an 8 here?". The language
model then reads your characters, explains values and enters your answers.

{{#KEY}}
The package belongs to your account on **{{BASE_URL}}**. The access key in
it is called **"{{KEY_NAME}}"** in your settings.
{{/KEY}}
{{^KEY}}
The package belongs to the character builder on **{{BASE_URL}}**. It holds
no access key yet. This is how you add one:

1. Log in on {{BASE_URL}} and open **Settings → Access keys**.
2. Make a new key and copy it. It starts with `cbk_`.
3. Open the file `config.json` from this package in a text editor. Put the
   key between the quotes after `"key"`, like this: `"key": "cbk_..."`.
   Save.
{{/KEY}}

> **Privacy**
>
> - The program in this package (`server.mjs`) talks only to the character
>   builder on {{BASE_URL}}. To no one else.
> - You choose the language model yourself, in your program (for example
>   Claude Desktop or Cursor). **That is where your character data goes**
>   once the language model reads it. What its provider does with it is in
>   the provider's terms, not ours.
> - The file `config.json` holds your access key. **The key is a password.**
>   Do not give it to anyone and do not upload it anywhere.

## 1. Install Node

The program needs Node, version 20 or newer. Download and install it here:
<https://nodejs.org/>

To check: open a terminal (Windows: "Command Prompt") and type
`node --version`. You should see a number from `v20` up.

## 2. Unpack the zip

Unpack the zip into a folder that stays, for example
`Documents/character-builder`. Do not leave it in "Downloads"; that folder
tends to get cleaned up.

The folder holds `server.mjs`, `config.json`,
`claude_desktop_config.json` and this guide. Note the full
path to `server.mjs`, for example
`C:\Users\you\Documents\character-builder\server.mjs` or
`/Users/you/Documents/character-builder/server.mjs`. Below it is written as
`PATH/server.mjs`.

## 3. Add it to your program

Pick your program. Restart the program once afterwards.

### Claude Desktop

1. In Claude Desktop, open **Settings → Developer → Edit Config**. The file
   `claude_desktop_config.json` opens.
2. Copy this into it (if there is already something under `mcpServers`, add
   only the `character-builder` entry):

   ```json
   {
     "mcpServers": {
       "character-builder": {
         "command": "node",
         "args": ["PATH/server.mjs"]
       }
     }
   }
   ```

3. Replace `PATH/server.mjs` with your path (on Windows, double every `\`:
   `C:\\Users\\...`), save, and restart Claude Desktop.

### Claude Code

1. Open a terminal.
2. Type:

   ```sh
   claude mcp add character-builder -- node "PATH/server.mjs"
   ```

3. Restart Claude Code. `/mcp` shows whether `character-builder` is
   connected.

### Cursor

1. Open **Settings → MCP → Add new MCP server**. The file `mcp.json` opens.
2. Paste:

   ```json
   {
     "mcpServers": {
       "character-builder": {
         "command": "node",
         "args": ["PATH/server.mjs"]
       }
     }
   }
   ```

3. Replace the path, save, and restart Cursor.

### Other programs

Any program that speaks MCP over "stdio" starts the server with:

```sh
node PATH/server.mjs
```

The address and the key come from `config.json` in the same folder. Instead
of the file, the environment variables `BUILDER_BASE_URL` and `BUILDER_KEY`
work too.

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
- see or change anything in other accounts: only your own characters
- get around the rules: what the builder refuses is not saved

The language model can be wrong when it explains. The numbers on the sheet
are always worked out by the builder, not by the language model.

## Withdraw the key

If you no longer need the package, or the key got into the wrong hands:

1. Log in on {{BASE_URL}}.
2. Open **Settings → Access keys**.
3. Withdraw the key {{#KEY}}**"{{KEY_NAME}}"**{{/KEY}}{{^KEY}}you put into `config.json`{{/KEY}}.

From then on the builder refuses the key at once. The language model then
reports that the key is no longer valid. Afterwards, delete the folder with
`server.mjs` and `config.json`.
