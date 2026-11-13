# REPORT s27-S2-client (2026-11-05)

**Status: BUILT.** All of items 1–5 are done; jump search (item 1) and item 4 are ★ proposals only, as the brief said. The lane's grouped targeted run passes: **173 files, 1466/1466**. `npx tsc --noEmit -p .` shows nothing in lane files. w2 ran `svelte-check --threshold error` and got 0 errors. No new `/tmp/serene-pub-vitest-*` dirs are left behind. No migration, SDK edit, `sdk:build`, commit or stash.

Workers: three Sonnet workers. I checked each report against its brief and read the diffs.
- w1: the card line, `memberName`, docs. Brief: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-client-w1.md`
- w2: the client session page and lists. Brief: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-client-w2.md`
- w3: payload int tests. Brief: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-client-w3.md`

I wrote the server payload code, the types and the §25 rows myself. `seatMembersAsRead` came from lane pT2 at your direction, and the faces and member sprite sets are built on it.

Relayed status question: none received.

## What switched (file → reader)
- **`sockets/sessions.ts`, `withSessionExtras`:**
  - `castNames` and `castFaces` now come from `seatMembersAsRead(db, sessionId, rows)` plus the new pure `seatCastShownFrom`. The member is read wherever it lives, over the card the seat holds. Before, they came from `retoldMembersForSession` plus `castIdentityExtras`, which read only the session's lorebook.
  - New 🚧 `castSpriteSets` (by seated card id) comes from `memberSpriteSetsBySeat`. It is present only when the member draws from its own sets and one of them has an image.
- **`sockets/sessions.ts`, `buildSessionsListFor`:** each list row now also carries `castNames` and `castFaces`, from `seatCastShownForSessions`.
  - To keep the list cheap, one prefilter query (`sessionsWithMemberWords`) picks the sessions whose seats can differ from their cards: a stored member, or the card's member in the attached or own book, that has `own_name`, `own_nickname` or `face_media_id`. Only those sessions get the member read; every other session gets `{}`.
  - I also added one import line (`seatCastShownForSessions`) to the file's import block.
- **`getSessionFromDB`:** no edit needed. `castMemberId` already rides every seat entry of both payloads, because it is a column of the seat row since S1 (`SelectSessionCharacter`).
- **`sessions/rowProjection.ts`:** `lastVisibleMessages` speaker names now come from `cardsAsSeatsRead`, using the same prefilter. Before, they came from `retoldMembersForSession`. New exports: `seatCastShownFrom`, `seatCastShownForSessions`, `memberSpriteSetsBySeat`, `SeatCastShown`, `SeatShownRow`, `SeatSpriteSet`.
- **`sockets/lorebooks.ts`, `bindingsForCharacter`:**
  - `memberName` is now `memberShownName(b, card)`, the rule `memberAsRead` uses. Before, it was `ownNameValue(ownName) || name`.
  - The card query gained `name` and `nickname`.
- **Client, one helper:** 🚧 `seatCardAsShown(session, card)` / `seatCardsAsShown(session)` in `projections/characters.ts`. They apply `castNames` through `withMemberNames`, use `castFaces` as the avatar (nulling `avatarMedia`, `avatar` and `_avatar`, as `withPortrait` does), and use `castSpriteSets` as `spriteSets`. They return the same object when nothing applies, and never touch personas.
- **Client sites routed through the helper:**
  - `messageSpeaker.ts`, which covers every line's name, face and sprite on the page.
  - `projectCharacters` (`memberOf`), so `requests/setSpriteSet.ts` offers the member's sets with no change of its own.
  - `headerCastKeyOf` / `headerFaceOf`; its change key now includes `castSpriteSets`.
  - `characterForRefIn`, the scene-cast faces and `charactersSection.svelte.ts`.
  - `routes/sessions/[id]/+page.svelte` (PickSpeakerModal's cards, `participantOf`, TurnPicker).
  - `SessionListItem`, `SessionCardItem`, the `SessionsSidebar` Jump subtitle, `SessionViewPanel`, and `routes/+page.svelte` (`castStack` and "… is up next").
  - The document-view session list, page (`speakerName`) and edit page.
  - `EditSessionForm` (seats loaded from the payload).
- **Refs in:** 🚧 `seatCardIdOfRef(session, ref)` in `sessionPageProjections.ts` accepts `character:<id>` and `seated-member:<memberId>`. It picks live before departed, then position, then payload order, and a character seat before a persona seat. `characterForRefIn` and the page's two parsers (~754, ~976) go through it. Emitted refs are unchanged.
- **`castMemberOf`** (the session page): it prefers the seat's `castMemberId` when that member is in `lorebookBindingList`, else the card match as before. Click targets are unchanged.
- **The card line (item 3):**
  - The cast line is now one component, `characterForms/CastLine.svelte`. Its markup, title and aria-label are byte for byte as before.
  - It shows in the card editor (as before) and on the **profile**, in `CharacterViewPanel.svelte` right under `DetailHero`.
  - The editor shows the **editing sentence** under it, from 🚧 `castEditWords(members)` in `castBannerWords.ts`, with `data-cast-edit-note`.
  - `docs/characters.md` is updated.
- **Still reads the card, and why:**
  - Personas and player seats keep reading their card (★pT-1 is still open).
  - `StartSessionForm` and `createSession.svelte.ts` show library cards before they are seated, so there is no member yet.
  - `canControlMessageAs` mirrors the server's card-owner rule and was left as asked.
  - Search matching (the sidebar filter ~686, `jump.ts`) is ★client-2.
  - `SummarizeLoreModal` already names book members via `memberShownName`.

## Visible changes (per the brief's "names and faces from the seat's member")
- For a member with no own name, face or sprite sets, every view reads exactly as before. Existing tests are green, and w3 case 2 pins this.
- **Where a member has its own name or face,** the session lists, cards, sidebar Jump subtitle, home "continue" cards, document-view pages and message avatars now show it. Before, these showed the card's; the session page already showed the member's for attached-book members. Own-book members now show there too, which is the contract's one intended change.
- **No existing test changed value because of the own-book change.** None covers an own-book member in these files.

## Changed files
- **Server:**
  - `src/lib/server/sockets/sessions.ts`: the import line, `buildSessionsListFor`, `withSessionExtras`. Hand-edited by hunk, no prettier.
  - `src/lib/server/sessions/rowProjection.ts`
  - `src/lib/server/sockets/lorebooks.ts`: the handler's card columns, `memberName`, one import name.
  - `src/lib/shared/sockets/types.ts`: additive. Get: `castSpriteSets` plus doc updates for `castNames`/`castFaces`. List: `castNames`/`castFaces`. `memberName`'s doc.
- **Client:**
  - `src/lib/client/components/sessionPage/projections/characters.ts` (including its header comment, which said a retold name is not on the payload)
  - `.../projections/charactersSection.svelte.ts`
  - `.../sessionPageProjections.ts`
  - `src/lib/client/utils/messageSpeaker.ts`
  - `src/routes/sessions/[id]/+page.svelte`
  - `src/lib/client/components/listItems/{SessionListItem,SessionCardItem}.svelte`
  - `src/lib/client/components/sidebars/SessionsSidebar.svelte`
  - `src/lib/client/components/sessionForms/{SessionViewPanel,EditSessionForm}.svelte`
  - `src/routes/+page.svelte`
  - `src/routes/document-view/sessions/+page.svelte`
  - `src/routes/document-view/sessions/[id]/+page.svelte`
  - `src/routes/document-view/sessions/[id]/edit/+page.svelte`
- **Card line:**
  - `src/lib/client/components/characterForms/{castBannerWords.ts,CastLine.svelte (new),CharacterForm.svelte,CharacterViewPanel.svelte}`
- **Tests:**
  - New: `src/lib/server/sessions/rowProjection.seatCast.int.test.ts` (7 cases), `src/lib/server/sockets/lorebooks.memberName.int.test.ts`, `src/lib/client/components/characterForms/castLine.dom.test.svelte.ts`, `src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts` (10 cases).
  - Extended: `projections/characters.test.ts` (+6), `utils/messageSpeaker.test.ts` (+1), `characterForms/castBannerWords.test.ts` (+`castEditWords` cases; its `member()` helper gained the two new required fields, and existing cases are unchanged).
  - **Edited existing test (3d):** `src/lib/server/lorebooks/retold.int.test.ts` "updateBinding refuses a malformed retold…". Its banner `toEqual` now also expects `followsCard` (every field but `face`) and `memberName: <card name>`. Cause: S2core's additive payload fields.
- **Docs:** `docs/characters.md` (the "A card is a starter" paragraph) and `NOMENCLATURE.md` §25 (5 rows).

## Tests
- **Grouped lane run, 173 files, 1466/1466:**
  - every folder: `sessionPage/**`, `listItems`, `sessionForms`, `sidebars`, `characterForms`, `cast/`
  - session tests: `rowProjection.seatCast.int`, `rowProjection.castNames.int`, `rowPush.int`, `revision.int`
  - socket tests: `sessions.listLastMessage.int`, `lorebooks.memberName.int`
  - lorebook and prompt tests: `retold.int`, `messageSpeaker`, `seatCards.int` and `seatCards`
- **The new tests prove:**
  - an own-book member's own name and face over the card (`castNames`/`castFaces`);
  - an own nickname alone;
  - today's data gives `{}`;
  - two seats on one member, each keyed by its own card;
  - a seat holding card A while a dated amendment draws card B is keyed by A only;
  - member sprite sets only with an image;
  - the last line names the own-book member;
  - `memberName` for an own name, an own nickname, and an empty synced name (card's name or nickname);
  - `seated-member:` refs accepted, including live before departed and lowest position on two seats;
  - projection and header with a member's name, face and sets;
  - `castEditWords` (the three spec examples, the no-Oxford-comma join, "greetings" merging, none → null);
  - the `CastLine` DOM in one book, in two, and in none.

## NOMENCLATURE §25 rows added (after the `findSeatMembers` row)
1. `memberName` is now the shown name, `memberShownName` against the requested card.
2. `castNames`/`castFaces` now mean the member as read; 🚧 `castSpriteSets`; the server helpers `seatCastShownFrom`, `SeatCastShown`, `SeatShownRow`, `seatCastShownForSessions`, `memberSpriteSetsBySeat`, `SeatSpriteSet`.
3. 🚧 `seatCardAsShown` / `seatCardsAsShown`.
4. 🚧 `seatCardIdOfRef`.
5. `CastLine` and 🚧 `castEditWords`.

These names were chosen inside the asked scope; you may veto them.

## Decisions taken inside scope
- **The payload keeps the existing per-card maps** (`castNames`, `castFaces`), now filled from the one reader, plus `castSpriteSets` in the same family. It does not add `shownName`/`face` fields to each seat entry. That gives one shape for the client to read (R1), and `castMemberId` already rides each seat.
- **`castNames` carries the member as read's name and nickname** (`ownNickname: ""` = none) only where they differ from the card's, so `memberShownName` on the client gives the shown name.
- **`memberName` is the shown name** (nickname over name), matching what the session shows and the quoted sentence.
- **The list prefilter is a superset.** A session that passes it but reads as its card sends `{}` (tested).

## Open ★
- **★client-1: card profile line and editing sentence** (built as recommended, owner may change).
  - The line sits on the profile under `DetailHero`.
  - The sentence sits in edit mode directly under the editor's cast line, always visible there, not only once there are unsaved changes.
  - Copy, gender-neutral: _Editing this changes Bianca in Porto Alto and The Shared House (their description, scenario, greetings, example dialogues and face; their personality is their own there)._
  - Members are grouped by shown name and the fields they follow. "first message + alternate greetings" is said as "greetings". No parenthetical when a member follows everything. No sentence when no member follows anything.
- **★client-2: search by the member's name** (`jump.ts` ~166–180, the sidebar's cast filter ~686).
  - Recommendation: also match the seat member's shown name, with one more `EXISTS` over `lorebook_bindings` (own_name / own_nickname) joined by the seat's `cast_member_id`. People remember a session by the name it shows.
  - Trade-off: one more subquery per pattern. There is no new disclosure, because the list payload already carries the names.
  - Not built.
- **★client-3 (item 4): the cast panel and a message's name open the cast member, not the card editor.** Recommendation:
  - **What opens:** the member's page in the Lorebooks view (`digest.lore = { lorebookId: <the member's book>, scope: "cast", castId: seat.castMemberId }`), whichever book it lives in. From that page, "Edit the card" opens the card editor, where the editing sentence now says what an edit changes.
  - **A guest whose character lives in the host's book:** if the guest can read that book, open the member read-only, with one line: _Bianca lives in Hana's lorebook Porto Alto; your card seeds her._ Add **Edit my card** and, in S4, **Copy to my characters**. If the guest cannot read the book, open a read-only member sheet in the session panel (name, face, own words), which needs a member read gated by session access (lane access).
  - **A member whose lorebook is the session's own book:** open it in that book (the Lorebooks view's "Session notes"), same page.
  - **A card-less member (S4):** only the member page.
  - Today `castMemberOf` finds members only in the session's `lorebookBindingList`, so an own-book member can't be addressed yet.
  - Not built.

## Noticed, not done
- **`castIdentityExtras` and `retoldMembersForSession`** (`lorebooks/retold.ts`) now have no non-test callers in the app. Their removal is S5, alongside `retoldByCard`/`applyRetold`.
- **Client and server rules may diverge in two places:**
  - `canControlMessageAs` still judges by the seat card's owner. If s27-S2-turns moved `messages/permissions.ts` to the seat's active card owner, the client affordance diverges for a seat whose dated amendment draws another card. Check against turns' report.
  - `sessions:setSpriteSet` validates against the member's sets whenever `spriteSetsFrom === "member"` (speechSprites), even when no member set has an image. The client offers `castSpriteSets` only once one has an image, so in that window it offers the card's sets and the server would refuse them. Edge case until a member-sets UI exists.
- **The list prefilter can miss one case:** a member whose face is set only by a dated amendment (stored `face_media_id` null) would not get the member read in the list. The page payload is unaffected.
- **List rows' trimmed card has no `nickname`.** So for plain cards the lists show the name while the page shows the nickname. This was true before this lane and is unchanged.
- **Wording sweep (S4):** `createSession.svelte.ts` `welcomeSessionInput`'s comment says "no lorebook".
- **Prettier:**
  - `castBannerWords.ts`, `sessionPageProjections.ts`, `projections/characters.ts` and `messageSpeaker.ts` were not prettier-clean at HEAD and were left that way.
  - The new files are clean.
- **Not this lane's:** `EditSessionForm.svelte`'s diff also contains a `handleLorebooksList` provided-book hunk.
- **S4 rekey items met:** these are still keyed by card id:
  - `castNames`, `castFaces`, `castSpriteSets` and `spriteSetOverrides`;
  - `set-sprite-set`'s `characterId`, `onPickSpeaker(characterId)` and `ChangeSpriteDialog`'s `characterId`;
  - `messageSpeaker`'s lookup by `msg.characterId`;
  - `character:<id>` refs emitted everywhere.

## Scope review (lead, 2026-11-05) — in scope; five findings → lane s27-S2-cT2
1. MEDIUM copy bug: _"their greetings is their own there"_ — is/are by count, not by noun.
2. MEDIUM cost: the sessions list runs the member prefilter twice and reads members per session in a loop (~8 queries per qualifying session), on every list push and message-write push.
3. LOW-MEDIUM `seatCardIdOfRef` claims to mirror `seatOf` but orders differently (character-before-player across live/departed, envoys, null positions).
4. LOW the brief's DOM tests for the editor sentence and the profile line are missing; a test title says "a card in no lorebook".
5. LOW STYLE-GUIDE's muted-line rule (~1126) not updated for the editor sentence and the profile line.
