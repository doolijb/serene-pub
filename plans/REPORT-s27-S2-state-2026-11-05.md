# REPORT s27-S2-state (2026-11-05): state readers now read the seated member; seated-member refs are accepted at every door

**Status: BUILT.** Workers w1, w2 and w3 (Sonnet). Their briefs are `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-state-w{1,2,3}.md`, and the shared rules they quote are in `BRIEF-s27-S2-state-RULES.md`. I checked every report against its brief and read the key hunks. A scope-reviewer raised 4 findings, and all 4 are fixed (w3) or recorded (§25). No migration, no SDK edit, no sdk:build, no commit, no stash. No stored key and no emitted ref changed.

Relayed status question: none.

## The one exported helper I wrote
`src/lib/server/state/seatRefs.ts` (🚧). It translates refs at the door, where they first arrive:
- `storedSeatRef(db, sessionId, ref)` turns `seated-member:<memberId>` into the seat's stored ref:
  - `character:<cardId>` for a seat with a card (a carded player seat counts as its card);
  - `player-seat:<seatId>` for a card-less player seat.
- `storedSeatOwner(db, sessionId, owner)` turns `{kind:'seated_member', id}` into `session_cast` (by card) or `player_seat` (by seat id).
- `isSeatedMemberOwner(owner)` tests for that owner form.
- Both go through `seatOf`. Any other ref or owner comes back unchanged. The result is null when the member has no seat in the session.
- Nothing ever writes a `seated_member` row. `assertSessionOwner` still refuses that kind.

## What switched (file → reader)
**Names and ownership (w1)**
- **`state/resolve.ts` `sessionLinks`:**
  - Both seat queries are kept and now also select the seat id and `cast_member_id`.
  - One `seatedCastOf` call per session, skipped when no seat has a member.
  - `CastMemberLink.name` is the member as read, over the card the seat holds. On a player seat the seat name still wins. A seat with no member reads the card.
  - New 🚧 `CastMemberLink.seatMemberId` (see ★1).
  - `nextTurn` also accepts `seated-member:` (through `seatOf` to the card).
  - `personaOf` is left as it was (decision). With `overCards` the active card *is* the seat's card, so switching only adds queries.
- **`state/write.ts` `sealerName`** (the name in "that reply is sealed: ‹name› has spoken since"): `seatOf` + `memberAsRead` (overCards), else the card's name. It now takes `sessionId`.
- **`state/handEdits.ts`:**
  - Seat and character names come from batched member reads, each over its own seat's card.
  - Ownership is the owner of `activeCardId`, which is the seat's card.
  - The local `seatOf` is renamed `playerSeatOf` (R1).
- **`sockets/state.ts`:**
  - Owners are translated at the door in `state:set`, `state:configure`, `state:setCarry`, `state:setOwnerFace`, `state:givePiece` (from and to) and `state:showTieSide`.
  - The ledger's seat labels read the member; the Map is renamed `seatLabelOf`.
  - `ownSeatsOf` reads ownership through the member when the seat has a card and a member.

**Refs in (w2, w3)**
- **`rulesets/resolve.ts`:** one door for each raw input: `owners`, invoke `actor`/`aimedAt`, `actions` (now async), `viewer`, `deltas[].owner`/`aimedAt` (which also covers reply changes), and the zone asks (`storeZoneOps`, before `farEndsOf` and `planZoneOps`). An unseated member lands in `unknownOwners`.
- **`rulesets/ties.ts`:**
  - Doors: `endOf`, and `setTieSideShown` (a door for direct callers; the socket also translates, so its own kind check sees the stored kind).
  - Names: `nameOfKey` gained an optional `sessionId`, threaded from four callers. `drawTieSides`/`keyOfEnd` read the end's name through `memberAsRead` with overCards.
- **`rulesets/zones.ts` `farEndsOf`:** names come from the member. Its own translation was removed by w3, because `storeZoneOps` is the one door on that path.
- **`pipelines/runtime/bindings.state.ts`:** doors at `ownersFrom` (now requires `db`), the change line's `owner`, and `keepsFrom` (now requires its translator).
- **`sockets/statTrail.ts`:** translates after the access check, so a stranger learns nothing.
- **`sessions/seatPortrait.ts` and `sessions/seatName.ts`:** take a `seated_member` owner. Ownership goes through the member when the seat has a card and a member, else the card as today.

