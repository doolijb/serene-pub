# BRIEF — `s4-f-emit-w4` (lane s4-f-emit) — state-side leftovers from f-door: restore doors, audiences, anchors, durable and hand edits

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

- `src/lib/server/sessions/annexChanges.ts` (`restoreAnnexDeltas` and helpers it needs)
- `src/lib/server/lorebooks/annex.ts` (`unionAudiences` and its callers in this file)
- `src/lib/server/state/give.ts` (the offer functions), `src/lib/server/state/write.ts` (**only** the restore path: `restoredInMemberForm`, `restoreRetractedState`)
- `src/lib/server/state/durable.ts` (the cast recording in the function around ~310–370)
- `src/lib/server/state/handEdits.ts` (`seatMemberOfCard` and its readers in that function)
- `src/lib/server/rulesets/resolve.ts` (**only** `writeOutcome`'s `ctxFor`)
- `src/lib/server/sessions/seatKeys.ts` — **only** add the `export` keyword to the PURE translators you need (`rekeyDeltaSide`, `rekeyAnnexAudiences`, `rekeyCoreDocument`, and the `Rekeyed` type if needed). No other change to that file; list exactly what you exported.

Files readable: anything. **Not yours:** every other function in those files, the rest of `state/**`, `rulesets/**`, `sessions/**`, `pipelines/**` (worker w2 is editing `pipelines/runtime/bindings*.ts`, `speakerRotation.ts`, `tools/**` right now), `sockets/**`, `messages/**`, client, `shared/sockets/types.ts`. If a fix needs one of those, stop that item and write the exact edit in your report.

## Goals

These are the items lane f-door (`plans/REPORT-s4-f-door-2026-11-08.md`, read it) left for wave 3. State the both-mode behaviour: off = unchanged byte for byte.

1. **`sessions/annexChanges.ts` `restoreAnnexDeltas`** (~193): with the switch on, translate each restored row's `before` / `after` (the core annex document and the audiences) through f-pass's translator — `rekeyDeltaSide(side, map, owner)` (or whatever its signature is; read `sessions/seatKeys.ts` ~700–760 and how the pass calls it), with `loadSeatMap(tx, sessionId)` from `state/seatRefs.ts` — before inserting the row back and before landing `after`. Only exact card-form strings are translated (the translator's rule). Then remove the ⚠ in `state/write.ts` `restoreRetractedState` (~1191: "`annexDeltas` documents are not translated here (the boot pass's)") and say what's true. Inside the transaction use only `tx`.
2. **`lorebooks/annex.ts` `unionAudiences`** (~240): book audiences (`lorebooks.annex_audiences`) stay in card form (★K-3, ruled: "read by card id until S5"). With the switch on, translate them **per session** when unioned for a session — every card-form ref to each seat that holds the card (`memberFormTargetsOf(map, ref)`, who-may-see goes to every target, ★K-2), refs already in member form kept. The function is sync today; load the seat map in its caller(s) when on and pass it in.
3. **Offers** (`state/give.ts`): an offer proposal's `payload.offer.from` (a `StateOwner`) and the receiver `payload.owner` go through the restore door. Extend `restoredInMemberForm` (write.ts restore path) so a proposal's `payload.offer.from` with a `session_cast` owner is translated like `payload.owner` already is. Then check `give.ts`'s offer readers (`answerOffer` / withdraw / labels, ~262–330) accept member-form `from` / `to` when on (a giver's "theirs to withdraw" check, `isGiveKind`, etc.).
4. **`rulesets/resolve.ts` `ctxFor`** (~925): today `session_cast` and `seated_member` changes file with the session context and everything else (incl. `player_seat`) anchored. With the switch on, a **carded** player seat's values live under `player_seat` (before: `session_cast`), so it must take the session context as `session_cast` did; a card-less player seat keeps the anchor (no behaviour change for persona-less seats). Decide carded-ness from the session's seat rows (`session_personas.persona_id` not null), read once per `writeOutcome`, not per change.
5. **`state/durable.ts`** (~310–370, ★K-2): a card held by a character seat AND a player seat is two links with one durable `castMemberId`, so both seats `record(...)` into the same `cast_member` durable owner and the later write wins. Make it deterministic: per durable member, only one link files — the **character seat's** (the first link in `seatOf` order: live, character seat before player seat, position, id); a player seat whose durable member is also filed by a character seat of this session is skipped (its values stay with the session). Both loops (`recordOwnBookOwners` and the main `links.cast` loop). Switch off: one link per card, unchanged. Report this as a decision (the supervisor flags it to the owner).
6. **`state/handEdits.ts` `seatMemberOfCard`** (~238–265): keyed by card id, so with the switch on a ★K-2 card's two seats share one entry (first link wins). Key the map by **seat** (`castLinkKey(link)` from `state/keys.ts` for cast links; the player seat's `player_seat:<id>` key for seat rows) and change `readOfCard` and its callers in that function to look up by seat; switch off must read exactly as before (keyed per card, since off there is one link per card).
7. List every card-form site you deliberately leave.

