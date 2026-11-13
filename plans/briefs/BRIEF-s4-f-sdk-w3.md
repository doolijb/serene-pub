# BRIEF — lane `s4-f-sdk`, worker 3 — the seat-kind hint on the cast lookup (`refOfMember`) — 2026-11-08

You are a lane-worker for supervisor `s4-f-sdk`. SDK repo: `/home/jody/github/serene-pub-sdk` (edit SDK code **there**). App: `/home/jody/github/serene-pub` (read only for you).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

You do **not** run `sdk:build`. Never `git checkout` / `restore` / `stash` in either repo. Prettier: `--check` changed files and **only reformat lines you changed**. Scratch: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w3-*`.

## The problem (plan §34.1 gap 2)

The SDK's turn-order readers take a **cast lookup** `refOfMember: (castMemberId: number) => ParticipantRef | null | undefined` (a cast member id → that seat's `ref`). One cast member can hold **both** a character seat and a player seat (a card seated as a character and also played as a persona). From the flip (wave 3) those seats carry different refs: `seated-member:<castMemberId>` and `player-seat:<seatId>`. The lookup has no way to know which seat the caller means, so `senderRefOf` (`sdk/src/turnOrder.ts` ~183-200) — whose row is **always** a person's line, i.e. from a **player seat** — can get the character seat back. The core-catalog conversation lookup (`core-catalog/components/shared/messages/conversation.svelte.ts` ~289, personas first) has the mirror bug for a character's reply.

Vocabulary (NOMENCLATURE, ruled 2026-10-14): "A **seat** is a place at the table … never a type name alone (R3): always one of its two kinds. A **character seat** is a `session_characters` row … A **player seat** is a `session_personas` row." R3: qualify, never the bare noun.

**Modder rule (owner 2026-11-08):** "plugins never parse ref strings (typed host-filled fields and helpers); one JSDoc sentence per new field". The brief from the lead: "design it so a plugin author never has to know this case exists."

⚠ **Waves 1–3 are one unit**: additive and tolerant of both forms. Before the flip both seats' refs are the same card form (`character:<cardId>`), so nothing may change for today's data; a lookup that ignores the new argument (the app's `seatRefLookupOfCast`, `src/lib/server/pipelines/runtime/speakerRotation.ts:115-140`, owned by a later lane) must keep today's answers exactly.

## Goal — the design (decided by the supervisor; names are 🚧 and go to the owner as a proposal)

1. The lookup gains one optional second parameter **`seatKind?: 'character-seat' | 'player-seat'`** — which kind of seat the caller means; the lookup **prefers** a seat of that kind and falls back to any seat of the member (so it changes identity only, never whether a row resolves). One JSDoc sentence on the parameter wherever the lookup type is spelled. Don't add an exported type alias (no new exported name); update each inline spelling:
   - `sdk/src/turnOrder.ts`: `senderRefOf` (~185), `spokenRefsSince` (~245), and the round-robin function (~284). `senderRefOf` calls `refOfMember(m.castMemberId, 'player-seat')`; `spokenRefsSince`'s assistant-row read (~253) calls it with `'character-seat'`; the sender read (~259) goes through `senderRefOf`. Update the 🚧 JSDoc blocks (~174, ~233, ~274) in one sentence each.
   - `core-catalog/src/shared/ui/conversation/itemValues.ts` (~84-135): `itemSpeakerOf` passes `'player-seat'` for a row a person sent from a seat (`personaId != null`, or a `player-seat:` speaker — the same reading `senderRefOf` uses) and `'character-seat'` otherwise; `itemValuesOf`'s `facts.refOfMember` type follows.
   - `core-catalog/src/shared/ui/conversation/messageVerbState.ts` (~117): the type follows; nothing else.
   - `core-catalog/components/shared/messages/conversation.svelte.ts` `refOfMember` (~289): honour the hint — `'character-seat'` searches `sessionCharacters` first then `sessionPersonas`; `'player-seat'` or absent keeps today's order (`sessionPersonas` first). Update its JSDoc.
2. A plugin calling `conv.refOfMember(id)` or passing its own one-argument lookup keeps compiling and behaving as today.

## Tests (new cases; put them in `sdk-tests/seatCastViews.test.ts` or `sdk-tests/roundRobin.test.ts`, whichever already tests `senderRefOf` / `spokenRefsSince` / `itemSpeakerOf`)

- `senderRefOf` with a lookup that honours the hint, for a member (id 7) holding character seat `seated-member:7` and player seat `player-seat:4`: a person's row (`personaId: 12, castMemberId: 7`) → `player-seat:4`.
- `spokenRefsSince`: an assistant row from member 7 → `seated-member:7`; the opening person's row → `player-seat:4`.
- A one-argument lookup (ignores the hint) → today's answers, unchanged (pin them).
- `itemSpeakerOf`: person's row → `player-seat:4`; reply row → `seated-member:7`.
- Today's card-form data (both refs `character:12`) → unchanged.
- The conversation lookup is in a `.svelte.ts` component module; if an existing sdk-test already imports `conversation.svelte.ts` add a case there, else skip testing it directly and say so.

Run (capped, logged), once before your edits for a baseline and once after:
```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx tsx --test seatCastViews.test.ts roundRobin.test.ts messageVerbState.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w3-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w3-tests.log'
```
(drop a file name that doesn't exist; add any other sdk-test that imports `turnOrder`/`itemValues`/`messageVerbState` — grep). Typecheck `cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests` before/after. Never pipe test output into `head`.

## Files owned (edit only these)

`sdk/src/turnOrder.ts`, `core-catalog/src/shared/ui/conversation/itemValues.ts`, `core-catalog/src/shared/ui/conversation/messageVerbState.ts`, `core-catalog/components/shared/messages/conversation.svelte.ts` (the `refOfMember` method and its JSDoc only), and the test file(s) you add cases to.

## Out of scope

Any app file (the app's `seatRefLookupOfCast` honouring the hint is queued to a later lane — just confirm in your report that its one-argument type still assigns). An SDK helper that builds the lookup from a cast document (not asked). Any other refactor.

## Done means

New cases present and green, the touched suites green (or failures shown pre-existing in your baseline), `tsc -p sdk-tests` no new errors, prettier clean on lines you changed.

## Report (your final message)

Changed files (one line each), tests before/after, tsc before/after, whether the app's one-argument lookup still type-assigns (read `speakerRotation.ts:113` and `bindings.ts:4356`), **Noticed, not done**.
