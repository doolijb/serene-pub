# Contributing to Serene Pub

Serene Pub is community-driven, and bug fixes, features, and feedback are welcome. This guide covers how to get a development environment running and what to do before opening a pull request.

## Before You Start

For anything beyond a small fix, please [open an issue](https://github.com/doolijb/serene-pub/issues) or [start a discussion](https://github.com/doolijb/serene-pub/discussions) first. It's a lot easier to align on an approach before code is written than to rework a finished PR.

## Development Setup

### Requirements

- [Node.js](https://nodejs.org/en) 24 or later; 26 matches the release bundles, the Docker image and CI
- (Optional) [Ollama](https://ollama.com/download) or [KoboldCPP](https://github.com/LostRuins/koboldcpp) for testing against a real local model

### Steps

1. Fork and clone the repo
2. `npm i` to install dependencies. The `@serene-pub/*` SDK packages come from npm, at the exact version `package.json` pins
3. `npm run dev` to start the dev server (or `npm run dev:host` to bind it for access from other devices on your network)
4. Visit [http://localhost:5173](http://localhost:5173)

The app runs against an embedded PGlite (Postgres-compatible) database by default — nothing else needs to be installed or running to get a working instance up.

`npm run build` also needs the SDK's guides, which the in-app docs compile and no npm package carries: clone [serene-pub-sdk](https://github.com/SerenePub/serene-pub-sdk) **beside** this repo, so the two folders are siblings (`git clone --branch v<pinned version> https://github.com/SerenePub/serene-pub-sdk.git ../serene-pub-sdk`), or point `SERENE_PUB_SDK_DIR` at a checkout. Without it the docs compile stops on links to the guides. The dev server logs that and carries on.

### Working on the SDK and the app together

With `serene-pub-sdk` checked out beside this repo:

1. In `serene-pub-sdk`: `npm i`, then from this repo `npm run sdk:build` to build its packages
2. `npm run sdk:link` swaps the installed `node_modules/@serene-pub/*` for symlinks to `../serene-pub-sdk/<package>`. `package.json` is not touched, and it warns when the checkout's version differs from the pinned one (CI and releases always install the pinned version)
3. After an SDK change, `npm run sdk:build` again, with the dev server stopped. Linked packages resolve to the SDK's built `dist/`
4. To go back to the published copies, `npm run sdk:unlink` (it removes the links, never the checkout), then `npm install`. A plain `npm install` keeps a link while the checkout's version matches the pin, and replaces it with the published copy once they differ

`SERENE_PUB_SDK_DIR` links a checkout somewhere else.

## Project Structure

Serene Pub is a SvelteKit app. A few starting points if you're getting oriented:

- `src/lib/client/` — UI components, forms, and client-side socket handling
- `src/lib/server/` — server-side logic: socket handlers, connection adapters, pipelines (the SDK runner that makes replies, summaries and graph builds; see `src/lib/server/pipelines/README.md`), embeddings/RAG, plugins, and card sources (library + CharaVault)
- `src/lib/shared/` — types and utilities used by both client and server
- `src/lib/server/db/schema.ts` — the database schema (Drizzle ORM)
- `docs/` — the user-facing documentation, also served in-app via the built-in Docs browser

## Adding a Dependency

`dependencies` is what the **built server** loads from `node_modules` at runtime, and it is exactly what the desktop bundles and the Docker image ship. adapter-node leaves those imports external and bundles everything else into `build/`. The `@serene-pub/*` packages are the exception: `vite.config.ts` bundles them into `build/` whether installed or linked, and they stay in `dependencies` because the component compiler loads the CLI by path at runtime. Pin each one to the same exact version, never a range: there is no lockfile, so a range drifts to the next SDK pre-release. Anything only the browser uses (icons, editors, UI widgets), and every build, test or type-only tool, goes in `devDependencies`. Svelte component libraries count as browser-only: Vite compiles them into the server build. Some packages are loaded by name or path at runtime, where no import statement in `build/` shows them: the in-app component compiler's toolchain, the plugin and script sandboxes, and PGlite through drizzle. Those stay in `dependencies`, and `scripts/prune-dist.test.ts` lists them.

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

## Releases

Every release is built by GitHub Actions from a tag; nothing is built on a developer's machine.

1. **SDK first.** Tag `v<version>` in [serene-pub-sdk](https://github.com/SerenePub/serene-pub-sdk). Its `publish.yml` publishes the packages to npm (under `next` for a pre-release) and makes its GitHub release. See its `RELEASING.md`.
2. **Pin it here.** Set every `@serene-pub/*` entry in `package.json` to that exact version, set the app's `version`, and add `docs/release-notes/<version>.md` if the release has notes.
3. **Tag the app** `v<version>` and push the tag. Three workflows build from it and attach to one GitHub release, which whichever starts first creates as a draft:
    - `release.yml`: the desktop zips for Windows, macOS (Intel and Apple chip) and Linux, each with its launcher, `.zip.sha256` and `SHA256SUMS`. When every desktop build has succeeded it publishes the draft. A failed target leaves it a draft.
    - `docker.yml`: the `linux/amd64` and `linux/arm64` image on `ghcr.io`, plus a `docker-compose.yml` pinned to it.
    - `build-android.yml`: the APK. It is signed only when the `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets are set. Otherwise it is uploaded as `…-android-unsigned.apk`, which Android will not install.

The release body is `docs/release-notes/<version>.md` with its links pointed at the tag, or GitHub's generated notes when there is none. A plain `vX.Y.Z` is a release. Any suffix (`-pr-N`, `-rc-N`, `-alpha`, `-beta`, `-dev`) makes a pre-release, which never becomes the repository's "Latest" release or the Docker `latest` tag, and whose launcher never updates itself (`scripts/release-meta.mjs`).

## Pull Requests

- Keep PRs focused — a bug fix doesn't need to carry an unrelated refactor along with it.
- Reference the issue or discussion it resolves, if any.
- Describe what changed and why, not just what files were touched.

## License

Serene Pub is licensed under AGPL-3.0 (see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md)). By contributing, you agree your contributions are licensed under the same terms.
