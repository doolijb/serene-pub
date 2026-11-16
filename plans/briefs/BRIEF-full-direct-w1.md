# BRIEF — worker `full-direct-w1` — Back never deletes a row another session stands on; Forward finds a free slot; the story settles when a scene closes

Supervisor: lane `full-direct` (brief `plans/briefs/BRIEF-full-direct.md`, read-only for you). Repo root
`/home/jody/github/serene-pub`. Report: your final message (the supervisor reads it; do not write a report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Background (why)

The owner ruled (2026-11-13) that under **Full**, on the session owner's own lorebook, a session's pipelines write
new entries, places, history days, links, and undated changes to existing entries **straight into the lorebook**
(another worker, w2, is building that in `host.ts`; do not touch `host.ts`). Two consequences land on your files:

1. A row a session made directly in the shared lorebook can now be stood on by **another** session before the
   first one swipes or goes Back. Back must never delete such a row.
2. Since writes no longer wait in the notes, the story must **settle** when a scene closes even when Apply had
   nothing to apply (owner: "Settle when a scene closes").

Words: a session's **notes** (code: *own book*) is the `lorebooks` row with `session_id` set; a **held change**
(code: held amendment) is an `entry_amendments` row with `base IS NOT NULL`, kept in a session's notes; an
**imprint** (`lore_imprints`) is the before/after record a turn's write leaves, by which swipe / regenerate / Back /
delete take it back (`retractImprints`) and Forward puts it back (`restoreImprints`). The **settle line**
(`sessions.settled_message_id`) is the message at or below which Back is refused.

## Task A — widen `holds` (correction 3) — `src/lib/server/lorebooks/imprints.ts` ~217–245

`retractImprints` (~506) removes a made row only when it is untouched: `notes || untouched`, where `untouched`
calls `SUBJECTS.entry.holds`. `holds` today ignores another session's held change, a link kept in another
session's notes, and values another session keeps on the entry. `entry_amendments.entry_id` cascades, so the
delete wipes them. Widen `holds` to the checks **Take back** already makes in
`src/lib/server/lorebooks/ownBook.ts` (`takeBackApply`, ~2515–2616; read it, do not edit it). After the change the
entry is held (so it stays, and the imprint becomes `kept`, i.e. the *replaced* note) when any of these stand on it:

- **any link** that touches it, in any book (the lorebook, this session's notes, or another session's notes).
  The links this same turn made are retracted first (newest imprint first), so they are gone by then;
- an entry filed under it (`anchor_entry_id`), as now;
- **any amendment** on it, held or not, whichever session's (drop the `isNull(base)` filter and its comment);
- **another session's** annotation naming it: `message_annotations.ref_entry_id` on a message of another session,
  or `entry_annotations.ref_entry_id` on an entry in another session's notes (Take back's `namedByMessage` /
  `namedByNote` queries; the imprint's `sessionId` is "this session");
- **another session's** values on it: `attribute_values` / `attribute_configs` rows with `owner_kind IN
  ('location','session_location')` and `owner_id` = the entry, using Take back's exact predicate (another
  session's `session_id`, or a book-level row whose `source_session_id` is null or another session's).

Keep the rule comment above `holds` stating the rule (not the story). `holds` is only asked for a real lorebook:
`notes || untouched` short-circuits on a session's own notes, so Back on the notes is unchanged — confirm this in
your report by pointing at the line.

Tests (new file `src/lib/server/lorebooks/imprints.holds.int.test.ts`, modelled on
`imprints.otherSessionLink.int.test.ts`): session A makes an entry directly in the lorebook through an imprint
(`imprintMade`); session B then (1) holds a change on it (an `entry_amendments` row in B's notes with `base` set),
(2) links to it from B's notes, (3) keeps a place value on it (`attribute_values`, `owner_kind 'location'`,
B's `session_id`); A's message is retracted (`retractImprints({ messageIds: [...] })`): the entry and B's row
remain, and A's imprint is `kept`. Also: with nothing standing on it, the entry is removed as before.

Existing tests that pin the old rule must be **rewritten to the new rule, never deleted or skipped**:
- `src/lib/server/lorebooks/imprints.otherSessionLink.int.test.ts` (asserts another session's link does NOT hold):
  now it holds — the entry stays and is marked kept.
- `src/lib/server/state/heldAmendments.exclusions.int.test.ts` — the case that a held amendment never blocks taking
  back a made entry: now it does.
List each rewritten `it` with what it asserts now.

## Task B — Forward after the slot was taken (correction 5) — `imprints.ts` `SUBJECTS.entry.insert` ~213

Forward (and a failed re-tell) re-inserts a made entry from its snapshot with its stored `position`.
`lorebook_entries_position_uq` is UNIQUE on `(lorebook_id, type_id, position)`, plain and non-deferrable
(`db/schema.ts` ~9217), so the insert fails when another entry took the slot meanwhile. When the stored position
is taken in that book and type, give the row the next free one: `nextPosition(tx, lorebookId, typeId)` in
`src/lib/server/utils/lorebookEntries.ts` ~727 (import it dynamically, as `write` does — `imprints.ts` never
statically imports `$lib/server/db`). Keep the stored position when it is free.

Test (in `imprints.holds.int.test.ts` or `imprints.int.test.ts`): A's turn makes an entry (imprinted); retract it;
another session adds an entry of that type that takes the same position; `restoreImprints(db, taken)` succeeds and
the entry is back at a free position.

Then **check, do not fix**: a made **history day** (`typeId` = `HISTORY_TYPE_ID` from `$lib/shared/entries/types`)
is restored while another history day for the same date was written on that line meanwhile. Say what happens
(two days for one date? an error? where is one-per-date enforced?). If it would need a merge, **stop on that part
and report it** — do not build a merge.

## Task C — settle when a scene closes (correction 2) — `src/lib/server/lorebooks/ownBook.ts` `applyHeldAutomatically` ~2820–2960

Read `applyHeldAutomatically` and Apply's own settle (~2389–2408: "through the newest applied anchor, never past
the message before the oldest item still held"). Read `src/lib/server/sessions/settle.ts` `settleThrough` (~134);
**call it, never change `settle.ts`**.

New behaviour: when a scene closes for a session on the **"book" route under Full**, the story settles through the
end of that scene **whether or not anything was applied**, at exactly the moments automatic Apply runs today:

- after every existing guard that returns null today: no lorebook; no own book with `overlayOf`; the book's owner
  is not the session's owner; the rewound check ("nothing while Back could still go Forward"); the scene not found
  or not closed (`through == null`); `scene-close` while that scene's summary is `running` or `review`.
- **The route rule**: the settle runs only when `loreWriteRoute({ attachedId, bookOwnerId, sessionOwnerId,
  mode: await sessionLoreWriteMode(db, sessionId) })` (same file, ~346 and how `loreWriteTargetFor` ~401 reads its
  facts) is `"book"` — the stricter of the person's and the book's setting. Do **not** change the existing
  `bookLoreWriteMode` guard that automatic Apply uses (~2849) or `overlayAccessOf`/`appliesItself` (~2994): they
  read the book's setting only; that is noted for the owner, not fixed. Because the existing guard returns null
  when the book's mode is not Full, the settle needs both (book Full for the guard, stricter Full for the route).
- **Through where**: for `scene-close` / `scene-summary`, the scene's end (`through` as computed today); for
  `close-out`, `before - 1` when `before` is given, else the session's newest message. Never past
  `waitingStart - 1` (a waiting summary gates its scene); never past the message before the oldest item **still
  waiting** after the Apply (read `overlayItemsOf(db, sessionId)` after the Apply; every item's `sourceMessageId`
  that is not null) — Apply's own rule, so Back can still take what waits.
- It runs in its own `db.transaction` after the Apply's (or in place of it when there was nothing to apply), with
  only `tx` inside (the outer `db` inside a transaction deadlocks PGlite silently).
- **Return**: when something was applied, return the Apply's result with `settled` set to the furthest settle
  (keep the Apply's `previousSettledMessageId` when both moved). When nothing was applied but the settle moved,
  return a result with empty lists (`applied: []`, `appliedChanges: []`, … every list empty, `batch: null`) and
  `settled` set; when nothing was applied and nothing moved, return null as today. Keep the "never throws" rule.

Note for the supervisor (do not edit it): `src/lib/server/sockets/sessions.ts` `applyHeldAutomaticallyAndTell`
(~8356) returns early when nothing was applied, so a settle with nothing applied is not announced to the client;
the lane queues that one-line change for the lead. Say in your report exactly which condition would need to change.

Update the comment above `applyHeldAutomatically` to state the new rule.

Tests: in `src/lib/server/lorebooks/autoApply.int.test.ts` (or a new `autoApply.settle.int.test.ts`; your call,
say which): a Full session on its owner's own lorebook with nothing waiting: closing a scene settles through its
end (`sessions.settled_message_id`), Back of a message at or below it is refused (`assertRetractable` throws), a
message after it is not; nothing settles while the scene's summary is `running`/`review` and it settles when it
is saved (`scene-summary`); nothing settles while a turn is rewound; under **Review changes** (book setting Full,
person's setting Review → route `own-book`) nothing settles; a session whose notes are its whole lorebook: nothing;
an item still waiting before the scene end keeps the settle below it. Find how the existing tests set the person's
and the book's write setting and close scenes, and reuse their helpers.

Existing tests asserting `toBeNull()` for a scene close with nothing to apply under Full on the owner's book may
now get a result with `settled`: rewrite them to the new rule (never delete or skip) and list them.

## Files owned (edit only these)

- `src/lib/server/lorebooks/imprints.ts` — `SUBJECTS.entry.holds` and `SUBJECTS.entry.insert` only
- `src/lib/server/lorebooks/ownBook.ts` — `applyHeldAutomatically` and its comment only
- `src/lib/server/lorebooks/imprints.holds.int.test.ts` (new), `imprints.int.test.ts`,
  `imprints.otherSessionLink.int.test.ts`, `src/lib/server/state/heldAmendments.exclusions.int.test.ts`,
  `src/lib/server/lorebooks/autoApply.int.test.ts` (or a new `autoApply.settle.int.test.ts`),
  `src/lib/server/scenes/liveScenes.autoApply.int.test.ts` (only if it pins the old null)

## Files readable

Anything. In particular `ownBook.ts` `takeBackApply` (~2440–2700), `sessions/settle.ts`, `state/loreWriteMode.ts`,
`utils/lorebookEntries.ts`, `db/schema.ts`, the tests named above and their helpers.

## Out of scope

`host.ts` (another worker), `sessions/settle.ts`, `sessions/rewind.ts`, `sockets/*`, `db/schema.ts`, any SDK file,
any doc, NOMENCLATURE. Any migration, setting, flag, event, or new exported name. Fixing the `bookLoreWriteMode`
vs route mismatch. A history-day merge.

## Stop and ask (in your report) when

Widening `holds` would change what Back does on a session's own notes; a change is needed in `settle.ts`,
`rewind.ts`, a socket file or the schema; a migration, setting or new exported name seems needed; an old-rule
test cannot be rewritten without losing what it covered. Stop that part, finish the rest, and say so plainly.

## Rules (from CLAUDE.md and the lane brief)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`. `imprints.ts` never statically imports `$lib/server/db`.
- Comments state the rule, not the story (`shared/conformance/commentHistory.test.ts` checks for story words).
- It is a **session**, never a *chat*.
- An int test that opens a DB inside an `it` takes a 60 s timeout.
- No migration (`db:generate`), no `npm run sdk:build`, no re-pinning hashes.
- Never `kill -9`.
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to run `sdk:build` at all.)

## Running tests

Another worker and another session share this checkout. Run one test command at a time, always like this, from
the repo root (the `flock` serializes you with the other worker; the `ps` check catches the other session):

```
cd /home/jody/github/serene-pub
timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 15; done'
flock /home/jody/github/serene-pub/plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full src/lib/... paths> > /home/jody/github/serene-pub/plans/full-direct-w1-<name>.log 2>&1"
```

Then read the log (`grep -n "✓\|×\|FAIL\|Tests " <log>`, then the failing parts). Never pipe vitest into `head`.
Ignore an `esbuild --service` process (it belongs to the editor). Typecheck your files with
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "imprints|ownBook|autoApply|heldAmendments" ` (one run at a time; it is slow).

## Done means

`imprints.holds.int`, `imprints.int`, `imprints.otherSessionLink.int`, `heldAmendments.exclusions.int`,
`heldAmendments.undo.int`, `autoApply.int` (and your new settle file), `liveScenes.autoApply.int`,
`applyTakeBack.int`, `heldApply.int` pass; `tsc` shows no error in your files.

## Report (final message)

Changed files; for each task what you built and the decisions you made inside it; each rewritten test and what it
asserts now; the history-day Forward finding; the exact `sockets/sessions.ts` condition to queue; tests run with
pass/fail counts; anything you stopped on; **Noticed, not done**.
