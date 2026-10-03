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
- **We collect nothing.** Stored data is limited to an email address, a
  password hash, settings and character data. No tracking, no analytics, no
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

## Running with Docker Compose

```sh
cp .env.example .env    # fill in POSTGRES_PASSWORD, BASE_URL, SMTP_*
# put content packages into ./packages-mount
docker compose up -d --build
```

The web container applies pending migrations on start, then serves on
`WEB_PORT` (default 3000). `GET /api/health` reports liveness. To swap a
content package, replace its files in `./packages-mount` and run
`docker compose restart web`.

## Contributing

**No rulebook text in this repository, including tests, fixtures and
screenshots. Develop against the demo package.**

- Code, identifiers, comments and commit messages are in English.
- Keep commits small; the message explains why, not only what.
- `pnpm check` must pass before every commit.
- No external fonts, CDNs, analytics or any other third-party resource in
  the browser.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, you must offer its source to its users.
