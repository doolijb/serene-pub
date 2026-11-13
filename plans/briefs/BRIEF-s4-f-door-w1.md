# BRIEF — lane-worker `s4-f-door-w1` — state core reads and writes able to take member form (switch OFF)

Supervisor: lane `s4-f-door` (seat-cast S4, wave 2 of the flip). Project: /home/jody/github/serene-pub. Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
(You need no `sdk:build`.)

## The one rule above all: nothing changes behaviour

Seats are stored today in **card form**. Wave 3 of this programme flips them to **member form**. Your job is to make the state core *able* to work in member form behind one switch, which stays **off**. With the switch off every code path must behave byte-for-byte as it does now. Every new branch reads `memberFormOn()` from `$lib/server/state/memberForm` — never add another flag, env var or setting.

## Vocabulary (plan §34.1, owner rulings ★K-1, ★K-2 of 2026-11-08 — quote, never reinterpret)

| | card form (switch OFF, today) | member form (switch ON) |
|---|---|---|
| character seat holding card C, seat member M | owner `{kind:"session_cast", id:C}`, `byId`/carries/hearing key `"C"`, ref `character:C` | owner `{kind:"seated_member", id:M}`, key `seated_member:M`, ref `seated-member:M` |
| player seat S with card C | merged into card C's entry: `session_cast:C`, key `"C"`, ref `character:C` | its own entry: owner `{kind:"player_seat", id:S}`, key `player_seat:S`, ref `player-seat:S` |
| card-less player seat S | `player_seat:S` (unchanged) | `player_seat:S` (unchanged) |
| character seat with **no** member | `session_cast:C` | ⏳ stays `session_cast:C` / key `"C"` / ref `character:C` (the boot pass leaves it) |

- ★K-1 (ruled): `cast.byId` keyed `seated_member:<id>`.
- ★K-2 (ruled): a card held by a character seat AND persona seat(s) → the shared values are copied to each seat. At runtime that means: with the switch on, a carded player seat is **its own cast entry/link**, never merged into the character seat of the same card.
- The rekey rule: "a card-form key maps to exactly what `seatOf("character:<card>")` returns today (`seats.ts:988-1097`), so no read changes."
- ⚠ Card ids and cast-member ids share one id range: `seated_member:5` / `seated-member:5` / `{kind:"seated_member",id:5}` is member 5, **never** card 5. Never parse a member form as a card id or the reverse.
- ⚠ `CastMemberLink.castMemberId` (resolve.ts) is the **attached book's** member, not the seat's. The seat's member is `CastMemberLink.seatMemberId` and `CastEntry.castMemberId`.

## Already built by the supervisor (use these; do not change their behaviour)

- `src/lib/server/state/memberForm.ts`: `memberFormSwitch = { on: false }`, `memberFormOn()`. Tests set `memberFormSwitch.on = true` and **must** restore it in `finally`/`afterEach`.
- `src/lib/server/state/owners.ts`: `OWNER_KINDS` includes `"seated_member"`; `isOwnerKind("seated_member")` is true **only** when the switch is on. `resolutionChain` has `seated_member` → `[seat, cast_member(ownBookMemberId)?, cast_member(castMemberId)?, card(links.characterId)?]`, and `player_seat` the same **only when on** (off: `[owner]`). New `castOwnerOf(link)`: off → `session_cast` by `characterId`; on → `player_seat` by `link.playerSeatId`, else `seated_member` by `link.seatMemberId`, else ⏳ `session_cast`.
- `src/lib/server/state/keys.ts`: `castMemberKey(entry)` — on: `playerSeatId` → `player_seat:<id>`, else `castMemberId` (the entry's = seat's member) → `seated_member:<id>`, else `String(id)`; off unchanged. New `castLinkKey(link)` (a link → its key, mapping `seatMemberId` correctly).
- `src/lib/server/state/resolve.ts`: `CastMemberLink.playerSeatId?` declared (doc only; you fill it).
- `src/lib/server/state/seatRefs.ts`: `loadSeatMap(db, sessionId)`, `memberFormOf(map, ref|key|owner)` (pure; card form → member form in the same shape; null = no seat / member-less seat; anything else unchanged), `memberFormTargetsOf`, and the doors `storedSeatRef` / `storedSeatOwner` already inverted when on.
- `src/lib/server/state/write.ts`: `OWNER_ROWS.seated_member = schema.lorebookBindings`, `OWNER_GONE.seated_member = "that seat is no longer in this session."` (done).

