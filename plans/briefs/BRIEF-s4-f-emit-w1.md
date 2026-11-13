# BRIEF — `s4-f-emit-w1` (lane s4-f-emit, worker 1) — sockets, scenes, turn plan, messages emit member form

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

## Files owned (edit only these, plus tests next to them)

- `src/lib/server/sockets/sessions.ts`
- `src/lib/server/sockets/scenes.ts` (`readCastProposal` only)
- `src/lib/server/sockets/pipelines.ts`
- `src/lib/server/pipelines/runtime/sessionEvents.ts`
- `src/lib/server/pipelines/routines/*` (e.g. `moments.ts`)
- `src/lib/server/sessions/turnPlan.ts`, `src/lib/server/sessions/turnYield.ts`
- `src/lib/server/scenes/liveScenes.ts`
- `src/lib/server/messages/**` (`store.ts`, `sessionChanges.ts`, `diceWords.ts`, `blocks.ts`, `permissions.ts`, `verbs.ts`, `writes.ts`, …)
- `src/lib/server/speech/**` (`resolveVoice.ts`), `src/lib/server/sprites/choices.ts`, `src/lib/server/pipelines/runtime/dispatchSpeech.ts`

Files readable: anything. **Not yours:** `pipelines/runtime/**` other than `sessionEvents.ts` and `dispatchSpeech.ts` (worker w3 is editing `host.ts`, `fireAction.ts`, `runTurn.ts`, `portrayals.ts` right now — do not touch), `state/**`, `sessions/*` other than the two named, `cast/**`, client, `shared/sockets/types.ts` (lane f-client). If a fix needs one of those, stop that item and write the exact edit in your report.

## Goals

Grep your files yourself (`grep -n 'character:\${\|character:"\|session_cast\|"character:\|startsWith("character' <file>`); the line numbers below are hints, not a list.

