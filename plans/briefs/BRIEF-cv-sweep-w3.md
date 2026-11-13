# BRIEF cv-sweep-w3 — follow-ups on the relational-read move (dispatch fixture, adapter bindings, prompt/adapter tests)

Read `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-sweep-wcommon.md` first; its rules bind you.

## Context
Worker w2 moved the relational whole-card reads in `sockets/sessions.ts`, `sockets/pipelines.ts` and `pipelines/runtime/dispatch.ts` onto `cardsNow` (`src/lib/server/cast/seatedCast.ts`: a card as its current card version has it — the frozen content columns on `characters` / `lorebook_bindings` are stale since S4; owner ruling 2026-11-05: "Everything in session is cast -> active card."). Read its code first: `putCardsNow` and `BINDING_FROZEN_OFF` in `sockets/sessions.ts` (~572–660, and its call sites ~437, ~1916, ~2044–2100, ~6767, ~6907), and `loadAdapterSession` in `dispatch.ts` (~417–530). Three things are left.

## Files owned
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatch.ts` — only `loadAdapterSession` and its `BINDING_FROZEN_OFF`, plus adding `export` to `loadAdapterSession`.
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts` — ONLY adding `export` to `getPromptSessionFromDb` (or whatever the prompt-session loader near ~1900 is called). Nothing else in this shared file.
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatch.int.test.ts` — only the `fakeDb` fixture (or a `vi.mock` at its top).
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.cardsNowReads.int.test.ts` (w2's new test) — add cases.
- A new test file if you prefer, e.g. `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatch.cardsNow.int.test.ts`.

## What to do
1. **Revert one unasked change in `loadAdapterSession`.** w2 added `with: { character: true }` to the adapter's `lorebook.lorebookBindings` (before, it was `lorebookBindings: true` with no `character` relation) and overlays `cardsNow` on it. That changes the adapter session's shape (a binding now carries `.character`, which name-substitution code may read) — not asked. Keep the narrowing (`columns: BINDING_FROZEN_OFF`, so frozen binding columns are not loaded) but drop the `character` relation and the bindings leg of the `cardsNow` call / overlay. Seats and personas stay as w2 wrote them.
2. **`dispatch.int.test.ts` (★ from w2, ruled by the supervisor: fix the fixture).** 49 of 57 tests fail because `fakeDb` has no `selectDistinctOn` / `query.characterVersions`, which `cardsNow` now needs. Make the fixture serve the new read so **every existing expectation stays as it is** (the cards read as before, "Alice" / "Bob"): either extend `fakeDb` (w2's suggestion: a thenable `where()`, `selectDistinctOn`, `query.characterVersions`) or a `vi.mock` of `$lib/server/cast/seatedCast` whose `cardsNow` answers the fixture's cards — choose the less invasive, name your choice. Do not edit any `expect`.
3. **Pin the move on the two private loaders (★ from w2, ruled: export them as test seams).** Add `export` to `loadAdapterSession` (dispatch.ts) and to the prompt-session loader in `sessions.ts` (a one-word change each; a JSDoc line "exported for tests" is fine). Real-DB int tests (60 s timeouts): a card with a newer card version (`newCardVersion` from `characters/versions.ts`) whose `characters` row still holds OLD stale text written straight into the frozen/copy columns by the fixture —
   - prompt session: a live seat with no cast member reads the new version's name / description / a greeting / post-history; a removed seat's card reads the new name; `lorebook.lorebookBindings[*]` rows carry no frozen binding column (e.g. `retold`, `personality` absent) and their `character` reads the new version;
   - adapter session: a seat with no cast member reads the new version; its bindings carry no frozen column and no `character`.
   If either loader needs `bootstrapPipelines` and that fails with "core binds a handler to core:query/cast-member@1 … which no type in this build declares" (another lane's SDK change is in flight), write the test anyway, record it as **blocked on cv-sdk**, and say exactly which file fails at load.

## Tests to run
`pipelines/runtime/dispatch.int.test.ts` (all 57 green), your new/extended tests, `sockets/sessions.cardsNowReads.int.test.ts`, `pipelines/prompt/seatCards.int.test.ts`, `characters/frozenColumns.guard.test.ts`, `characters/versionsWriter.guard.test.ts`.

## Out of scope
Any other site, any other relational read (Noticed), host.ts, client, docs.

## Stop and ask when
An existing `expect` would change; a downstream reader turns out to need the adapter bindings' `character`; you need another file.

## Done means
Tests green (or explicitly blocked on cv-sdk, with the failing load named), `tsc` clean on your files, prettier clean on your hunks. Report per the common brief, starting `# REPORT cv-sweep-w3`.
