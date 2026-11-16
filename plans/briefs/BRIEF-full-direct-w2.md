# BRIEF — worker `full-direct-w2` — under Full, a session writes straight into its owner's own lorebook (`host.ts`)

Supervisor: lane `full-direct` (brief `plans/briefs/BRIEF-full-direct.md`, read-only for you). Repo root
`/home/jody/github/serene-pub`. Report: your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Words

- A session's **notes** (code: *own book*) is the `lorebooks` row with `session_id` set; the **lorebook** is
  `sessions.lorebook_id` (the "attached" book).
- **Full / Review changes / Off** is the lorebook write setting in force (the stricter of the person's and the
  book's). The **"book" route** (`loreWriteRoute`, `src/lib/server/lorebooks/ownBook.ts` ~346) is: an attached
  lorebook the session's owner owns, and the setting in force is Full. Everything else is the **"own-book" route**.
- A change **waits** (code: *held*) when it is kept in the notes as an `entry_amendments` row with `base IS NOT
  NULL` (`holdLoreEntryChange`, `host.ts` ~2189) until it is applied to the lorebook (automatic Apply drains it as
  each scene closes).
- An **imprint** (`lore_imprints`) is the per-field before/after record a turn's write leaves, by which a swipe,
  regenerate, Back or delete takes it back and Forward puts it back. A field a person changed since keeps the
  write and the entry gets the *replaced* note (Revert / Keep). A later **run's** write to the same field is
  spliced silently.
- A **dated** session is one whose reading has a moment (`line.reading.moment != null`).

## The owner's ruling (2026-11-13), and the lead's instruction

"We should pull back on how frequently we use own notes. Use the lorebook if it's a surfaced one." · "file it
right away. if review is off, write directly to the lorebook." Agreed reading: **with Full in force and the session
on its owner's own lorebook, everything the session's pipelines write goes into the lorebook at once, changes to
existing entries included; the notes are used under Review changes and Off, for a session whose notes are its
whole lorebook, and for a book the session's owner does not own.** This reverses, for Full only, "a change to an
existing lorebook entry always waits" and "a session whose scenes end by themselves keeps new entries, places,
history days and links in the notes under Full".

**Lead's instruction (overrides the lane brief's correction 1): a dated session's change to an existing lorebook
entry keeps waiting in the notes exactly as today** (held; drained at scene close by automatic Apply as a dated
change). Only an **undated** session's change is written in place.

## What is true today (verify; line numbers from 2026-11-13, re-read before editing)

`host.ts` = `src/lib/server/pipelines/runtime/host.ts` (12,600 lines — **read by line range only**).

- `sessionLoreWriteTo` (~1634–1713) forces the own-book route when `opts.notes || endsByThemselves` (~1658–1665),
  where `endsByThemselves = scenesEndByThemselves(db, sessionId)` (`ownBook.ts` ~438). On the "book" route its
  result says `scenesEndByThemselves: false` (~1675).
- `changeLoreEntry` (~2255–2350) holds any entry not in the notes, with no route or mode check (~2274–2279); its
  direct branch writes in place with `imprintChanges` (~2313–2321) and **refuses** an entry on another line or under
  a pending fork (~2283–2289).
- `create-lore-entry` (~11420–11908): the match (~11612–11653, `lookLoreMatch` / `findLoreMatch` from
  `loreMatch.ts`, with `target.line.alsoReads` as the second book), the fork decision (~11655–11658: a match without
  links never forks), the outlet-level copy of the hold decision (`heldIn`, ~11694–11695), `contentAsRead`'s reading
  choice (~11699–11702), the result (`heldIn` → `route: "own-book"`, ~11890–11900), and the settle skip on a
  `sources` write (~11849).
- `update-lore-entry` (~11910–12075): resolves `p.entry` (~11946–11961: on the "book" route only the lorebook's
  entries answer), the outlet-level copy of the hold decision and the landing (~11973–11979: a notes entry on the
  "book" route lands through `sessionLoreWriteTo(…, { notes: true })`), the date checks for a moved history entry
  (`!held`, ~11999), the settle skip (~12053), the result (~12068).