## Tests

New tests set the switch explicitly and restore the saved value:
```ts
import { memberFormSwitch } from "$lib/server/state/memberForm"
let was = false
beforeEach(() => { was = memberFormSwitch.on; memberFormSwitch.on = true })
afterEach(() => { memberFormSwitch.on = was })
```
- Forward after a Back taken **before** the flip (card-form `annexDeltas` in the taken record): the restored core annex (turn order/tally refs) and audiences land in member form; a second Forward/Back changes nothing more. (Read `sessions/seatKeys.gate.int.test.ts` — f-pass built Back → pass → Forward; you need Back (switch off) → switch on → Forward without the pass for the taken record.)
- `unionAudiences` / `lorebookAnnexViewFor`: a book audience stored as `character:<card>` lets the member who holds that card's seat (member form, switch on) see the key; one stored as `seated-member:`/`player-seat:` works too.
- An offer taken before the flip and restored: `payload.offer.from` / `to` in member form; accepting it after works.
- `ctxFor`: switch on, a carded player seat's change files with the session context (as `session_cast` did); a card-less player seat's still files anchored (unchanged).
- durable: a ★K-2 card (character seat + player seat, one member) — the member's durable record takes the character seat's values, deterministically, whichever order the links come in.
- hand edits (`handEdits.ts`): a ★K-2 card's two seats each get their own member read/name (no overwrite).
- Int fixtures need seats **with cast members** (`session_characters.cast_member_id`, `session_personas.cast_member_id`): copy the pattern in `src/lib/server/state/memberForm.int.test.ts` (`insertCastMember` from `$lib/server/characters/versions`; `vi.mock("$lib/server/db", …createTestDb)`; `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`). Where a test needs data already in member form, build it in member form, or run f-pass's pass (`seatKeys(db)` from `$lib/server/sessions/seatKeys`) in setup.

Run, in a capped scope, logged to a file — **both modes**, batches of ≤12 files:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w4-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w4-off.log"
# switch on for every test + the door gap closed (the post-turn-on state):
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-w3-door.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w4-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w4-on.log"
```
`<files>`: every test file next to a file you changed — `ls src/lib/server/sessions/annexChanges*.test.ts src/lib/server/lorebooks/annex*.test.ts src/lib/server/state/{give,write,durable,handEdits,memberForm}*.test.ts src/lib/server/rulesets/{resolve,memberForm}*.test.ts src/lib/server/sessions/{rewind,seatKeys}*.test.ts`. Both runs green. A pre-existing test that asserts card form and fails only on-mode: make it switch-aware (set the switch explicitly in that test and assert the member form; keep an off-mode assertion if cheap) — never delete assertions. A failure you didn't cause: report it, don't fix it. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0 errors; worker w2 edits pipelines/runtime/bindings*.ts beside you — report errors in your files only).

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
- Scratch files go in the scratchpad above and start with `s4-f-emit-w4`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
