# BRIEF — worker `el-1a-w2` — the entry lock's checks: no run writes, holds, archives, takes back or auto-applies a locked entry

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1a`. Report: your final message
(under ~600 words) — changed files with the line of each check, tests run with results, every new sentence or
fragment you wrote, Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` and never pipe its output into a file. No migration, no schema change (done: column
  `lorebook_entries.entry_lock`, TS `entryLock`, boolean default false, migration 0169).
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1a-w2-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`
  (other lanes share vitest; waits can be long). Never pipe vitest into `head`. An int test that opens a DB inside an
  `it` needs a 60 s timeout. `NODE_OPTIONS=--max-old-space-size=10240` for `npx tsc --noEmit -p .` (once, at the end).
- Another worker (`el-1a-w3`) edits `scenes/liveScenes.ts`, `sockets/scenes.ts` and `shared/sockets/types.ts` at the same
  time: never edit those. Re-read any file right before each edit.

## The rule (owner, ruled EL1, 2026-11-17; lane brief "Cold review corrections")

"A manual lock to all entry types so pipelines can't make edits to individual locked entries." While an entry's
`entryLock` is true **no run** writes it: a pipeline's lore write, a routine, the automatic Apply, a ruleset tie's
field write, a run's archive, and **Back / swipe / regenerate taking back** a run's earlier write. **Not stopped:** a
person's hand edit, Apply or Take back pressed by a person, import. Read the lock only through
`entryLockedAgainstRuns(row)` (`src/lib/shared/lorebooks/runLocks.ts`) and word it only with `RUN_LOCK_SENTENCES`
there (`entry(title)` for a run's note, `held(title)` for the Apply review). Quote from the cold review, verbatim:

1. "**A refused write never halts the reply.** Do not do 'the same as `host.ts:493`': that throws, and `runTurn.ts`
   1228–1240 turns a throw into a halted run and a failed reply row … Use the carrier that does not halt: a write's
   result `{ written, notes: [sentence] }` (`host.loreWrites.ts` 1121–1133 …): a write to a locked row returns
   `written: false` and one note naming the row; it never throws `HostScopeError` or `StateRefusal` and never rolls
   back the step's transaction. … Test: the reply completes and its other writes land."
2. "The check reads the **target** row the writer already loads as `stored` (`host.ts:424` and following), never the
   row being inserted: dated changes go into `entry_amendments`, held and notes changes into separate rows of the
   notes (`holdLoreEntryChange`, `host.ts` 477–484): a run's change to a locked entry is refused **before** any of those
   rows is made, so it is never held."
3. "A change held before the entry was locked stays in the Apply review for a person to Apply or Take back, and
   **does not hold the settle line back** (`lorebooks/ownBook.ts` 2650–2669, 3287–3292 never settle past the oldest held
   change): leave changes on a locked entry out of that minimum. Close out ('applies whatever is left') skips a locked
   entry and says so."
4. "**Back, swipe, regenerate** take back a run's earlier writes (`lorebooks/imprints.ts` 632, 801 …): a lock counts as
   'something else now stands on it': Back leaves a locked entry as it is and says so with the existing words for that
   case." (The existing words: the imprint is `kept`, and the entry shows *Written by a reply that was since replaced*.)

No extra statement per reply: every check reads a row the writer already selected whole (`stored`, `row`, the
`entry` of a join). Where a select lists columns, add `entryLock` to that same select. Say for each check how you know.

## The checks (the fewest places; never per call site)

A. `src/lib/server/pipelines/runtime/host.ts`
   1. `changeLoreEntry` (~412–630): first thing, before the timeline-off block and before any held decision:
      locked → push `RUN_LOCK_SENTENCES.entry(\`'${stored.title ?? \`entry ${stored.id}\`}'\`)` onto `a.notes` (when given) and
      `return false`. This covers `create-lore-entry`'s match (both branches ~6852/6874) and `fileOntoHistoryDay`.
      In the by-name branch, the *"added to '…' as a new paragraph."* note must not be pushed when nothing changed
      because of the lock.
   2. `fileOntoHistoryDay` (~632–750): pass a notes array to its `changeLoreEntry` call; when the day is locked return
      the lock sentence as its `note` (not *filed onto …'s entry*). Nothing is filed over a locked day and nothing
      throws (a new day it creates is never locked).
   3. `core:outlet/update-lore-entry` (~7100–7320): right after `stored` is loaded and before `lorebookChangeHeld`, the
      moved-date checks and any transaction: locked → return
      `{ id: entryId, entryId, lorebookId: stored.lorebookId, route: target.route, written: false, notes: [...(checked?.notes ?? []), <the entry sentence>] }`
      (no settle, no record).
   4. `core:outlet/note-scene` (~4501–4545): `appendSceneNote` now returns `{ sceneId, notes, lockedNote?: string }`
      (worker w3 builds that; code against this contract). When `out.lockedNote` is set: return
      `{ written: false, sessionId, sceneId: out.sceneId, notes: [out.lockedNote] }` and record nothing.
B. `src/lib/server/sessions/forgetNote.ts`: the archive's `where` also requires `entry_lock = false`.
C. `src/lib/server/rulesets/ties.ts` `writeColumn` (~687), `entry-field` target: add `entryLock` and the title to the
   existing select; locked → write nothing and return a reason in the same form as its siblings ("its entry is gone"):
   report the exact fragment you chose.
D. `src/lib/server/lorebooks/imprints.ts` `retractImprints` (~632): after the "gone / carried out" check, for subject
   `entry` when `entryLockedAgainstRuns(row)`, and for subject `version` when the version's entry is locked (one select
   of that entry, on this path only): mark the imprint `kept` exactly as the existing "changed since" branch does
   (status `kept`, `keptNow`, `taken.push({ act: "kept", imprint })`), in a notes book too (the lock wins over
   `alwaysRevert`). `restoreImprints` needs nothing new.
E. `src/lib/server/lorebooks/ownBook.ts`
   1. `takeOwnBookEntriesAnchoredTo` (~720): its delete also requires `entry_lock = false` (a locked notes entry stays
      when its turn is taken back).
   2. `overlayItemsOf` (~1781): an item whose entry is locked carries `entryLocked: true` (internal field on
      `OverlayEntryChangeItem` and `OverlayEntryItem`; the held change's lorebook entry is in the existing join; a new
      notes entry is its own row). Do not touch the socket or wire type (worker w4 does).
   3. `applyHeldAutomatically` (~3121): leave items with `entryLocked` out of `entryIds` and `amendmentIds` (so the
      automatic Apply and Close out skip them; they stay held), and out of the `stillWaiting` minimum (~3287).
   4. `applyOverlayItems` (~2067) settle (~2650–2669): leave held changes on a locked entry (the `heldNow()` join has
      `entry`) and locked notes entries out of `stillHeldAnchors`. A person's Apply of a locked entry's held change still
      applies it (★ ruled reading: a person chose it).

## Tests (new files beside the existing ones; reuse their worlds)

Patterns: `pipelines/runtime/host.heldEntryChange.int.test.ts`, `host.historyWrites.int.test.ts`,
`host.loreMatchShown.int.test.ts`, `lorebooks/autoApply.int.test.ts`, `autoApply.settle.int.test.ts`,
`lorebooks/imprints.int.test.ts`, `imprints.version.int.test.ts`, `lorebooks/heldApply.int.test.ts`.
New file `src/lib/server/pipelines/runtime/host.entryLock.int.test.ts` and `src/lib/server/lorebooks/entryLock.int.test.ts`:
- `update-lore-entry` on a locked entry: nothing written (row, `entry_amendments`, notes all unchanged), result
  `written: false` with the note naming it, no throw; the same write unlocked works.
- `create-lore-entry` matching a locked entry (by id and by name): nothing written, note; history filed onto a locked
  day: nothing filed, note, no throw.
- One run whose step makes two writes (one to a locked entry, one to another) completes and the other write lands
  (through the real run path the existing tests use; if none fits, say so and test at the outlet).
- A person's hand edit of a locked entry (`entries:update` socket, as an existing socket test does) works.
- `forget` leaves a locked entry unarchived; `writeColumn` on a locked entry writes nothing and returns the reason.
- Back (`retractImprints`) on a locked entry the run changed and on one it made: kept, nothing reverted or removed;
  a locked notes entry anchored to the taken turn stays.
- Automatic Apply (scene-close and close-out) skips a locked entry's held change, it stays held and is listed with
  `entryLocked: true`; the settle line moves past it; a person's Apply of it then lands.
Then run the existing files you touched the code of: the eight pattern files above,
`lorebooks/applyTakeBack.int.test.ts`, `rulesets/*ties*.int.test.ts` (find them), `sessions/forgetNote*` (if any),
and `src/lib/shared/conformance/commentHistory.test.ts`.

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the four places in §A only), `sessions/forgetNote.ts`, `rulesets/ties.ts`
(`writeColumn` only), `lorebooks/imprints.ts` (`retractImprints` only), `lorebooks/ownBook.ts` (§E only), the two new
test files.

## Out of scope

Scenes (w3), sockets, the wire type, client, docs, NOMENCLATURE, cast members, place stat values (attribute rows),
links and knowledge ties that end at a locked entry (their own rows: not stopped).

## Stop and ask (in your report) when

A run's write cannot be told from a person's at a writer; a check would need a new statement on every reply; a refusal
would have to halt the run; a check belongs in a file not listed here.

## Done means

The two new files and every existing file named above green; `tsc` 0 errors in your files.
