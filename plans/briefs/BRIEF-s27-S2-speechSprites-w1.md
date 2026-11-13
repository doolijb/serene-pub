# BRIEF s27-S2-speechSprites-w1 — a seated speaker's voice and name come from the cast member, own over card

Worker (Sonnet) for lane **s27-S2-speechSprites** (supervisor: Opus). App `/home/jody/github/serene-pub`. Report back to the supervisor in your final message (changed files, tests run with results, anything you could not do, Noticed-not-done). Do not write a report file.

*"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
*"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
*"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
*"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: no SDK edit in this task.)

## Goal
Plan §27 stage S2 ("readers to members"). Owner ruling 2026-11-05: **members carry voice and sprites — own over card, like retold text.** A seat now records the cast member it seats (`session_characters.cast_member_id`, `session_personas.cast_member_id`). Switch the speech readers below from the card to the **cast member as read**, falling back to the card exactly as today when a seat has no member yet.

## Files owned (edit only these)
- `src/lib/server/speech/resolveVoice.ts`
- `src/lib/server/pipelines/runtime/dispatchSpeech.ts`
- new test files: `src/lib/server/speech/memberVoice.int.test.ts`, `src/lib/server/pipelines/runtime/dispatchSpeech.members.int.test.ts`

## Files readable (do not edit)
- `src/lib/server/cast/memberAsRead.ts` — `memberAsRead(db, memberId, { sessionId, overCards })`, `membersAsRead(db, ids, opts)` → `MemberAsRead` with `name`, `nickname`, `timbre: CharacterTimbreInput | null`, `voiceFrom: "member" | "card" | null` (null = neither has a voice), `activeCardId`, … `overCards: Map<memberId, cardId>` = "layer this member over THIS card" (a seat reads the card it holds).
- `src/lib/server/cast/seatedCast.ts` — `seatedCastOf(db, sessionId)` → live seats `{ seatId, kind: "character" | "player", castMemberId, cardId, position, asRead }`; `asRead` null when the seat has no member yet. Already layers each seat over the card it holds (overCards) and handles two seats on one member.
- `src/lib/server/sessions/seats.ts` — `parseSeatRef(ref)` (`character:<n>` · `seated-member:<n>` · `player-seat:<n>` → `{ form, id }` or null) and `seatOf(db, sessionId, ref)` → `ResolvedSeat { kind, seatId, castMemberId, cardId, departed } | null` (live beats departed; never an envoy seat).
- `src/lib/server/cast/memberAsRead.int.test.ts` — **copy its fixture style** (the `vi.mock("$lib/server/db")` + `createTestDb`, `mkdtemp` data dir, `releaseDataDir`, `user`/`card`/`book`/`member` helpers; how it gives a member its own `timbre`, `ownName`, and a dated card amendment).
- `src/lib/server/speech/autoVoice.int.test.ts` — a real-DB `resolveVoice` world (voicebank, loadout); copy what you need.
- `src/lib/server/pipelines/runtime/dispatchSpeech.store.int.test.ts` — how dispatchSpeech is driven with `resolveVoice` mocked; copy its mocks for the dispatch test.
- `src/lib/shared/lorebooks/memberIdentity.ts` (`memberNames`: a member with no own name reads exactly the card's name and nickname).

## Items

### 1. `resolveVoice.ts`
- **`speakerTimbre(db, ref, sessionId)`** (add the `sessionId: number | null` parameter; `resolveVoice` passes `input.sessionId`). New first step: when `sessionId != null` and `parseSeatRef(ref)` parses, `const seat = await seatOf(db, sessionId, ref)`.
  - `seat?.castMemberId != null` → `memberAsRead(db, seat.castMemberId, { sessionId, overCards: new Map([[seat.castMemberId, seat.cardId]]) })` and return its `timbre` (the member's own when set, else the seat's card's; null when neither has one — downstream reads only `timbre?.x`, so null and today's `{}` behave the same; check `resolveVoiceCore.ts` to confirm and say so in your report). If `memberAsRead` returns null, fall through to the card read.
  - A seat with no member (`castMemberId` null) → today's card read for that seat's card (`seat.cardId`; a card-less player seat → null).
  - No seat found, or no session, → **today's code unchanged** (`character:` → `characterTimbre`, `player-seat:` → its persona card). `seated-member:` with no seat or no session → null.
  - The SDK's `parseParticipantRef` does not know `seated-member:` (it throws) — so the seat step must run before it.
- **`speakerSilent(db, ref, sessionId?: number | null)`** — pass it through to `speakerTimbre` (absent = null = today's behaviour). A member's own `timbre.silent` now silences.
- **`usedVoiceSlugs`** ("voices in use", ~260–283): **keep today's two seat queries** (every seat of the session, departed included, no envoy filter beyond `characterId != null`) and add `castMemberId` to each select. Then one `membersAsRead(db, memberIds, { sessionId })` (no `overCards` needed: only a member's OWN timbre is read from it). Per seat: if its member as read has `voiceFrom === "member"`, its `timbre.voice`; else today's `characterTimbre(card).voice`. Keep it a list (pickAutoVoice puts it in a Set; duplicates are harmless).
- **Auto voice picks stay keyed by the speaker ref string** (`speechAutoVoice:<speakerRef>`, `autoVoice.ts` hashes `speakerRef|sessionId`): do not touch `rememberAutoPick`, `readAllAutoVoices`, `castingOf` or the hash. For today's data the ref is unchanged, so the pick is unchanged.
- Update the doc comments you touch (`timbre?` on `ResolveVoiceInput` says "the speaker's card's" → "the speaker's as read: the cast member's own, else the card's").

### 2. `dispatchSpeech.ts`
- **`castRefs(db, sessionId)`** (display name → ref, used to map a `Name:` cue to a seat): it means "the live seats now", so read the members through **`seatedCastOf(db, sessionId)`** and map by `seatId`. Keep today's two queries (they give card names and `seatName`) — add `seatId: sessionCharacters.id` to the character-seat select. For each seat with `asRead`: names are `[asRead.name, asRead.nickname]` (a player seat: `[seatName, asRead.name, asRead.nickname]`), display name `asRead.name` (a player seat: `seatName ?? asRead.name`). Without `asRead`: today's card names. **Refs emitted stay as today**: `character:<cardId>` and `player-seat:<seatId>`. Keep the first-wins rule and today's iteration order (character seats, then player seats).
- **`nameOfRef(db, ref, sessionId)`** (add `sessionId: number | null`; the caller at ~520 passes `sessionId`): accept `seated-member:<id>` too. With a session and a parsed ref: `seatOf` → if it has a member, `memberAsRead(..., { sessionId, overCards: seat's card })` → a character seat's name is `asRead.name`; a player seat's is its `seatName` first (today's rule), then `asRead.name`. No member → today's code. No session → today's code (`seated-member:` → undefined).
- **`speakerSilent`** call (~516): pass `sessionId`.
- Do not change `groupCues`, `mergeTinyGroups` or anything pure; do not change the payload/`SpeakResult` types.

### 3. Tests (new files only; existing tests stay green **unchanged** — a test you must edit is a finding: stop and tell the supervisor)
`src/lib/server/speech/memberVoice.int.test.ts` (real DB, `resolveVoice(input, db)`), each a separate `it`:
1. A carded seat whose member has its own `timbre.voice` speaks with the member's voice over the card's (`from: "timbre"`, `voicebankSlug` = the member's).
2. A carded seat whose member has no timbre reads the card's voice (unchanged).
3. A seat with no member yet (`cast_member_id` null) reads the card's voice.
4. A `seated-member:<memberId>` speaker ref resolves to that member's voice.
5. A `player-seat:<id>` ref whose seat has a member with its own voice speaks with it.
6. A seat holding a dated card reads that card (a dated cast amendment moves the member to another card with a different voice at the session's reading; the seat still holds the first card → the first card's voice). Copy how `memberAsRead.int.test.ts` makes a dated card amendment.
7. Two seats on one member (a character seat on card A and one on card B, both `cast_member_id` = M, no own timbre; A and B have different voices): `character:A` gets A's voice, `character:B` gets B's.
8. `speakerSilent(db, "character:<card>", sessionId)` is true when the member's own timbre is `{ silent: true }` and the card's is not.
9. Voices in use: the member's own voice counts — Auto for another speaker avoids it (follow `autoVoice.int.test.ts`'s Auto setup).

`src/lib/server/pipelines/runtime/dispatchSpeech.members.int.test.ts` (copy the mocks from `dispatchSpeech.store.int.test.ts`; capture the `resolveVoice` inputs):
10. A `Name:` cue naming the member's own name (`ownName`) maps to the seat's `character:<cardId>` ref (the group's `speakerRef` passed to `resolveVoice`).
11. A member with no own names: a `Name:` cue with the card's name, and one with the card's nickname, map to the seat's ref exactly as before.

Each int test that opens the DB: 60 s timeouts (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Seat rows: insert `session_characters` / `session_personas` with `castMemberId` set directly, or use `seatCast` from `sessions/seats.ts`; either is fine in tests.

### Run (targeted only; never pipe vitest into `head`)
`npx vitest run src/lib/server/speech src/lib/server/pipelines/runtime/dispatchSpeech src/lib/server/pipelines/speech` and `npx tsc --noEmit -p . 2>&1 | grep -E "speech/|dispatchSpeech"` (nothing in your files). `npx prettier --check` your changed/new files only. Afterwards delete only the `/tmp/serene-pub-vitest-*` dirs your new tests made, by their exact names.

## Rules (from CLAUDE.md, NOMENCLATURE and the lane contract — they apply to you)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration." → **No new exported name**, no new setting, flag, event, migration, socket field. Non-exported local helpers are fine.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Lane contract: "no static `$lib/server/db` import in modules tests mock (pass `db`)" — `dispatchSpeech.ts` has none; keep it so (`resolveVoice.ts` already has one; add none elsewhere).
- Lane contract §3: "**Keys stay.** … speech Auto voice picks (`speechAutoVoice:<speakerRef>`) … **unchanged**. Do not rekey or rewrite them (S4 owns that)."
- Lane contract §2: "Every parser in your files that accepts `character:<cardId>` also accepts 🚧 `seated-member:<memberId>`, resolved with `sessions/seats.ts` `seatOf` / `parseSeatRef`. Refs your code **emits** stay as today."
- Lane contract §4: "**Do not change SDK types or objects handed to plugins**" — no SDK edit.
- Lane contract §5: "Two live seats can share one member until the next boot … Resolve per seat, never per member."
- Lane contract §6: "A carded seat whose member has no voice or sprites of its own, and whose retold flags are what they were, must read exactly what it read before: the existing tests in your files stay green **unchanged**."
- Lane contract §9: "Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy; say 'a session whose lorebook is its own book'."
- NOMENCLATURE R3: qualify, never the bare noun. "It is a **session**, never a *chat*."
- Never touch `src/lib/server/pipelines/runtime/host.ts`, `bindings.ts`, `state/**`, `sockets/sessions.ts`, or any other lane's file.
