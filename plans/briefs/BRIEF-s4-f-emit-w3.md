# BRIEF — `s4-f-emit-w3` (lane s4-f-emit, worker 3) — the host and the turn runtime emit member form

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

- `src/lib/server/pipelines/runtime/host.ts`
- `src/lib/server/pipelines/runtime/fireAction.ts`, `runTurn.ts`, `portrayals.ts`, `runStatus.ts`, `settledLines.ts`
- `src/lib/server/pipelines/runtime/bindings.ts` — **only** the function `castEntityRefs` (goal 6); worker w2 edits the rest of `bindings.ts` after you
- `src/lib/server/pipelines/prompt/seatCards.ts` — only to fix a bug you find in `hostSeatRefOf` / `storedSeatRefInCast` (say so)

Files readable: anything. **Not yours:** the rest of `bindings.ts`, `bindings.*.ts`, `speakerRotation.ts`, `tools/**`, `sessionEvents.ts`, `dispatchSpeech.ts` (others), `sockets/**`, `messages/**`, `speech/**`, `sprites/**`, `sessions/**` (worker w1 is editing `sockets/sessions.ts`, `messages/**`, `sessions/turnPlan.ts` right now), `state/**`, client, `shared/sockets/types.ts`. If a fix needs one of those, stop that item and write the exact edit in your report.

## Goals

Grep your files yourself (`grep -n 'character:\${\|character:"\|session_cast\|"character:\|startsWith("character\|storedSeatRef' <file>`); line numbers are hints.

