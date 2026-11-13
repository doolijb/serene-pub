# BRIEF — lane `s4-seat`, worker w2 — card-less seats: prompt, greetings, lore gate, turn readers (2026-11-08)

Supervisor: lane `s4-seat` (wave 4 of seat-cast S4; the flip is ON — `state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file).

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A seat reads its member over the member's active card; a **card-less** member reads only its own fields (`cast/memberAsRead.ts` `MemberAsRead`, `cardless: true`).
- Owner 2026-11-05 ★S2b-1 "Still theo": the seater (`session_characters.seated_by_user_id`) acts for the seat — never `characters.user_id` for a card-less seat.
- Owner 2026-11-08 ★4: **"background member" = not seated in this session** (lore gate and docs). Trade-off accepted: one member is a speaker in one session and background in another. Supervisor's reading (name it in code comments): *seated* = a **live** seat (`removed_at` null) of either table holds the member.
- Worker w1 (done) made **card-less character seats** writable: a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; addressed `seated-member:<castMemberId>` (`hostSeatRefOf` in `pipelines/prompt/seatCards.ts` already emits that for such a row). **The seat filter** = *not an envoy, and has a member or a card*: `and(isNull(envoySlug), or(isNotNull(characterId), isNotNull(castMemberId)))`, written inline.
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never put a member id where a card id is read, never invent a card id, and keep the two in separately named fields; never compare one to the other.
- Supervisor's design (from a read-only diagnosis; decide details inside it and name them):
  - 🚧 `cardlessSeatCard(asRead: MemberAsRead)` in `seatCards.ts` → a card-shaped object `{ ...cardColumnsOfProfile(profileOf(asRead)), cardless: true }` with **no `id` and no `userId` key**, so name/description/personality/greetings/post-history/likeness/strokes readers work unchanged and an `cc.character.id === x` comparison is simply false.
  - `seatMembersAsRead(db, sessionId, rows, opts?)` and `seatCardsAsRead(db, sessionId, rows, opts?)` gain `opts.cardless?: boolean` (default **off** — `seatCardsAsRead` also serves player seats via `personasAsRead`, and filling those would hand every card-less player seat a made-up persona). With it on, a row with no card but a stored `castMemberId` reads that member — with the same trust check the carded path uses (the member lives in the session's attached book or own book; **no** `findSeatMembers` fallback) — and `seatCardsAsRead` sets that row's `character` to `cardlessSeatCard(asRead)`. A row whose member doesn't read stays as it was.
  - The speaker of a card-less seat is identified by a separate optional datum `currentCastMemberId` (set only when `currentCharacterId` is null). Matching rule: `currentCharacterId != null ? card match : row.castMemberId === currentCastMemberId`.

## Goal

1. `src/lib/server/pipelines/prompt/seatCards.ts`: `cardlessSeatCard` + the `cardless` option (above). Unit + int tests.
2. `src/lib/server/sockets/sessions.ts` `getPromptSessionFromDb` (~1975–2160) — **only this function**: pass `{ cardless: true }` for `sessionCharacters` and `removedSessionCharacters` (not personas); the removed-rows query (~2083) also gets `isNull(cc.envoySlug)`. ⚠ Lane worker w3 may be editing a different hunk of this file at the same time: re-read before each Edit; touch nothing outside this function.
   **Then audit every consumer** of this function's `sessionCharacters` / `removedSessionCharacters` (and of `loadAdapterSession`'s, if it derives from them): `grep -rn "getPromptSessionFromDb\|removedSessionCharacters" src/lib/server`, follow into `pipelines/prompt/contentProcessors.ts`, `promptFields.ts`, `cardStrokes.ts`, `runtime/dispatch.ts`, `ranking/ragQuery.ts`, `speech/cueLines.ts`, `scripts/chains.ts`, `connections/stops.ts`, etc. For each site report file:line and one of: **safe** (guards null / compares `id ===`), **crash** (non-null deref of a missing key), **collision** (Map/Set/object key or string built from `character.id`), **wrong** (reads `userId`/ownership off the card). Do **not** edit those files (outside the lane) — the supervisor queues them.
3. `src/lib/server/sessions/greetings.ts`: a card-less live character seat (seat filter; add `isNull(envoySlug)` where seats are read) gets its member's greeting through `seatCardsAsRead(..., { cardless: true })` (drop or reuse the local `seatsAsRead`); the greeting entry type widens to `characterId: number | null` plus the speaker of a card-less seat; a card-less greeting row is written with `character_id` NULL and `metadata.speaker = "seated-member:<castMemberId>"` (the message store's stamp rule (d) then fills `cast_member_id` — verify in `src/lib/server/messages/store.ts` ~240–260 and say what you found). Names list (~275) includes card-less seats by their member's name.
4. `src/lib/server/pipelines/prompt/characterLore.ts` `isCharacterLoreEntryVisible(entry, session, currentCharacterId, currentCastMemberId = null)` (~106): "narrator" = both ids null. Order: (1) unbound → narrator only (unchanged); (2) `binding.id === currentCastMemberId` → visible; (3) the card match (unchanged); (4) persona/player-seat voiced (unchanged); (5) **★4 background**: when `session.seatedMemberIds` (🚧 optional `readonly number[]` on the session object the gate takes — find its type; add the optional field with one JSDoc sentence) is present, a binding **not** in it → narrator only, a binding in it → not visible to the narrator; when absent, the old rule (`!binding.characterId && narrator`); (6) otherwise not visible. Every existing caller keeps compiling and behaving the same until it passes the new arguments (callers in `runtime/host.ts` are outside the lane — list them with the exact argument they'd pass).
5. `src/lib/server/pipelines/runtime/bindings.ts` (in-lane, all guarded, no behaviour change for carded seats):
   - `resolveAddresseeName` (~1562–1607): a seated row counts with `character?.id != null || castMemberId != null`; `seatRefOf` takes `cardId: number | null` (check its signature and callers).
   - turn pool (~4422–4450): `ownerUserId` = `character.userId` when the row has a card, else the seat's `seatedByUserId` when the row carries it (if the host row doesn't carry it yet, read it as optional and list "host `session_cast` select `seatedByUserId`" as queued); the ref stays host-filled (`cc.ref`), never `character:${undefined}`.
   - `build-template-context` (~5436) and the lore lanes (~2682, ~2780, ~3041, ~3435, ~3920, ~4275, ~8199): where they pass `currentCharacterId` to a lore/visibility/prompt helper you own or that is in-lane, also pass `currentCastMemberId` read as `(input?.scope as { currentCastMemberId?: number | null } | undefined)?.currentCastMemberId ?? null` **only if** the receiving helper is in-lane (characterLore); otherwise list the site as queued. Do not widen `HostScope` (it's in `host.ts`, outside the lane).
   - pick-sprite (~8574–8606): leave the call as is unless w3's `castMemberId` param on `sprites/choices.ts` exists when you get there (it may not — then list it as queued).
   - `castEntityRefs` (~790), ~9407, ~7400: read and report; change only if an id-less `character` would now collide or mis-key there.
6. `src/lib/server/pipelines/runtime/speakerRotation.ts` `rotationSeats` (~232–244): guard `cc.character?.id != null`; other sites (~125, ~385, ~609, ~920) read by ref / `castMemberId` — check and report.

## Files owned (edit only these)

`src/lib/server/pipelines/prompt/seatCards.ts`, `src/lib/server/sockets/sessions.ts` (**only** `getPromptSessionFromDb`), `src/lib/server/sessions/greetings.ts`, `src/lib/server/pipelines/prompt/characterLore.ts`, `src/lib/server/pipelines/runtime/bindings.ts`, `src/lib/server/pipelines/runtime/speakerRotation.ts`, and tests next to them: existing `seatCards*.test.ts`, `characterLore*.test.ts` (e.g. `characterLore.seatMember.test.ts`), `sessions/greetings.seatMembers.int.test.ts`, `bindings*.test.ts`, `speakerRotation*.test.ts`, or new files `seatCards.cardless.int.test.ts`, `characterLore.cardless.test.ts`, `greetings.cardless.int.test.ts`.

## Files readable

Everything. Key: `seatCards.ts` whole; `cast/memberAsRead.ts` 60–200, 600–800; `characters/cardIO.ts` `cardColumnsOfProfile`; `shared/characters/profile.ts` `profileOf`; `sessions/seats.ts` (w1's new card-less paths, `seatOf`); `messages/store.ts` speaker stamp; `sessions/seats.cardless.int.test.ts` (w1's harness for making a card-less seat).

## Out of scope (never built here)

`runtime/host.ts`, `runReply.ts`, `runTurn.ts`, `fireTurn.ts`, `promptFields.ts`, `contentProcessors.ts`, `stops.ts`, `dispatch.ts`, `dispatchSpeech.ts`, `state/resolve.ts` — outside the lane: **list exact edits** for the supervisor to queue. Also w3's files (seatedCast, rowProjection, portrayals, conversations/gate, handEdits, seatRefs, resolveVoice, sprites/choices, illustrateScene). Client. Docs. NOMENCLATURE (queue rows).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a ★ is unruled; a new exported name beyond `cardlessSeatCard`, the `cardless` option, `currentCastMemberId`, `seatedMemberIds`; a change outside your files.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `sockets/sessions.ts` and `types.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-w2-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-w2-tests.log"
```

Must pass, each its own `it`:
- `cardlessSeatCard` has no `id`/`userId` and carries the member's name, description, personality, first greeting and post-history; without the option, player rows and card-less rows come back unchanged;
- with `{ cardless: true }` a card-less seat whose member lives in the own book reads that member; a member in an unrelated book does not;
- `getPromptSessionFromDb` on a session with a card-less seat: its row's `character.name` is the member's name, `character.id` is undefined, and an envoy's departed row is not in `removedSessionCharacters`;
- greeting: a card-less seat's greeting row has `character_id` null, `cast_member_id` = the member, `metadata.speaker = seated-member:<id>`, and the member's greeting text;
- lore gate, with card-less member M seated and member B (carded and card-less variants) not seated: M speaking (`currentCastMemberId = M`) sees M's entry; another speaker does not; the narrator does not see M's entry (seated → not background) but does see B's; speakers don't see B's; unbound entries as before; without `seatedMemberIds` every old case is unchanged (the existing characterLore tests stay green);
- turn pool: a row with no card takes its owner from `seatedByUserId`; a carded row is unchanged.
Re-run the existing tests of every file you touched, ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-w2-tsc.log`) — no new errors.

## Report (final message)

Changed files; decisions (named); the consumer audit table (file:line → safe/crash/collision/wrong); the outside-lane edits needed, exact; tests + counts + log paths; tsc; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft).
