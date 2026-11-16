# BRIEF — worker `time-t6a-w1` — firsthand: the message store's write path and its tests

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t6a`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

No SDK edit, no `sdk:build`, no `npm run build`, no dev instance, no GPU. Never touch the owner's server (a suspended `vite preview` on port 4173).

## Goal

Every new `session_messages` row records which cast members were there for it, in the new column
`firsthand_cast_member_ids` (`integer[]`, schema field `firsthandCastMemberIds`, already added; migration
`drizzle/0165_message_firsthand.sql` already generated). The module that owns it is already written:
`src/lib/server/messages/firsthand.ts` — **read it first, all of it**; do not change it. If it is wrong (an SQL
error, a wrong set), stop and report the failing test and the error; the supervisor fixes the module.

You wire it into the message store and prove it with tests.

## Owner rulings (quoted)

- 2026-11-14, ★5: "Presence per message needs a new stored fact (who was seated and not benched when a message
  was written)." §5.4: "Presence is per message, never per scene."
- 2026-11-11 (benched seats): one Benched section; core never benches by itself.
- Standing, "0.6 is in users' hands": a change to stored data ships with a forward migration (done) — existing rows
  get nothing: NULL means "not recorded", never "nobody was there".
- P2: one module owns the fact and every write to it — `firsthand.ts`. The store only calls it.

## Build

1. `src/lib/server/messages/store.ts`:
   - `insertLegacy` (~464): stamp with `withFirsthandStamp` from `./firsthand` (static import is fine: the module
     imports `sessions/seats` only dynamically), alongside the existing `withStoryClockStamp` / `withSpeakerStamp`,
     so the value goes into the existing INSERT. No new statement.
   - `insertLegacyMany` (~483): the same, per row.
   - `repointSpeakerStamps` (~444): after moving the speaker stamps, call `repointFirsthand(db, sessionId, moves)`
     so a member's mark moves with its lines. Keep its return value (lines moved) as it is.
   - Make sure `trimCommittedContent` and the typing still accept the stamped value (the module returns an SQL
     value typed as `number[]`; if TypeScript objects, report rather than casting widely).
   - Touch nothing else in the store.
2. New test file `src/lib/server/messages/firsthand.int.test.ts`. Model the harness on
   `src/lib/server/messages/speakerStamp.int.test.ts` / `store.int.test.ts` (createTestDb, seats written through
   `seatCast` / `seatPlayer` / `setSeatBench` from `sessions/seats.ts`, or directly as those tests do). Each `it`
   that opens a DB gets a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Cases:
   - a character's reply, a person's line (persona seat) and a narrator line (`isNarratorResponse: true`, no
     speaker) each record the cast members of every seat in play: character seats and player seats, ascending,
     one id per member;
   - an envoy seat (`envoySlug`) is not recorded; a benched seat (`isActive: false`) is not recorded; a seat that
     holds no cast member is not recorded;
   - a session with no seat in play records `[]` (not NULL);
   - a seat removed after a message stays recorded on that message, and is absent from the next one;
   - a caller that passes `firsthandCastMemberIds` (an array, or `null`) is left alone — `insertLegacy` and
     `insertLegacyMany`;
   - `firsthandOf` reads NULL as `{ recorded: false }` and `[]` as `{ recorded: true, castMemberIds: [] }`;
   - Back (`rewindTurn`, `src/lib/server/sessions/rewind.ts`) keeps the row's set on the rewound row and Forward
     (`forwardTurn`) brings it back unchanged; a deleted row (`deleteLegacy`) takes it with it — if driving
     `rewindTurn` needs more setup than a few lines, look at `rewindMirror.int.test.ts` for how it is done;
   - `repointSpeakerStamps(db, sessionId, new Map([[A, B]]))` moves A to B in every set of that session that held
     A, does not double B where B was already there, and leaves another session's sets alone;
   - **statements:** count statements as `store.contentMirror.int.test.ts` ~160–181 does (a drizzle client with
     a `logQuery` logger on the same `$client`): `insertLegacy` of the same line issues the same number of
     statements whether the caller passes `firsthandCastMemberIds` or the store stamps it (0 added), and
     `console.log` the count.

## Files owned

`src/lib/server/messages/store.ts` (only the three functions above), `src/lib/server/messages/firsthand.int.test.ts`
(new). Read anything; edit nothing else. Another worker is editing `pipelines/runtime/host.ts`,
`sockets/sessions.ts`, `sessions/branch.ts`, `sockets/import.ts` at the same time — never touch them.

## Rules

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a hardcoded id.
- Migrations are generated only (`db:generate`); a new migration's index must exceed the highest applied or it is
  silently skipped. You need none: if you think you do, stop and report.
- `$state(new Set())` is not reactive (not relevant server-side, but never use it client-side).
- Comments state the rule, not the story.
- Never `prettier --write` beyond the lines you changed; check with `npx prettier --check <file>` and report, do
  not reformat the file.
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Never pipe vitest into `head` (it leaks PGlite temp dirs).

## Done means

Another Claude session shares the checkout: before each run check
`ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait if one is running. Then, one at a time:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/messages/firsthand.int.test.ts > plans/time-t6a-w1-firsthand.log 2>&1"
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/messages > plans/time-t6a-w1-messages.log 2>&1"
```

All green (report any failure that is also red without your change, with the evidence). Do not run tsc or
`npm run check`; the supervisor does.

## Report

Your final message: changed files, each case and its result, the statement count printed, anything in the module
that looked wrong, **Noticed, not done**. Under 400 words.
