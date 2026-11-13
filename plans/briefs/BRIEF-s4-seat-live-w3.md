# BRIEF — lane `s4-seat-live`, worker w3 — a card-less seat's stops, transcript name, adapter and speech reads, token estimate, sprite pick (Q6–Q8 + smaller) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON** — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w4 runs beside you on `state/resolve.ts` only — no shared files.

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A **card-less character seat** is a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; its ref is `seated-member:<castMemberId>` (`hostSeatRefOf`, `pipelines/prompt/seatCards.ts`). **The seat filter** = not an envoy, and has a member or a card: `and(isNull(envoySlug), or(isNotNull(characterId), isNotNull(castMemberId)))`, inline.
- Ready helpers: `seatCards.ts` 🚧 `cardlessSeatCard(asRead)` (card-shaped, the member's profile, `cardless: true`, **no `id`/`userId`**); `seatCardsAsRead(db, sessionId, rows, { cardless: true })` fills a card-less row's `character` with it (trust check: member lives in the session's books). `sprites/choices.ts` `spriteChoicesFor(db, { sessionId, castMemberId })` — the card-less form (member's own sprite sets), exactly one of `characterId` / `castMemberId`.
- Done earlier in this lane (w1/w2, read them): the run carries 🚧 `currentCastMemberId` — the speaker of a card-less seat, set only when `currentCharacterId` is null — on `HostScope` (`runtime/host.ts`), the run request and `sessionScope` (`runtime/runTurn.ts`); the host `session_cast` read now includes card-less rows (`character` = `cardlessSeatCard`, `castMemberId`, `ref`, `seatedByUserId`); `promptFields.ts` names the speaker by `currentCastMemberId`. A card-less seat's reply row: `character_id` null, `cast_member_id` = the member, `metadata.speaker = "seated-member:<id>"`.
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never put a member id where a card id is read, never compare one to the other, keep them in separately named fields.
- ⚠ A **card-less player seat** line also has `character_id` null and may have `cast_member_id` set — its `metadata.speaker` is `player-seat:<id>` and/or it has a seat name. Never name a player's line as a character seat: a card-less **character** line is one whose `metadata.speaker` is `seated-member:` (or, with no speaker stamp, `cast_member_id` matches a card-less **character** seat and `personaId` is null and role is assistant — name the rule you use).

## Goal (the supervisor's queue, exactly)

1. **Q6 stops** — a card-less speaker's own label must not end its own reply (`Ash: ` seeded and `Ash:` stopped → empty reply):
   - `src/lib/server/connections/stops.ts`: `speakerStops` (~215) skips the current speaker by card id; `ownLabelsFor` (~619–645) adds the speaking character's name/nickname by card id. Add the card-less speaker by member: `ComposeStopsInput.currentCastMemberId?` + the `characters` entries carry `castMemberId` (map it in `withStops`/the session→input mapping ~720), skip/own the row with **no `id`** whose `castMemberId === currentCastMemberId`. One JSDoc sentence per new field.
   - `src/lib/server/pipelines/runtime/dispatch.ts`: the dispatch request takes `currentCastMemberId?` (beside `currentCharacterId` ~164) and passes it to `ownLabelsFor` (~1485) and to the stop composition (~1149, ~1186, ~1239 — find where `currentCharacterId` reaches the stops/adapter and follow it; the adapter itself needs nothing new unless it composes stops).
   - `src/lib/server/pipelines/runtime/host.ts` provider call (~6960–6985 `dispatchGeneration({ … currentCharacterId: p.currentCharacterId ?? scope.currentCharacterId ?? null`): also `currentCastMemberId: scope.currentCastMemberId ?? null` — **only when** the resolved `currentCharacterId` is null.
2. **Q7 transcript naming:** `src/lib/server/pipelines/prompt/contentProcessors.ts` (~230–270) and `src/lib/server/pipelines/ranking/ragQuery.ts` `formatMessageForQuery` (~35–55): a card-less character line (rule above) is named by the session row with **no card** whose `castMemberId === message.castMemberId` (and, departed, from `removedSessionCharacters` the same way); it is never the unclaimed name. Check the message shape these receive carries `castMemberId` (and `metadata`); if a caller strips it, name the caller (fix if it's in your files, else queue).
3. **Q8 adapter + speech session reads:**
   - `dispatch.ts` `loadAdapterSession` (~438–520): filter `cc.character !== null || (cc.castMemberId != null && cc.envoySlug == null)` and read through `seatCardsAsRead(…, { cardless: true })` so a card-less seat has its member's card-shaped `character`; envoy seats stay out.
   - `src/lib/server/pipelines/runtime/dispatchSpeech.ts` `castRefs` (~405–445): `innerJoin(characters)` → `leftJoin` with the seat filter; a card-less seat is named from its member as read (`seatedCastOf` already reads members — reuse `members`), ref from `hostSeatRefOf({ kind: "character", seatId, castMemberId, cardId: null })`; no `character:${undefined}`.
4. **`promptTokenCount`** — `src/lib/server/sockets/sessions.ts` `promptTokenCountHandler` (~10062–10345) **only**: when the stored head is a `seated-member:` ref whose seat has **no card**, compile for it with `speaker: <that ref>` (as the envoy head passes `speaker`), not "No character available"; the "first active character" fallback (~10264) also considers live active card-less seats by position (speaker = its `hostSeatRefOf` ref). The session object there comes from a relational read where a card-less seat's `character` is null — read `castMemberId`/`envoySlug`/`removedAt` off the row; don't widen the shared read.
5. **pick-sprite** — `runtime/bindings.ts` `core:oracle/pick-sprite@1` (~8634–8700) **and** `host.ts` `case "core:oracle/pick-sprite"` (~6820–6880) **together**: a `seated-member:` speaker whose seat has no card → the binding calls the host with `castMemberId` (not `characterId`); the host passes `castMemberId` to `spriteChoicesFor` (exactly one of the two). A carded speaker is unchanged.

## Files owned (edit only these)

`src/lib/server/connections/stops.ts`, `src/lib/server/pipelines/runtime/dispatch.ts`, `src/lib/server/pipelines/runtime/dispatchSpeech.ts`, `src/lib/server/pipelines/prompt/contentProcessors.ts`, `src/lib/server/pipelines/ranking/ragQuery.ts`, `src/lib/server/pipelines/runtime/host.ts` (**only** the provider call ~6960–6985 and the pick-sprite case), `src/lib/server/pipelines/runtime/bindings.ts` (**only** pick-sprite), `src/lib/server/sockets/sessions.ts` (**only** `promptTokenCountHandler`), and tests next to them: new `connections/stops.cardless.test.ts`, `pipelines/prompt/contentProcessors.cardless.test.ts` (or additions), `ranking/ragQuery` test additions, `runtime/dispatch.cardless.int.test.ts`, `runtime/dispatchSpeech` test additions, `sockets/sessions.promptTokenCount.cardless.int.test.ts`, a pick-sprite test (grep existing `pickSprite*` tests).

## Files readable

Everything. Key: `pipelines/prompt/seatCards.ts`; `sprites/choices.ts`; `sessions/seats.ts` (`seatOf`); `sessions/seats.cardless.int.test.ts`, `sessions/fireTurn.cardless.int.test.ts`, `pipelines/runtime/host.sessionCast.cardless.int.test.ts` (harnesses this lane wrote for a card-less seat); `messages/store.ts` (the speaker stamp).

## Out of scope (never built here)

`state/resolve.ts` (w4). `seatName.ts`, `permissions.ts`, the client, `+page.svelte` (next workers). The `session_cast` read, `promptFields.ts`, the lore read, `runTurn.ts`, `runReply.ts`, `fireTurn.ts` (done — read only). SDK. Docs. NOMENCLATURE (list rows to queue).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a new exported name beyond `currentCastMemberId` on the dispatch request / `ComposeStopsInput` and `castMemberId` on its `characters` entries; a change outside your files.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `host.ts`/`bindings.ts`/`sockets/sessions.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w3-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w3-tests.log"
```

Must pass, each its own `it`:
- stops: with card-less member M speaking (`currentCastMemberId = M`), `M:` is not a stop and is an own label; another seat's `N:` still is; a carded speaker unchanged; narrator unchanged;
- transcript: a card-less character line is named M in the session processor and in `formatMessageForQuery`; a card-less **player** line with the same member is not named as the character seat; a departed card-less seat's line still named;
- `loadAdapterSession` lists the card-less seat with M's name, no `id`; envoys absent;
- `castRefs` maps M's name → `seated-member:M`;
- `promptTokenCount` with a card-less head returns a count (no "No character available");
- pick-sprite with a `seated-member:` card-less speaker calls the host with `castMemberId` and offers M's own sets; a carded speaker unchanged.
Re-run the existing tests of every file you touched (grep `stops`, `contentProcessors`, `ragQuery`, `dispatch`, `dispatchSpeech`, `promptTokenCount`, `pickSprite`/`sprite` test files), ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-live-w3-tsc.log`) — no new errors.

## Report (final message)

Changed files with hunks named; decisions (named, incl. the card-less-character-line rule); tests + counts + log paths; tsc; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft).