- `link-lore-entries` (~12113–12232): settle skip ~12202.
- `forkedLoreLine` (~1776), `pendingLineFork` (~1802). `lineOnFirstWrite` is set for branches and for "branch off
  at a point" starts; on a pending fork a match without links does not fork.

## Build

### 1. New entries, places, history days, links go to the lorebook (`sessionLoreWriteTo`)

`sessionLoreWriteTo` no longer forces the notes because scenes end by themselves; `opts.notes` (a filing tool's
`toNotes`) still does. So under Full on the owner's own lorebook, a session whose scenes end by themselves gets the
"book" route like any other. **Keep the predicate's answer on the result on every route** (`scenesEndByThemselves:
endsByThemselves` on the "book" route too): the `sources` settle skip at ~11849, ~12053, ~12202 must stay keyed on
it, **textually unchanged**, so a session whose scenes end by themselves still never settles by `sources` (it now
settles when a scene closes — another worker builds that in `ownBook.ts`), and every other session settles as
today. Leave the own-book route's behaviour (incl. ~1693 `alsoReads`) exactly as it is, so Review changes and Off
behave exactly as before. Remove a branch only when nothing can reach it, and list what you removed and what you
left (code only serving the forced route may stay if other routes use it). Update the 🚧 comments at ~1625–1633,
~1640–1645, ~1652, ~1766–1775, ~1797–1800 to state the rule as it now is (comments state the rule, not the story).

### 2. A change to an existing lorebook entry (`changeLoreEntry`, its two outlet-level copies, the match path)

On the **"book" route**, a change to an entry of the attached lorebook is **written in place and imprinted**, as a
notes entry's change is today (`imprintChanges`, with the turn's anchor; a press with no turn has no anchor and
leaves no imprint, as today). It **waits** (today's `holdLoreEntryChange`, unchanged) when any of these holds:

- the route is not "book" (Review changes, Off, a book someone else owns): exactly as today;
- the session is **dated** (`line.reading.moment != null`) — the lead's instruction above;
- the session **already holds a change on that entry** (an `entry_amendments` row in its own book, `base IS NOT
  NULL`, `entry_id` = the entry): the new change goes with it as today (it drains at scene close), never beside it
  in the lorebook (correction 4);
- the direct write would be refused for the line: the entry is on another line (`stored.branchId !== line.branchId`)
  or the session's line fork is pending (`pendingLineFork`). **That refusal (~2283–2289) becomes a hold for a
  lorebook entry; it is never a refusal** (a branch's change to an entry on its original's line waits in the
  branch's notes). For an entry of the session's own notes the existing refusal stays as it is.

**No write that is held today may be refused.** Check every path where the direct write can throw where the hold
did not; if one exists, keep the hold for that case and say so.

Make the decision **once** (inside `changeLoreEntry`, or one helper it and the two outlets share — your call, say
which); the outlets must know whether the change was held, to fill their results: held → `lorebookId` the entry's
lorebook, `route: "own-book"` (as today); written in place → `lorebookId` the lorebook, `route: "book"`. An internal
parameter or a local variable is fine; **no new exported name, no new field on a published result shape**
(`LoreWriteLine` is internal but its fields are recorded vocabulary: do not add one; if you think you must,
stop and ask).

The match path's fork decision (~11655) stays: a match without links forks nothing; on a pending fork the line
check then holds.

For `update-lore-entry`'s moved-history-date checks (~11999, `!held`): a lorebook history entry written in place on
the "book" route runs the same date checks the socket runs (`assertDateLands`, `assertHistoryDateFree`,
`assertRedateKeepsLines`) against the lorebook; a held one keeps today's behaviour.

### 4. Rows that already wait in the notes (Build 4 + correction 4)

On the "book" route, `create-lore-entry`'s match (`lookLoreMatch` and `findLoreMatch`) and `update-lore-entry`'s
resolve look in the **notes first, then the lorebook**, as the own-book route does: pass the own book as the first
book (`lorebookId` = own book id, reading = its main head: `{ lorebookId: own, branchId: null, moment: null,
forkedAt: null, line: MAIN_LINE }` as `sessionLoreWriteTo` builds at ~1701) and the lorebook as the second (`then`
/ last argument: `{ lorebookId: target.lorebookId, reading: target.line.reading }`). `resolveLoreLinkEnd` (~1419)
already takes such a `then`. Skip the notes when the session has no own book (`ownBookOf` null). `loreMatch.ts`
should need no change (its book order is "first, then `then`"); if it does, only its book order, and say why.

A name that meets a waiting notes row changes **that row** in the notes (in place, imprinted on the notes' id, so a
swipe always reverts it; it drains at the next scene close); it never makes a second entry and never answers "not
found". Its landing is the notes, as `update-lore-entry` already does at ~11978 (`sessionLoreWriteTo(…, { notes:
true })`): `lorebookId` the notes' id, its line, `route: "own-book"`. In `create-lore-entry` the transaction holds
the lorebook's lock; if you need the notes' landing, compute it **before** the transaction (one extra call only on
the "book" route), never with the outer `db` inside the transaction (it deadlocks PGlite silently). `contentAsRead`
(~11699) must read a notes row on the notes' reading and a lorebook row on `target.line.reading`.

`entries-named` (`loreMatch.ts` `entriesNamedIn` ~275) already lists notes first: no change.

## Tests

### New: `src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts`

Through the real outlets (copy the harness of `host.scenesEndRoute.int.test.ts` and `host.ownBookFull.int.test.ts`:
how they make a Story Living session whose scenes end by themselves, a Chat session whose don't, run an outlet,
swipe / regenerate / go Back / delete / go Forward). Under Full on the owner's own lorebook:

1. a routine's new entry, place, history day and link land in the **lorebook** and nothing in the notes, for a
   session whose scenes end by themselves **and** for one whose don't;
2. a shown entry (`create-lore-entry` with `shown` + `match { name }`) is rewritten in place, its name kept, with
   imprints; `update-lore-entry` likewise;
3. swipe, regenerate, Back and delete of the turn restore the earlier text and remove the new rows; Forward puts
   them back;
4. after a hand edit of the field, the take-back leaves it and the entry is marked *replaced* (a `kept` imprint);
5. for a session whose scenes end by themselves, Back is **not** refused after a `sources` write (no settle);
   for a Chat session it is, as today;
6. a branch session's change to an entry on its original's line waits in the branch's notes (a held row; the
   lorebook unchanged); a pending-fork session's match without links waits too, never refused;
7. a **dated** session's change to an existing entry waits in its notes (held, dated at its day) — the lead's
   instruction;
8. a session that holds a waiting new entry and a waiting change from before (rows made as the old rule made them:
   insert them directly into its notes, as `host.ownBookFull` / `autoApply` tests do): `create-lore-entry` matching
   the waiting entry's name changes that notes row (no second entry, nothing in the lorebook); a change to the
   entry it already holds a change on folds into the held change (a held row; the lorebook unchanged);
   `update-lore-entry` naming the waiting notes row changes it (not "not found");
9. a second session on the same lorebook reads the write at once;
10. a session on a book its owner does not own (a member's session, or a plugin-provided book) and a session whose
    notes are its whole lorebook behave exactly as before (their writes in the notes / held).

### Old-rule tests in `src/lib/server/pipelines/runtime/` — rewrite, never delete or skip

Run these and rewrite each failing `it` to the new rule: `host.scenesEndRoute.int`, `host.ownBookFull.int`,
`host.heldEntryChange.int`, `host.loreMatchShown.int`, `host.historyWrites.int`, `host.ownBookRoute.int`,
`host.forkTiming.int`, `loreSources.int`. **A test that set Full only to reach the held path moves to Review
changes** (set the person's or the book's write setting to Review) so the held path stays covered. Do not weaken an
assertion to make it pass: if the new rule says something different, assert the new thing. List each rewritten `it`
with what it asserts now. If one cannot be rewritten without losing coverage of the held path, stop on it and say so.

## Files owned (edit only these)

- `src/lib/server/pipelines/runtime/host.ts` — `sessionLoreWriteTo`, `forkedLoreLine`/`pendingLineFork` comments,
  `holdLoreEntryChange`/`changeLoreEntry`, and inside the `create-lore-entry`, `update-lore-entry` and
  `link-lore-entries` outlets only the routing, hold, settle-skip and match points named above
- `src/lib/server/pipelines/runtime/loreMatch.ts` — the match's book order only, if needed
- `src/lib/server/pipelines/runtime/host.fullDirect.int.test.ts` (new) and the eight test files listed above

## Files readable

Anything. In particular `ownBook.ts` (`loreWriteRoute`, `loreWriteTargetFor`, `scenesEndByThemselves`,
`overlayItemsOf`, `applyOverlayItems`), `state/reading.ts`, `state/entriesOnReading.ts`, `lorebooks/imprints.ts`,
`lorebooks/sessionLine.ts`, `sessions/settle.ts`.

## Out of scope

`ownBook.ts` and `imprints.ts` (another worker edits them now), `sessions/settle.ts`, `sessions/rewind.ts`,
`sockets/*`, `db/schema.ts`, `runtime/dispatch.ts`, any SDK file, docs, NOMENCLATURE. Cast members, stats, ties,
timeline capture and the lorebook annex (already direct). Review changes and Off. Removing the waiting machinery,
Apply or Take back. Any migration, setting, flag, event, or new name. Converting or moving rows that already wait.
Children (a note filed under an entry).

## Stop and ask (in your report) when

A write held today would be refused; Review changes or Off would behave differently; a change is needed in
`ownBook.ts`, `imprints.ts`, `settle.ts`, `rewind.ts`, a socket file, the schema or the SDK; a migration or a new
name (exported symbol, result field, `LoreWriteLine` field) seems needed; an old-rule test cannot be rewritten
without losing coverage of the held path. Stop that part, finish what does not depend on it, and say so plainly.

## Rules (from CLAUDE.md and the lane brief)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently;
  `db/transactionGuard.ts` throws in dev/test.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- Comments state the rule, not the story (`shared/conformance/commentHistory.test.ts` checks for story words).
- It is a **session**, never a *chat* (except in chat-completions wire vocabulary).
- An int test that opens a DB inside an `it` takes a 60 s timeout.
- No migration, no `npm run sdk:build`, no re-pinning hashes. Never `kill -9`.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)

## Running tests

Another worker and another session share this checkout. Run one test command at a time, always like this, from
the repo root (the `flock` serializes you with the other worker; the `ps` check catches the other session):

```
cd /home/jody/github/serene-pub
timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 15; done'
flock /home/jody/github/serene-pub/plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/full-direct-w2-<name>.log 2>&1"
```

Then read the log (`grep -n "✓\|×\|FAIL\|Tests " <log>`, then the failing parts). Never pipe vitest into `head`.
Ignore an `esbuild --service` process (it belongs to the editor). Typecheck with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "runtime/(host|loreMatch)"` (slow; one
at a time).

## Done means

`host.fullDirect.int` and the eight listed files pass, plus `host.heldEntryChange.int`'s neighbours
`src/lib/server/state/heldAmendments.undo.int.test.ts` and `src/lib/server/state/ownBookRoute.undo.int.test.ts`
(run, do not edit; report failures). `tsc` shows no error in your files.

## Report (final message)

The rule as built (write kind × setting × session shape, a short table); where the hold decision lives and how the
outlets learn of it; code removed / left unreachable; every rewritten test `it` and what it asserts now; tests run
with pass/fail counts; anything you stopped on; **Noticed, not done** (e.g. a book-route link whose other end is a
waiting notes entry).
