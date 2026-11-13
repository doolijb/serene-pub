# BRIEF — lane-worker `s4-f-door-w2` — rulesets, sessions, sockets and the outer state files able to take member form (switch OFF)

Supervisor: lane `s4-f-door` (seat-cast S4, wave 2 of the flip). Project: /home/jody/github/serene-pub. Use absolute paths.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
(You need no `sdk:build`.)

## The one rule above all: nothing changes behaviour

Seats are stored today in **card form**. Wave 3 flips them to **member form**. Your job is to make these files *able* to work in member form behind one switch, which stays **off**. With the switch off every code path must behave exactly as now. Every new branch reads `memberFormOn()` from `$lib/server/state/memberForm` — never add another flag, env var or setting.

## Vocabulary (plan §34.1, owner rulings ★K-1, ★K-2 of 2026-11-08 — quote, never reinterpret)

| | card form (switch OFF, today) | member form (switch ON) |
|---|---|---|
| character seat holding card C, seat member M | owner `{kind:"session_cast", id:C}`, `byId`/carries key `"C"`, participant ref `character:C` | owner `{kind:"seated_member", id:M}`, key `seated_member:M`, ref `seated-member:M` |
| player seat S with card C | merged into card C: `session_cast:C`, key `"C"`, ref `character:C` | its own: owner `{kind:"player_seat", id:S}`, key `player_seat:S`, ref `player-seat:S` |
| card-less player seat S | `player_seat:S` | `player_seat:S` (unchanged) |
| character seat with **no** member | `session_cast:C` | ⏳ stays card form (the boot pass leaves it) |

- ★K-1 (ruled): `cast.byId` keyed `seated_member:<id>`. ★K-2 (ruled): a card held by a character seat AND persona seat(s) → the shared values are copied to each seat (at runtime, with the switch on, a carded player seat is its own entry/link/owner).
- The rekey rule: "a card-form key maps to exactly what `seatOf("character:<card>")` returns today (`seats.ts:988-1097`), so no read changes."
- ⚠ Card ids and cast-member ids share one id range: `seated_member:5` is member 5, **never** card 5. Never parse a member form as a card id or the reverse.
- ⚠ `CastMemberLink.castMemberId` (state/resolve.ts) is the **attached book's** member; the seat's member is `CastMemberLink.seatMemberId` (and `CastEntry.castMemberId`). A cast member id **is** a `lorebook_bindings.id`.
- ★K-3 (ruled): genre-scoped presets and **book** audiences keep reading by card id until S5 — don't rekey those.

## Already built by the supervisor (use these; do not change them)

