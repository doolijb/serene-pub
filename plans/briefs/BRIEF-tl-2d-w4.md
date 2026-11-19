# BRIEF — worker `tl-2d-w4` — import and export of a history entry with no year; the history entry type's declared Year 1 default goes

Supervisor: lane `tl-2d`. App `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk`. Both working
trees hold a full day of uncommitted work by earlier lanes: **re-read each file right before editing it; small
targeted edits; never a whole-file rewrite.** Always absolute paths. No other worker is running.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You may run `npm run sdk:build` **from the app root** once you have edited the SDK, only after `pgrep -af "vite"`
shows no dev / preview server (a VS Code `svelte-language-server` esbuild is fine) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Never `git checkout / restore / stash /
clean` in either repo. Never `prettier --write` (nor a scratch-copy equivalent). SDK tests only from
`/home/jody/github/serene-pub-sdk/sdk-tests` with `npx tsx --test <files>`. App tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/tl-2d-w4-<n>.log 2>&1"`
(never pipe vitest into `head`). `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`; `npm run check`
with the same NODE_OPTIONS once at the end. No migration (the boot CHECK for history is built from `required`,
`pipelines/boot/entryProjection.ts` ~230, not from the default: confirm).

## Rules that apply (quoted)

- Owner 2026-11-16: "There shouldn't be a scenario where it defaults to 1-1-1." "Go with the safest option for
  existing lorebooks." No stored row is rewritten; no boot pass.
- CLAUDE.md "0.6 is in users' hands": a change to stored data ships with a migration or boot pass (none here: you
  change no stored data). Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a hardcoded id.
- SDK rule: "a pin that moves on purpose is re-pinned with a dated comment saying why" (`(was …) 2026-11-16, tl-2d:
  history year has no default`).

## The scope, and when to stop

**This item is separable; the rest of the lane does not depend on it.** If following the type change goes beyond
the callers named below (or the few lines of each that read a history entry's year), **stop**: undo nothing you
cannot undo cleanly, leave the tree compiling (`tsc` 0), and report exactly where it spread. Prefer stopping early
over a wide change.

## Build

1. **Export** (`src/lib/server/utils/lorebookExportBuilder.ts` ~360–405): an undated scene not yet filed goes out
   under a synthetic history entry for its day; for an undated scene that entry carries `year ?? 1`, month 1,
   day 1 today. It carries **no year** instead (and no month / day). A stored history row that has no year in
   `fields` (legacy) is exported with no year, not Year 1 (this follows from item 3's `toEntryRow`). Find how the
   document serializes a history entry's date and make "no year" representable without breaking a dated row's
   bytes (a dated export must not change: test byte-equality of a dated history entry's exported shape before and
   after).
2. **Import** (`src/lib/server/utils/lorebookImportMapper.ts` ~950–975 and its caller): a history entry with no
   year is skipped (never inserted, never given a year) and the import reports, through its **existing warnings**
   (find how the import surfaces warnings to the person), ★ *‹n› history entries had no year and were not
   imported.* (singular: ★ *1 history entry had no year and was not imported.*). Scenes nested under a skipped
   entry are imported **unfiled** (no history entry), which is what they were in the book that exported them;
   if the import cannot do that without restructuring, stop and report. An older file that carries Year 1 for such
   rows cannot be told apart from a real Year 1 entry and imports as Year 1: say so in your report (the supervisor
   writes the docs).
3. **The declared default goes** (`/home/jody/github/serene-pub-sdk/core-catalog/src/registry/entries.ts` ~242–254,
   the history entry type's `year` field `default: 1`): remove it; re-pin that definition's hash wherever it is
   pinned (SDK `sdk-tests` and / or the app's `registryHashes.test.ts`: grep) with the dated "(was …)" comment.
   Then `historyDateOf` (`src/lib/server/utils/lorebookEntries.ts` ~378) and `toEntryRow` (~274) read a legacy
   undated row's year as `null`, not Year 1 (they fall back to `fieldDefault`, `entries/declarations.ts` ~200,
   which then gives `undefined`: make it `null`). Follow the type change through its callers —
   `src/lib/server/sockets/scenes.ts`, `src/lib/server/…/narrativeGraph.build.ts`,
   `src/lib/server/…/availableSceneCast.ts` (find the paths), and `pipelines/runtime/host.loreWrites.ts`
   `historyDateOf` (~504) if it reads the same default — **without changing what a dated row does**. An undated
   history row sorts and prints as the code already treats "no date" elsewhere (find that treatment; do not
   invent one). `entryInsert` (~420) must never insert a history entry with no year (writers already refuse;
   import now skips): confirm, do not add a fallback.
4. **The stale Year 1 comment in `src/lib/server/sockets/scenes.ts` ~1475**: make it say what the code does now.

## Tests

- Export: an undated unfiled scene's synthetic entry has no year; a legacy undated history row exports with no
  year; a dated history entry's exported shape is unchanged (find the export tests:
  `grep -rln "lorebookExportBuilder\|buildLorebookExport" src --include=*.test.ts`).
- Import: a file with a yearless history entry imports everything else, skips that entry, reports the sentence
  (singular and plural), and its nested scenes arrive unfiled; a round trip export → import of a book with an
  undated unfiled scene keeps the scene, unfiled.
- `historyDateOf` / `toEntryRow` on a row with no year: `year: null`; a dated row unchanged.
- The callers' existing tests (`scenes`, narrative graph, available scene cast): green, unchanged for dated rows.
- The SDK: the hash pin, and any `sdk-tests` file that reads the history default.
- `src/lib/server/state/noYearOneFallback.guard.test.ts` stays green (its `ALLOWED` is now empty).

## Files owned

`/home/jody/github/serene-pub-sdk/core-catalog/src/registry/entries.ts` (the history `year` default only) and the
hash pin(s); `src/lib/server/utils/lorebookExportBuilder.ts`, `src/lib/server/utils/lorebookImportMapper.ts`
(and the import's warning plumbing, only if the sentence needs it), `src/lib/server/utils/lorebookEntries.ts`
(`historyDateOf`, `toEntryRow`), `src/lib/server/entries/declarations.ts` (only if `fieldDefault`'s `undefined`
needs it), `src/lib/server/sockets/scenes.ts`, the narrative graph build and available scene cast files (only the
lines that read a history entry's year), `pipelines/runtime/host.loreWrites.ts` (`historyDateOf` only, if needed);
the test files above.

## Out of scope

Dating any stored row; a boot pass; the client (a client type that breaks on `year: null` is a stop-and-report,
not a fix); docs and `NOMENCLATURE.md` (the supervisor); anything else.

## Done means

Tests above green (log paths, counts); `sdk:build` done once (say when); `tsc` 0; `npm run check` 0 errors;
`npx prettier --check` on touched files (report, do not fix formatting you did not cause).

## Report

Your final message: changed files; how export writes an undated history entry now; how import handles one (and
its scenes); the sentence(s) (★); the hash re-pinned (old → new); each caller touched and why; pinned tests changed
(old → new); whether you stopped and where; **Noticed, not done**.
