# BRIEF — build lane `cpl-A` — one fallback genre; summarizers found by registration (programme 3.6 and 3.8)

Repos `/home/jody/github/serene-pub` (app); SDK `/home/jody/github/serene-pub-sdk` not expected to change.
Supervisor: read `.claude/guides/multi-agent.md`, then `plans/PLAN-core-genre-couplings-2026-11-17.md` §1 (its
table and "What moved"), §2 **3.6** and **3.8**, §3, §4 row `cpl-A` (**re-verify every file:line: the plan was
written from a read-only pass and has not been built against**), the programme's Phase 3 text
(`plans/PLAN-programme-2026-11-15.md`), `docs/genres.md`, `docs/summarization.md`, `NOMENCLATURE.md` §1, §24
and rows **fallback genre** / **standard genre**, **registration**, **close-out**, **summarize**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/cpl-A-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No SDK build, no full run, no
`npm run build`.

## Owner

Programme, Phase 3 (owner's ordered build list, 2026-11-15: "core stops special-casing genres"): "3.6 One
fallback genre." "3.8 Close out and summarize found by registration, not fixed keys." Principles: P2 (a module
owns its data; two writers of one thing is a bug), P5 (derived from the SDK), P6 (charters); "Genres expect,
never lock".

## 3.6 — one fallback genre

Story is the standard genre (`pipelines/entities/sessionGenres.ts:70` `STANDARD_GENRE_ID`; the column default
`db/schema.ts:2588`), but eight places still fall back to **Chat**, which has been the assistant genre since
2026-10-19 (`sessions/annexViews.ts` 55, 100; `sessions/annexInspect.ts` 123; `pipelines/runtime/runTurn.ts`
1613; `host.ts` 4849, 4869, 4936, 4992), and five places spell a genre id literally
(`registrations/resolve.ts` 382, `fit.ts` 103, `sessionEvents.ts` 737, `db/sessionLayoutPanels.ts` 96,
`sockets/sessions.layout.ts` 60; client copies `createSession.svelte.ts` 33, `editSessionForm.ts` 46,
`sessionPageData.svelte.ts` 296).

Build: **one export** of the fallback genre id in `$lib/shared` (usable by client and server; it re-exports or
equals `STANDARD_GENRE_ID`: one definition, the other imports it; mind `defaults.ts` import rules: leaf imports
only), and every site above imports it. **For each of the eight Chat fallbacks, first establish what the
fallback is for and what a session reaching it gets today** (a session whose genre does not resolve: a plugin
genre not loaded, a withdrawn genre): moving it from Chat to Story **changes behaviour for such a session**
(which annex views, which specs it runs). List each site: when it is reached → today (Chat) → after (Story) →
what a person would see differently. If any site is reached by ordinary sessions (not only by an unresolved
genre), **stop on that site and report**: that is not a fallback. Tests: each site with an unresolved genre;
shipped genres unchanged; spec hashes unchanged.

## 3.8 — summarizers found by registration

Close out is already found by registration. World and character summaries are found by the core spec's exact
identity; the scene summarizer by `GenreDecl.summarize.scene` (plan §1 table), so a genre's own world or
character summarizer under another spec slug is never found, and the scene path ignores the registration
genres already make (`core-catalog/src/genres/defaults.ts` 187–194).

