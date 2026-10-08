# Content packages

The builder loads its content from this folder (in Docker Compose it is
mounted as `/packages`). Nothing here except this file is committed: the
packages come from elsewhere.

Each folder with a `manifest.json` is one package:

```
packages-mount/
  mistland/           a base package
    manifest.json
    ...
  mistland-tides/     an extension of mistland
    manifest.json     with "dependsOn": [{ "id": "mistland" }]
    ...
```

## Adding an extension

An extension adds to a base package (format SPEC, section 17): more
options for its choices, new things and texts. Characters switch it on one
by one; a character without it does not see it.

1. Copy the extension's folder **next to** its base, as its own folder
   (`packages-mount/mistland-tides/`). A base may also carry extensions in a
   subfolder `extensions/` of its own folder; both work.
2. Check it with its base before the restart:
   `pnpm validate-package packages-mount/mistland-tides packages-mount/mistland`.
3. Restart the web container: `docker compose restart web`. The log says
   `Packages: loaded mistland-tides 0.1.0 (extends mistland …)`, or
   `REJECTED` with the reason. A rejected extension leaves its base and
   every character without it working as before.

An extension whose licenses are not `publishable` holds content that may
not be shared. Keep such a folder off public servers and out of public
repositories; the sheet of a character that uses it says "not for
sharing".
