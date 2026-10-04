# @builder/format

Zod schema, types and validator of the content package format. Every
package the builder loads is validated against it at start; invalid
packages are rejected with a clear message.

- **[SPEC.md](SPEC.md)** — the specification. Read this to write a package.
- `src/schema.ts` — Zod schemas and TypeScript types, one per package file.
- `src/validate.ts` — cross-file rules; `validatePackageDir(dir)`.
- `src/expr.ts` — parser for conditions and formulas (the rule core evaluates).
- `src/template.ts` — parser for placeholders in texts.
- `src/units.ts` — `convertAmount`: table-based unit conversion.
- `test-fixtures/broken-package` — a deliberately invalid package for tests.

```sh
pnpm validate-package packages/demo-package
pnpm validate-package path/to/package --strict   # warnings fail too
```

Current format version: **0.4** (`PACKAGE_FORMAT_VERSION`).
