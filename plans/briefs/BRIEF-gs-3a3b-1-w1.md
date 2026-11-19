# BRIEF gs-3a3b-1-w1 — a line's seat is resolved within the line's own kind (owner ruling MV2, 2026-11-17)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `gs-3a3b-1`. You type; you do not decide
anything a user sees. Report back in your final message (under 400 words).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

The repo is staged by the lead: run **no git command that changes the index or the working tree** (no
checkout, restore, add, reset, stash). Never run prettier with `--write` and never pipe its output into a
file. No SDK edit or build, no `npm run build`, no full test run, no migration.

## Why (the owner's words)

MV2 (2026-11-17): "Earlier lines move to the new seat and keep their kind": what a person typed stays a
person's line, by that person; what the AI wrote stays the AI's; **nothing about who may edit an old line
changes**. A later lane lets the session's owner move a guest's player seat (persona) to the AI-played
group: the old player seat is soft-removed (`removed_at` set) and a character seat for the same card or
cast member is created or revived. Lines are never rewritten: a person's line keeps `role 'user'`,
`user_id`, `persona_id` and its stamp `metadata.speaker = "player-seat:<id>"`.

Today who may edit a line is decided by the **seat** the line resolves to, and that resolution crosses
kinds: `seatOf` (`src/lib/server/sessions/seats.ts` ~1994–2096) prefers a **live** seat in either table,
then the character seat over the player seat. So after such a move a person's line with no stamp, or
`character:<card>`, would resolve to the new live character seat, and the right to edit it would follow
that seat's actor. Your task removes that crossing.

## The rule to build

**A line's seat is resolved only among seats of the line's own kind, removed (departed) seats included;
within the kind a live seat still wins over a departed one, then position, then id (as today).**

- A **person's line** (`persona_id` set): against **player seats** only — the seat its stamp names when the
  stamp is `player-seat:<id>`, else the player seat whose `persona_id` is the line's card. No player seat
  at all (live or removed) holds it: judged by the card's owner (`ownsCharacter`, today's last fallback).
- An **AI line** with `character_id`: the session's owner may (unchanged); else against **character seats**
  only — the seat its stamp names when the stamp is `seated-member:<id>`, else the character seat whose
  `character_id` is the card; none: the card's owner (`ownsCharacter`).
- A **card-less character line** (stamp `seated-member:<id>`, no card, not narration): the owner (unchanged),
  else the character seat holding that member, live or departed — **never a player seat**.
- Every other branch of `canActOnMessage` (envoy, narration, author rule for a user line with no persona,
  orphan) is unchanged. A stamp of the other kind is ignored (not followed across kinds).
- The actor of the resolved seat is still `seatActorOf` (`seats.ts` ~2169): a character seat's
  `seated_by_user_id`, a player seat's `user_id`, with its existing fallbacks.

## Files you may edit

1. `src/lib/server/sessions/seats.ts` — **only `seatOf`**: add an optional 4th argument
   `opts?: { kind?: "character" | "player" }`. With `kind`, only that table is searched (same order: live
   then departed, position, id); a `player-seat:` ref with `kind: "character"` answers null. Without it,
   behaviour is byte-for-byte as today (55 callers rely on it). Update its doc comment (state the rule).
   **Another lane (`el-1a`) may edit `seats.ts` where a member is created: re-read the file right before
   your edit and change only `seatOf`.**
2. `src/lib/server/messages/permissions.ts` — `ownsSeatedCard` and the card-less branch of `canActOnMessage`
   take the line's kind and call `seatOf(..., { kind })`. Keep `memberFormOn()` as the gate on reading the
   stamp. Update the module's rule comment and the function's comment to state the rule.
3. `src/lib/client/components/sessionPage/sessionPageProjections.ts` — **only `canControlMessageAs`**
   (~254–300), and only if it does not already hold the rule. Read it first: it filters by kind already
   (persona lines against `session.sessionPersonas`, character lines against `session.sessionCharacters`;
   the client payload from `getSessionFromDB`, `server/sockets/sessions.shared.ts` ~641, keeps removed seat
   rows). Prove it with tests; change code only if a test shows it crosses kinds. If you change nothing,
   say so.
