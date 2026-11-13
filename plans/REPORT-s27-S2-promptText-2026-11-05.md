# REPORT s27-S2-promptText (2026-11-05)

## Lane s27-S2-promptText (2026-11-05)

Status: **BUILT**, nothing blocked. Run against the latest work: 17 test files, 125 of 126 pass. The one failure belongs to another lane (details below).

The prompt now takes a seated character's name and text from the cast member the seat holds, read over the card that seat holds. This change is behind every reader in this lane. No stored key, stored data or emitted ref changed. No SDK edit, no `sdk:build`, no migration, no new setting or event, no commit, no stash.

Workers: w1 did `host.ts`; w2 did everything else. Briefs:
- `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-promptText-w1.md`
- `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-promptText-w2.md`

I wrote the shared helper module and its pure tests myself. I also did the extra pick-sprite item you sent. I checked both worker reports against their briefs, read the changed hunks, and re-ran the whole lane set together.

### The one new module: `src/lib/server/pipelines/prompt/seatCards.ts`
It keeps the card shape (`cc.character`, `BasePromptSession`) and fills it from `MemberAsRead`.
- **`seatCardAsRead(card, asRead)`** (pure)
  - Fills in the member's name and nickname where they differ from the card's.
  - Fills in each retold text field that is not in `followsCard`.
  - Drops strokes when the member tells the description or personality, and drops group-only greetings when the member tells a greeting.
  - Returns the same object when nothing differs, and leaves the card unchanged unless `activeCardId` is this card.
  - `seatCards.test.ts` checks it gives `toEqual(applyRetold(...))` for every retold flag and own-name case.
- **`seatCardsAsRead(db, sessionId, rows)`**
  - Each row is read over the card its seat holds (`overCards`); two seats on one member are read in separate batches.
  - **Decision:** a seat with no `cast_member_id` stored yet reads the member the seat writer would find for its card: the attached book, then the session's own book, find-only. That keeps "read the card as today" for seats the boot pass hasn't filled. It is also why `retold.int.test.ts`, which inserts seats with no member, stays green unchanged.
- **`cardsAsSeatsRead(db, sessionId, cards)`** — for readers that hold card ids.
- **`cardFormRef(db, sessionId, ref)`** and the pure **`cardFormRefInCast(cast, ref)`** (⏳ transitional):
  - They take a `seated-member:<id>` ref and turn it into the card form the session's keys still use: `character:<cardId>`, or `player-seat:<id>`.
  - They return null when nobody is seated as that member.
  - Any other ref passes through unchanged.

### What switched (file → reader)
- **`pipelines/runtime/host.ts` (w1)**
  - The `session_cast` read: character seats (live, departed and switched off) go through `seatCardsAsRead`. The rows now also carry `castMemberId` (plus `seatId` on character rows), added fields only.
  - The `retoldCards` / `retoldByCard` / `applyRetold` overlay and the retold columns are removed from that read. The roster and absorbed aliases are unchanged.
  - Transcript names (`summarize_source`) use `cardsAsSeatsRead`.
  - The lore read's seated set: a seat holding the member by `castMemberId` wins; otherwise today's card rule applies. w1 added `orderBy(position, id)` so the choice is deterministic.
  - Refs coming in accept `seated-member:` at:
    - the lore visibility speaker
    - the person's-line speaker
    - the speaker-row reads (~7568)
    - the turn-order write (candidates and order entries are stored in card form)
    - `retire`
  - `liveCastRefs` is unchanged.
- **`sockets/sessions.ts`, `getPromptSessionFromDb` (w2):** live and removed character seats go through `seatCardsAsRead`.
- **`sockets/sessions.ts`, token-count head ref (w2):** goes through `cardFormRef`.
- **`sessions/greetings.ts`:** reads `seatCardsAsRead` instead of `retoldMembersForSession` + `applyRetold`.
- **`pipelines/scripts/chains.ts`:** the speaker name and `castNames` come from the member.
- **`entities/sideCharacter.ts`:** names of offered cards come from `cardsAsSeatsRead`.
- **`prompt/characterLore.ts`:** a player seat whose `castMemberId` is the binding also makes that member's lore visible.
- **`runtime/bindings.ts`** accepts `seated-member:` (through `cardFormRefInCast`) at:
  - the form addressee resolver
  - the side-character fact ref
  - **your extra item:** `core:oracle/pick-sprite@1` now resolves a `seated-member:` speaker with `cardFormRef` (built on `seatOf`) to the card its seat holds, null when the seat has no card. It uses the binding file's existing `await import("$lib/server/db")` pattern.
- **`runtime/loreMatch.ts`:** accepts `seated-member:<memberId>` when that member is in the book. Otherwise it throws the existing "…is not in this book's cast…" sentence, naming the member, or "cast member <id>" when it has no name.

