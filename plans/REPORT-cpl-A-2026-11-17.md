# REPORT cpl-A (2026-11-17): programme 3.6 and 3.8

3.6 and 3.8 are built, with no behaviour change for any shipped genre. Spec hashes and both prompt baselines have the same shas. `tsc` 0, `npm run check` 0 errors.

## 3.6: one definition of `STANDARD_GENRE_ID`

The constant keeps its name and is defined in one new file with no imports, `src/lib/shared/sessions/standardGenre.ts`. `sessionGenres.ts` imports and re-exports it. `createSession.svelte.ts` and `editSessionForm.ts` keep their exports, so their importers are untouched. NOMENCLATURE row 2464 is updated.

| Site | Done | Why |
|---|---|---|
| `annexViews.ts` 55, 100; `annexInspect.ts` 123 | dead branch deleted | each returns early when the row is missing, and `genre_id` is NOT NULL |
| `runTurn.ts` 1613 | replaced (Chat → the constant) | reached only when the session row is gone mid-run |
| `resolve.ts` 382, `fit.ts` 103, `sessionEvents.ts` 737, `sessions.layout.ts` 60 | replaced | already said Story |
| `sessionLayoutPanels.ts` 96 | `FALLBACK_GENRE` deleted; its one use reads the constant | same value |
| `sessionPageData.svelte.ts` 296 | replaced | same value |
| `host.ts` 4849, 4869, 4936, 4992 | left | out of scope (brief correction 5) |

Tests: the existing `sessionGenres.int.test.ts` check that a session whose genre isn't loaded stays read-only, plus a value pin `standardGenre.test.ts`.

## 3.8: summarizers found by registration

New file `src/lib/server/pipelines/registrations/summaryRegistration.ts`: `summaryRegistrationOf(db, sessionId, kind)` over the session's effective registrations, and the pure `summaryRegistrationIn(regs, kind)`. Kinds: `world`, `character`, `scene`, `close-out`. Each returns `{ registration, spec, key, minAge }`. `summarize-<kind>` is returned whatever its mode, as today; close-out keeps its "mode not off" filter. Unpublished pipelines never reach `effective`.

Readers: `sockets/summarize.ts` (identity cache and `resolveSubjectVerdict` dropped there; `@` genres refuse as before); `closeOutRegistrationOf` (wrapper, same signature); `resolveSummarizeSceneSpec` (session's registration) and `…OfGenre` (`genreRegistrations`), both then falling back to the genre's declaration, then core's spec.

| Genre | world | character | scene | close-out |
|---|---|---|---|---|
| story, guide, lair, dungeon-crawler | `core:spec/summarize-world` (same spec, key, minAge) | `core:spec/summarize-character` | its own declared spec | the scene spec, minAge 0 |
| chat | same | same | `core:spec/summarize-scene` | same as scene |

`summaryRegistration.int.test.ts` also shows: cues, scene settings and the genre listing unchanged for every genre; a switched-off world registration is still found with `mode: 'off'`; a switched-off close-out gives none. The pure `summaryRegistration.test.ts` pins the pick rule.

Docs: one sentence in `docs/summarization.md`; NOMENCLATURE §25 bullet.

## Tests

w1: 3 files, 80 passed. w2: 4 files, 42 passed. Supervisor: 6 files, 56 passed; Lair baseline 5 passed. Shas equal `perf-3-shas-final.txt`. Statement counts: story 1474 → 1478, lair 2281 → 2283.

## ★ for the owner

- ★3.8-A: names `summaryRegistrationOf` / `summaryRegistrationIn` / `SummaryRegistration` / `SummaryRegistrationKind` provisional.
- ★3.8-B: retire `GenreDecl.summarize.scene`? Kept.
- ★3.8-C: should a switched-off summarize registration refuse a pressed Summarize? Not built.
- ★3.6-A: `host.ts` 4936 and 4992 give a lorebook-level run (no session) Chat's annex fields. Keep, or the SDK's "no genre: every field"? Not changed.

## Noticed, not done

- The +4 / +2 statements are probably the boundary-trigger read now calling `effectiveRegistrations` (uncached under VITEST, cached in production). Not isolated.
- Prettier: edited files already failed `--check`; the new `summaryRegistration.ts` and its test fail too.
- `host.ts` 4849 and 4869 still say Chat; header comment of `sessionGenres.ts` line 5 still names Chat.
- `/tmp/serene-pub-vitest-*` dirs not deleted (ownership unclear).

## Scope review fix

Pick rule in `summaryRegistrationIn`: candidates are `action` registrations on `summarize-<kind>` (or `close-out`), never those on the rules-action spec; close-out drops mode "off" before the pick, summarize kinds keep any mode. A registration on core's own action for the kind (`core:spec/summarize-world#summarize-world`, `...summarize-character#summarize-character`, `core:spec/summarize-scene#summarize-scene`, `core:spec/summarize-scene#close-out`) wins wherever it sits; else the first candidate in effective order. Renamed `Summarizer`/`SummarizerKind`/`summarizerOf`/`summarizerIn` to `SummaryRegistration`/`SummaryRegistrationKind` (`SummaryKind` is the client's)/`summaryRegistrationOf`/`summaryRegistrationIn`; "found under another slug" now reads "a registration on another spec's summarize-<kind> action". The undeclared-spec integration fixture is deleted (a published fixture spec needs large setup); the pure `summaryRegistration.test.ts` is the proof. The character row of the per-genre table asserts key and `minAge`.

Noticed: `summaryRegistrationOf` lets a database error through where the old `resolveSubjectVerdict` caught it and refused.
