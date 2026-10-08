# Character Builder

A multilingual character builder that guides a player, step by step, to a
finished and printable character — in their own language, without needing
to read a rulebook.

**The builder knows nothing about any rule system; it loads content
packages.** Everything that makes a game a game — things, choices, rules,
texts and unit conversions — comes from a package mounted at runtime. A new
class is a data entry, not a code change. If something only works with one
particular game's data, that is a bug in the builder.

## Principles

- **Rules are data.** A small, rule-system-neutral core evaluates formulas
  and dependencies declared by the loaded package.
- **One language on screen.** Texts come from per-language files in the
  package. The UI never mixes languages.
- **Units are a separate setting**, stored with the account, independent of
  the language. Values are stored once in the package's source unit and
  converted with a table from the package.
- **Login without mail.** A player gives a name and, if they want, a mail
  address (only a way back in). The server makes the password (five words
  and a number), shows it once on the screen and logs the player in; later,
  the password alone logs in. Players make and delete further passwords
  (one per device, one on paper) in the settings; nobody chooses one, and
  nothing waits for a mail.
- **Campaigns by link.** Whoever makes a campaign leads it and gets one
  invitation link for it, also shown as a QR code (drawn on the page, no
  outside service). They send it however they like or show it at the
  table; whoever opens it joins and builds a character for it. The builder
  sends no invitation mails. A new link replaces the old one.
- **We collect nothing.** Stored data is limited to a name, a mail address
  if one is given, password hashes, settings and character data. No tracking, no analytics, no
  third-party scripts, no requests from the browser to any other domain
  (enforced by a Content-Security-Policy).
- **The draft lives on the server** as a single document, so collaborative
  editing can be added later without a rewrite.

## Repository layout

```
apps/web               Next.js app (App Router): UI, API, server-side PDF
packages/core          Rule core: rule-system-neutral formula/dependency engine
packages/format        Content package format (Zod schema)
packages/demo-package  Demo package with invented content, for development and tests
packages/db            PostgreSQL access and forward-only migrations
packages-mount/        Mount point for content packages (not committed)
docker/                Container entrypoint
```

## Development

Requirements: Node.js 24+, pnpm (via `corepack enable`), PostgreSQL 17 for
anything that touches the database.

```sh
pnpm install
pnpm check        # lint, typecheck, tests, formatting
pnpm dev          # http://localhost:3000
```

Database:

```sh
export DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/builder
pnpm db:migrate   # applies pending migrations; safe to run repeatedly
```

Migrations live in `packages/db/migrations` as `NNNN_snake_case.sql`. They
only run forward. Never edit an applied migration — the runner refuses to
start if a file changed after it was applied; add a new migration instead.

Tests use an in-process PostgreSQL (PGlite), so `pnpm check` needs no
running database.

For `pnpm dev`, set `PACKAGES_DIR=packages/demo-package` (it may point at a
single package or at a folder of packages) and `DATABASE_URL`. Logging in needs no
mail. SMTP (`SMTP_*`, `MAIL_FROM`) is used only for the link back in after
a lost password; for local development point it at a local mail catcher.
The server never logs or stores passwords, only their hashes.

The HTTP API is described in [apps/web/API.md](apps/web/API.md).

## Running with Docker Compose

```sh
cp .env.example .env    # fill in POSTGRES_PASSWORD, BASE_URL, SMTP_*
# put content packages into ./packages-mount
docker compose up -d --build
```

The web container applies pending migrations on start, then serves on
`WEB_PORT` (default 3000). `GET /api/health` reports liveness and lists the
loaded packages (id, version, format version); with none loaded, its
`warnings` say so. Each folder
in `./packages-mount` with a `manifest.json` is one package (to try the
builder, copy `packages/demo-package` there). Packages are validated on
start; an invalid one is rejected with the validator's report in the log
(`docker compose logs web`) and the builder starts without it. To swap a
content package, replace its files in `./packages-mount` and run
`docker compose restart web`.

Run it behind a reverse proxy that terminates TLS and appends
`X-Forwarded-For` (per-IP login limits use the last entry). With an
`https://` `BASE_URL`, cookies are `Secure` and `__Host-` prefixed.

The live help (several people on one character) is a WebSocket on the same
port and process, at `/api/live/drafts/{id}`; there is no second port. The
proxy must pass WebSocket upgrades on to the web container (`Upgrade` and
`Connection` headers; in nginx `proxy_http_version 1.1`,
`proxy_set_header Upgrade $http_upgrade` and
`proxy_set_header Connection "upgrade"`; Caddy and Traefik do it on their
own) and keep idle connections open for at least a minute (the server pings
every 30 seconds). Live connections are kept in the one web process's
memory: run one web container, not several behind a load balancer.

## Contributing

**No rulebook text in this repository, including tests, fixtures and
screenshots. Develop against the demo package.**

- Code, identifiers, comments and commit messages are in English.
- Keep commits small; the message explains why, not only what.
- `pnpm check` must pass before every commit.
- No external fonts, CDNs, analytics or any other third-party resource in
  the browser.

### Working as a team

The shared checkout only ever has `main` checked out and is updated with
`git pull --ff-only`. Every task works in its own worktree
(`git worktree add ../wt-<task> -b <branch> origin/main`) or its own clone.
Remove the worktree as soon as the PR is merged (`git worktree remove <path>`,
then `git worktree prune`); a merged worktree left behind costs about 150 MB
of disk. If you find the shared checkout on another
branch, do not switch it; note it in your task and keep working in your own
worktree. `pnpm install`, builds and test runs happen only in your own
worktree, never in the shared checkout.

A review server for your worktree: `scripts/dev-server.sh [--packages DIR]`
(builds if needed, picks a free port from your agent's range, prints the
address once `/api/health` answers); `scripts/dev-server.sh stop` ends only
that server. Playwright uses the shared browsers in `PLAYWRIGHT_BROWSERS_PATH`
(set in the agent environment, `/paperclip/.ms-playwright` otherwise).

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, you must offer its source to its users.