## What still reads the card, and why
- **The `card` owner kind's own values and the card editor:** `state/cardState.ts` (~116, ~336) and `state/declarations.ts` (~866).
- **Stored-key mappings:** `state/worldScope.ts` (player seat → `session_cast(personaId)`), `sessions/convertRuleset.ts` and `rulesets/tryOut.ts` (sample owners, no session).
- **Durable routing through `CastMemberLink.castMemberId`:** `state/statTrail.ts` (`sessionOwnerOf`, ~358), plus `chainOf`/`castMemberOf` in `sockets/state.ts`.
- **Item-4 sweep, checked by me, no change needed:** these use the card id only as the stored key — `give.ts` (isPlayersSeat), `supply.ts`, `presencesOnReading.ts`, `sessionLoreRefs.ts`, `owners.ts`, `earshot.ts` (emits `character:` hearing refs), `carries.ts`. `durable.ts` takes `member.name` from `links.cast`, so it now gets the member's name for free. `storyTime.ts` and `lorebookState.ts` name *book* members from the stored member row. Those are not seat readers and not card reads (see Noticed).
- **Emitted refs stay `character:<cardId>`:** for example `rulesets/engine.ts` `PARTICIPANT_KEY`, and the `drawTieSides` key built from the member's linked card.
- **`pipelines/runtime/tools/stateTools.ts`:** no change. It matches names through the `session_cast` read in `host.ts`, which lane s27-S2-promptText fills from the member.

## Changed files
- **Edited:**
  - `src/lib/server/state/resolve.ts`, `state/write.ts` (sealerName and imports only), `state/handEdits.ts`
  - `src/lib/server/sockets/state.ts`, `src/lib/server/sockets/statTrail.ts`
  - `src/lib/server/rulesets/resolve.ts`, `rulesets/ties.ts`, `rulesets/zones.ts`
  - `src/lib/server/pipelines/runtime/bindings.state.ts`
  - `src/lib/server/sessions/seatPortrait.ts`, `src/lib/server/sessions/seatName.ts`
  - `NOMENCLATURE.md` §25: three rows appended after the last row.
- **New:**
  - `src/lib/server/state/seatRefs.ts`
  - `src/lib/server/state/seatMember.int.test.ts`
  - `src/lib/server/rulesets/seatedMemberRefs.int.test.ts`
- I also changed one existing §25 row's text: s27-S2core's `seatedCastOf` row said "card-keyed until S2-state switches it". It now says "card-keyed; its names read the member since S2-state". Revert it if you want rows to stay untouched.
- Existing files were hand-formatted. Prettier was run only on the new files, and all three now pass `--check`.

## Tests (worker runs; every batch green)
- **New `state/seatMember.int.test.ts`** (9 tests):
  - a member's own name on the entry, `seatMemberId`, and `castMemberId` left alone;
  - a seat with no member reads the card;
  - a carded player seat;
  - two seats on one member, each read over its own card;
  - the sealed refusal names the own name;
  - a `seated_member` owner writes the same `session_cast:<card>` row, and no `seated_member` row exists;
  - the not-theirs sentence names the own name;
  - **a seat holding a dated card reads that card** (name and owner), while `memberAsRead` without overCards returns card B.
- **New `rulesets/seatedMemberRefs.int.test.ts`** (7 tests):
  - the ref reads the same sheet and writes the same row as the card ref, and an unseated member is refused;
  - `ownersFrom` (seated, unseated, two seats);
  - `readStatTrail` gives the same trail, and a stranger is refused;
  - `farEndsOf` gives the own name, or the card name with no member;
  - two seats on one member resolve to the lowest position.
- **Existing suites, unchanged:**
  - w1: `state/{write,handEdits,worldScope,resolve,write.ownerGone,declarations}.int`, `sockets/{state,state.ownerScope,state.earshot,state.ledger,state.attributes,cardState}.int`: 13 files, 231 passed.
  - w2: `rulesets/{ties.int,resolve.int,zones,engine,tryOut}`, `stateTools`, `sockets/statTrail.int`, `sessions/convertRuleset.int`, `readsPairing`, 10 `bindings.state` importers, `sessions.dungeonCrawler.int`, `seatSites.int`: 286 passed.
  - w3 re-ran after its fixes: 5 files, 53 passed; then 3 files, 70 passed.
- **Existing tests edited:** none. The only edit to a test file was w3 dropping one `seated-member:` op it had itself added to the new `seatedMemberRefs` test, now that `farEndsOf` is no longer a door.
- **Not run by this lane, as the brief scoped:** `rewind.int`, `imprints.int`, `rewindMirror.int`. They are left for the lead's grouped run.
- **`npx tsc --noEmit -p .`:** nothing in lane files (I ran it myself).
- **Intended behaviour change:** no existing test changed. The change itself: a member with `ownName` is now named by it in `SessionLinks` and `stateFor`, and its `state.cast.<slug>` key follows that name (`castKey(name)`). `byId` stays keyed by card id. No existing state test covers an own-name member.

