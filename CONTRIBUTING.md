# Contributing to Serene Pub

Serene Pub is community-driven, and bug fixes, features, and feedback are welcome. This guide covers how to get a development environment running and what to do before opening a pull request.

## Before You Start

For anything beyond a small fix, please [open an issue](https://github.com/doolijb/serene-pub/issues) or [start a discussion](https://github.com/doolijb/serene-pub/discussions) first. It's a lot easier to align on an approach before code is written than to rework a finished PR.

## Development Setup

### Requirements

- [Node.js](https://nodejs.org/en) 24 or later
- (Optional) [Ollama](https://ollama.com/download) or [KoboldCPP](https://github.com/LostRuins/koboldcpp) for testing against a real local model

### Steps

1. Fork and clone the repo
2. Clone the SDK repo (`serene-pub-sdk`) **beside** it, so the two folders are siblings. The app's `@serene-pub/*` packages resolve to `../serene-pub-sdk/<package>` through `file:` links
3. `npm i` to install dependencies, then `npm run sdk:build` to build the SDK packages (run it again after any change in the SDK repo)
4. `npm run dev` to start the dev server (or `npm run dev:host` to bind it for access from other devices on your network)
5. Visit [http://localhost:5173](http://localhost:5173)

The app runs against an embedded PGlite (Postgres-compatible) database by default — nothing else needs to be installed or running to get a working instance up.

## Project Structure

Serene Pub is a SvelteKit app. A few starting points if you're getting oriented:

- `src/lib/client/` — UI components, forms, and client-side socket handling
- `src/lib/server/` — server-side logic: socket handlers, connection adapters, pipelines (the SDK runner that makes replies, summaries and graph builds; see `src/lib/server/pipelines/README.md`), embeddings/RAG, plugins, and card sources (library + CharaVault)
- `src/lib/shared/` — types and utilities used by both client and server
- `src/lib/server/db/schema.ts` — the database schema (Drizzle ORM)
- `docs/` — the user-facing documentation, also served in-app via the built-in Docs browser

## Adding a Dependency

`dependencies` is what the **built server** loads from `node_modules` at runtime, and it is exactly what the desktop bundles and the Docker image ship. adapter-node leaves those imports external and bundles everything else into `build/`. Anything only the browser uses (icons, editors, UI widgets), and every build, test or type-only tool, goes in `devDependencies`. Svelte component libraries count as browser-only: Vite compiles them into the server build. Some packages are loaded by name or path at runtime, where no import statement in `build/` shows them: the in-app component compiler's toolchain, the plugin and script sandboxes, and PGlite through drizzle. Those stay in `dependencies`, and `scripts/prune-dist.test.ts` lists them.

## Database Changes

If your change touches `src/lib/server/db/schema.ts`, generate a migration rather than hand-writing one:

```bash
npm run db:generate
```

`npm run db:studio` opens Drizzle Studio if you need to inspect the local database directly.

A few things about the migration chain in `drizzle/` that generation will not tell you:

- `0000`–`0093` are Serene Pub 0.5.3's migrations and must stay byte-identical: an existing install's ledger is matched to them by file hash. `0095_schema_0_6_0` takes a 0.5.3 schema to 0.6's. Two files around it are hand-written: `0094_entry_keys_text`, a SQL function a generated column needs, and `0096_link_description_not_null` (a `db:generate --custom` slot), which closes a gap generation cannot see — 0.5.3 created that column nullable while its snapshots record `NOT NULL DEFAULT ''`. Everything after is generated.
- A new migration's index must be higher than the highest one already applied, or drizzle skips it silently — and a fresh test database cannot catch that. Check the journal's last entry before generating.
- Seed rows belong in `src/lib/server/db/defaults.ts` (the boot-time defaults sync), never in a migration, and never at a hard-coded id.
- Upgrading a 0.5.3 database is not done by migrations: its rows are set aside in an `attic_0_5_3` schema while `0095` runs, and the `attic` startup task brings them back in the 0.6 shape (`src/lib/server/attic/`). Its tests boot real 0.5.3 databases from `src/lib/server/db/fixtures/0.5.3/`.

## Before Opening a Pull Request

Run these from the repo root:

```bash
npm run check   # svelte-check — type errors and Svelte-specific diagnostics
npm run lint     # prettier --check — formatting
npm run test     # vitest — unit and integration tests
npm run sdk:test # the SDK suite, if you changed anything in serene-pub-sdk
```

`npm run format` (prettier --write) will fix most formatting issues automatically. If you're touching connection adapters, pipelines, or embeddings/RAG, add or update a test alongside the change where practical — see `src/lib/server/connectionAdapters/BaseConnectionAdapter.test.ts` for the existing style.

## Comments

A comment is for the reader of the code as it is now. It states something the code cannot: an
invariant, a constraint the shape depends on, or the reason this way was chosen over the obvious
one. Keep it to the present tense and to a few lines.

Leave out:

- **How it got here.** Which migration introduced a column, what a function did before, or the
  bug that prompted the change. That is the commit message's job, and `git log -p` keeps it.
- **Evidence.** Row counts, timings, and "on one save this happened". Numbers age silently; if a
  decision rests on a measurement, record the measurement under `docs/` and point at it.
- **Commentary on the comment.** "This is deliberate", "the whole reason this exists", "do not
  remove". State the rule the reader must not break; the rule is what makes the removal wrong.
- **Restating the line below it**, or listing parameters the signature already names.

When the reason really is a page, it belongs in `docs/` next to the feature it explains, with a
one-line pointer from the code. `src/lib/shared/conformance/commentHistory.test.ts` counts the
phrases that usually mark history ("used to", "until 0112", "previously") and only lets the count
go down. After you lower a file's count, `npm run comments:ratchet` records the new number; never run it to paper over a rise.

## Documentation

If your change affects user-facing behavior, update the relevant page under `docs/` in the same PR — that's the source both the in-app Docs browser and the website docs (`npm run docs:site`) are built from. Keeping docs and code in the same PR avoids the docs drifting out of sync with what actually shipped.

## Pull Requests

- Keep PRs focused — a bug fix doesn't need to carry an unrelated refactor along with it.
- Reference the issue or discussion it resolves, if any.
- Describe what changed and why, not just what files were touched.

## License

Serene Pub is licensed under AGPL-3.0 (see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md)). By contributing, you agree your contributions are licensed under the same terms.
