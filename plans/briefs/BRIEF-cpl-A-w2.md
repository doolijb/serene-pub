# BRIEF — worker `cpl-A-w2` — summarizers found by registration (programme 3.8)

App repo `/home/jody/github/serene-pub`. Supervisor: lane `cpl-A`. SDK repo `../serene-pub-sdk` is **read-only** for you (read `core-catalog/src/genres/defaults.ts`, `core-catalog/src/registry/genres.ts`, `sdk/src/registrations.ts`, `sdk/src/identity.ts` as needed).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: do not run one.) Both repos are staged by the lead: run **no** git command that changes the index or the working tree (no add, reset, checkout, restore, stash, commit). Never `prettier --write`. No migration. Inside `db.transaction(async (tx) => …)` use only `tx`. Do not stop any running server or instance.

## Goal (no behaviour change for any shipped genre)

Today three paths find a summarizer three ways (all app paths under `src/lib/server/`):
- **close-out**: by registration key — `sessions/closeOut.ts` 17–31 `closeOutRegistrationOf`: the session's effective `action` registration whose `parseActionIdentity(trigger.action).key === closeOutAction.key`, **mode not "off"**.
- **world / character**: by the core spec's **exact identity** — `sockets/summarize.ts` 16–29 (`summarizeActionIdentities`) and ~204–222 → `resolveSubjectVerdict` (`pipelines/entities/sessionGenres.ts:1025`) → `onAction` (`registrations/resolve.ts:457`), identity match only, **mode ignored** (a switched-off registration stays in the effective list with `mode: 'off'`, so the summary still runs). So a genre's own world summarizer under another spec slug is never found.
- **scene**: by the declaration `GenreDecl.summarize.scene` — `scenes/liveScenes.ts` ~1783–1838 `resolveSummarizeSceneSpec` / `resolveSummarizeSceneSpecOfGenre`, else core's `DEFAULT_SUMMARIZE_SCENE_SPEC_ID`, with a `note` when the declared spec is not published. Registrations are ignored.

Every shipped genre registers, through `summaries(scene)` in `core-catalog/src/genres/defaults.ts` 177–194, the core world/character specs on actions keyed `summarize-world` / `summarize-character`, and its scene spec on `summarize-scene` and `close-out` (minAge 0). Story, Guide, the Lair and the Dungeon Crawler each register the same scene spec they declare; Chat declares none and registers core's `summarizeSceneSpec()`.

## Build