4. New tests (your files):
   - `src/lib/server/messages/permissions.ownKind.int.test.ts` (copy the harness of
     `src/lib/server/messages/permissions.cardless.int.test.ts`: test DB mock, data dir, `releaseDataDir`;
     use `memberFormSwitch` from `$lib/server/state/memberForm` if the flag must be on, as
     `src/lib/server/sockets/sessions.ownerCardForGuest.int.test.ts` does).
   - `src/lib/client/components/sessionPage/sessionPageProjections.ownKind.test.ts`.
   - A small block in `src/lib/server/sessions/seatOf.int.test.ts` for the `kind` option (live/departed
     order within a kind; `player-seat:` with `kind: "character"` is null; no `kind` = unchanged).

## Tests to write (state "after a move" by writing rows directly: soft-remove the player seat with
`removed_at`, then seat a character seat for the same card with `seatCast`, `seatedBy` as below)

Server (`canActOnMessage`):
1. A guest's persona (the guest's own card) with lines (insert through `insertLegacyMany` from
   `$lib/server/messages/store`, so the stamp is written as in production), then "moved": player seat
   removed, character seat on the same card live with `seatedBy` = the guest. The guest may still change
   and rerun their earlier person lines; the session's owner may **not**; a third member may not.
2. Same, for lines with no stamp (`metadata` null) and `persona_id` set: still the guest's, not the owner's.
3. A new AI line of that character seat (`character_id` the card, `role 'assistant'`): the owner may; the
   guest (the seat's actor) may; a third member may not.
4. A card-less member: the guest's card-less player seat (`user_id` guest, `cast_member_id` M, no card)
   with person lines, then removed and a card-less character seat of M seated by the session's owner: the
   guest still edits their earlier lines; the owner does not; a new `seated-member:M` AI line: owner yes,
   guest no.
5. ★K-2, no move: a card held by a live player seat (guest) and a live character seat (owner-seated) at
   once: a person line is the guest's, an AI line the owner's and not the guest's — as before.

Client (`canControlMessageAs`), with a payload carrying the removed player seat (`removedAt` set) and the
live character seat: the same expectations as 1, 3, 4, 5.

## Done means

- Every existing permission test green **untouched** (do not edit their expectations; if one fails, stop
  and report it with the failing assertion): run
  `src/lib/server/messages/permissions.cardless.int.test.ts`
  `src/lib/server/messages/seatMemberNames.int.test.ts`
  `src/lib/server/sessions/actingRights.int.test.ts`
  `src/lib/server/sessions/cardlessSeat.e2e.int.test.ts`
  `src/lib/server/sessions/seatOf.int.test.ts`
  `src/lib/server/sockets/sessions.ownerCardForGuest.int.test.ts`
  `src/lib/server/sockets/sessionMessages.laneEnvoySwipe.int.test.ts`
  `src/lib/server/messages/store.memberForm.int.test.ts`
  `src/lib/client/components/sessionPage/sessionPageProjections.cardless.test.ts`
  `src/lib/client/components/sessionPage/sessionPageProjections.personaSeat.test.ts`
  `src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts`
  plus your new files.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — 0 errors in your files (report the
  total).
- `npx vitest run src/lib/shared/conformance/commentHistory.test.ts` green.

### How to run tests (exactly)

Before **every** vitest run: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`. Then
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "cd /home/jody/github/serene-pub && npx vitest run --maxWorkers=3 <paths> > plans/gs-3a3b-1-<n>.log 2>&1"`
(always at least one path; `<n>` = 1, 2, 3 … per run; read the log with `tail`/`grep`, never pipe vitest
into `head`). One run at a time.

## Rules you work under (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite
  silently." Every function here takes its handle first; never import `$lib/server/db` statically in
  `seats.ts` ("⚠ No static import of `$lib/server/db`, here or through anything this module imports").
- Comments state the rule, never the history (no "used to", "now", "was", "previously", dates of changes):
  `src/lib/shared/conformance/commentHistory.test.ts` enforces it.
- "It is a **session**, never a *chat*." No new names beyond the `kind` option; no new setting, flag, event
  or table. Do not fix anything else you notice: list it under **Noticed, not done**.
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation" (only if you touch client
  state; you should not need to).

## Report

Changed files with the functions touched; the rule before → after in two lines; each test with its result
(file, count passed/failed); `tsc` total; the client verdict (changed or not, and why); **Noticed, not done**.
