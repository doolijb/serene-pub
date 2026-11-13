# BRIEF cv-readers-w1 — session-path card-copy reads, batch 1 (sessions, state, rulesets, dice, sprites)

Read `plans/briefs/BRIEF-cv-readers-wcommon.md` first (the rules and the design). Lane cv-readers, worker 1 (Sonnet). Report as your final message: `# REPORT cv-readers-w1 (2026-11-06)`.

## Goal
Every read of the ⏳ card copies `characters.{name, nickname, avatarMediaId, description}` in the files below goes. What a seat or speaker shows reads the **seated cast member as read** (`membersAsRead` / `seatMembersAsRead` / `cardsAsSeatsRead`); a card no member answers for reads the **card's current version** (`cardsNow`, or `cardsNowAsSeatsRead` to do both in one call). Behaviour stays the same except where a member's own or evolved words differ from its card's — list each such place in your report.

## Files owned (edit only these, plus their `*.test.ts` and the new test named below)
`sessions/seats.ts`, `sessions/turnPlan.ts`, `sessions/turnYield.ts`, `sessions/rowProjection.ts`, `sessions/rewind.ts`, `state/handEdits.ts`, `state/resolve.ts`, `state/write.ts`, `rulesets/ties.ts`, `rulesets/zones.ts`, `messages/diceWords.ts`, `sprites/index.ts`; new `cast/seatedCast.cardsNow.int.test.ts`.

## The spots (scanner output, line numbers as of 2026-11-06 06:10)
- `sessions/seats.ts:352-353` `cardNameOf` (behind `memberNameOf`, which reads `lorebook_bindings.name`): the member's name from `membersAsRead` (pass the session's reading where the caller has a session; else main), else the card's current version (`cardsNow`), `resolveCharacterName(card, "Unknown")` as now. ⚠ `seats.ts` must not import `pipelines/prompt/seatCards.ts` (that file imports `seats.ts`); import `cardsNow` from `cast/seatedCast.ts`.
- `sessions/seats.ts:825-826` the merge rule's live seats select `name`/`nickname` from `characters`: read what the merge rule uses them for; take names from the seat's member as read (the seats all have a member there — `isNotNull(cs.castMemberId)`), else `cardsNow`.
- `sessions/turnPlan.ts:112-113, 129-130` `storedTurnPlan`: select ids only; fill names via `cardsNow` before the existing `cardsAsSeatsRead` / `seatCardsAsRead` (or `cardsNowAsSeatsRead`).
- `sessions/turnYield.ts:185-186` the yield rows' `characterName`/`characterNickname` join: drop the join; names via `cardsNowAsSeatsRead(db, sessionId, ids)`; the `?? r.characterName` fallback becomes the current version's name.
- `sessions/rowProjection.ts:117-118, 122` `lastVisibleMessages` (`characterName`, `characterNickname`, and `personaName` through the `voicedCharacter` alias): names via `cardsNow` by the rows' ids (keep the existing member layering for `withMemberWords` sessions); `sessions/rowProjection.ts:713-715` `seatCastShown…` cards map → `cardsNow`. Note `seatCardAsRead` now overlays every content column the row carries (incl. `avatarMediaId` = the member's face): check `castFaces` and the list payload still come out right, fix test fallout.
- `sessions/rewind.ts:157` (`personaName`) and `:458` (`characterName`): via `cardsNowAsSeatsRead` by the rows' persona / character ids.
- `state/handEdits.ts:201` (`cardName` on player seats) and `:272` (`cardFacts` name): `cardsNow` for the card name (owner `userId` stays from `characters`).
- `state/resolve.ts:592` (`sessionLinks` seated name) and `:614` (`coalesce(seatName, characters.name)`): seat name still wins; then the seat's member as read (the function may already layer members — read it); else `cardsNow`.
- `state/write.ts:719` the fallback name → `cardsNow`.
- `rulesets/ties.ts:1217` (a binding's name, else its card's): the member's name from `memberAsRead` (with the session when known), else `cardsNow`. `rulesets/ties.ts:1784` the fallback → `cardsNow`.
- `rulesets/zones.ts:214` the card name for a `character:<id>` owner → `cardsNow` (the member layering after it stays).
- `messages/diceWords.ts:97` → `cardsNowAsSeatsRead(db, sessionId, characterIds)`.
- `sprites/index.ts:591` `releaseSpriteFile`'s "no character's avatar" check → no character version (card or cast, retired ones included) has `face_media_id = fileId` (conservative: any version's face keeps the file). `sprites/index.ts:614` `spriteFileIds`: the card's current version's face (`cardsNow`).

## Tests (Done means)
- New `cast/seatedCast.cardsNow.int.test.ts`: `cardsNow` returns the current version's content after `newCardVersion` (not v1's), keeps library facts (`userId`, `isDeleted`), lifts a raw-inserted card to v1 on first ask (raw insert allowed in a test), skips unknown ids.
- `sessions/seats.int.test.ts` inserts `cast_amendments` rows (~171, ~491, ~833, ~886) to give members a **dated card**; worker 2 is removing the `cast_amendments` leg from `utils/castMemberCards.ts`. Convert those fixtures to cast versions now (`insertDatedCardVersion(db, memberId, cardId, year)` in `pipelines/testing/fixtures.ts`, or `writeCastVersion`) so the tests pass with or without that leg.
- One test per behaviour change where a test file exists for the module (e.g. a turn-yield / turn-plan / rewind name reads a member's own name over the card's): seat a member whose base version has an own name (`writeCastVersion`/`updateCastVersion` or a fixture) and assert the shown name.
- Run, with `--maxWorkers=2`: every existing test file of the files you touched (`ls` their siblings: `sessions/seats*.test.ts`, `sessions/turnPlan*`, `sessions/turnYield*`, `sessions/rowProjection*`, `sessions/rewind*`, `state/handEdits*`, `state/resolve*`, `state/write*`, `rulesets/ties*`, `rulesets/zones*`, `messages/diceWords*`, `sprites/*.test.ts`) plus `pipelines/prompt/seatCards.test.ts` and `characters/frozenColumns.guard.test.ts`. The guard's "every allowlist entry still has its site" test **will** list your files' entries as stale — that is expected (the supervisor removes them); "no frozen column is touched" must pass and must show no new site in your files.
- `npx tsc --noEmit -p .` clean on your files.

## Out of scope
`cast_amendments` readers (worker 2), `pipelines/**`, `sockets/**`, `pipelines/runtime/host.ts` (other workers), acting-rights code, docs, `NOMENCLATURE.md`.
