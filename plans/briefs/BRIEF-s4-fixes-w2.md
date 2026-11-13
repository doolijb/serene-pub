# BRIEF s4-fixes-w2 — card-less seats in stat trail, durable filing, supply, zones, presences, conversion (2026-11-08)

Supervisor: lane `s4-fixes` (wave 5; the seat-cast flip is ON — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Report back to the supervisor in your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Goal

A session can seat a **card-less character seat**: a `session_characters` row with `character_id` null and a `cast_member_id`. `sessionLinks` (`src/lib/server/state/resolve.ts` ~771–800) lists those in **`links.seatedMembers`** (🚧 ⏳ `SeatedMemberLink`, resolve.ts ~213: `seatMemberId`, `name`, `position`, `isActive`, `seatActiveCardId`, `castMemberId` = the member when it lives in the session's attached book, `ownBookMemberId` = the member when it lives in the session's own book). `stateFor` files each one as a cast entry keyed `seated_member:<seatMemberId>` with `id: 0`, `ref: "seated-member:<id>"`, `castMemberId: seatMemberId` (resolve.ts ~2296–2320); `chainFor` (~1364) resolves a `seated_member` owner with no card link down its member. A sibling worker already made the hearing, the state sockets and hand edits walk them (`state/earshot.ts` `hearingOf(..., seatedMembers)`, `sockets/state.ts`, `state/handEdits.ts` — read their current code as the pattern; don't edit them).

The readers below still walk **`links.cast` only**. Make each also walk `links.seatedMembers` (or, where the reader works on a book's members, make it accept a card-less member).

### The rule (apply it at every site)

- A card-less seat's **session-layer owner** is `{ kind: "seated_member", id: seat.seatMemberId }`; its key in `state.cast.byId` and in zones is `seated_member:<seatMemberId>` (`castMemberKey` / `castLinkKey` give this for a carded seat in member form — check what they do and use the same spelling); its participant **ref** is `seated-member:<seatMemberId>`.
- Its **durable owner** (the book's) is `{ kind: "cast_member", id: seat.castMemberId }` when its member lives in the attached book, or the own book's member (`ownBookMemberId`) on the own-book route.
- It has **no card**. ⚠ Never put a member id where a card id goes (card and member ids share one number range — a wrong-person read is silent). `seatActiveCardId` is only the member's active card, never the seat's identity.
- `links.seatedMembers` is filled only when `memberFormOn()`; absent reads as none (`?? []`). Don't add entries for a key the cast already lists.

## Sites (line numbers approximate)

1. **`src/lib/server/state/statTrail.ts`** — `sessionOwnerOf` (~131): `links` here is the **book's** `LorebookLinks` (every member of the book, card-less ones with `characterId: null`). Today `if (!member?.characterId) return null` drops a card-less member. With the flip on, find the seat by member in the seat map (`loadSeatMap` / `map.seats`, as the function already does below) and answer `{ kind: "seated_member", id }` for a character seat (player seat → `player_seat` as today); off, keep returning null for a card-less member. `durableOwnerFor` (~360): check a card-less `seated_member` owner reaches `{ kind: "cast_member", id }` (the `direct` branch should already find it — confirm with a test; fix only if it doesn't).
2. **`src/lib/server/sockets/statTrail.ts`** `readStatTrail`: confirm `storedSeatOwner` passes a card-less `seated_member` owner through (so the trail is readable for it). Fix only if it doesn't.
3. **`src/lib/server/state/durable.ts`** (~337 `recordOwnBookOwners`, ~370 the book route): a card-less **character** seat files its member's durable record — book route: `record({ kind: "seated_member", id: seat.seatMemberId }, { kind: "cast_member", id: seat.castMemberId }, "cast", seat.name)` when `seat.castMemberId`; own-book route (`recordOwnBookOwners`): into the own book with `seat.ownBookMemberId` (mirror how a carded seat's own-book member is chosen there, including the `allCast` condition). This follows ★f-emit-3 (lane s4-f-emit, recommended, **not yet ruled by the owner**): "only the character seat files the member's durable record; the player seat's values stay with the session." Every `seatedMembers` entry is a character seat, so all of them file. Read `heldByCharacterSeat` and keep the K-2 rule intact: if a carded link already files the same durable member, don't file it twice (say what you did).
4. **`src/lib/server/state/supply.ts`** (~156): the holders list also includes each card-less seat (`facet: "cast"`).
5. **`src/lib/server/state/presencesOnReading.ts`** (~159): the members whose zones are scanned also include card-less seats with a member in the read book (owner `seated_member`, key as `castLinkKey` would give; `bindingId` = the member id it uses for a carded seat's `castMemberId` — read what `bindingId` means for the caller and keep it consistent).
6. **`src/lib/server/sessions/convertRuleset.ts`** (~226): an added slot's default goes onto each card-less seat too (`{ kind: "seated_member", id }`), deduped as the block below does.
7. **`src/lib/server/state/lorebookState.ts`** (~172–404): this reads the **book's** members (all of them, card-less included, `characterId: null`). Verify with a test that a card-less member's durable value and sheet read through `lorebookStateFor` (or the exported reader) and that `normalizeOwner({ kind: "seated_member", id })` answers the member. Change code only if the test shows a gap (e.g. `characterId ?? 0` at ~172 must never let a `card` owner with id 0 through — check `worldAttributesFor`'s `member.characterId > 0` guard).
8. **`src/lib/server/state/resolve.ts`**: drop the private `ownOwnersOf` (~1443) if nothing calls it (grep `src/` and tests first; if something does, leave it and say so). Touch nothing else in resolve.ts.

Also grep `src/lib/server/state/**` for any other `links.cast` walk that builds per-seat owners/keys/holders and is not in the list above or in w1's files; list each in your report with a one-line verdict (needs the walk / doesn't), and fix only those that clearly need it under the rule (say which).

## Files you may edit

`src/lib/server/state/statTrail.ts`, `src/lib/server/state/durable.ts`, `src/lib/server/state/supply.ts`, `src/lib/server/state/presencesOnReading.ts`, `src/lib/server/state/lorebookState.ts`, `src/lib/server/state/resolve.ts` (`ownOwnersOf` only), other `src/lib/server/state/*.ts` only for the grep finds you justify, `src/lib/server/sockets/statTrail.ts`, `src/lib/server/sessions/convertRuleset.ts`, and new test files next to them. **Don't edit** `state/earshot.ts`, `state/handEdits.ts`, `sockets/state.ts` (done by w1), or anything outside `src/lib/server/state/`, `sockets/statTrail.ts`, `sessions/convertRuleset.ts`. Another worker is editing `src/lib/client/components/sessionForms/EditSessionForm.svelte` and `docs/` at the same time.

## Out of scope

Portrayals/runtime/client/widgets; renames; refactors; any behaviour beyond "the card-less character seat appears wherever a carded character seat does".

## Stop and ask (in your report, don't decide) when

- A site would need a new exported name, a wire-shape change, or a migration.
- Filing a card-less seat's durable record would write into a book the session may not write (check how the carded path decides the route, and don't widen it).
- A fix needs a file outside your list.

## Tests (Done means)

Write `src/lib/server/state/cardlessSeat.trail.int.test.ts` (split if cleaner): a session reading an attached book whose card-less member is seated as a character seat (flip on), plus one carded character seat; a declared cast stat slot and a list slot. Template on `src/lib/server/state/resolve.cardlessSeat.int.test.ts` and `src/lib/server/state/cardlessSeat.readers.int.test.ts` (same mocks, `memberFormSwitch`, `defineAttributeSlot`, `genreKeeping`). Assert:
- stat trail: a value written on the card-less seat (session layer) shows in `sessionStatTrail` / `readStatTrail` for owner `seated_member`; and the book-side trail maps the member to the `seated_member` session owner.
- durable filing: recording the session (the exported entry `durable.ts` offers — read `durable.int.test.ts` for how it's driven) files the card-less seat's value onto `cast_member:<member>` in the book; a second record changes nothing.
- supply: an item held in the card-less seat's list slot counts in the supply reader.
- convertRuleset: an added slot's default lands on the card-less seat (extend or mirror `sessions/convertRuleset.int.test.ts`).
- presences: if the genre/ruleset fixture needed for `presencesOnReading` is heavy, one case is enough; if you can't build it in reasonable effort, say so and test the owner list it builds instead.
- lorebookState: the card-less member's durable value reads back.

Then the neighbours: `state/statTrail.int.test.ts` (if present; else `sockets/statTrail.int.test.ts`), `state/durable.int.test.ts`, `state/presencesAtHour.int.test.ts`, `sessions/convertRuleset.int.test.ts`, `state/resolve.cardlessSeat.int.test.ts`, `state/memberForm.int.test.ts`, and any `state/*supply*` / `lorebookState` tests that exist (find them). All green (report any red that is red before your change too — check by reading, never by stashing).

Run tests only like this (capped scope, logged; never pipe vitest into `head`):

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-fixes-w2-tests.log 2>&1; echo test-exit=\$? >> $S/s4-fixes-w2-tests.log"
```

Then `npx tsc --noEmit -p .` under a 12G scope (`-p MemoryMax=12G`, `NODE_OPTIONS=--max-old-space-size=8192`), logged to `$S/s4-fixes-w2-tsc.log`. Note: lane s4-st runs beside us; tsc errors in its files (`lorebooks/starterKits*`, `plugins/providedPrimers.ts`, `cast/characterRows.ts`) are not yours — list them, don't fix them.

## Rules that apply (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." · "It is a **session**, never a *chat*."
- CLAUDE.md "0.6 is in users' hands": a change to stored data ships with a forward migration or boot pass — you change no stored data shape here; if you think you must, stop and ask.
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- NOMENCLATURE §24: "Grep for it first … Never ship a second meaning." Keep new names private; list every new name.
- An int test that opens a DB inside an `it` needs a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`).
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails only on lines you didn't touch, leave it and say so. Run `--write` on your **new** test files.

## Verbatim rules

- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.* (Name each dir exactly — `ls` first, then `rm -rf` the exact paths. No `*` in an `rm`.)
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.

## Report (final message)

Changed files with one line each; every new name; the grep list with verdicts; tests run with pass/fail counts and log paths; tsc before/after; decisions made (each named); stop-and-ask items; **Noticed, not done**.
