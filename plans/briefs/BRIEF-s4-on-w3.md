# BRIEF s4-on-w3 — stale session/ruleset/reply tests after the S4 flip (2026-11-08)

Read first, and follow: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s4-on-common-tests.md` (shared rules, verbatim lines, how to fix, test command, report shape).

## Files owned (edit only these)

- `src/lib/server/rulesets/seatedMemberRefs.int.test.ts` — 3 failing (S3 door tests: "none is stored under seated_member", "the seat's cast owner", "two live seats on one member: the lowest position's card") → choice 1 (pin off + on sibling asserting `seated_member` with the member id; for the two-seats case the on answer is the member of the lowest-position seat).
- `src/lib/server/sessions/creationModes.seatedAudience.int.test.ts` — 1 failing, named "stores a declared audience in the card form" → choice 1 (on: a `seated-member:` audience is stored as `seated-member:<id>`; check what the code returns for the card-form and role inputs too and assert it).
- `src/lib/server/sessions/fireTurn.seatedMember.int.test.ts` — 1 failing, "the translated ref is the card's" (door test calling `storedSeatRef`) → choice 1. Note `storedSeatRef` now returns a card-form input it cannot translate unchanged rather than null (owner-queued ★f-emit-2, applied today).
- `src/lib/server/sessions/creationModes.seatMember.int.test.ts` — 2 failing (~l.200–230): `carryFrom` reads `attribute_values` by `ownerKind: "session_cast"`; on, the carried value lands under the new seat's member form (`seated_member`, id = the into-seat's `cast_member_id`) → choice 3: read the into-session's rows for this slot of either kind and assert `[ownerKind, ownerId, value]` with the member-form expectation (`["seated_member", <into seat's castMemberId>, 40]`). Keep "nothing carries" as is. If the carried row is genuinely missing (no row of any kind), stop and report it — that would be a production bug.
- `src/lib/server/utils/replyRoad.int.test.ts` — 1 failing (~l.775): the receipt's portrayals key for the owner's persona seat is `player-seat:<seatId>` when on (every player seat is `player-seat:`), not `character:<personaCardId>` → choice 2 (read the inserted `session_personas` row's id; `.returning()` it).
- `src/lib/server/sockets/appletSessions.int.test.ts` — 1 failing, "name + a declared field + attach / detach a readable book" (~l.164–182). Not the flip: owner ruling ★B-5 (2026-11-08) "the book is **fixed at start** — chosen at create" and ★27-10 "No swapping lorebooks"; `bookChangeRefusal` is unconditional (a different `lorebookId` is refused with *"A session keeps the lorebook it started with."*, the same value is accepted). Change the attach/detach half to: attaching a different book is refused with that sentence and the row's `lorebookId` is unchanged; sending the session's current `lorebookId` back is accepted. Keep the name/field half as is. Rename the test title's "attach / detach a readable book" to say the book is kept (e.g. "…; a different book is refused, the same one passes").

## Done means

All six files pass with the switch on, in one capped run of exactly these six files, log `s4-on-w3-tests.log`.
