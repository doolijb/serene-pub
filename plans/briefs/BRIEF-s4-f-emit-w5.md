# BRIEF — `s4-f-emit-w5` (lane s4-f-emit) — make the on-mode failures pass: turn order, Back/Forward, routines, Dungeon Crawler

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

**Two fixes already queued to the lead (do NOT make them; the test config mocks the first):**
1. The door (`state/seatRefs.ts`, f-door's): on-mode `storedSeatRef("character:N")` / `storedSeatOwner({session_cast})` will return the input unchanged when the translator has no answer (a member-less character seat, or a card no seat holds) instead of null. The config below mocks exactly this.
2. `pipelines/prompt/adventureContext.ts` `withinEarshot` / `holderOf` compares a card id with `castMemberKey(entry)`, which is member form when on, so a voice's own holder-only values are hidden when on. If a failure you chase is this, say so and stop that item.

## Files owned (edit only these, plus tests next to them)

Every file this lane owns (the earlier workers are finished): `src/lib/server/pipelines/runtime/**`, `src/lib/server/pipelines/routines/*`, `src/lib/server/messages/**`, `src/lib/server/sessions/{turnPlan,turnYield,annexChanges}.ts`, `src/lib/server/scenes/liveScenes.ts`, `src/lib/server/speech/**`, `src/lib/server/sprites/choices.ts`, `src/lib/server/pipelines/prompt/seatCards.ts`, `src/lib/server/sockets/sessions.ts`, `src/lib/server/sockets/pipelines.ts`, `src/lib/server/lorebooks/annex.ts` (`unionAudiences` only), and the test files next to them — plus the failing test files named below (only to make an assertion switch-aware where the test pins card form; never weaken what it checks).

**Not yours:** `state/**` (except via the lead), `rulesets/**`, `sessions/*` other than the three named (e.g. `sessions/rewind.ts`, `sessions/fireTurn.ts`, `sessions/retakeTurn.ts`, `sessions/seatName.ts`, `sessions/seats.ts`), `pipelines/prompt/*` other than seatCards, `cast/**`, client, `shared/sockets/types.ts`, the SDK. If the fix belongs there: stop that item and write the exact edit (file, function, before → after) in your report.

## Goal

These on-mode failures (switch on + door fix mocked) remain. For each: find the root cause (file:line), fix it in your files if it is a real member-form bug, or make the test switch-aware if the test pins card form and the new behaviour is right, or queue the edit if the cause is outside your files.

- `src/lib/server/sockets/sessions.genreParity.int.test.ts` (3): "Story · Minimal: costs exactly what Chat costs — one call", "the derived calls per turn agree with a real turn", "Story · Living: the reply plus one reckoning call" — extra calls suggest the turn order no longer sees that a seat replied (a reply loop / extra turns). Trace the recompute path the socket uses (who builds candidates, which strategy, which lookup reaches `spokenRefsSince`).
- `src/lib/server/pipelines/routines/routines.int.test.ts` (3): "one Story · Living turn…", "the sweep every 5 turns: a member's line and a reply are a turn each", "Allow stacking off…" (w1 found these fail even with its stamp/tally mapping bypassed — likely the same turn-order cause).
- `src/lib/server/sessions/rewind.int.test.ts` "🚧 RF fix 5: Back · Forward" (6).
- `src/lib/server/sockets/sessions.dungeonCrawlerWalk2.int.test.ts` "the card stays with the fallen seat; a solo line from its player is the new seat's and starts the round at once"; `sessions.dungeonCrawlerWalk3.int.test.ts` "a persona host's standing order, pressed during genesis…" and "Vis Itineris: 'Health 12 (full)'…".

Start with genreParity (cheapest signal). Keep off-mode behaviour byte-identical.

## Tests

Run each file you work on **both modes**, capped, logged:
```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-f-emit-w5-off.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w5-off.log"
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run --config $S/s4-f-emit-door2.vitest.config.mts <files> --maxWorkers=2 > $S/s4-f-emit-w5-on.log 2>&1; echo test-exit=\$? >> $S/s4-f-emit-w5-on.log"
```
(`-t "<test name>"` narrows to one test while you diagnose.) At the end, rerun every file you changed a source next to, both modes, ≤12 files a batch: the six failing files above plus `src/lib/server/pipelines/runtime/bindings.s4Emit.test.ts`, `src/lib/server/messages/store.memberForm.int.test.ts`, `src/lib/server/pipelines/runtime/host.seatForm.int.test.ts`, `src/lib/server/sockets/sessions.lairKnock.int.test.ts`, `src/lib/server/sockets/sessions.retake.int.test.ts`. Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=8192; ..."` (baseline 0).

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
- Scratch files go in the scratchpad above and start with `s4-f-emit-w5`.

## Report (final message)

Changed files; every site changed (file:line, before → after in a few words) and every card-form site deliberately left (why); tests run with both-mode results (files, counts); tsc result; caller edits needed outside your files (exact edits); open questions (★, one recommendation each); **Noticed, not done**.