1. **The `session_cast` read's host-filled identity** (`host.ts` `case "session_cast"` ~4836 and the rows it returns ~5030–5040 personas, ~5365–5375 characters): `ref` on each `sessionCharacters[]` / `sessionPersonas[]` row → `hostSeatRefOf({kind, seatId, castMemberId, cardId: held card})` (comments saying "the card form until S4" → what's true in both modes). Plugins and bindings match on this `ref`; nothing may build it elsewhere.
2. **`host.ts` emit sites**: `liveCastRefs` ~633–665 (the pool of live refs — must contain the refs a turn entry carries when on: each seat's `hostSeatRefOf`; select `id`, `castMemberId` too), ~7602 (`speaker: speakerRef`), ~7862 (`scope.portrayals?.[character:${characterId}]` — portrayals are keyed by the ref as asked; when on, look them up under the seat's member form), ~8824 (`row?.personaId != null ? character:… : player-seat:…` → `hostSeatRefOf`), ~8877 (`owner.kind !== "session_cast"` — must also treat `seated_member` / `player_seat` like a cast owner when on; read the code), ~9242 (`speakerRefOf(current)` — worker w1 is giving `messages/sessionChanges.ts` `speakerRefOf` a `metadata` parameter: pass the row's `metadata` here and at ~107's other callers in host.ts), ~11243. Then every `storedSeatRef(...)` caller (~885–905, 2643, 2842, 3539, 4112, 7437, 8390, 8770, 8848–8856, 10139): with the switch on the door returns **member form**; check what each caller does with the result and fix any that then parse a card id or compare against card-form refs.
3. **`portrayals.ts`**: `turnRefs` ~388–439 asks for every seat — when on, ask by each seat's `hostSeatRefOf` (select `id`, `castMemberId`). `resolvePortrayals` ~111–330 must answer `seated-member:M` and `player-seat:S` refs (carded **and** card-less player seats) as asked, when on: today it translates `seated-member:` to card form via `storedSeatRef` and only parses card forms, and answers `player-seat:` only for card-less seats (`isCardlessPlayerSeat`). With the switch on the door gives member form, and `hearingOf` (`state/earshot.ts` `hearingInMemberForm`, read it) asks by member-form refs — resolve each asked seat ref through `seatOf(db, sessionId, ref)` (gives `kind`, `cardId`, seat's `userId`) and answer it under the ref as asked: a carded player seat is the person's presence exactly as `character:<personaId>` is today; a character seat is the AI's cast exactly as `character:<cardId>` is today. Keep off-mode answers byte-identical.
4. **`fireAction.ts`** ~308 (`new Set(rows.map(r => character:${r.characterId}))`), ~368–374, ~679, ~699 (`form.addressee = own !== null ? character:${own} : user:…`), ~952 (actor), ~1050 (`character:${presserPresence}`), ~1298 (`answered.by` through the door): emit the seat's member form when on; readers accept it. **`runTurn.ts`** ~1620, ~1767, ~1777 (`character:${request.currentCharacterId}`), ~1821. **`runStatus.ts`** ~212–215. **`settledLines.ts`** ~87 (passes `speakerRefOf(row)` — pass `metadata`).
5. **`selection.sentSinceReply`**: find where the host builds the turn-order selection (`turnOrderSelection(...)` from `speakerRotation.ts`) and check it passes the cast lookup (`seatRefLookupOfCast(cast)`) so senders read member form; if it doesn't, pass it (worker w2 later changes the lookup's internals to honour `seatKind`).
6. **★s4-ner-2 (`castEntityRefs`, `bindings.ts` ~759):** retrieval's gazetteer skips card-less members (`b?.characterId != null`), so a card-less member's name can still be proposed as an entry key. Make it emit `{kind: "cast_member", id: <lorebook_bindings.id>}` for a roster member (`cast.lorebookBindings[]`) with **no live card** (card-less, or its card soft-deleted); a member with a live card stays `{kind:"character", id: cardId}`. This needs the binding id and the card's deleted flag on the host's cast read (`host.ts` `case "session_cast"` → `lorebookBindings`): add them there. Widen the return type's `kind` to include `"cast_member"` (it matches `EntityRef.kind` in `pipelines/ranking/entities.ts`, which lane s4-ner already widened — reuse that type if it fits; `parseEntityKey` is the inverse). Check `castEntityRefs`'s consumer (`buildGazetteer`, ranking) accepts the kind. Not behind the switch (it is independent of the flip, like s4-ner's work). Test in `castEntityRefs.test.ts`.

## Tests

New tests (switch on explicitly, restore the saved value):
```ts
import { memberFormSwitch } from "$lib/server/state/memberForm"
let was = false
beforeEach(() => { was = memberFormSwitch.on; memberFormSwitch.on = true })
afterEach(() => { memberFormSwitch.on = was })
```
- the `session_cast` read: `ref` on a character seat `seated-member:M`, a carded player seat `player-seat:S`, a member-less character seat ⏳ `character:C`; off → card form.
- `resolvePortrayals` against the audience refs `hearingOf` asks for when on: `seated-member:M` → the AI cast portrayal; carded `player-seat:S` → the person's presence; card-less `player-seat:S` as today; a member holding **both** a character seat and a player seat with the same card (★K-2): each ref answers its own seat.
- `turnRefs` / `liveCastRefs` in member form; one fireAction/runTurn path that emits a seat ref (addressee or actor) in member form.
- `castEntityRefs` for a card-less member and a member whose card is soft-deleted → `cast_member:<bindingId>`; a carded member unchanged.
- Int fixtures need seats **with cast members** (`session_characters.cast_member_id`, `session_personas.cast_member_id`): copy the pattern in `src/lib/server/state/memberForm.int.test.ts` (`insertCastMember` from `$lib/server/characters/versions`; `vi.mock("$lib/server/db", …createTestDb)`; `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`).

Run, in a capped scope, logged to a file — **both modes**:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w3-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w3-off.log"
# switch on for every test (the post-turn-on state), without touching the literal:
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-switch-on.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w3-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w3-on.log"
```
`<files>`: every test file next to a file you changed — `ls src/lib/server/pipelines/runtime/{host,fireAction,runTurn,portrayals,runStatus,settledLines,castEntityRefs}*.test.ts` and `grep -rl "resolvePortrayals\|turnRefs\|liveCastRefs" src/lib/server --include=*.test.ts`. Run big sets in batches of ≤12 files. Both runs green. A pre-existing test that asserts card form and fails only under the on-config: make it switch-aware (set the switch explicitly in that test and assert the member form; keep an off-mode assertion if cheap) — do not delete assertions. A failure you didn't cause: report it, don't fix it. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0 errors; other workers edit beside you — report errors in your files only).

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
- Scratch files go in the scratchpad above and start with `s4-f-emit-w3`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