- `state/memberForm.ts`: `memberFormSwitch = { on: false }`, `memberFormOn()`. Tests set `memberFormSwitch.on = true` and **must** restore it after.
- `state/owners.ts`: `OwnerKind` includes `"seated_member"` (id = `lorebook_bindings.id`); `isOwnerKind("seated_member")` true only when on. `castOwnerOf(link)` — the owner a `sessionLinks(...).cast` link stores under: off `session_cast` by `characterId`; on `player_seat` by `link.playerSeatId`, else `seated_member` by `link.seatMemberId`, else ⏳ `session_cast`.
- `state/keys.ts`: `castMemberKey(entry)` (on: `player_seat:` / `seated_member:` / id) and `castLinkKey(link)` (a link's key).
- `state/carries.ts` `carryKeyOf(owner)` (the other worker makes it answer `seated_member:<id>`).
- `state/seatRefs.ts`: `loadSeatMap(db, sessionId)`, pure `memberFormOf(map, ref|key|owner)` (card form → member form in the same shape; null = no seat holds the card or a member-less seat; anything else unchanged, same object), `memberFormTargetsOf` (every seat — the boot pass's copy), doors `storedSeatRef` / `storedSeatOwner` (already inverted when on: card form in → member form out).
- The other worker (w1) is changing `state/resolve.ts` so that, when on, `sessionLinks(...).cast` links carry `playerSeatId` for carded player seats (one link per seat, ★K-2), `stateFor` keys `byId` by `castMemberKey(entry)` and entries carry member-form `ref`. Build against that contract; don't edit resolve.ts.

## Goal — make each of these able to take member form when the switch is on

1. **`rulesets/read.ts`** — `ownerRefOf` (~l.105): when on, also read `seated-member:<id>` and `{kind:"seated_member", id}` → `{ key: "seated-member:<id>", owner: {kind:"seated_member", id}, facet: "cast" }`; off: refuse them exactly as now. `bagOf` (~l.375): the `byId` key of a `seated_member` owner is `seated_member:<id>` (use `carryKeyOf`/`castMemberKey`, not a hand-built string where a helper exists). `tiesBetween` (~l.495–515): when on, a `seated_member` view's binding **is** its owner id (`lorebook_bindings.id`) — key it by the view's key; `player_seat` views as today. Grep the file for other `session_cast`/`character:` sites.
2. **`rulesets/ties.ts`** — `rulesKeyOf` (~l.1218, ~l.2086) and every tie end / `towards` key: when on, a seat's end is its member-form ref (`seated-member:<M>` / `player-seat:<S>`), and resolving a `seated-member:<M>` end to a lorebook binding is the binding `M` itself (no card lookup). Card-form ends still read (⏳ stray rows). Off unchanged.
3. **`rulesets/zones.ts`** — `farEndsOf` (~l.205–224): when on, a `seated-member:<M>` key is a far end (owner `seated_member`, named via `memberAsRead(db, M, {sessionId})`), `player-seat:<S>` likewise by its seat; `character:N` keeps today's path. Other sites in the file the same way.
4. **`rulesets/resolve.ts`** — the door at ~l.237–245 already calls `storedSeatRef`/`storedSeatOwner`; when on it must also send `character:` refs and `session_cast` owners through the door (today it only sends `seated-member:`/`seated_member`). ~l.606 and ~l.917 (`c.owner.kind === "session_cast"`): a `seated_member` owner is a cast owner too when on.
5. **`sessions/seatName.ts`** — `givePlayerSeatACard` (~l.267–335): when on, **skip the rekey of the seat's stats, configs, sheets and pending proposals to `session_cast`** and the restamp of its lines as the card's — the seat keeps `player_seat:<seatId>` and `player-seat:<id>` (a carded player seat is `player_seat` in member form). Still fill `persona_id`. Off unchanged. Update its JSDoc for both cases.
6. **`sessions/creationModes.ts`** (~l.111–260): copying seat values old → new session: when on, the source owner is `castOwnerOf(oldLink)` / `player_seat`, and the target is the **new** session's seat for the same card, found with `memberFormOf(await loadSeatMap(db, newSessionId), {kind:"session_cast", id: card})` (skip on null). Off unchanged.
7. **`sessions/convertRuleset.ts`** — `SESSION_LAYER` (~l.40) gains `seated_member` only where that list filters rows (adding it is behaviour-neutral off: no such rows exist off — say so if you rely on it); owners list ~l.224 uses `castOwnerOf`.
8. **`sessions/branch.ts`** — when on: `seated_member` owners keep their id in the branch (members are shared — branches ride the parent's people; only `session` and `player_seat` ids are remapped, `ownerIdFor` ~l.648–654); make sure every row-copy predicate that picks the session layer (~l.700–712, ~l.225) **includes `seated_member` rows** so a branch copies them. ~l.470 `seatOf(..., character:${cardId})`: read it and keep it right for both forms.
9. **`sessions/rewind.ts`** — Forward's tally (~l.745–760, `writeTurnTally(… turn.tally …)`): when on, translate every participant ref in the restored tally (each lane's `lastSpeaker`, `turnsBy` keys, `spoke[]`, `persons[]`; leave `narrator` and non-card refs) with `memberFormOf(await loadSeatMap(t, sessionId), ref)`; a `null` keeps the ref as it was. Use only the transaction handle inside the transaction. Off unchanged.
10. **`sockets/state.ts`** — ~l.435–450 (owner rows "never a `seated_member`"), ~l.610–635, ~l.725, ~l.1617, ~l.1681–1690, ~l.1808–1820, ~l.1888: when on, a seat's owner row is `castOwnerOf(link)` (its `characterId` field stays the card where there is one), `seated_member` counts as a seat everywhere `session_cast` / `player_seat` do, "mine" checks resolve a `seated_member` by the seat's member. The `owner()` door (~l.217–240) already calls `storedSeatOwner`: when on, it must also pass `session_cast` owners through it (they come back member form). Off unchanged. Don't touch `shared/sockets/types.ts` (another lane's) — if a type blocks you, cast locally and report it.
11. **`sockets/statTrail.ts`** (~l.18–60): when on, keep a stored `seated_member` owner (today it refuses `stored.kind === "seated_member"`), and send `session_cast` through the door too; off unchanged. **`state/statTrail.ts`** (~l.130–140, ~l.319–360): accept a `seated_member` owner when on (a seat's trail by its member; `castOwnerOf` where it builds one).
12. **`state/supply.ts`** (~l.47, ~l.156), **`state/durable.ts`** (~l.225, ~l.326, ~l.361), **`state/storyTime.ts`** (~l.745–780), **`state/lorebookState.ts`** (~l.381–410: `session_cast` → the card's member; a `seated_member` owner **is** the member), **`state/sessionLoreRefs.ts`** (`HOLDER_KINDS` ~l.24), **`state/presencesOnReading.ts`** (~l.158): every seat owner built from a cast link uses `castOwnerOf(link)` and key `castLinkKey(link)`; every kind list that holds `session_cast` admits `seated_member` (when adding it to a list could change behaviour off, gate it on `memberFormOn()`).

## Files owned (edit only these)

`src/lib/server/rulesets/{read,ties,zones,resolve}.ts`, `src/lib/server/sessions/{seatName,creationModes,convertRuleset,branch,rewind}.ts`, `src/lib/server/sockets/state.ts`, `src/lib/server/sockets/statTrail.ts`, `src/lib/server/state/{supply,durable,storyTime,statTrail,lorebookState,sessionLoreRefs,presencesOnReading}.ts`, and new test file `src/lib/server/rulesets/memberForm.int.test.ts` (plus a new `src/lib/server/sessions/seatName.memberForm.int.test.ts` if you need one).

Readable: anything. **Do not edit** `state/{memberForm,owners,keys,seatRefs,resolve,write,carries,earshot,worldScope,handEdits,give}.ts` (supervisor's and the other worker's), `sessions/seats.ts`, `pipelines/runtime/**`, `sockets/sessions.ts`, `shared/**`, or anything else. If you need a change there, stop and say what in your report.

## Tests (Done means)

New `src/lib/server/rulesets/memberForm.int.test.ts` (copy the harness of `src/lib/server/state/seatMember.int.test.ts`: `vi.mock("$lib/server/db")` with `createTestDb`, `releaseDataDir`, `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`, temp dir `serene-pub-vitest-rulesMemberForm-`). With the switch **on** (set in the test, restored after): `ownerRefOf` reads `seated-member:<id>` / `{kind:"seated_member"}` (and refuses them off — a pure assertion is fine); `givePlayerSeatACard` leaves the seat's `player_seat` rows in place on, and still rekeys them off; a branch copies `seated_member` rows with the same owner id; Forward's tally translation maps `character:<card>` refs to member form (unit-level on the helper if you write one inside rewind.ts — no new export unless needed). With the switch off: every existing test file under `src/lib/server/rulesets/` and the existing tests for `sessions/{seatName,creationModes,convertRuleset,branch,rewind}.ts`, `sockets/state*`, `sockets/statTrail*`, `state/{statTrail,durable,supply,storyTime,lorebookState}*` stay green (find them with `ls`/`grep`).

Run tests only like this, a few files at a time, logged (logs in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-f-door-w2`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > <log> 2>&1; echo test-exit=$? >> <log>'`
Never pipe vitest into `head`. Then `npx tsc --noEmit -p .` under a 12G scope with `NODE_OPTIONS=--max-old-space-size=8192` — 0 errors in your files (the other worker edits resolve.ts at the same time; if an error is in their files, note it and move on).

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- `socket.off(event)` always with the handler. Sockets: one domain context per event family is the only listener and the only place that toasts; server code here never adds a new event.
- An event in `SCOPED_EVENTS` must carry its scope key in the payload (don't change payload shapes).
- No migrations, no schema edits. It is a **session**, never a chat. No new user-facing sentences: reuse existing refusal sentences.
- Prettier: run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file.
- New exported names: avoid them; if one is unavoidable, mark it 🚧 in its JSDoc and list it in your report.
- Findings outside this brief go under **Noticed, not done** — never fixed in passing.

## Stop and ask (in your report, then finish the rest) when

A change would alter behaviour with the switch off; a new exported name, setting, event or user-visible sentence seems needed; a file outside your list needs changing; a rule above is unclear.

## Report

Return in your final message: changed files (what changed, per goal item), tests run with results (file → pass/fail counts), tsc result, decisions you made, Noticed-not-done, and anything queued for other files.
