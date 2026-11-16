# BRIEF — build lane `time-t5a-fix` — the scope review's findings on what a dated session writes

Repo `/home/jody/github/serene-pub`. Supervisor: read `.claude/guides/multi-agent.md` first, then
`plans/REPORT-time-t5a-2026-11-15.md` (all of it), `plans/briefs/BRIEF-time-t5a.md` (Build C and the
Corrections), `src/lib/server/lorebooks/imprints.ts` (the `version` subject, `retractImprints`,
`restoreImprints`, `keptImprintsByEntry`, `settleKeptImprint`), `src/lib/server/lorebooks/redlines.ts`,
`src/lib/client/lorebooks/sections/keptImprints.ts`, `KeptImprintNote.svelte`, `NOMENCLATURE.md` §24 and the
lore imprint row.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no migration, no GPU.

## Goal: four fixes, data safety first

The scope review found the lane data-safe (no take-back deletes or rewrites text a person or another session
wrote). These four remain.

### 1. Back then Forward keeps a made version's edit-history row

A direct write records a `routine` edit-history row with `amendment_id` for a version the turn made
(`pipelines/runtime/host.ts` ~2607–2614). That row's foreign key cascades (`drizzle/0161_flowery_bishop.sql`
~17), so when Back removes the version (`imprints.ts` ~758–763) the row goes too, and Forward
(`imprints.ts` ~795–800) puts the version back with no row. For a version the turn made: before the remove,
read that run's edit-history rows on that `amendment_id`; carry them on the `unmade` entry of `TakenImprint`;
re-insert them, ids kept, after `access.insert` in `restoreImprints`, in the same transaction. Never seed any
other row at a fixed id; these are the same rows going back. Test: Back then Forward leaves the version with
its `routine` row; a second Back removes both again.

### 2. The note on a kept version says what Revert does (owner: recommendation accepted in advance is NOT assumed — copy is 🚧)

Today `keptImprintsByEntry` sends `field: null` for a kept version the turn made (`imprints.ts` ~883–884), so the
client prints *The reply added this entry. Revert removes it.* (`client/lorebooks/sections/keptImprints.ts`
~33), but Revert removes only the dated version (`imprints.ts` ~1003–1006), with any later edits to it.

- Server: `KeptImprint` (`src/lib/shared/entries/types.ts`) gains an optional `versionDate` (the version's date
  in words through the lorebook's calendar, from the joined `entry_amendments` row), set for every record whose
  subject is a version.
- Client (`keptImprints.ts`, `KeptImprintNote.svelte`): for a made version, *The reply added the version dated
  ‹date›. Revert removes that version, with any later edits to it; the entry and its other dates stay.* 🚧 For
  a field record on a version, the existing field sentence gains *in the version dated ‹date›* 🚧. Entry records
  read exactly as today.
- Tests: the data arrives; each sentence; an entry record's sentence unchanged.

### 3. A version's record is never dropped silently

`retractImprints` deletes a `version` record with no take-back and no note when the session's lorebook is no
longer the record's (`imprints.ts` ~660–675, the "fold guard"). The session's text then stays in the lorebook
with no cause shown and no **Revert**. Mark the record **kept** instead (as the code does when someone else
changed the row since), so the note shows and the person can keep or revert it. It must still never write into
a folded lorebook on Back. Test: after a fold, Back leaves the lorebook's text as it is and the record kept.

### 4. One stale comment

The doc comment on `heldChangeVerdict` (`src/lib/server/lorebooks/ownBook.ts` ~1473–1475) still says a dated
change waits "when the line already holds a version of the entry at that date". That rule is withdrawn
(NOMENCLATURE §25, ★T5A-1): delete the clause.

Also, if small and safe: a person deleting a version that has a kept record leaves the record orphaned (hidden
by the inner join, `imprints.ts` ~859): delete the record with the version, in the same transaction, in
`sockets/amendments.ts`'s delete. If it is not small, report it.

## Files owned

`src/lib/server/lorebooks/imprints.ts`, `src/lib/server/lorebooks/redlines.ts` (only what fix 1 needs),
`src/lib/server/lorebooks/ownBook.ts` (the comment), `src/lib/server/sockets/amendments.ts` (the orphan only),
`src/lib/shared/entries/types.ts` (`KeptImprint.versionDate`), `src/lib/client/lorebooks/sections/keptImprints.ts`,
`KeptImprintNote.svelte`, tests beside each, `docs/lorebooks.md` (the note's wording), `NOMENCLATURE.md` §25.

## Stop and ask when

A fix would change what a take-back does to text a person or another session wrote; a migration or a published
name seems needed; restoring edit-history rows by id could collide with a row made since.

## Done means

- Tests, each as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t5a-fix-<name>.log 2>&1"`,
  one at a time, checking `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` first: the new tests; all of
  `src/lib/server/lorebooks/imprints*`, `src/lib/server/pipelines/runtime/host.*`, `src/lib/server/state`,
  `src/lib/server/sockets/sessions.*`, `src/lib/server/sockets/amendments.*`,
  `src/lib/client/lorebooks/sections`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors and
  `NODE_OPTIONS=--max-old-space-size=12288 npm run check` 0 errors.
- Inside `db.transaction` only `tx`. Comments state the rule, not the story. Never `prettier --write` beyond the
  lines changed.

## Report

Your final message is the report (the lead saves it as `plans/REPORT-time-t5a-fix-2026-11-15.md`): changed
files, tests with results, sentences added, open ★, Noticed not done. Under about 500 words.
