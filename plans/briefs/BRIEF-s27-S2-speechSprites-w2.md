# BRIEF s27-S2-speechSprites-w2 — a seated character's sprite sets come from the cast member, own over card

Worker (Sonnet) for lane **s27-S2-speechSprites** (supervisor: Opus). App `/home/jody/github/serene-pub`. Report back to the supervisor in your final message (changed files, tests run with results, anything you could not do, Noticed-not-done). Do not write a report file.

*"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
*"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
*"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
*"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You need no `sdk:build`: no SDK edit in this task.)

## Goal
Plan §27 stage S2 ("readers to members"). Owner ruling 2026-11-05: **members carry voice and sprites — own over card, like retold text.** S1 gave `sprite_sets` a second owner: a row has exactly one of `character_id` (a card's set) or `cast_member_id` (a cast member's own set). Make the session-side sprite readers show a seated member's own sets when it has any, else the card's exactly as today.

## Files owned (edit only these)
- `src/lib/server/sprites/index.ts` — one new reader beside `spriteLabelsFor`, nothing else
- `src/lib/server/sprites/choices.ts`
- `src/lib/server/sockets/sprites.ts` — the `sessionsSetSpriteSet` handler only
- new test files: `src/lib/server/sprites/memberSprites.int.test.ts`, `src/lib/server/sockets/sprites.memberSets.int.test.ts`

## Files readable (do not edit)
- `src/lib/server/cast/memberAsRead.ts` — `memberAsRead(db, memberId, { sessionId, overCards? })` → `MemberAsRead` with `activeCardId` (the linked card, or the dated card a cast amendment draws the member with on the session's reading), `spriteSets: {id,name,isDefault,position}[]` (the member's own when it has any, else the active card's), `spriteSetsFrom: "member" | "card" | null`, `spriteSet` (the member's chosen set by name, amendable).
- `src/lib/server/sessions/seats.ts` — `seatOf(db, sessionId, ref)` → `ResolvedSeat { kind: "character" | "player", seatId, castMemberId, cardId, departed } | null`. `character:<cardId>` finds the character seat on that card, else a player seat whose persona is that card; live beats departed; never an envoy seat.
- `src/lib/server/sprites/sprites.pipeline.int.test.ts` — the existing `spriteChoicesFor` tests (incl. the card-swap amendment case ~254–300); copy its fixtures.
- `src/lib/server/cast/memberAsRead.int.test.ts` — fixture style for members and member-owned sprite sets (`sprite_sets.cast_member_id`).
- `src/lib/server/sockets/sprites.int.test.ts` — how the sprite socket handlers are driven in tests.

## Items

### 1. `sprites/index.ts`: `spriteLabelsForMembers(db, memberIds)`
Beside `spriteLabelsFor` (which is per card and already skips member-owned rows): the same query and return shape `Map<memberId, { defaultSet, sets: Map<setName, label[]> }>`, but `inArray(spriteSets.castMemberId, ids)` and keyed by `castMemberId` (labels with an image only, `isNotNull(sprites.fileId)`, as the card reader). Doc comment: "⚠ Not `spriteLabelsFor` (a card's sets)". This is the one new exported name in this brief — the supervisor records it in NOMENCLATURE; you do not edit NOMENCLATURE.

### 2. `sprites/choices.ts`: `spriteChoicesFor` reads the seat's member
Keep the signature (`{ sessionId, characterId, set?, excludeMessageId? }`) and return type; existing callers must keep working.
- First: `const seat = await seatOf(db, params.sessionId, \`character:${speakerId}\`)`. If `seat?.castMemberId != null`: `const asRead = await memberAsRead(db, seat.castMemberId, { sessionId: params.sessionId })` — **without `overCards`, on purpose**: sprites DRAW the member, so they follow the dated card a card-swap amendment brings (today's rule; the lane contract: "Only a reader that *draws* the member (sprites) follows the dated card; such a reader omits `overCards` and says so"). Say so in a comment.
- **With a member as read** (replaces the `cardMemberAt` block for that case): `cardId = asRead.activeCardId ?? speakerId`; `wanted = normalizeSpriteName(asRead.spriteSet)` → `decidedBy: "amendment"` when set. Then the override and spec rungs exactly as today.
  - **Art:** if the member has its own sets with images — `(await spriteLabelsForMembers(db, [memberId])).get(memberId)` with `sets.size > 0` — those are the art, and the returned `characterId` is `null` (no card draws them; update the `characterId` doc on `SpriteChoicesV1`: "null when the sets are the cast member's own"). No card fallback inside the member's sets.
  - Otherwise today's card path unchanged: `spriteLabelsFor(cardId)`, and the "swapped-in card has no art → the speaker's own card" fallback.
- **No seat, or a seat with no member yet** (`castMemberId` null): **today's code path, unchanged** (the `cardMemberAt` read at `sessionReadingOf`).
- The `wanted` → `missing` / `missingAskedBy` logic, the "recent faces" query (stays keyed by `sessionMessages.characterId = speakerId`) and the return shape are unchanged.
- Update the file header: rung 2 `amendment` is the cast member's `spriteSet` (as read through `memberAsRead` for a seat with a member; through `cardMemberAt` for a seat with none yet); rung 3 `default` is the member's own default set when it has sets, else the card's. Keep the "⚠ The CARD whose sprites are read is the RESOLVED characterId" note, adding that a member's own sets come before any card.
- Imports static (`seatOf` from `$lib/server/sessions/seats`, `memberAsRead` from `$lib/server/cast/memberAsRead`): `publishedValues.ts` imports `choices.ts` statically and a dynamic import on that path stalls (its comment ~219–223). Neither module imports `$lib/server/db` statically.
- `setSessionSpriteSet` and `spriteSetOverridesFor`: **unchanged** — the slot stays on the `session_cast:<cardId>` owner (S4 rekeys it).

### 3. `sockets/sprites.ts`: `sessions:setSpriteSet` (`sessionsSetSpriteSet`, ~300–362)
- The seat check: replace the `sessionCharacters.findFirst` with `const seat = await seatOf(db, session.id, \`character:${character.id}\`)`; refuse with today's words (_That character isn't in this session._) when `!seat || seat.kind !== "character"` (today only a character seat passes; a player seat on that card did not, and still does not).
- The set name check: if `seat.castMemberId != null`, `const asRead = await memberAsRead(db, seat.castMemberId, { sessionId: session.id })`; when `asRead?.spriteSetsFrom === "member"`, the name must be one of `asRead.spriteSets` (compare `normalizeSpriteName(s.name) === set`); otherwise today's `findSpriteSetByName(db, character.id, set)`. Same refusal words as today.
- The write and broadcast unchanged (`setSessionSpriteSet` on the card id). No socket type change.

