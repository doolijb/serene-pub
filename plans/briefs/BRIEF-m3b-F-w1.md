# BRIEF m3b-F-w1 — the list row's `provided` names its plugin (server)

Lane **m3b-F**, worker 1 of 2. Supervisor: the m3b-F lane-supervisor. Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (No SDK edit is in scope: you should never need `sdk:build`.)

## Goal
Owner ruling 2026-11-05: a member's provided lorebook row (a plugin's book, readable pub-wide since m3-core) must say **"Comes with Mundi"** — the plugin's name — not "From admin". The client (worker 2) draws the words; you give the `lorebooks:list` row the plugin's display name.

1. `src/lib/shared/sockets/types.ts`, the `lorebooks:list` row (~line 7859): `provided?: { disabled: boolean }` becomes `provided?: { disabled: boolean; pluginName: string | null }`. Extend the doc comment: `pluginName` is who the book comes with — the plugin's display name (`plugins.name`, else its id); `null` for core ("Serene Pub"), the same value and meaning as `readOnly.pluginName`. Tag it `🚧 (m3b-F)`. Do NOT change the `lorebooks:get` response's `provided` (~7917) or the starter-kit card's `provided` (~7664).
2. `src/lib/server/sockets/lorebooks.ts` `buildLorebooksList` (~318–470): today `providedOwnerNames(...)` (~407) is fed only `starter_kit` rows' marks. Feed it every marked row's plugin (still ONE call, ONE query — never per row), and in the row projection (~445) set `provided: { disabled: …, pluginName }` where `pluginName = providedBy.plugin === "core" ? null : (ownerNames.get(providedBy.plugin) ?? providedBy.plugin)`; `readOnly.pluginName` keeps exactly that value (compute it once, use it in both). Do not touch the `lorebooks:get` handler (~758), the `or` arms, or who may read a book.
3. Test — extend `src/lib/server/plugins/providedBooksPubWide.int.test.ts` (keep its existing 60 s `testTimeout`): a member's `buildLorebooksList` row for a live plugin-provided book carries `provided.pluginName` equal to the plugin's `plugins.name` (give the plugin a display name different from its id, e.g. `"Mundi"`, to prove it is the name and not the id); and a primer row of core's (the file already has `VIS_PRIMER`/a primer test) carries `provided.pluginName === null`. Add to an existing `test(...)` or one new `test(...)`; do not restructure the file.

## Files owned
`src/lib/shared/sockets/types.ts` (the one hunk above, additive), `src/lib/server/sockets/lorebooks.ts` (the hunks above), `src/lib/server/plugins/providedBooksPubWide.int.test.ts`.
Both source files are edited concurrently by other programmes: **re-read the exact lines immediately before each edit**, change only your hunk, never reformat (they are dirty at HEAD — do not run prettier `--write` on them).

## Files readable
Anything. Useful: `src/lib/server/plugins/providedMarks.ts` (`providedOwnerNames`, `markedBook`, `providedOwnersPresent`), `src/lib/shared/lorebooks/primerRow.ts`.

## Out of scope
`sockets/appletLibrary.ts` (its rows carry no `provided`; leave it), the `lorebooks:get` reply, any client file, docs, NOMENCLATURE, who may read a book, any setting or migration, any SDK file.

## Rules (quoted from CLAUDE.md / NOMENCLATURE; obey them)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees or that outlives the change: … a new name / setting / flag / abstraction / event …" — the only new name you add is the field `pluginName` on the list row's `provided`. Add no other field, helper export or event; if you think you need one, stop and say so in the report.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Hard rule: "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- P2: a module owns its data; read plugin names only through `providedOwnerNames` (already imported).
- NOMENCLATURE R1 "One word, one meaning" — `pluginName: null` means core, exactly as `readOnly.pluginName` already does; never a second meaning.
- Tests: run only `npx vitest run src/lib/server/plugins/providedBooksPubWide.int.test.ts` (and, if you like, `src/lib/server/plugins/primerRowReadOnly.int.test.ts`, which reads `readOnly.pluginName`). **Never pipe vitest into `head`** (the SIGPIPE leaks PGlite temp dirs); redirect to a file under `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/` named `m3b-F-w1-*.log` and read it. An int test that opens a DB inside an `it` needs a 60 s timeout.
- Typecheck: `npx tsc --noEmit -p . 2>&1 > <scratchpad>/m3b-F-w1-tsc.log`, then grep the log for your files and for any error the type change caused elsewhere (e.g. a test fixture that builds a list row's `provided`). Report any such error with file:line — do not edit files outside your list; the supervisor decides.

## Stop and ask (in your report) when
A ★ would be needed, a name beyond `pluginName` seems needed, a migration or setting seems needed, or a file outside your list must change.

## Done means
`providedBooksPubWide.int.test.ts` green with the new assertions; `tsc` shows no error in your three files and none caused elsewhere by the type change (or each one listed).

## Report
Write `plans/REPORT-m3b-F-w1-2026-11-05.md`: changed files with the hunks' line ranges, the tests run with pass/fail counts, the tsc result, Noticed-not-done. Then end.