## §25 rows added
1. `storedSeatRef` / `storedSeatOwner` / `isSeatedMemberOwner`, with a charter: no `seated_member` row in S2.
2. `CastMemberLink.seatMemberId`, with the "⚠ Not `castMemberId`" warning and the slug consequence.
3. The R1 renames `playerSeatOf` and `seatLabelOf`.

## Open ★
- **★1 (new name):** the lane brief said cast entries "gain `castMemberId`". But `CastMemberLink.castMemberId` already exists and means the attached book's member. It routes durable values, and the §25 m3b-V2 row says "⚠ `castMemberId` still means the attached book's member". A stored seat member can sit in the own book, or in a previously attached book (a fill never clears it), so redefining the field would move durable values. I built 🚧 **`seatMemberId`** instead (recommended). The alternative is to redefine `castMemberId` and re-audit durable routing.
- **★2 (copy):** the socket door's refusal for a member with no seat reuses the state layer's lower-case sentence _"that character is not in this session's cast."_ verbatim (`write.ts`). Keep it, or capitalise / give it new copy.
- **★3 (user-visible, intended per brief):** for a member with `ownName`, these now say the own name: the sealed-turn refusal, hand-edit refusals, ledger seat labels, tie-end names and the template slug `state.cast.<key>`.

## Queued for other lanes
- **s27-S2-promptText, `pipelines/runtime/host.ts` ~8540–8545 / ~8612 (configure-stat):** it calls `castOwnerOfRef(p.owner)` on a raw ref. Put `storedSeatRef(db, sessionId, ref)` first. Its halt sentence "name a seat (player-seat:<id>, character:<id>)" would need the new form (★ copy).
- **Other lanes' "no book" wording** (common §9): `state/resolve.ts:247` (the m3b-V2 `valuesOwnBookId` doc, "it reads no book") and `state/worldScope.int.test.ts:553` (`describe("a session with no book …")`). Neither is in this lane's hunks; add them to the S4 wording sweep.

## Noticed, not done
- **`lorebookState.ts` `lorebookLinks` and `storyTime.ts`** name book-side members from the stored `lorebook_bindings.name`, which is synced from the card, so `own_name` is not applied there. These are book views, not seat readers. Whether the lorebook's state view should use `memberAsRead` is a question for the lead; it would move book-side slugs for own-name members.
- **`proposalHeard`** in `sockets/state.ts` reads owners from stored proposal payloads, which hold stored kinds only. A future `seated_member` proposal path must translate at its door.
- **`replies.ts`** turns an object owner with `String(c.owner)` in reply zone asks. A `{kind:'seated_member'}` object is no worse than a `{kind:'session_cast'}` object is today; string refs work.
- **Stored seat member can go stale:** a stored seat `cast_member_id` from a previously attached book is never cleared by fill-only settling, so `seatedCastOf` can read a stale member's name after a swap. This affects every S2 reader. It goes away with S4's no-swapping.
- **S4 rekey items met:**
  - `session_cast:<cardId>` owners everywhere in `state/**` and `rulesets/**`;
  - `state.cast.byId[<cardId>]`;
  - `CastMemberLink.castMemberId` durable routing;
  - `givePlayerSeatACard` (`seatName.ts`);
  - `worldScope.ts` `ownBookMemberOf` (mints an own-book member by card);
  - stored `character:<cardId>` keys in `zone_contents` and in tie entries' `towards`/`sideOwner`;
  - `drawTieSides`' key taken from the linked card;
  - the `sealerName` world branch, which resolves the speaker by card only;
  - card-less ownership: every ownership read falls back to the seat's card when `activeCardId` is null (S4 rules a card-less member as the session owner's).
- **Two notes for the lead:**
  - The §25 `seatOf` row still mentions "the local `seatOf` closures in `state/handEdits.ts`". That closure is now `playerSeatOf`, which my rename row records.
  - `seatCardOwner` is duplicated, not shared, in `seatName.ts` and `seatPortrait.ts`, to avoid a new export.
## Lead dispositions (2026-11-05)
- ★1 `seatMemberId` beside the existing `CastMemberLink.castMemberId` (attached book's member, routes durable values) → **accepted as built** (redefining `castMemberId` would move durable values; S4 settles the pair).
- ★2 the door's refusal reuses _"that character is not in this session's cast."_ → kept.
- ★3 own names now shown in refusals, ledger labels, tie ends and the `state.cast.<slug>` key → the intended S2 change (contract item 6).
- Queued `host.ts` configure-stat (`castOwnerOfRef(p.owner)` on a raw ref) → sent to lane s27-S2-pT2 (owns `host.ts` hunks now); its halt sentence copy stays until S3.
- "No book" wording at `state/resolve.ts:247` and `state/worldScope.int.test.ts:553` → S4 wording sweep.