Build: one helper `summarizerOf(db, sessionId, kind)` (name by §24, ★): the session's **effective action
registration** whose key is `summarize-<kind>` (or `close-out`), mode not off; `sockets/summarize.ts`,
`sessions/closeOut.ts` and `resolveSummarizeSceneSpec` (`scenes/liveScenes.ts` ~1774–1890: touch only that
function) read it. The scene path falls back to the genre's declaration, then core's spec, as today, so every
shipped genre resolves **exactly the spec it resolves today** (each declares and registers the same one):
prove it per genre and kind in a table test. **Do not retire `GenreDecl.summarize.scene`** (a published name:
the owner's call; list it as ★3.8-B).

## Stop and ask when

CLAUDE.md §Decisions applies; any shipped genre would resolve a different spec for any kind; a spec hash
moves; a Chat fallback is reached by ordinary sessions; the shared export would create an import cycle or make
`defaults.ts` import a non-leaf module.

## Tests

3.6: per site (above). 3.8: the per-genre × kind table; a session with a routine / action registration
switched off resolves none (as today?: state what today does and keep it); a custom genre registering its own
world summarizer under another slug is found (new: a fixture genre). Existing pins:
`sockets/summarize.registrations.int.test.ts` 98, 114, 126; `sockets/scenes.live.int.test.ts` 659–690;
`sockets/sessions.closeOut.int.test.ts` 233; `db/layoutPresets.int.test.ts`; `pipelines/boot/specHashes.test.ts`
(unchanged). Both prompt baselines byte-identical. `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

The new shared export, the 3.6 sites listed, `sessions/closeOut.ts`, `sockets/summarize.ts`,
`scenes/liveScenes.ts` (`resolveSummarizeSceneSpec` only), the helper's home (beside the registrations
resolve code), their tests, `docs/genres.md` / `docs/summarization.md` (one sentence each if needed),
`NOMENCLATURE.md` §25. Workers: one for 3.6, one for 3.8 (no shared files); briefs
`plans/briefs/BRIEF-cpl-A-w<n>.md`.

## Report

Final message = the report (lead saves `plans/REPORT-cpl-A-<date>.md`): 3.6 the table of sites (when reached →
before → after → seen); 3.8 the helper and the per-genre table; names (★); what was left (★3.8-B);
**Noticed, not done**. Under about 550 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**3.6 is a removal of duplicates, not a behaviour change, and it does not touch `host.ts`.**

1. **The word and the direction.** NOMENCLATURE calls this the **standard genre** (`NOMENCLATURE.md:3118`:
   "`STANDARD_GENRE_ID` is `core:genre/story`", ruled 2026-10-19); there is no "fallback genre" and no new name
   is coined. The definition lives in a **new pure-constant file in `$lib/shared`**;
   `pipelines/entities/sessionGenres.ts` (which imports the SDK and server modules) **re-exports** it, never the
   other way round; the client's existing re-exports stay (`createSession.svelte.ts` holds
   `STANDARD_GENRE_ID` and `GUIDE_GENRE_ID` per `NOMENCLATURE.md:2464`; unlisted importers depend on that:
   `EventIdPage.svelte:40`, `EventsPage.svelte:27`, `routes/+page.svelte:82`); update row 2464 in the same
   change.
2. **The "falls back to Chat" sites never see an unresolved genre.** `genre_id` is NOT NULL with a Story
   default (`db/schema.ts:2588`); `sessions/annexViews.ts` 55 / 100 and `annexInspect.ts:123` return early when
   the row is missing, so the `??` after them is dead code; `runTurn.ts:1613` and `host.ts` 4849 / 4869 fire
   only when the session row is gone. A session whose plugin genre is not loaded keeps its genre id and is
   read-only (`sessionGenres.ts` 686–700). So: in `annexViews.ts`, `annexInspect.ts` and `runTurn.ts`, replace
   the Chat literal with the shared constant **or delete the dead branch** (say which per site and why);
   **leave `host.ts` alone** (4849 / 4869 are trivial and stay for a later lane; **4936 and 4992 are not
   fallbacks**: a lorebook-level run has no session and gets Chat's annex fields, where the SDK defines "With
   no genre … every field", `sdk/src/annexFields.ts` 373–386: reported as ★, not changed). The five server
   literal sites already say Story: point them at the constant. Replace "tests: each site with an unresolved
   genre" with **one pin**: a session whose genre is not loaded stays read-only (`sessionGenreAvailable`),
   unchanged.
3. **3.8: the summarize kinds do not filter on mode.** Today `sockets/summarize.ts` 207–213 →
   `resolveSubjectVerdict` → `onAction` (`registrations/resolve.ts:457`) matches on identity only and ignores
   mode; a switched-off registration stays in the effective list with `mode: 'off'`
   (`sdk/src/registrations.ts:997`); so a world or character summary runs even when switched off, the scene
   summarizer ignores registrations, and only close-out filters off (`sessions/closeOut.ts` 25–27). The helper
   keeps exactly that: for `summarize-<kind>` it returns the registration **whatever its mode**; close-out
   keeps its filter. Whether "off" should refuse a pressed Summarize is ★ in the report, not built. The helper
   also returns the registration's **key and `minAge`** (pinned at
   `sockets/summarize.registrations.int.test.ts` 105–109).
4. **`resolveSummarizeSceneSpec` has more readers.** Through `sessionBoundaryTriggers`
   (`scenes/liveScenes.ts` 1882–1888) it feeds the offered scene cues (`scenes/boundaryWatcher.ts:1128`) and
   scene settings (`scenes/sceneSettings.ts` 55, 178); `resolveSummarizeSceneSpecOfGenre` (the genre listing,
   `sockets/sessions.pipelines.ts` 69–77) reads the declaration. Make `…OfGenre` follow the same rule through
   `genreRegistrations` (`registrations/resolve.ts:445`) so there is one answer, and test that cues, settings
   and the listing are unchanged for every shipped genre. Expected per-genre table: Story, Guide, the Lair and
   Dungeon Crawler each resolve their own declared spec; Chat declares none and resolves core's.
5. Files: `host.ts` is **out** of Files owned.
