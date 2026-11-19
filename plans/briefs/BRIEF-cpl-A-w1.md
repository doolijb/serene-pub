# BRIEF — worker `cpl-A-w1` — one definition of the standard genre id (programme 3.6)

App repo `/home/jody/github/serene-pub`. Supervisor: lane `cpl-A`. SDK repo is read-only for you.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

(You need no `sdk:build`: do not run one.) Both repos are staged by the lead: run **no** git command that changes the index or the working tree (no add, reset, checkout, restore, stash, commit). Never `prettier --write`. No migration. Do not stop any running server or instance.

## Goal

A **removal of duplicates, with no behaviour change.** Story (`"core:genre/story"`) is the **standard genre**; its id is spelled in many places. Make it **one definition** that client and server both import. The name stays exactly `STANDARD_GENRE_ID` (NOMENCLATURE: "`STANDARD_GENRE_ID` is `core:genre/story`", ruled 2026-10-19). No new name is coined, no "fallback genre".

## Build

1. **New pure-constant file** `src/lib/shared/sessions/standardGenre.ts`: no imports at all; one export
   `export const STANDARD_GENRE_ID = "core:genre/story"` with a one-line doc (carry the existing doc: "The genre a session with none is read as — **Story** since 2026-10-19 (was Chat, which is the assistant now).").
2. `src/lib/server/pipelines/entities/sessionGenres.ts` line ~70: delete the local definition; **import** it from `$lib/shared/sessions/standardGenre` and **re-export** it (`export { STANDARD_GENRE_ID }`), so its ~40 existing importers keep working unchanged. Never the other way round (the shared file must not import sessionGenres). Do not touch anything else in sessionGenres.ts (`LEGACY_STANDARD_GENRE_ID*` stay).
3. Client re-exports **stay** (unlisted importers depend on them: `EventIdPage.svelte:40`, `EventsPage.svelte:27`, `routes/+page.svelte:82`, `EditSessionForm.svelte:10`):
   - `src/lib/client/components/sessionForms/createSession.svelte.ts:33`: replace the literal definition with an import from the shared file plus a re-export (the file uses it internally at ~204 and ~1092). `GUIDE_GENRE_ID` and the comment block above stay; adjust the comment so it no longer says "stated here rather than imported" for the standard genre.
   - `src/lib/client/components/sessionForms/editSessionForm.ts:46`: `export { STANDARD_GENRE_ID } from "$lib/shared/sessions/standardGenre"`; fix its comment the same way.
   - `src/lib/client/components/sessionPage/sessionPageData.svelte.ts:296`: compare against the imported constant instead of the literal.
4. Server literal sites — point at the constant (import from `$lib/shared/sessions/standardGenre`, unless the file already imports `STANDARD_GENRE_ID` from `sessionGenres`, then use that):
   - `src/lib/server/pipelines/registrations/resolve.ts:382`
   - `src/lib/server/pipelines/registrations/fit.ts:103`
   - `src/lib/server/pipelines/runtime/sessionEvents.ts:737` (already imports it at :69)
   - `src/lib/server/db/sessionLayoutPanels.ts:96` (`FALLBACK_GENRE`: replace the constant's value by the import, or replace its one use at :153 and delete `FALLBACK_GENRE` — your choice, say which)
   - `src/lib/server/sockets/sessions.layout.ts:60`
5. The three "falls back to Chat" sites (`"core:genre/chat"` literal):
   - `src/lib/server/sessions/annexViews.ts:55` and `:100`, `src/lib/server/sessions/annexInspect.ts:123`: **delete the dead `?? "core:genre/chat"`** — each returns early when the row is missing, and `sessions.genre_id` is NOT NULL with a Story default (`db/schema.ts:2588`), so the `??` can never fire. (If TypeScript says `genreId` may be null there, stop and report instead.)
   - `src/lib/server/pipelines/runtime/runTurn.ts:1613` (`session?.genreId ?? "core:genre/chat"`, reached only when the session row is gone): replace the Chat literal with `STANDARD_GENRE_ID`.
   Line numbers are from a read on 2026-11-17: re-find each by content.

## Files owned (edit nothing else)

`src/lib/shared/sessions/standardGenre.ts` (new), `src/lib/shared/sessions/standardGenre.test.ts` (new), `src/lib/server/pipelines/entities/sessionGenres.ts` (step 2 only), `createSession.svelte.ts`, `editSessionForm.ts`, `sessionPageData.svelte.ts`, `registrations/resolve.ts` (line 382 only), `registrations/fit.ts`, `runtime/sessionEvents.ts` (line 737 only), `db/sessionLayoutPanels.ts`, `sockets/sessions.layout.ts`, `sessions/annexViews.ts`, `sessions/annexInspect.ts`, `runtime/runTurn.ts` (line 1613 only).

## Out of scope — never touch

`src/lib/server/pipelines/runtime/host.ts` (another lane is editing it; its four Chat literals stay). `sessions/rewind.ts`, `turnYield.ts`, `actionsPush.ts`, `sessionSpeech.ts`. `attic/`, `db/dataUpgrades/`, `db/schema.ts` (historical/migration spellings stay literal). `admin/.../NewPage.svelte` (`CHAT` is the assistant genre on purpose). Any other `?? STANDARD_GENRE_ID` site (already right). NOMENCLATURE.md and docs (the supervisor does those). Lane `cpl-A-w2` is editing `sockets/summarize.ts`, `sessions/closeOut.ts`, `scenes/liveScenes.ts` and a new file under `pipelines/registrations/`: do not touch them.

## Stop and ask when

An import would create a cycle; the shared file would need any import; any site turns out to be reached by an ordinary session; anything would change behaviour; a new name seems needed.

## Tests

- New `src/lib/shared/sessions/standardGenre.test.ts`: pins `STANDARD_GENRE_ID === "core:genre/story"`.
- The one behavioural pin (exists, keep it unchanged): `src/lib/server/pipelines/entities/sessionGenres.int.test.ts` — a session whose genre is not loaded stays read-only (`sessionGenreAvailable`, ~510–553).
- Run exactly, one run at a time, after waiting for other vitest runs:
  `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/shared/sessions/standardGenre.test.ts src/lib/server/pipelines/entities/sessionGenres.int.test.ts src/lib/server/db/layoutPresets.int.test.ts > plans/cpl-A-w1.log 2>&1"`
  Never pipe vitest into `head`. Read the log with `tail`/`grep`.
- `npx prettier --check` on every file you changed (report pre-existing failures, don't fix them).
- Do **not** run tsc or `npm run check` (the supervisor does).

## Report

Reply with: changed files; per site what you did (replaced / dead branch deleted) and why; test results (counts); prettier results; anything noticed but not done. Under 300 words.