1. **`sockets/sessions.ts` seat payloads.** ~5455–5475: the host-filled `ref` on `sessionData.sessionCharacters[]` / `sessionPersonas[]` → `hostSeatRefOf({kind, seatId: row.id, castMemberId: row.castMemberId, cardId: held})` (check the row field names: `sc.id`/`sp.id`, `castMemberId`). Other sites: ~6675–6681 turn positions (refs keyed by position), ~7104 (`ref: character:${delta.id}`), ~7928, ~8248 (offer speaker), ~11222 (cast-change events `ref: character:${params.characterId}`), ~9966/10178 (`storedSeatRef` callers — check what they do with the result), ~10375 comment. Each: emit the seat's member form when on (look up the seat — the row in hand, or `seatOf(db, sessionId, "character:<card>")` then `hostSeatRefOf`). Readers here that compare a client-sent ref to a card form must accept member form.
2. **`sockets/scenes.ts` `readCastProposal`** (~2864): key a seat by its **member** (castMemberId), not its card, so a seat whose card is soft-deleted and who is also named in the scene shows once (the s4-ner report: "readCastProposal shows a soft-deleted-card seat twice in `scenes:openScenes`"). Read the function and `scenes/liveScenes.ts` `writeProposedCast` / `refreshOpenSceneCast` / `proposedMembersInBook` (lane s4-ner already made those compare member ids) to see the shape.
3. **`scenes/liveScenes.ts`** ~965–971: `senderKey: character:${sender}`, `key: character:${id}` → the seat's member form when on.
4. **`sessions/turnPlan.ts`** ~177–180 (candidate refs from cards/personas), ~188, ~297, ~323 (`storedSeatRef` results used as card refs?); **`sessions/turnYield.ts`** ~295.
5. **`pipelines/runtime/sessionEvents.ts`** ~401–403; **`routines/moments.ts`** ~82–83 and `speakerKey` ~306; **`messages/diceWords.ts`** ~84, ~100 (names keyed `character:${c.id}` — key them by the forms the refs arrive in); **`messages/blocks.ts`** ~133 (addressee parse — accept `seated-member:`/`player-seat:`); **`messages/permissions.ts`** ~85; **`messages/verbs.ts`** ~473; **`sockets/pipelines.ts`** ~2836–2844 (receipts' portrayals: old receipts keep `character:` keys — K-3 left; make the read find both).
6. **The speaker stamp — one rule** (`messages/store.ts` ~110–200 `speakerRefOfValues`, `speakerMemberOf`, `withSpeakerStamp`, `restampSpeakers`; and `messages/sessionChanges.ts` ~250 `speakerRefOf`). Today there are two rules (★TIDY-2, ruled "keep both until S4's `player_seat:` keys"); S4 merges them. Build it like this:
   - The seat of a row's speaker, one rule (store side, with a db): (a) `personaId != null` → a `metadata.speaker` that is `player-seat:S` of a seat holding that persona, else **the player seat** whose `persona_id` is it (live first, then position, then id — NOT `seatOf("character:<personaId>")`, which returns a character seat first when the same card also sits in a character seat, ★K-2); (b) else `metadata.speaker` is `player-seat:S` → that seat; (c) else `characterId != null` → the character seat whose `character_id` is it (seatOf order); (d) else `metadata.speaker` is `seated-member:M` → `seatOf` of it; (e) else none (narration, envoy, persona-less person).
   - The stamp sets `castMemberId` from that seat (as today; a caller-given `castMemberId` is left alone, as today), and **with the switch on** sets `metadata.speaker` to the seat's `hostSeatRefOf` (member form) — this is "stamp a seat's line with its member-form ref". Off: `metadata` untouched (today's behaviour, byte for byte). `restampSpeakers` (a patch moving `characterId`/`personaId`) must re-stamp `metadata.speaker` too when on, so a stale one never wins.
   - `sessionChanges.ts` `speakerRefOf(row)` (pure; callers: `lost.speaker` on `core:event/message-deleted@1`, the speech line key `speechAutoVoice:<ref>`, `settledLines`) — when on: `personaId` → the row's `metadata.speaker` if it is `player-seat:`, else ⏳ `character:<personaId>`; else `metadata.speaker` `player-seat:` → it; else `characterId` → `metadata.speaker` if it is `seated-member:`, else ⏳ `character:<characterId>`; else null. Off: exactly today's (`character:<personaId>` / `character:<characterId>` / null). Add an **optional** `metadata?: unknown` to its parameter type (worker w3 updates the `host.ts` / `settledLines.ts` callers to pass it); check every caller passes it (callers outside your files: list them in your report, don't edit).
7. **Speech and sprites.** `speech/resolveVoice.ts`: the `speechAutoVoice:<speakerRef>` key (`speechAutoVoiceKey`, ~391, and wherever keys are read, e.g. voices-in-use ~298) — with the switch on, the key is the seat's member form (the `seat-keys` boot pass rekeys stored `speechAutoVoice:character:N` to one key per seat); normalise an incoming card-form `speakerRef` through `storedSeatRef` before building or reading the key when on (an old persona line without a stamped `metadata.speaker` still arrives as `character:<personaId>`). `pipelines/runtime/dispatchSpeech.ts` ~431–434: names keyed `character:${c.id}` → keyed by the forms speaker refs arrive in when on (the seat's `hostSeatRefOf`; keep the card form as well if old refs can still arrive). `sprites/choices.ts` ~145, ~150, ~286, ~309: `valueOf`/`setValue` on `{kind:"session_cast", id: cardId}` — with the switch on the seat's values live under `seated_member` / `player_seat`; get the owner through `storedSeatOwner(db, sessionId, {kind:"session_cast", id})` (it translates card form when on; returns the owner unchanged when off) — check whether `valueOf` already goes through a door before adding one; `spriteSetOverridesFor` stays keyed by card id for its client (say so).
8. **`messages/writes.ts`** ~145 `LibraryNeed`: remove the now-unused `"lorebooks-into-sessions"` member (grep both repos for readers first — `../serene-pub-sdk` read only); keep `"sessions"`, mark it ⏳ in its JSDoc ("⏳ removed in S5, ★f-sdk-4").

## Tests

New tests (switch on explicitly, restore the saved value):
```ts
import { memberFormSwitch } from "$lib/server/state/memberForm"
let was = false
beforeEach(() => { was = memberFormSwitch.on; memberFormSwitch.on = true })
afterEach(() => { memberFormSwitch.on = was })
```
- the speaker stamp: a character line → `castMemberId` M and `metadata.speaker` `seated-member:M`; a persona line of a member who also holds a character seat with the same card (K-2) → the **player** seat (`player-seat:S`, its member); a card-less player line keeps `player-seat:S`; switch off → metadata unchanged; a patch moving `characterId` re-stamps both. Put them in the existing store test (find `messages/*store*.test.ts` / `*.int.test.ts`) or a new `messages/store.memberForm.int.test.ts`.
- `speakerRefOf` both modes (pure unit test).
- auto-voice key: a seat's remembered Auto pick is written and read under its member-form key when on (a card-form `speakerRef` in reads the same key).
- seat payload refs on `sessions:get` (or whatever builds `sessionData`) in member form; `readCastProposal` shows a soft-deleted-card named seat once.
- Int fixtures need seats **with cast members** (`session_characters.cast_member_id`, `session_personas.cast_member_id`): copy the pattern in `src/lib/server/state/memberForm.int.test.ts` (`insertCastMember` from `$lib/server/characters/versions`; `vi.mock("$lib/server/db", …createTestDb)`; `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`).

Run, in a capped scope, logged to a file — **both modes**:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w1-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w1-off.log"
# switch on for every test (the post-turn-on state), without touching the literal:
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-switch-on.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w1-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w1-on.log"
```
`<files>`: every test file next to a file you changed (find them: `ls src/lib/server/messages/*.test.ts`, `grep -rl "turnPlan\|turnYield\|liveScenes\|readCastProposal\|sessionEvents\|moments" src/lib/server --include=*.test.ts`), plus `src/lib/server/sockets/sessions*.test.ts` that cover what you changed. Both runs green. A pre-existing test that asserts card form and fails only under the on-config: make it switch-aware (set the switch explicitly in that test and assert the member form; keep an off-mode assertion if cheap) — do not delete assertions. A failure you didn't cause: report it, don't fix it. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0 errors; other workers edit beside you — report errors in your files only).

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
- Scratch files go in the scratchpad above and start with `s4-f-emit-w1`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