### What still reads the card, and why
- **Player seats** in `session_cast`, in `getPromptSessionFromDb` and in the greeting's `{{user}}` keep their card plus seat name. Open ★1.
- `illustrateScene.likenessImagesFor` (the card's likeness extension and avatar). Open ★2.
- `cardAction.ts`: a card action has no session or seat.
- `castEntityRefs` keeps the card's aliases (plus the member's absorbed aliases and the book's roster), because member aliases differ from the card's and switching them would change today's output.
- Ref-in sites left as they are:
  - `bindings.ts` wired `addressee`, the select chain and advise: they compare against refs core emits.
  - `adventureContext.holderOf`: no cast and no db in hand.
  - `host.ts` `isParticipantRef` gates at ~3440, ~7177 and ~9844: these check SDK grammar, so S3 handles them.
- These needed no edit because they read the rows already filled in: `promptFields`, `contentProcessors`, `messages`, `cardStrokes`, `ragQuery`, `bindings.relationships`, `sessionGenres`, `stops.ts` and the `connectionAdapters`.

### Queued for the lead (not my files) — **important**
- **`pipelines/runtime/dispatch.ts` `loadAdapterSession`**:
  ```ts
  sessionCharacters: await seatCardsAsRead(db, sessionId, (session.sessionCharacters ?? []).filter((cc: any) => cc.character !== null))
  ```
  - **Why:** without it, the stops and own labels sent to the model still use the card's name. A member with an own name would get no stop on its own label.
  - `stops.ts` needs no change: `stops.seatMembers.int.test.ts` shows it stops on the member's name once the rows are filled in.
- **`lorebooks/retold.ts`:** `retoldByCard` and `applyRetold` now have no callers outside tests. I didn't delete them; they belong to the S5 cleanup or the owning lane.
- `retoldMembersForSession` still has callers in other lanes' files: `sockets/sessions.ts` ~5128 (`withSessionExtras`), `rowProjection.ts`, `narrativeGraph.ts`, `liveScenes.ts`, `runStatus.ts`, `fireAction.ts`.

### Changed files
Owned files:
- `src/lib/server/pipelines/runtime/host.ts`
- `src/lib/server/pipelines/runtime/bindings.ts` (the import, the addressee resolver, the fact caller, pick-sprite)
- `src/lib/server/pipelines/runtime/loreMatch.ts`
- `src/lib/server/pipelines/prompt/characterLore.ts`
- `src/lib/server/pipelines/scripts/chains.ts`
- `src/lib/server/pipelines/entities/sideCharacter.ts`
- `src/lib/server/sessions/greetings.ts`
- `src/lib/server/sockets/sessions.ts` (only the `getPromptSessionFromDb` hunk ~1912–1931 and the token-count hunk ~9628–9640)
- `NOMENCLATURE.md` (§25)

New:
- `src/lib/server/pipelines/prompt/seatCards.ts`
- `src/lib/server/pipelines/prompt/seatCards.test.ts`
- `src/lib/server/pipelines/prompt/seatCards.int.test.ts`
- `src/lib/server/pipelines/prompt/characterLore.seatMember.test.ts`
- `src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`
- `src/lib/server/pipelines/runtime/pickSprite.seatedMember.int.test.ts`
- `src/lib/server/pipelines/runtime/loreMatch.seatedMember.int.test.ts`
- `src/lib/server/sessions/greetings.seatMembers.int.test.ts`
- `src/lib/server/connections/stops.seatMembers.int.test.ts`

### Tests
**Final grouped run, 17 files: 125 of 126 pass.** It covered all 9 new files plus these existing ones: `retold.int`, `transcript.castNames`, `chains.sideCharacterExtras.int`, `sessions.sideCharacter.int`, `sessions.participantRemoval.int`, `promptTokenCount.int`, `castEntityRefs`, `spriteEmbedCalls.int`, `createChat.parity.int`.

The new tests prove:
- A member with `ownName` and a retold description replaces the card in the read and in `resolveContextInput`.
- Stops use the member's name.
- A seat holding card A while the clock draws dated card B reads A (`overCards`).
- A seated card with no member reads the card unchanged.
- Two seats on one member each read over their own card.
- `seated-member:` refs are accepted (turn-order write, `cardFormRef`, loreMatch, pick-sprite).
- Greetings and names come from a member in the session's own book (the intended change).

Workers' extra runs, all green: 11 more seat, cast and session int files, 145 tests; plus `characterLore*`, 50 tests.

**No existing test was edited.** No existing test changed value from the intended change: none covers an own-book member.

**Failures not caused by this lane:**
1. `lorebooks/retold.int.test.ts` "sockets > updateBinding refuses a malformed retold…": `banner.members` now carries `memberName` and `followsCard`. Those come from S2core's `lorebooks:bindingsForCharacter` payload addition in the dirty `sockets/lorebooks.ts`, and the test's `toEqual` lists 4 keys.
2. `connections/stopsWiring.test.ts` (w2 saw it): `speech/preview.ts:216` and `speech/speechTarget.ts:26` build a text adapter without `withStops`. That is the speech lane.

`npx tsc --noEmit -p .` shows only the old `arrangeCanvas.dom` error. Prettier is clean on all new files. I didn't reformat `host.ts`, `sessions.ts`, `greetings.ts` or `sideCharacter.ts`; the workers say `greetings.ts` and `sideCharacter.ts` fail `--check`, and it isn't known whether that predates this lane.

One `/tmp/serene-pub-vitest-RI7JhP` directory is left. None of this lane's tests uses that name, so I didn't delete it.

### NOMENCLATURE §25 rows added (after the `spriteLabelsForMembers` row)
1. 🚧 **a seat's card as read**: `seatCardAsRead`, `seatCardsAsRead` (`SeatCardRow`), `cardsAsSeatsRead`, with a charter and "⚠ Not `applyRetold`".
2. ⏳ **`cardFormRef`** and **`cardFormRefInCast`** (`SeatRefCast`).

These names were mine to choose inside the asked scope, and you can veto them. Noted, not given a row: the added `castMemberId` / `seatId` fields on `session_cast` rows.

### Open ★
- **★1 Player seats:** should they read their cast member too (own name and retold text over the persona card) in `session_cast`, `getPromptSessionFromDb` and the greeting's `{{user}}`?
  - My recommendation: yes, in a follow-up, because "what a seated character is" covers them.
  - Trade-off: it changes today's prompts for persona members that have retold flags or own names, which is a second behaviour change the contract doesn't name. Built the safe way: not filled in, and the w1 test (f) pins that.
- **★2 Scene illustration:** should `likenessImagesFor` use a member's retold face before the card's avatar?
  - My recommendation: yes: card likeness image, then the member's face, then the card's avatar.
  - Trade-off: it is a visible change for members with `retold.face`. Not built.
- **★3 Error naming in `loreMatch`:** a `seated-member:` bind now names the member in the existing sentence ("cast member <id>" when it has no name). Built; tell me if the wording should change.

### Noticed, not done
- The header comment in `transcript.castNames.test.ts` still describes `applyRetold`; the test passes.
- The comment in `getPromptSessionFromDb` says the adapter session is derived from its rows. It isn't until the queued `dispatch.ts` change lands.
- An unresolved `seated-member:` side-character fact ref falls back to a name match rather than dropping the fact (w2's decision; the alternative is to drop it).
- Absorbed aliases and the gazetteer roster still read only the attached book. A member in the session's own book contributes no absorbed aliases there.
- `collectSessionGreetings` still reads every seat row, departed ones included, as before.
- **For S4 to rekey** (left as they are): the turn-order write and `liveCastRefs` store card refs; `currentCharacterId` stays the card. The token-count head, pick-sprite's host call and loreMatch all resolve to the card through `cardFormRef`.

Relayed status question: none received.
## Scope review (lead, 2026-11-05) — no scope breach; four findings → follow-up lane s27-S2-pT2
1. MEDIUM (P2/R1) `seatCardsAsRead` re-writes the seat writer's find order for unfilled seats (and `cardFormRefInCast` copies `seatOf`'s order) → one find-only rule exported from `sessions/seats.ts`, used by both; `cardFormRefInCast` stays (no db in a binding) with its §25 row tied to `seatOf`'s order.
2. MEDIUM-LOW three `seated-member:` hunks in `host.ts` (~2578, ~7565, ~7629) are unreachable behind the `isParticipantRef` gate (~7193) and sit in message-write code out of scope → revert; the gate joins the S3 list; the report's ref-in list corrected below.
3. LOW-MEDIUM the side-character picker renames unseated library cards to member names (visible, no ★) → overlay only cards a seat holds.
4. LOW a seat's stored `cast_member_id` from a previous book (after a book swap) is trusted → trust it only when the member's book is the session's attached or own book; else the find-only rule.

## Corrected ref-in list (lane s27-S2-pT2, 2026-11-05)
The list under "Refs coming in accept `seated-member:`" above overstated `host.ts`. Three of its hunks could never fire — the person's-line speaker (`personLineOf`) and the two speaker-row reads in the message write only ever see `namedRef`, which the `isParticipantRef` gate keeps from `seated-member:` — and lane s27-S2-pT2 reverted them to their HEAD text. What accepts `seated-member:<memberId>` now:
- `host.ts`: the lore visibility speaker (`cardFormRef`); the turn-order write — candidates and order entries, stored in card form (`cardFormRef`, tested); `retire` on set-seat-name (`cardFormRef`); and, added by s27-S2-pT2, the `core:outlet/set-stat-config` owner (`storedSeatRef`, tested; an unseated member keeps today's halt sentence).
- `bindings.ts`: the form addressee resolver and the side-character fact ref (`cardFormRefInCast`); `core:oracle/pick-sprite@1` (`cardFormRef`).
- `loreMatch.ts`: `bind` of a create-lore-entry.
- `sockets/sessions.ts`: the token count's head ref (`cardFormRef`).
- **Not accepted (S3 list):** the `isParticipantRef` gates in `host.ts` — the message write's `namedRef` (~7189), ~3442 and ~9882. (`loreVisibilitySubject`'s check, ~879, is fed the card form by its caller.) They check the SDK grammar, which learns `seated-member:` in S3.
