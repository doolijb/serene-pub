# BRIEF — lane `s4-seat-live`, worker w2 — a card-less seat in the cast read and the prompt (Q4–Q5) (2026-11-08)

Supervisor: lane `s4-seat-live` (seat-cast S4, wave 4 follow-up; **the flip is ON** — `src/lib/server/state/memberForm.ts` `memberFormSwitch = { on: true }`). Repo `/home/jody/github/serene-pub`. Report in your final message (no report file). Worker w1 runs beside you (turn → run scope → lore gate); see "Shared files".

## Context (quoted by the supervisor; never reinterpret)

- Owner 2026-11-05: "Everything in session is cast → active card." A seat reads its member over the member's active card; a **card-less** member reads only its own fields (`cast/memberAsRead.ts` `MemberAsRead`, `cardless: true`).
- Owner 2026-11-05 ★S2b-1 "Still theo": the person who seated a cast member (`session_characters.seated_by_user_id`) keeps acting for that seat — never `characters.user_id` for a card-less seat.
- A **card-less character seat** is a `session_characters` row with `character_id` NULL, `envoy_slug` NULL, `cast_member_id` set; its ref is `seated-member:<castMemberId>` (`hostSeatRefOf`, `pipelines/prompt/seatCards.ts`). **The seat filter** = not an envoy, and has a member or a card: `and(isNull(envoySlug), or(isNotNull(characterId), isNotNull(castMemberId)))`, written inline.
- Ready helpers (lane s4-seat w2), `pipelines/prompt/seatCards.ts`: 🚧 `cardlessSeatCard(asRead)` → a card-shaped object with the member's profile and `cardless: true` and **no `id`/`userId` key**; `seatMembersAsRead(db, sessionId, rows, { cardless: true })` and `seatCardsAsRead(db, sessionId, rows, { cardless: true })` read a card-less row's stored member (trust check: the member lives in the session's books). Read them before you start.
- ⚠ **Card ids and member ids share one id range** — a wrong-person read is silent. Never put a member id where a card id is read, never compare one to the other; `cc.character.id === x` on a card-less row is simply false (no `id`) — keep it that way.
- Plugins never parse ref strings (owner modder rule 2026-11-08). Match the host-filled `ref` / `castMemberId`, don't parse.
- w1 adds 🚧 `currentCastMemberId` (the speaker of a card-less seat; set only when `currentCharacterId` is null) to `HostScope` and the run's `sessionScope`; **you** don't need either — derive the speaker in `build-template-context` from the cast read (below).

## Goal (the supervisor's queue Q4–Q5, exactly)

1. **Q4 `src/lib/server/pipelines/runtime/host.ts` `session_cast` read (~4904–5490; output ~5461–5472):**
   - the character-seat select (~4945): `innerJoin(characters)` → `leftJoin`; where = session **and the seat filter**; select `seatedByUserId` (`session_characters.seated_by_user_id`) too; `cardId` becomes nullable.
   - `cardsNow` gets only non-null card ids; a carded row whose card is gone is dropped as today; a card-less row is read through `seatMembersAsRead(…, { cardless: true })` and its `character` = `cardlessSeatCard(asRead)`; a card-less row whose member doesn't read is dropped (say so in a comment). Keep `castRows` and `sessionCharacters` index-aligned (the output reads both by `i`) — or restructure so it can't drift; name what you did.
   - output: `cardId: castReads[i]?.activeCardId ?? character?.id ?? null` (no card-id fallback for a card-less row); `ref: hostSeatRefOf({ kind: "character", seatId, castMemberId, cardId: character?.id ?? null })`; `seatedByUserId` rides on every row; `absorbedAliases` keyed by card id only when there is one.
   - audit the rest of the read (~5110–5440: aliases, `memberNames`, envoys, anything keyed by `character.id`) for a card-less row: **safe / crash / collision**; fix in-hunk what would crash or collide.
   - every reader of this read's `sessionCharacters` in `runtime/bindings.ts` was guarded by lane s4-seat (turn pool `ownerUserId` from `seatedByUserId` for a card-less row, addressee, choices, `rotationSeats`). Grep `sessionCharacters` in `bindings.ts`, `speakerRotation.ts`, `turnPlan.ts` and confirm each handles a row with no `character.id` — report a table; fix only inside `build-template-context` (yours), list any other as queued.
2. **Q5 `src/lib/server/pipelines/prompt/promptFields.ts`:** `SessionCharacterRow.castMemberId?: number | null` (one JSDoc sentence); `ResolveInput.currentCastMemberId?: number | null` (one JSDoc sentence: the speaker of a card-less seat, read only when `currentCharacterId` is null); in `resolveContextInput` (~363–) the `current` lookup = by card when `currentCharacterId` is non-null, else the row with **no card** whose `castMemberId === currentCastMemberId`; that row renders at `CHARACTER_DETAIL.FULL` like any speaker; every other `cc.character.id === currentId` test in the file takes the same "is the speaker" rule (one local helper, not two copies). Narrator (both null) unchanged byte-for-byte.
3. **`src/lib/server/pipelines/runtime/bindings.ts` `build-template-context` (~5413–5530) only:** when `currentCharacterId` resolves to null and `input.speaker` is a string, the speaker is the cast row (`cast.sessionCharacters`) whose host-filled `ref === input.speaker` and that has no card → pass its `castMemberId` as `currentCastMemberId` to `resolveContextInput`. `stableExamplePick`'s key: a card-less speaker keys by its member, never as the narrator — pick a key that can't collide with a card id (e.g. a `seated-member:<id>` string if the helper takes one; read it) and name it.

## Files owned (edit only these)

`src/lib/server/pipelines/runtime/host.ts` (**only** the `session_cast` read case), `src/lib/server/pipelines/prompt/promptFields.ts`, `src/lib/server/pipelines/runtime/bindings.ts` (**only** `build-template-context`), and tests: `pipelines/prompt/promptFields.test.ts` (additions) or new `promptFields.cardless.test.ts`, new `src/lib/server/pipelines/runtime/host.sessionCast.cardless.int.test.ts`.

## Shared files (w1 is editing other hunks at the same time)

`host.ts`: w1 edits `HostScope` (~183–260), `loreVisibilitySubject` (~880–925), the `lorebook_entries` read (~4150–4900) and possibly the placeholder writer (~7600–7760) — never touch them. `bindings.ts`: w1 edits the lore-lane `ctx.read` calls (~1070, ~1288, ~2692, ~2790, ~3051, ~3445, ~3930, ~4285, ~8217). **Re-read the region before every Edit**; if an Edit fails because the file changed, re-read and redo. Never reformat either file.

## Files readable

Everything. Key: `pipelines/prompt/seatCards.ts` whole; `cast/memberAsRead.ts`; `sessions/seats.ts` (card-less seat writer); `sessions/seats.cardless.int.test.ts` and `pipelines/prompt/seatCards.cardless.int.test.ts` (harnesses); `pipelines/runtime/host.seatMembers.int.test.ts`, `host.seatForm.int.test.ts` (how the cast read is tested); SDK `../serene-pub-sdk/sdk/src/participants.ts` ~420–500 (the published cast shape — read only).

## Out of scope (never built here)

Everything w1 owns (fireTurn, runReply, runTurn, HostScope, lore gate). `stops.ts`, `dispatch.ts`, `dispatchSpeech.ts`, `contentProcessors.ts`, `ragQuery.ts`, `sockets/sessions.ts`, `state/resolve.ts`, pick-sprite (later workers). SDK (if the published `sessionCharacters[]` JSDoc needs a sentence for card-less rows / `seatedByUserId`, draft it in your report — don't edit). Client. Docs. NOMENCLATURE (list rows to queue).

## Stop and ask (in your report) when

CLAUDE.md §Decisions applies; a new exported name beyond `SessionCharacterRow.castMemberId`, `ResolveInput.currentCastMemberId` and the `seatedByUserId` field on the cast read; a change outside your files.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently.
- Never seed a row at a fixed id. No migration. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- It is a **session**, never a chat.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.
- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build; dev servers are running — don't build.)
- Prettier: `npx prettier --check` changed files; only `--write` lines you changed — never reformat a whole file. `host.ts`/`bindings.ts` are huge: hand-format your hunks.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests (Done means)

Capped, logged:

```
SP=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $SP/s4-seat-live-w2-tests.log 2>&1; echo test-exit=\$? >> $SP/s4-seat-live-w2-tests.log"
```

Must pass, each its own `it`:
- the host `session_cast` read on a session with a carded seat, a card-less seat (member M) and a seated envoy: M's row is in `sessionCharacters` with `character.name` = M's name, no `character.id`, `castMemberId` = M, `ref = seated-member:M`, `cardId` null (M has no card), `seatedByUserId` = the seater; the envoy is not in `sessionCharacters`; the carded row is unchanged (same keys and values as before your change);
- a departed card-less seat rides with `removedAt` set (readers filter);
- `resolveContextInput` with `currentCastMemberId = M` (card null): M's card renders FULL, the seed name is M's; with a carded speaker M renders at the session's detail level; narrator output unchanged (snapshot or equality against the pre-change call);
- `build-template-context` with `speaker = seated-member:M` and a null `currentCharacterId` builds a prompt whose `{{char}}` / seed line is M's name.
Re-run the existing tests of every file you touched (at least `promptFields.test`, `promptFields.strokes.test`, `host.seatMembers.int`, `host.seatMembers.s3.int`, `host.seatForm.int`, `host.seatIdentity.int`, `seatCards.cardless.int`, and the `bindings*.test.ts` that cover `build-template-context` — grep), ≤10 files per batch. `npx tsc --noEmit -p .` (12G scope, `NODE_OPTIONS=--max-old-space-size=8192`, log `$SP/s4-seat-live-w2-tsc.log`) — no new errors.

## Report (final message)

Changed files with hunks named; decisions (named); the consumer table (file:line → safe/crash/collision, fixed or queued); tests + counts + log paths; tsc; stopped-and-asked; Noticed, not done; NOMENCLATURE rows to queue (draft); SDK JSDoc draft if any.
