# BRIEF — `s4-f-emit-w2` (lane s4-f-emit) — bindings, rotation and state tools read and emit member form

Supervisor: lane `s4-f-emit` (`plans/briefs/BRIEF-s4-f-emit.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Background (read this, it is the whole design)

Seat-cast S4 "the flip": a seat is stored and emitted in **member form** instead of card form.
- Character seat (`session_characters` row with `cast_member_id` M): ref `seated-member:M`, state owner `{kind:"seated_member", id:M}`, byId/state key `seated_member:M`. ⏳ A character seat with **no** member keeps card form `character:<cardId>`.
- Player seat (`session_personas` row id S), **carded or not**: ref `player-seat:S`, owner `{kind:"player_seat", id:S}`, key `player_seat:S`.
- Card form (today): `character:<cardId>` (a persona seat is its card `character:<personaId>`), `player-seat:S` only for a card-less player seat, owner `session_cast:<cardId>`.

Everything is behind ONE switch, `src/lib/server/state/memberForm.ts`: `memberFormSwitch.on` / `memberFormOn()`. **Off = card form (today's behaviour, unchanged). On = member form.** The lead flips the literal after this lane; **never change the literal**. Every change you make is gated: `memberFormOn() ? memberForm : cardForm` — or, better, goes through the shared helpers below which are already gated.

Shared helpers (already written by the supervisor, `src/lib/server/pipelines/prompt/seatCards.ts`):
- `hostSeatRefOf({kind:"character"|"player", seatId, castMemberId, cardId}) → string|null` — **the one rule to build a seat's ref**. On: player → `player-seat:<seatId>`; character → `seated-member:<castMemberId>`, ⏳ `character:<cardId>` when member-less. Off: card form.
- `storedSeatRefInCast(cast, ref)` — pure door over a `session_cast` read in hand (off = `cardFormRefInCast`; on = `character:N` / `seated-member:M` → that seat's `hostSeatRefOf`).
- DB door (f-door's, `state/seatRefs.ts`, do not edit): `storedSeatRef(db, sessionId, ref)` — off: `seated-member:` → card form; **on: `character:<card>` → member form** (seatOf's order), `seated-member:M` of a member only in a player seat → `player-seat:S`. `storedSeatOwner` same for owners. `loadSeatMap` + `memberFormOf(map, refOrKeyOrOwner)` pure translator card→member form.
- `sessions/seats.ts` `seatOf(db, sessionId, ref)` resolves **all three** forms (`character:`, `seated-member:`, `player-seat:`) to a seat `{kind, seatId, castMemberId, cardId, ...}`; `parseSeatRef(ref)`.
- `state/keys.ts` `castMemberKey(entry)` / `castLinkKey(link)`, `state/owners.ts` `castOwnerOf(link)` are already gated.

Two kinds of site to fix, both gated:
1. **Emitters** — code that builds `character:${id}` (or `session_cast` owners / card-id keys) for a seat and sends it to a socket payload, a stored row, a plugin, or another module. With the switch on it must emit the seat's member form (`hostSeatRefOf`, or the row's host-filled `ref`).
2. **Readers downstream of a door** — code that, after `storedSeatRef` / `seatOf` / a payload ref, assumes the ref is `character:<cardId>` and parses the number as a card id (regex `character:(\d+)`, `startsWith("character:")`, `Number(ref.slice(10))`). With the switch on such a ref is `seated-member:M` / `player-seat:S`. Make it work: resolve through `seatOf` (gives `cardId`), or compare refs in the same form.
**Left on purpose:** card→seat lookups on card columns (`session_characters.character_id`, `session_personas.persona_id`, `session_messages.character_id/persona_id`) — they stay until S5. Note each site you deliberately leave.


**Known door gap (do not fix — the lead fixes it in f-door's file):** with the switch on, `storedSeatRef` returns null for `character:<card>` when that card's seat is a **member-less** character seat, and `storedSeatOwner` returns null for its `session_cast` owner — though `hostSeatRefOf` / `castOwnerOf` keep card form for exactly that seat. Many existing int fixtures seat characters with no cast member, so they fail under the plain on-config for this reason alone. Run your on-mode tests with **the door-fix config** below, which closes the gap with a mock; report any failure that remains.

## Files owned (edit only these, plus tests next to them)

- `src/lib/server/pipelines/runtime/bindings.ts` (all of it; worker w3 already changed `castEntityRefs` and the `SessionCastRead.lorebookBindings` type — keep those)
- `src/lib/server/pipelines/runtime/bindings.state.ts`, `bindings.relationships.ts`, and any other `bindings.*.ts`
- `src/lib/server/pipelines/runtime/speakerRotation.ts`
- `src/lib/server/pipelines/runtime/tools/**` (`stateTools.ts`)
- `src/lib/server/pipelines/prompt/seatCards.ts` — only to fix a bug you find in `hostSeatRefOf` / `storedSeatRefInCast` (say so)

Files readable: anything. **Not yours:** `host.ts`, `fireAction.ts`, `runTurn.ts`, `portrayals.ts`, `runStatus.ts`, `settledLines.ts`, `sessionEvents.ts`, `dispatchSpeech.ts` (done by other workers this lane — read them to see how they emit), `state/**`, `rulesets/**`, `sessions/**`, `sockets/**`, `messages/**` (worker w4 edits state/give, write, durable, handEdits, rulesets/resolve right now), `pipelines/prompt/*` other than seatCards, client, `shared/sockets/types.ts`. If a fix needs one of those, stop that item and write the exact edit in your report.

## Goals

Grep your files yourself; line numbers are hints.

How the rest of the lane already emits (read, don't edit): the `session_cast` read (`host.ts` `case "session_cast"`) now fills each `sessionCharacters[]` / `sessionPersonas[]` row's `ref` with `hostSeatRefOf` (member form when on) and carries `castMemberId`, `seatId`; the speaker stamp (`messages/store.ts`) stamps `castMemberId` and, when on, `metadata.speaker` = the seat's member-form ref on every seat line; `messages/sessionChanges.ts` `speakerRefOf(row)` reads it. **In bindings, prefer the row's host-filled `ref`** (`cc.ref`, `cp.ref`) over building a ref; fall back to `hostSeatRefOf` only where a row has no `ref`.

1. **Emit sites in `bindings.ts`**: ~1528 and ~1569–1573 (addressee by name: `character:${c.id}` → the seat row's `ref`; and the ref-kind check just above it ~1550, which accepts only `ref.kind === "character"` — make it accept a `seated-member:` / `player-seat:` ref of a seat in the cast in hand), ~4338 and ~4373 (turn candidates: `ref` from the row), ~7264 (`key = character:${id}`), ~9312, ~9495, ~5395, ~8467, ~9279 (the `cardFormRefInCast` callers → `storedSeatRefInCast`, which is the same off and member form on; check what each caller then does with the result — a caller that parses a card id from it must read the seat's card from the cast row instead). Grep: `grep -n 'character:\${\|cardFormRefInCast\|storedSeatRef\|session_cast\|startsWith("character' bindings.ts`.
2. **Turn-advise** (`core:oracle/turn-advise@1`, ~7897–7935): `spokenRefsSince(messages, lookup)` with the cast lookup (`seatRefLookupOfCast(cast)` — read how ~4356 gets the cast), and `who` (~7913–7921) built from seat refs: a person's line → `senderRefOf(m, lookup)`; a reply → the lookup of `m.castMemberId` with `'character-seat'`, else ⏳ `character:${m.characterId}`, else `m.speaker`. `roundRobinEntries(candidates, messages)` in its fallback gets the lookup too. Without this, turn-advise names nobody once candidates carry member-form refs.
3. **`turnOrderSelection(candidates, messages)`** (~1679): pass `seatRefLookupOfCast(cast)` so `selection.sentSinceReply` (and the order) read member form — the cast is presumably at hand as at ~4356; if not, read it the same way.
4. **`seatRefLookupOfCast` honours `seatKind`** (`speakerRotation.ts` ~115–140): the SDK now calls the lookup as `refOfMember(castMemberId, seatKind?)` with `seatKind?: 'character-seat' | 'player-seat'` (`../serene-pub-sdk/sdk/src/turnOrder.ts` `senderRefOf` asks `'player-seat'`, `spokenRefsSince` asks `'character-seat'` on replies). Change `SeatRefOfMember` to `(castMemberId: number, seatKind?: 'character-seat' | 'player-seat') => ParticipantRef | undefined`: `'character-seat'` → the member's character seats first (live first, then position), else any; `'player-seat'` → its player seats first, else any; no hint → today's order (live, character before player, position). So `contentProcessors.ts:93` and `bindings.ts` ~4356 get the **persona** seat for a person's line of a member holding both seats (★K-2). Check `contentProcessors.ts` (not yours) compiles unchanged.
5. **Other `speakerRotation.ts` sites**: ~347 (`newest.characterId` → `character:`), ~370 (candidate `speaker: character:${s.characterId}`), ~384 (`due`), ~566 (`spoken.add(character:…)`): when on, use the seat's member form (the cast row's `ref`, or the lookup by `castMemberId`); readers that compare these to candidate refs must compare in one form.
6. **State owners from refs** (`bindings.state.ts`): `CastOwner` (~69) and `castOwnerOfRef` (~78) read only `character:` → `session_cast` and `player-seat:` → `player_seat`. With the switch on accept `seated-member:M` → `{kind:"seated_member", id:M}` and keep `player-seat:S` → `player_seat`; a `character:<card>` still maps to `session_cast` (the write door `storedSeatOwner` turns it into member form when on). Widen `CastOwner`'s kind to `"session_cast" | "seated_member" | "player_seat"`. Then every reader of a `CastOwner` / `owner.kind === "session_cast"` in `bindings.state.ts` (~83, ~609, ~622–623, ~640, and `ownersFrom` etc.) treats `seated_member` / `player_seat` as a cast owner where it treated `session_cast` as one (e.g. "a delver" naming, card id lookups — get the card through the cast row / `seatOf` instead of `owner.id`). `host.ts` `set-stat-config` already maps member forms itself (w3) — leave host alone; note whether it could now call `castOwnerOfRef`.
7. **`tools/stateTools.ts`** (~39–90): the tool's owner from a cast row → when on, the seat's owner (`seated_member` by the row's `castMemberId`, `player_seat` by seat id; ⏳ `session_cast` for a member-less character seat) — mirror `state/owners.ts` `castOwnerOf`. Widen its return type. **`bindings.relationships.ts`** ~148, ~394 (`character:${input.scope.currentCharacterId}` → the current seat's member form when on: find the seat in the cast read by card and use its `ref`).
8. List every card-form site you deliberately leave (card→seat lookups on card columns stay until S5).

## Tests

New tests set the switch explicitly and restore the saved value:
```ts
import { memberFormSwitch } from "$lib/server/state/memberForm"
let was = false
beforeEach(() => { was = memberFormSwitch.on; memberFormSwitch.on = true })
afterEach(() => { memberFormSwitch.on = was })
```
- turn-advise with member-form candidates: `spokenRefsSince` excludes a seat that replied (by `castMemberId`), the transcript names a person's line and a reply by seat ref; a member holding both a character and a player seat (★K-2): the person's line is the player seat, the reply the character seat.
- `seatRefLookupOfCast` with each `seatKind` (unit, in `speakerRotation`'s test file).
- `turnOrderSelection` / `sentSinceReply` in member form with the lookup.
- `castOwnerOfRef` for all three forms (switch on and off); one state-tool write on a seat in member form.
- turn candidates (~4338/4373) carry the host-filled member-form `ref`.
- Int fixtures need seats **with cast members** (`session_characters.cast_member_id`, `session_personas.cast_member_id`): copy the pattern in `src/lib/server/state/memberForm.int.test.ts` (`insertCastMember` from `$lib/server/characters/versions`; `vi.mock("$lib/server/db", …createTestDb)`; `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`). Where a test needs data already in member form, build it in member form, or run f-pass's pass (`seatKeys(db)` from `$lib/server/sessions/seatKeys`) in setup.

Run, in a capped scope, logged to a file — **both modes**, batches of ≤12 files:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w2-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w2-off.log"
# switch on for every test + the door gap closed (the post-turn-on state):
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-w3-door.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w2-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w2-on.log"
```
`<files>`: every test file next to a file you changed — `ls src/lib/server/pipelines/runtime/{bindings,speakerRotation,turnAdvise,turnOrder,stateTools,roundRobin}*.test.ts src/lib/server/pipelines/runtime/tools/*.test.ts` and `grep -rl "seatRefLookupOfCast\|turn-advise\|castOwnerOfRef\|stateTools" src/lib/server --include=*.test.ts`; also `src/lib/server/pipelines/prompt/contentProcessors*.test.ts`. Both runs green. A pre-existing test that asserts card form and fails only on-mode: make it switch-aware (set the switch explicitly in that test and assert the member form; keep an off-mode assertion if cheap) — never delete assertions. A failure you didn't cause: report it, don't fix it. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0 errors; another worker edits beside you — report errors in your files only).

## Rules (quoted from CLAUDE.md and the lane contract)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never add a top-level `await` to `src/lib/server/db/index.ts`.
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." Don't drop a scope key from any payload you touch.
- "It is a **session**, never a *chat*." "There is always a lorebook": no code path or comment framing a session as having no lorebook.
- NOMENCLATURE R1 "One word, one meaning"; R6: mark transitional words ⏳, provisional 🚧. **No new exported name, setting, event, table, column or migration** — a private helper inside your file is fine; anything exported and new: stop and ask in your report (proposed name + one line).
- Comments: one short JSDoc sentence per changed behaviour, ⏳/🚧 marked; update comments that say "the card form until S4" to say what's true now (both modes).
- Do what is asked. Findings outside these goals go under **Noticed, not done** in your report — never fixed in passing.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build`.)
- Never pipe vitest into `head`. Never `kill -9` anything. Never `git checkout`/`restore` in either repo.
- **Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit. If a file fails only on lines you didn't touch, leave it and say so.
- Scratch files go in the scratchpad above and start with `s4-f-emit-w2`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
