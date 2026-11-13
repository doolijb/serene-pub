# BRIEF — `s4-f-emit-w7` (lane s4-f-emit) — make three test files switch-aware: forms, fireTurn, stored turn plan

Supervisor: lane `s4-f-emit` (`plans/briefs/BRIEF-s4-f-emit.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back in your final message; do not write a report file.

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


## What is already built (workers w1–w4 of this lane; read their code, it is the base you fix)

All gated on `memberFormOn()`:
- **Seat refs** emitted via `hostSeatRefOf` (`pipelines/prompt/seatCards.ts`): the `session_cast` read's host-filled `ref` (`host.ts` `case "session_cast"`), `sockets/sessions.ts` seat payloads, turn candidates (`bindings.ts` `core:task/turn-pool@1`, which also carries `castMemberId` on each candidate when on), `liveCastRefs`, `turnRefs`, `fireAction`, `runTurn`, `turnPlan.ts` `storedTurnPlan`.
- **Speaker stamp** (`messages/store.ts` `speakerSeatOf` / `withSpeakerStamp` / `restampSpeakers`): on, every seat line gets `castMemberId` and `metadata.speaker` = the seat's member-form ref. `messages/sessionChanges.ts` `speakerRefOf(row)` reads it.
- **Turn-order rules**: `speakerRotation.ts` `seatRefLookupOfCast(cast)` honours `seatKind`; `bindings.ts` `seatRefLookupOfCandidates(candidates)` builds the lookup for the cast-less strategies; `turnEntries`, turn-advise, `turnOrderSelection`, `plannedTurns`, `unpromptedEntries`, `lastSpeakerRef` take it. The SDK's `spokenRefsSince` / `senderRefOf` / `roundRobinOrder` (`../serene-pub-sdk/sdk/src/turnOrder.ts`, read only) read a row's seat through the lookup by `castMemberId`, else card form.
- **State**: f-door's doors (`state/seatRefs.ts`) and readers are member-form aware; `castOwnerOf`/`castMemberKey` give member-form owners/keys; `bindings.state.ts` `castOwnerOfRef` accepts `seated-member:`; restore paths translate (`state/write.ts` `restoredInMemberForm`, `sessions/annexChanges.ts` `restoreAnnexDeltas`).
- **Moments/tally** (`routines/moments.ts`): `tallySpeakerOf`, `seatedOf`, `replayStoryLane` map card-form speakers to member form when on.

**Three fixes already queued to the lead (do NOT make them; the test config mocks the first and third):**
1. The door (`state/seatRefs.ts`, f-door's): on-mode `storedSeatRef("character:N")` / `storedSeatOwner({session_cast})` will return the input unchanged when the translator has no answer (a member-less character seat, or a card no seat holds) instead of null. The config below mocks exactly this.
2. `pipelines/prompt/adventureContext.ts` `withinEarshot` / `holderOf` compares a card id with `castMemberKey(entry)`, which is member form when on, so a voice's own holder-only values are hidden when on. If a failure you chase is this, say so and stop that item.
3. `sessions/fireTurn.ts` `fireTurnEntry` RESPOND branch (~215): a `seated-member:M` entry ref now resolves its card through `seatOf` (before: only `character:` parsed, so on-mode replies were written with no character — the reply loop). The config swaps in the patched copy (`$S/s4-f-emit-w5-fireTurn.ts`).

Worker w5 (done) also fixed `host.ts` `set-stat-config`'s anchor for a card-less `player_seat`, and made `rewind.int`, `sessions.dungeonCrawlerWalk2/3.int` switch-aware — read those test edits for the helper pattern (`loadSeatMap` + `memberFormOf` to name a seat's owner/key in a fixture, `storedSeatOwner` to read a value).

## Files owned (edit only these)

- the three test files named in the goal, `src/lib/server/sessions/turnPlan.ts`, and tests next to it.

**Not yours:** every other source file — in particular `pipelines/runtime/**` (`host.ts`, `fireAction.ts`, `runTurn.ts`, `bindings.ts`) and `sockets/sessions.ts`, which worker w6 is editing right now. If a test failure is a real source bug in one of those, stop that item and write the exact edit (file, function, before → after) in your report — the supervisor applies it.

## Goal

These on-mode failures remain (switch on + the door fix + the fireTurn fix). Each likely pins card form where the new behaviour (member form) is right; confirm that by reading the code path, then make the test switch-aware: under `memberFormOn()` assert the member form (a persona/player seat line is `player-seat:<seatId>`, a character seat `seated-member:<castMemberId>`, a member-less character seat ⏳ `character:<cardId>`); off, keep today's assertion. Never weaken what a test checks. If the code is wrong instead, queue the source edit.

- `src/lib/server/sockets/sessions.forms.int.test.ts` (5): "the guest whose persona is addressed answers by clicking…", "a pressed action that parks at its own write answers parked at once… (R-b)" (⚠ this one also fails OFF on an extra `askedRunId` in the ack from an earlier lane — leave that part, note it), "a choices press is normalised to { choice }… (W5)", "a persona named by the oracle is the block's addressee…", "a question put to nobody in particular is answered as the presser…". (w2 found: tests expecting `character:<persona>` in `metadata.speaker` / `answered.by` now get `player-seat:S`.)
- `src/lib/server/sockets/sessions.fireTurn.seatedMember.int.test.ts` (1): "a carded seat's member fires as character:<cardId>…" — with the switch on the entry fires in member form; rename the test's words only if they then lie.
- `src/lib/server/pipelines/runtime/turnSeats.seatMembers.int.test.ts` (2) `storedTurnPlan`: "matches a speaker fact naming the member's own name…" and "a wait named seated-member:<id> is stored as the seat's card form" — `sessions/turnPlan.ts` `storedTurnPlan` now stores seat refs via `hostSeatRefOf` (member form when on). Check `turnPlan.ts` is right, then make the test switch-aware.

## Tests

Run each file you work on **both modes**, capped, logged:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w7-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w7-off.log"
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-w5.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w7-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w7-on.log"
```
(This config = switch on + the door fix + the fireTurn fix. `-t "<test name>"` narrows to one test while you diagnose.) At the end, rerun the three files both modes, plus `src/lib/server/sessions/turnPlan.playerSeats.int.test.ts` if you touched `turnPlan.ts`. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0).

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
- Scratch files go in the scratchpad above and start with `s4-f-emit-w7`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
