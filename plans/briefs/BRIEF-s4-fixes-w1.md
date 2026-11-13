# BRIEF s4-fixes-w1 — card-less seats in the hearing, the state sockets and hand edits (2026-11-08)

Supervisor: lane `s4-fixes` (wave 5; the seat-cast flip is ON — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Report back to the supervisor in your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Goal

Since lane s4-seat-live, a session can seat a **card-less character seat**: a `session_characters` row with `character_id` null and a `cast_member_id`. `sessionLinks` (`src/lib/server/state/resolve.ts` ~771–800) lists those in **`links.seatedMembers`** (🚧 ⏳ `SeatedMemberLink`, resolve.ts ~213: `seatMemberId`, `name`, `position`, `isActive`, `seatActiveCardId`, `castMemberId` (member when it lives in the attached book), `ownBookMemberId` (member when it lives in the session's own book)). `stateFor` already files each one as a cast entry keyed `seated_member:<seatMemberId>` with `id: 0`, `ref: "seated-member:<id>"`, `castMemberId: seatMemberId`, `cardId: seatActiveCardId` (resolve.ts ~2296–2320), and `chainFor` (~1364) already resolves a `seated_member` owner with no card link down its member.

But the readers below walk **`links.cast` only**, so a card-less seat is missing: the sheet widget shows no sheet for it, its seater doesn't hear its holder-only values, carries list no holder for it. Make each walk also walk `links.seatedMembers`.

### The rule (apply it at every site)

- A card-less seat's **owner** is `{ kind: "seated_member", id: seat.seatMemberId }`. Its **heard/carry key** is `seated_member:<seatMemberId>` (what `valueHeard` in `earshot.ts` already tests for `seated_member`, and what `carryKeyOf` gives for that owner — check `carryKeyOf`). Its participant **ref** is `seated-member:<seatMemberId>`.
- It has **no card**. ⚠ Never put a member id where a card id goes (card and member ids share one number range — a wrong-person read is silent). `seatActiveCardId` is the member's active card on the timeline (may be null); use it only where the carded code uses a *face/active card*, never as the seat's identity.
- Its chain layers are its member (`castMemberId` or `ownBookMemberId`), as `chainFor` does.
- Dedup: `sessionLinks` already dedups a member seated twice; don't add a second entry for a key the cast already lists.
- Everything stays gated as the existing code is: `links.seatedMembers` is only filled when `memberFormOn()`, and absent reads as none (`?? []`).

## Sites (line numbers approximate — read around them)

1. **`src/lib/server/state/earshot.ts` `hearingOf` (~299) / `hearingInMemberForm` (~345).** Add an optional parameter for the card-less seats (e.g. `seatedMembers: ReadonlyArray<{ seatMemberId: number }> = []`, after `playerSeats`). In member form, each is asked for by ref `seated-member:<id>` and heard under key `seated_member:<id>`. (Off mode never has any; ignore them there.) Update the three callers to pass `links.seatedMembers`: `sockets/state.ts` ~325 (`callerHearing`) and ~1853 (`carriesOnWire`), `state/handEdits.ts` ~186. Check how `resolvePortrayals` (`src/lib/server/pipelines/runtime/portrayals.ts`) answers a `seated-member:` ref for a card-less seat (s4-seat-live made the **seater** act for it, owner ruling ★S2b-1 2026-11-05 "Still theo": "the person who seated a cast member keeps acting for that seat (`seated_by_user_id`)"); if it does not, stop and report — don't edit portrayals.ts (not this lane's file).
2. **`src/lib/server/sockets/state.ts`:**
   - `chainOf` (~448): a `seated_member` owner not found in `links.cast` → find it in `links.seatedMembers` and resolve with `castMemberId: seat.castMemberId ?? seat.ownBookMemberId ?? null` (match what `chainFor` in resolve.ts does for the card-less case — read it and mirror it), `characterId: null`.
   - The owner rows (~632): after the `links.cast` rows, one row per card-less seat: `key: castKey(seat.name)` (as a carded character seat's row uses `castKey(member.name)` — check this matches what `stateFor` uses as the slug key in `cast` so widgets matching by key find it), `kind: "seated_member"`, `id: seatMemberId`, `label: seat.name`, `ref: "seated-member:<id>"`, `castMemberId: seatMemberId`, `editable: false`, `face`: the member's face if `facesOf` (or a reader already at hand in this file) can give it cheaply, else `null` (say which in your report), `mine` when `myMembers.has(seatMemberId)` (the `ownSeatsOf` result already returns `memberIds`), no `seat` flag (a character seat), `configs: {}`. The rest of the loop (configs, `handLocked`, `editable`) then runs for it unchanged.
   - `ledgerFor` (~862): `memberOfSeatMember` should name a `seated_member` row of a card-less seat too (its `name`).
   - `ledgerBaselines` (~1107): the `memberByKey` map and the `layers` list — add the card-less seats (layer: its member as `cast_member`, no `card` layer).
   - `castMemberOf` (~303) is `cast_member` id → card id for `valueHeard`; leave it (a card-less seat has no card).
   - `carriesOnWire` (~1867): holders also list each card-less seat (`{ kind: "seated_member", id }`, `seat.name`); `mayChange` already accepts `seated_member`.
3. **`src/lib/server/state/handEdits.ts`:** s4-seat already added `seaterOfMember` (a card-less seat is its seater's) and `state/handEdits.cardless.int.test.ts` covers one case. Finish the walk:
   - ~186 pass `links.seatedMembers` to `hearingOf`.
   - ~260 / ~325 `seatMemberOfSeat` / `learnCharacters`: a card-less seat has no card, so `learnCharacters` (card facts) can't name it — make `factsOfOwner` for a `seated_member` with no card link answer from `links.seatedMembers` (name = `seat.name`; userId = the owner of `seatActiveCardId` if that's what the carded path does for "whose", otherwise null — read the role logic and keep it consistent with the seater rule already there).
   - ~384 `characterOf`: a card-less `seated_member` has no character — returning `undefined` is right; make sure callers then fall back to the seater rule, not to "nobody".
   - ~488 the refusal sentence's `name`: a `seated_member` owner of a card-less seat is named by `links.seatedMembers` (today it finds no card and says "that character").

## Files you may edit

`src/lib/server/state/earshot.ts`, `src/lib/server/sockets/state.ts`, `src/lib/server/state/handEdits.ts`, and new test files next to them. Read anything. Another worker (w2) is editing `state/statTrail.ts`, `state/durable.ts`, `state/supply.ts`, `state/lorebookState.ts`, `state/presencesOnReading.ts`, `state/resolve.ts`, `sessions/convertRuleset.ts`, `sockets/statTrail.ts` **at the same time — don't touch those.**

## Out of scope

Any other reader (portrayals, runtime, client, widgets), new behaviour beyond "the card-less seat appears wherever a carded character seat does", renames, refactors.

## Stop and ask (in your report, don't decide) when

- A site would need a new exported name, a new socket field or a changed wire shape beyond adding rows of the existing shape.
- `resolvePortrayals` doesn't answer a card-less seat's ref for its seater.
- A fix needs a file outside your list.

## Tests (Done means)

Write `src/lib/server/state/cardlessSeat.readers.int.test.ts` (or split per file if cleaner): a session with one **carded** character seat and one **card-less** character seat (flip on), a seater who is a guest (not the session owner), and a declared holder-only cast slot. Template the setup on `src/lib/server/state/resolve.cardlessSeat.int.test.ts` and `src/lib/server/state/handEdits.cardless.int.test.ts` (same mocks, `memberFormSwitch`, `defineAttributeSlot`, `genreKeeping`; `sessions/seats.ts` `seatCast({ castMemberId })` or the same inserts those tests use). Assert:
- `hearingOf` for the seater hears `seated_member:<id>`; another guest doesn't.
- `state:get`'s owner rows (call the exported builder or handler the existing `sockets/state.int.test.ts` / `state.seatIdentity.int.test.ts` call) include a `seated_member` row for the card-less seat with its configs, `mine` for its seater, and a value written on it reads back.
- the hand-edit judge lets the seater set a holder-only value on it and refuses another guest with a sentence naming the member.
- `carriesOnWire` (through `state:attributes`) lists the card-less seat as a holder.

Then run the neighbours: `src/lib/server/state/earshot.test.ts`, `state/handEdits.int.test.ts`, `state/handEdits.cardless.int.test.ts`, `state/resolve.cardlessSeat.int.test.ts`, `sockets/state.int.test.ts`, `sockets/state.earshot.int.test.ts`, `sockets/state.attributes.int.test.ts`, `sockets/state.ledger.int.test.ts`, `sockets/state.ownerScope.int.test.ts`, `sockets/state.seatIdentity.int.test.ts`, `sockets/state.showTieSide.int.test.ts`. All green (report any red that is red before your change too — check by reading, never by stashing).

Run tests only like this (capped scope, logged; never pipe vitest into `head`):

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-fixes-w1-tests.log 2>&1; echo test-exit=\$? >> $S/s4-fixes-w1-tests.log"
```

Then `npx tsc --noEmit -p .` under a 12G scope (`-p MemoryMax=12G`, `NODE_OPTIONS=--max-old-space-size=8192`), logged to `$S/s4-fixes-w1-tsc.log`. Baseline is 0 errors.

## Rules that apply (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." · "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`." · "It is a **session**, never a *chat*."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later': no option, hook or extension point nobody asked for."
- NOMENCLATURE §24: "Grep for it first — across `src`, the SDK, and the schema. If it collides, either pick another or rename the other use in the same change. Never ship a second meaning." — keep new names private (non-exported) and list every new name in your report.
- Memory "int test timeouts": an int test that opens a DB inside an `it` needs a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })` as the templates do).
- **Prettier:** run `npx prettier --check` on changed files, but **only `--write` the lines you changed** — never reformat a whole file you didn't otherwise edit. If a file fails the check only on lines you didn't touch, leave it and say so.

## Verbatim rules

- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.

## Report (final message)

Changed files with one line each; every new name (private or not); tests run with pass/fail counts and the log paths; tsc before/after; decisions you made (each named); stop-and-ask items; **Noticed, not done**.
