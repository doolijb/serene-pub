# BRIEF — worker `time-t6a-w2` — firsthand: re-drive, Reassign, branch copy, import

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t6a`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU. Never touch the owner's server (a suspended `vite preview` on port 4173).

## Goal

Every `session_messages` row records which cast members were there for it, in the new column
`firsthand_cast_member_ids` (`integer[]`, schema field `firsthandCastMemberIds`, already added; migration already
generated). The module that owns it is already written: `src/lib/server/messages/firsthand.ts` — **read it first,
all of it**; do not change it. If it is wrong, stop and report the failing test and the error.

Another worker (`w1`) is wiring the INSERT stamp into `src/lib/server/messages/store.ts` at the same time: every
`insertLegacy` / `insertLegacyMany` row will get the seats in play stamped unless the caller passes the field.
Your tests depend on that stamp; if a test of yours fails only because `store.ts` does not stamp yet, wait a few
minutes and re-run (never edit `store.ts`).

Your part: the four places that must say something other than "the seats in play at the INSERT".

## Owner rulings (quoted)

- 2026-11-14, ★5: "Presence per message needs a new stored fact (who was seated and not benched when a message
  was written)." §5.4: "Presence is per message, never per scene."
- Lead's correction (rules this lane): "One set per row. Swipes and regenerated replies are not rows … a re-drive
  **rewrites** the row's set to the seats present when it is re-driven."
- "Keyed by cast member, never by seat row … Reassign re-stamps a seat's lines and hard-deletes the old seat row";
  Reassign's two handlers may be touched "only to carry the fact with the lines".
- Standing: existing rows get nothing — NULL means "not recorded", never "nobody was there". P2: `firsthand.ts`
  owns the fact; callers only call it.

## Build

1. **Re-drive** — `src/lib/server/pipelines/runtime/host.ts` ~8755–8782, the claim of an existing row
   (`claimId !== null`, the `updateLegacyWhere` whose patch clears `generationStatus`, `queueItemId`, `error`,
   `generationOutcome`): add `...(await firsthandRedrive(sessionId))` to that patch (dynamic import of
   `$lib/server/messages/firsthand`, as the file does for other modules). Nothing else in host.ts. This is the one
   place a regenerate, a swipe and an extend take the row.
2. **Reassign** — `src/lib/server/sockets/sessions.ts`, `sessionsReassignRemovedParticipantHandler` only
   (~8571–8850; a shared file: no other line). In each branch's transaction, after the lines are re-stamped and
   before the old seat row is deleted: when the old seat's member (`removedCC.castMemberId` /
   `removedCP.castMemberId`) and the new seat's member (the character branch's `seatOf(...)` result — hoist it into
   a const so it is read once; the persona branch's `playerSeat.castMemberId`) are both non-null, call
   `repointFirsthand(tx, sessionId, new Map([[oldMember, newMember]]))`. Use `tx` only inside the transaction.
3. **Branch copy** — `src/lib/server/sessions/branch.ts` ~424–482: each copied row passes
   `firsthandCastMemberIds: (message as any).firsthandCastMemberIds ?? null` (match how the story clock stamp is
   carried there), with a one-line comment: the copy keeps its original's set; the branch's seats hold the
   parent's members (★CV-14), so the ids need no remap.
4. **Import** — `src/lib/server/sockets/import.ts` ~1678–1704: each imported row passes
   `firsthandCastMemberIds: null` beside the story clock nulls, with a one-line comment: an imported line was
   written elsewhere, so who was there is not recorded.

## Tests (new files; each `it` that opens a DB gets a 60 s timeout)

- `src/lib/server/pipelines/runtime/host.firsthand.int.test.ts` — harness from `host.seatMembers.int.test.ts`
  (its `vi.mock("$lib/server/db")`, `createHost(db(), { sessionId, userId }).commit!({ text, row: <id> }, { key:
  "reply", definitionId: "core:outlet/create-message" })`). A generating row written while seat A was in play;
  then A is benched and B seated; the claim rewrites the row's set to [B]. A plain new row (no `row`) records the
  seats in play.
- `src/lib/server/sessions/branch.firsthand.int.test.ts` — harness from `branch.seatMembers.int.test.ts`: the
  branch's copies carry their originals' sets unchanged (including a NULL one), and the branch's seats hold the
  same member ids those sets name.
- `src/lib/server/sockets/sessions.firsthand.int.test.ts` — harness from `sessions.benchedSeats.int.test.ts`
  ~350–470 (Reassign): after reassigning a removed/benched character seat, the messages that recorded the old
  member record the new one (not doubled); the persona branch the same.

## Files owned

`src/lib/server/pipelines/runtime/host.ts` (the claim patch only), `src/lib/server/sockets/sessions.ts` (the
Reassign handler only), `src/lib/server/sessions/branch.ts` (the copy's values only),
`src/lib/server/sockets/import.ts` (the history rows only), the three new test files. Read anything; edit nothing
else; never `store.ts` or `firsthand.ts`.

## Rules

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a hardcoded id.
- Migrations are generated only (`db:generate`); a new migration's index must exceed the highest applied or it is
  silently skipped. You need none: if you think you do, stop and report.
- `socket.off(event)` with no handler removes every listener app-wide (not expected here).
- Comments state the rule, not the story.
- Never `prettier --write` beyond the lines you changed; check with `npx prettier --check <file>` and report, do
  not reformat the file (these files are large and other lanes' work lives in them).
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Never pipe vitest into `head` (it leaks PGlite temp dirs).

## Done means

Another Claude session shares the checkout: before each run check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait if one is running. Then, one at a time, e.g.:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/pipelines/runtime/host.firsthand.int.test.ts > plans/time-t6a-w2-host.log 2>&1"
```

then the branch and Reassign files, then `src/lib/server/sessions/branch.seatMembers.int.test.ts`,
`src/lib/server/sockets/sessions.benchedSeats.int.test.ts` and `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`
as regressions. All green (report any failure that is also red without your change, with the evidence). Do not run
tsc or `npm run check`; the supervisor does.

## Report

Your final message: changed files with line ranges, each test and its result, anything in the module that looked
wrong, **Noticed, not done**. Under 400 words.