### 4. Tests (new files only; existing tests stay green **unchanged** — a test you must edit is a finding: stop and tell the supervisor)
`src/lib/server/sprites/memberSprites.int.test.ts` (real DB):
1. `spriteLabelsForMembers` returns a member's own sets with image-bearing labels, keyed by member id; `spriteLabelsFor` on the card does not include them.
2. A seat whose member has its own sprite sets: `spriteChoicesFor` offers the member's default set and its labels (not the card's), `characterId: null`, `decidedBy: "default"`.
3. A session sprite-set pick (`setSessionSpriteSet` with a member's set name) → `spriteChoicesFor` shows that set, `decidedBy: "override"`; a card-only set name with the member's sets in force → `missing`, `missingAskedBy: "override"`, default set.
4. The member's `spriteSet` (stored on `lorebook_bindings.sprite_set`) names one of its own sets → `decidedBy: "amendment"`.
5. A seat with no member yet (`cast_member_id` null) reads the card's sets exactly as before.
6. A seat whose member has no sets of its own reads the card's sets (same result as before).
`src/lib/server/sockets/sprites.memberSets.int.test.ts` (drive the handler as `sprites.int.test.ts` does):
7. `sessions:setSpriteSet` accepts a member's own set name and refuses a card-only name when the member has sets; with no member, the card's names as before; a player seat on the card is refused as before.

Each int test that opens the DB: 60 s timeouts (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Seats: insert `session_characters` with `castMemberId` directly, or use `seatCast` from `sessions/seats.ts`.

### Run (targeted only; never pipe vitest into `head`)
`npx vitest run src/lib/server/sprites src/lib/server/sockets/sprites src/lib/server/pipelines/entities/publishedValues` and `npx tsc --noEmit -p . 2>&1 | grep -E "sprites"` (nothing in your files). `npx prettier --check` your changed/new files only. Afterwards delete only the `/tmp/serene-pub-vitest-*` dirs your new tests made, by their exact names.

## Rules (from CLAUDE.md, NOMENCLATURE and the lane contract — they apply to you)
- CLAUDE.md Decisions: "Decide implementation inside the asked scope (structure, helpers, tests, existing patterns); name the choice in your report." "Propose and wait … on anything a user sees or that outlives the change: behaviour, layout, copy, a new name / setting / flag / abstraction / event / table / migration." → the only new exported name is `spriteLabelsForMembers`; no new setting, flag, event, migration, socket field; no copy change.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- Hard rule: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- Lane contract: "no static `$lib/server/db` import in modules tests mock (pass `db`)". (`sockets/sprites.ts` already imports `db`; leave that.)
- Lane contract §1: "A seat reads the card it holds. … Only a reader that *draws* the member (sprites) follows the dated card; such a reader omits `overCards` and says so."
- Lane contract §3: "**Keys stay.** … the sprite-set slot on the `session_cast` owner: **unchanged**. Do not rekey or rewrite them (S4 owns that)."
- Lane contract §4: "**Do not change SDK types or objects handed to plugins**" — no SDK edit; `SpriteChoicesV1`'s fields stay (only `characterId` may now be null for a member's own sets, a value it could already take).
- Lane contract §5: "Two live seats can share one member until the next boot … Resolve per seat, never per member."
- Lane contract §6: "A carded seat whose member has no voice or sprites of its own … must read exactly what it read before: the existing tests in your files stay green **unchanged**."
- Lane contract §9: "Never write 'no book', 'no lorebook', 'bookless', 'reads no lorebook' in code, comments, tests or copy."
- Hard rule: "`$state(new Set())` …" does not apply (server only). "It is a **session**, never a *chat*."
- Card-editor writers (`attach.ts`, `reexpress.ts`, `fillAction.ts`, the `characters:*Sprite*` handlers, `listSpriteSets` and the CRUD in `sprites/index.ts`) stay card-keyed — this lane is readers only.
- Never touch `src/lib/server/pipelines/runtime/host.ts`, `bindings.ts`, `state/**`, `sockets/sessions.ts`, `publishedValues.ts`, or any other lane's file.