## Goal — make these files able to take member form when the switch is on

1. **`state/resolve.ts`**
   - `sessionLinks` (~l.570–720): when on, a carded player seat's link carries `playerSeatId: <session_personas.id>` and is **not** deduped against a character seat holding the same card (★K-2) — dedupe by `castLinkKey(link)` instead of `characterId` when on. Off: unchanged (`take` dedupes by `characterId`).
   - `chainFor` (~l.1040): when on, find the link by its owner (`castOwnerOf(link)` equal kind+id to the asked owner) for `seated_member` / `player_seat` / `session_cast`, and pass `characterId` = **the link's** `characterId` — never `owner.id` for a `seated_member` or `player_seat` owner (that id is a member/seat id). A card-less player seat (no link in `cast`) gets `characterId: null`. Off: unchanged.
   - `stateFor` `byId` (~l.1630–1700): when on, each cast link's entry has `ref` in member form (`seated-member:<seatMemberId>` / `player-seat:<playerSeatId>`, ⏳ `character:<id>` for a member-less seat), `playerSeatId` set for a carded player seat, values read with `owner: castOwnerOf(member)`, carried-check and index key `castMemberKey(entry)`. `id` stays the card id. Off: unchanged.
   - `isSessionScoped` gains `seated_member` (only reachable on). `ownOwnersOf` (~l.1345) uses `castOwnerOf`. ~l.1740 owner of an entry: when on, use the entry's owner (`playerSeatId` → `player_seat`, else `castMemberId` → `seated_member`, else `session_cast`). `whoFor` (~l.2230) and the `character:` parse at the file's end (~l.2302): make them answer member-form refs when on (read the code; keep off identical).
   - Grep the file for `session_cast`, `characterId)`, `character:`, `String(member.characterId)` and handle every seat-owner/key site the same way. Leave `card` / `cast_member` owners alone (they are not seats).