1. **New file** `src/lib/server/pipelines/registrations/summarizer.ts` (beside the registrations resolve code), two exports (names provisional, the supervisor marks them ★):
   - `summarizerIn(regs: readonly EffectiveRegistration[], kind)` — pure: the first `action` registration whose `parseActionIdentity(trigger.action)?.key` is `summarize-<kind>` (kind `world` · `character` · `scene`) or `closeOutAction.key` (kind `close-out`). For `summarize-<kind>` it returns the registration **whatever its mode** (keeps today's behaviour); for `close-out` it keeps today's filter **mode not "off"**. Returns `{ registration, spec: registration.pipeline, key: registration.key, minAge: minAgeOf(registration) } | null` (`minAgeOf` from `@serene-pub/sdk`, as `sessionGenres.ts` imports it). Type the kind as a union `"world" | "character" | "scene" | "close-out"`: no `history` (nobody asked).
   - `summarizerOf(db, sessionId, kind)` — `summarizerIn((await effectiveRegistrations(db, sessionId))?.effective ?? [], kind)`.
   Check whether `effective` ever holds a registration whose pipeline is not published (see `mergeLayers` / `stale` in `registrations/resolve.ts` ~240–280) and say what you found.
2. `sessions/closeOut.ts`: `closeOutRegistrationOf` keeps its name, signature and result (its callers in `sockets/sessions.shared.ts` and `sockets/sessionArchive.ts` are not yours) and becomes `(await summarizerOf(db, sessionId, "close-out"))?.registration ?? null`. Drop imports that become unused.
3. `sockets/summarize.ts`: replace the `summarizeActionIdentities` cache and the `resolveSubjectVerdict` call by `summarizerOf(db, sessionId, loreType)`; same refusal sentences when null; `specId = found.spec`, `registration: { family: "action", key: found.key, minAge: found.minAge }`. Before replacing, confirm what `resolveSubjectVerdict` does for a genre id containing `@` (`transitionalSubject`) with an action identity: if it could return a spec there, stop and report rather than change it.
4. `scenes/liveScenes.ts` — touch only `resolveSummarizeSceneSpec` and `resolveSummarizeSceneSpecOfGenre` (and a private helper you extract from them); another lane owns the rest of this file.
   - Session: the session's `summarizerOf(db, sessionId, "scene")` → its spec; none → the genre's **declaration** path exactly as today (incl. the `note`) → core's default.
   - Genre (`…OfGenre`, read by the genre listing `sockets/sessions.pipelines.ts` 69–77 through `genreBoundaryTriggers`): `summarizerIn(await genreRegistrations(db, genreId), "scene")` (`registrations/resolve.ts:445`) → its spec; none → the declaration path as today → core's default.
   - Extract today's declaration-reading body into one private function both use; behaviour for the `null` session / `null` genre cases unchanged. Update the doc comments to say registration first, then declaration, then core. **Do not retire or rename `GenreDecl.summarize.scene`** (published name).
   - Readers that must stay identical: `sessionBoundaryTriggers` → offered scene cues (`scenes/boundaryWatcher.ts:1128`) and scene settings (`sessions/sceneSettings.ts` 55, 178); `sockets/scenes.ts:2178`.

## Files owned (edit nothing else)

`src/lib/server/pipelines/registrations/summarizer.ts` (new) and its test(s) (new, e.g. `summarizer.int.test.ts` beside it), `src/lib/server/sessions/closeOut.ts`, `src/lib/server/sockets/summarize.ts`, `src/lib/server/scenes/liveScenes.ts` (the two functions only), and these existing tests if a pin must be extended (never weakened): `sockets/summarize.registrations.int.test.ts`, `sockets/scenes.live.int.test.ts`, `sockets/sessions.closeOut.int.test.ts`.

## Out of scope — never touch

`pipelines/runtime/host.ts`, `sessions/rewind.ts`, `turnYield.ts`, `actionsPush.ts`, `sessionSpeech.ts` (another lane). `registrations/resolve.ts`, `entities/sessionGenres.ts` (read only; lane `cpl-A-w1` edits lines in them). The SDK. NOMENCLATURE.md and docs (the supervisor does those). Whether a switched-off summarize registration should refuse a pressed Summarize: **not built** (a ★ for the owner).

## Stop and ask when

Any shipped genre would resolve a different spec for any kind; a spec hash moves; you need a new event, setting, table, migration or SDK change; `transitionalSubject` resolves action identities.

## Tests (new file `src/lib/server/pipelines/registrations/summarizer.int.test.ts`; boot with `bootstrapPipelines` like `sockets/summarize.registrations.int.test.ts`; 60 s timeouts on DB tests)

1. **Per-genre × kind table**: for each shipped genre — `core:genre/story`, `core:genre/chat`, `core:genre/guide`, the Lair and the Dungeon Crawler (find their ids in `core-catalog/src/registry/genres.ts`) — and each kind world · character · scene · close-out, make a session and assert `summarizerOf(...).spec` **equals what today's mechanism gives**: world/character = `resolveSubjectVerdict(db, genreId, <core identity>, { sessionId }).spec` (it still exists) and the expected literal (`core:spec/summarize-world` / `-character`); scene = `resolveSummarizeSceneSpec(db, sessionId).specId` equals the declared `getGenre(id).summarize?.scene ?? DEFAULT_SUMMARIZE_SCENE_SPEC_ID` and equals `resolveSummarizeSceneSpecOfGenre(db, genreId).specId`; close-out = the same scene spec. Expected: Story, Guide, the Lair and the Dungeon Crawler each their own declared spec; Chat core's.
2. **Cues, settings and listing unchanged**: per shipped genre, `sessionBoundaryTriggers(db, sessionId)` and `genreBoundaryTriggers(db, genreId)` deep-equal `boundaryTriggersOfSpec(db, <declared-or-default spec>)`.
3. **Switched off**: a session whose `summarize-world` registration is switched off (a session-scope change row with `mode: 'off'`; find how existing tests write one, e.g. grep `mode: "off"` in `pipelines/registrations/*.int.test.ts` / `sessions/settingsForm.int.test.ts`) still resolves it (today's behaviour, kept); with `close-out` switched off, `closeOutRegistrationOf` and `summarizerOf(..,"close-out")` return null.
4. **Fixture genre** (new behaviour): a test genre whose genre-scope registrations register its own world summarizer under another, published spec slug (action key `summarize-world`) is found by `summarizerOf`, and a world summary through `sessionsSummarizeHandler` runs that spec (mock `runSpec` as `summarize.registrations.int.test.ts` does, or put this case in that file). Find how other tests write genre-scope registration rows (`grep -rln 'scopeKind: "genre"' src/lib/server --include=*.test.ts`).
5. Existing pins must pass unchanged: `sockets/summarize.registrations.int.test.ts` (98, 114, 126: spec, key, minAge), `sockets/scenes.live.int.test.ts` 659–690, `sockets/sessions.closeOut.int.test.ts` 233.

Run exactly, one run at a time, after waiting for other vitest runs:
`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/registrations/summarizer.int.test.ts src/lib/server/sockets/summarize.registrations.int.test.ts src/lib/server/sockets/scenes.live.int.test.ts src/lib/server/sockets/sessions.closeOut.int.test.ts > plans/cpl-A-w2-<n>.log 2>&1"`
Never pipe vitest into `head`; read logs with `tail`/`grep`. `npx prettier --check` on every changed file. Do not run tsc or `npm run check` (the supervisor does).

## Report

Changed files; the helper's signature; what `effective` holds for unpublished pipelines; `transitionalSubject` finding; the per-genre × kind table as the test asserts it; test counts; prettier; anything noticed but not done. Under 400 words.
