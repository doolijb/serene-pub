# BRIEF s4-last-w1 — a branch keeps card-less seats (★s4-fold2-3, S4 regression) — 2026-11-08

Supervisor: lane `s4-last`. You are a lane-worker; you edit only the files below.

## Goal

`src/lib/server/sessions/branch.ts` `branchSession` copies the parent's seats. Today (~194–214) it keeps a character seat only with `characterId || envoySlug`, so a **live card-less character seat** (`character_id` null, `envoy_slug` null, `cast_member_id` set) is dropped as "departed"; and the player-seat copy (~224–251) calls `seatPlayer` with `personaId` + `deferMember: true` and no `castMemberId`, so a **card-less player seat** (`persona_id` null, `cast_member_id` set) comes across without its member. Fix both:

1. Character seats: keep a non-removed seat when it has a `characterId`, an `envoySlug`, **or a `castMemberId`**. "Departed" = no card, no envoy, no member (update the comment ~183–193 to say so). Seat a card-less one (no `characterId`, no `envoySlug`) through the one seat writer's member form: `seatCast(tx, { sessionId: created.id, castMemberId: sc.castMemberId, position, isActive, onExisting: "keep", seatedBy })`. Carded and envoy seats keep today's call exactly. `seatCast` by `castMemberId` **requires** a numeric `seatedBy` (it throws otherwise): pass `sc.seatedByUserId ?? original.userId` (a card-less seat always has a seater, since its writer requires one; the fallback is the session owner — say so in a one-line comment). `seatCast` returns `{ ok: false, refusal }` when the member doesn't live in the session's books (`checkSeatMember`, `seats.ts` ~420–464): the branch must not silently drop the person — throw `new BranchError(refusal)` (the transaction rolls back). The member check passes for the parent's own-book people because the branch row is inserted with `branchAncestry` naming the parent first, and `seatBookOf` reads ancestors' own books (`seats.ts` ~213–274).
2. Player seats: for a seat with `personaId == null && castMemberId != null`, pass `castMemberId: sp.castMemberId` to `seatPlayer` (keep `onExisting: "insert"`, `seatName`, `userId`, portrait, `removedAt`, `removedName`; drop `deferMember` for that call only if needed — read `seatPlayer` ~826–995: the member form checks the member and **throws** its refusal sentence; wrap that as `BranchError` too). Carded player seats keep today's call exactly (their member comes from `settleSeats` with `parentSeatMembers`).
3. Copied lines of card-less seats: the seats now exist with their member before the copy is inserted, so `insertLegacyMany`'s speaker stamp (`messages/store.ts` `withSpeakerStamp`/`speakerSeatOf` ~163–294: `seated-member:<id>` / `player-seat:<id>` speakers resolve through `seatOf`) should stamp them. **Verify in the test** that a card-less character seat's copied line and a card-less player seat's copied line carry the member (`cast_member_id`). If they don't, report why — don't change `messages/store.ts`.

## Rules you work under (quoted by the supervisor)

- Owner 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member keeps acting for that seat (`seated_by_user_id`).
- ★CV-14 (plan §32 §5d): a branch's seat points at the member the parent's seat holds — the parent's own-book people included — never a new one. (A branch rides its parent's people.)
- `seats.ts` is the **one seat writer**; never insert into `session_characters` / `session_personas` yourself, and don't edit `seats.ts`.
- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- It is a **session**, never a chat. Never write copy or comments that frame a session as having no lorebook (own book / overlay).
- Decide implementation; name each choice in your report. Don't add new exported names, settings or events.

## Files owned

- `src/lib/server/sessions/branch.ts` (the seat copy in `branchSession` only, ~183–254)
- New test `src/lib/server/sessions/branch.cardlessSeats.int.test.ts` (model it on `branch.seatMembers.int.test.ts`: its `vi.mock` block, `beforeAll` data dir prefix `serene-pub-vitest-branch-cardless-seats-`, `releaseDataDir`, 60 s timeouts).

Readable: `sessions/seats.ts`, `messages/store.ts`, `sessions/branch.*.int.test.ts`, `sessions/seats*.int.test.ts` (for how a card-less seat is made: `seatCast({ castMemberId, seatedBy })` with a card-less member from `insertCastMember(tx, { lorebookId, characterId: null, binding, name })` in `characters/versions.ts`, and `seatPlayer({ castMemberId })`).

## Test (Done means)

`branch.cardlessSeats.int.test.ts`: a session with (a) a live card-less character seat seated by user B (a guest, not the owner), (b) a live card-less player seat with its `userId` and a seat name, (c) a carded character seat, each with a line; branch at the last line. Assert the branch has: the card-less character seat, same `cast_member_id`, `character_id` null, `seated_by_user_id` = B, live; the card-less player seat, same `cast_member_id`, same `user_id` and seat name; the carded seat as before; and the copied card-less lines carry their members. Also one assertion that a **departed** row with no card, envoy or member is still not copied. Run, plus the existing branch tests:

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/sessions/branch.cardlessSeats.int.test.ts src/lib/server/sessions/branch.seatMembers.int.test.ts src/lib/server/sessions/branch.ancestry.int.test.ts src/lib/server/sessions/branch.state.int.test.ts src/lib/server/sessions/branch.clock.int.test.ts src/lib/server/sessions/branch.revision.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-last-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-last-w1-tests.log'
```

Never pipe vitest into `head`. Then `npx prettier --check` on the two files.

## Stop and ask when

A refusal you can't avoid, a need to edit any other file, a new name/setting/event, or a test that shows the stamp doesn't follow. Report and stop.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Report

In your final message (not a file): changed files with line ranges, each implementation choice, tests run with pass/fail counts (from the log), prettier result, anything noticed but not done.