2. **`state/write.ts`**
   - `assertSessionOwner` (~l.1595–1700): a `seated_member` branch (reachable only when on, because `isOwnerKind` gates it): the member must be the `cast_member_id` of a seat of **this session** — a non-envoy `session_characters` row, else a `session_personas` row (same "live or departed" scope the `session_cast` branch uses today); else `StateRefusal("that character is not in this session's cast.")` (the existing sentence). When on, the `player_seat` branch must also accept a **carded** player seat (read its current comment: it admits only a card-less one today); off unchanged.
   - ~l.1736–1780 owner tables/lock: check the `FOR KEY SHARE` re-read works for `seated_member` (it locks the `lorebook_bindings` row).
   - `restoreRetractedState` (~l.1076): when on, before the inserts, translate each restored row in card form to member form with `memberFormOf(await loadSeatMap(t, sessionId), …)` — `values`, `configs`, `zones` by their `ownerKind`/`ownerId` columns, `proposals` by `payload.owner` (only `session_cast` owners change). Load one seat map per session id met. `null` → leave that row exactly as it is. Use only `t`/`tx` inside the transaction. Off: unchanged. **Do not** touch `annexDeltas` documents (queued to the boot-pass lane); say so in your report.
   - Grep for every other `session_cast` site in the file (owner kind lists, payload checks, `castMemberKey(owner…)` at ~l.3271 — when on a `seated_member` owner's key is `seated_member:<id>`; use `carryKeyOf` or `castMemberKey` with the right fields) and make each accept `seated_member` when on.
3. **`state/carries.ts`**: `carryKeyOf` → `seated_member:<id>` for a `seated_member` owner; `isCarryOwner` / `CARRY_OWNER_KINDS` accept `seated_member` only when on (keep the exported const unchanged if widening it would change behaviour off — e.g. add the kind through `isCarryOwner` instead).
4. **`state/earshot.ts`**: when on, `hearingOf` keys each heard cast link by **both** `castLinkKey(link)` and `String(link.characterId)` (so `card` / `cast_member` owners keep being heard by card id, and `seated_member` / `player_seat` by the seat key), and the audience ref for a link is its member-form ref (`seated-member:<seatMemberId>` / `player-seat:<playerSeatId>`, ⏳ `character:<id>` when member-less); `valueHeard` hears a `seated_member` owner by `seated_member:<id>`; `CAST_OWNER_KINDS` gains `seated_member`. Off unchanged. (Book/preset audiences keep card ids until S5 — ★K-3; don't touch audience storage.)
5. **`state/worldScope.ts`, `state/handEdits.ts`, `state/give.ts`**: every place that accepts `session_cast` as a seat owner accepts `seated_member` when on, resolving the seat by `castMemberId` (worldScope ~l.43–90: a carded `player_seat` is turned into `session_cast` by its persona today — when on keep it `player_seat`; handEdits ~l.230, 338–430; give ~l.51, 102, 128 — key via `carryKeyOf`/`castMemberKey`). Off unchanged.

## Files owned (edit only these)

`src/lib/server/state/resolve.ts`, `state/write.ts`, `state/carries.ts`, `state/earshot.ts`, `state/worldScope.ts`, `state/handEdits.ts`, `state/give.ts`, and new test file `src/lib/server/state/memberForm.int.test.ts` (plus additions to `state/earshot.test.ts` if useful).

Readable: anything. **Do not edit** `memberForm.ts`, `owners.ts`, `keys.ts`, `seatRefs.ts` (supervisor's; if you need a change there, stop and say what in your report), nor any file outside the list (another worker owns rulesets/, sessions/, sockets/, and the other state files).

## Tests (Done means)

New `src/lib/server/state/memberForm.int.test.ts` (copy the harness of `state/seatMember.int.test.ts`: `vi.mock("$lib/server/db")` with `createTestDb`, `releaseDataDir`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`, a temp dir named `serene-pub-vitest-memberForm-`). With the switch **on** (set in the test, restored after):
- a character seat (card C, member M) written through `writeValue`/the door with `{kind:"session_cast", id:C}` is stored as `owner_kind='seated_member', owner_id=M`; a carded player seat's value as `player_seat`; `stateFor` reads it back at `byId["seated_member:M"]` / `byId["player_seat:S"]` with the same value; a `seated_member` owner is accepted by `assertSessionOwner`, a member seated in no seat of the session is refused;
- **read equivalence**: rows stored in member form read (switch on) exactly the values the same rows in card form read (switch off), including inheritance from the cast member and the card;
- ★K-2: a card in a character seat and a player seat is two entries when on;
- `restoreRetractedState` with a stray card-form row restores it in member form; a row whose card has no seat is restored unchanged;
- ids overlapping: card id N and member id N both present → never cross.
With the switch off: every existing test file under `src/lib/server/state/` that imports your files stays green — at least `resolve.int.test.ts`, `write.int.test.ts`, `write.ownerGone.int.test.ts`, `write.turnMessages.int.test.ts`, `seatMember.int.test.ts`, `carries.int.test.ts`, `earshot.test.ts`, `owners.test.ts`, `handEdits.int.test.ts`, `worldScope.int.test.ts`, `items.int.test.ts`, `seatRefs.test.ts`.

Run tests only like this, a few files at a time, logged (log in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-f-door-w1`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo test-exit=$? >> <log>'`
Never pipe vitest into `head`. Then `npx tsc --noEmit -p .` under a 12G scope with `NODE_OPTIONS=--max-old-space-size=8192` — 0 errors in your files.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`. No migrations; no schema edits.
- It is a **session**, never a chat. No new user-facing sentences: reuse the existing refusal sentences.
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file.
- New exported names: avoid them; if one is unavoidable, mark it 🚧 in its JSDoc and list it in your report.
- Findings outside this brief go under **Noticed, not done** — never fixed in passing.

## Stop and ask (in your report, then finish the rest) when

A change would alter behaviour with the switch off; a new exported name, setting, event or user-visible sentence seems needed; a file outside your list needs changing; a rule above is unclear.

## Report

Return in your final message: changed files (with what changed, per goal item), tests run with results (file → pass/fail counts), tsc result, decisions you made, Noticed-not-done, and anything queued for other files.
