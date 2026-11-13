# REPORT cv-readers (2026-11-06)

No status question was relayed to me.

All four items are built.
- **Guard:** `SESSION_COPY_READS` is gone, so the guard now enforces "no card-copy read on the session path". No whole-row `characters` read is left in `host.ts`.
- **`cast_amendments`:** no product reader of it remains in the lane's files.
- **Tests:** one grouped targeted run passed, **145 of 145 files and 1443 of 1443 tests** (`--maxWorkers=2`).
- **Typecheck:** `npx tsc --noEmit -p .` shows no errors.
- **Rules kept:** I ran no `sdk:build` (there was no SDK change), made no commit and never ran `git stash`. I edited none of cv-fix2's four files.
- **Workers:** four Sonnet workers, never more than two at once. Briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-readers-wcommon.md` and `-w1.md` through `-w4.md`.

**Most important open question:** ★cv-readers-1. A `{{char:N}}` tag inside a cast version's text is no longer rewritten when its member is merged or deleted, so the tag can outlive its member.

**One stopgap you need to clear:** removing `castAmendment` from the cast-tag sites broke `sockets/narrativeGraph.ts` (~5946), which is not my file. To keep the build compiling I added an ignored ⏳ `castAmendment?` key to `CastTagRows` in `utils/castTags.ts`. Queued: delete the `castAmendment: …` lines in `narrativeGraph.ts` ~5946, then delete that key.

## Names and signatures (🚧)
- **`cardsNow(db, cardIds): Promise<Map<number, CardNow>>`** and the type `CardNow`, in `cast/seatedCast.ts` (I wrote these myself).
  - It returns cards as their **current card version** has them (the highest `number`), in the `characters` row shape: library facts come from the row, content columns from the version via `cardAsOfVersion`.
  - It never reads the ⏳ copy columns or the frozen columns.
  - A card with no version gets v1 lazily through `ensureCardVersion`, so a reader can write. That follows the documented "lifted the first time anything asks".
  - It costs two queries.
- **`cardsNowAsSeatsRead(db, sessionId | null, cardIds): Promise<Map<number, CardNow>>`** in `pipelines/prompt/seatCards.ts`: `cardsNow`, then read through the member of the seat holding each card. It is the one way to name or draw a card id as the session reads it.
- **`seatCardAsRead(card, asRead)` is rewritten.** It lays **every** profile field of the member as read over the row, in card column names (`cardColumnsOfProfile`):
  - name and nickname always;
  - each other content column only when the row carries it: description, the greetings split into opener, alternates and group-only, examples, aliases, summary, post-history, notes, strokes, the face as `avatarMediaId`, and likeness and timbre under `extensions`.
  - It still returns the same object when nothing differs.
  - Strokes are no longer nulled, and group-only greetings are no longer dropped.
- **`SessionPersonaRow.memberDescription?: string | null`** in `pipelines/prompt/promptFields.ts` (w3): the description of a card-less player seat's member (inventory A8), filled by the host.
- **`castTagName`** in `pipelines/prompt/characterLore.ts` takes an optional `shownName` (the member as read's nickname, else name).
- **Local helpers:**
  - `currentCardVersionOf(cardIdColumn): SQL` in `sockets/jump.ts`;
  - `named()` in `sessions:accountVisibility`;
  - `seatsAsRead()` in `sessions/greetings.ts`;
  - `memberInCast()` in `sessions/backdrop.ts`.
- **`characterEmbedText`** (`embedding/vectorizationQueue.ts`) is now the current card version's name and description. `CHARACTER_STORE.embedTextHash` is the digest of that text, computed where it is read. The digest is unchanged for an unchanged card, so nothing re-embeds on restart.

## Items
1. **Card-copy reads.** All 64 spots and the 5 whole-row `host.ts` reads moved.
   - The rule everywhere: a seat or speaker reads its member as read; a card no member answers for reads its current card version.
   - The files: `diceWords`, `sideCharacter`, `dispatchSpeech`, `fireAction`, `loreMatch`, `runStatus`, `chains`, `ties`, `zones`, `rewind`, `rowProjection`, `seats`, `turnPlan`, `turnYield`, `sockets/{jump, pipelines, sessions, state}`, `sprites/index`, `handEdits`, `resolve`, `write`.
   - In `host.ts`, the transcript names and the session cast now use `cardsNow` rows, and the seat layering then reads each member over them.
   - `sprites/index` `releaseSpriteFile` now keeps any file that is the face of any version, retired ones included.
   - The guard's session list is deleted rather than left empty, with a comment saying never to add one.
2. **No `cast_amendments` reader.**
   - `castMemberCards`, `memberOfCard` and `cardTakenBy` lost their dated leg.
   - `sessionsDrawingCard` finds seats whose member has a cast version whose parent card version is of the card. It excludes the member's own linked card, which stays the callers' ground.
   - The `conversations/store.ts` prefilter now looks at versions' parent cards.
   - `castTags` no longer lists the `castAmendment` site.
   - `lorebookLinks`, `sideCharacter` `lorebookNames`, the `host.ts` lore read and gazetteer, and `hydrateBindings` (now `cardsNow`) all read `membersAsRead` / `cardsNow`.
   - Every amendment fixture the guards lane kept was moved to versions: `sessionsDrawingCard`, `castMemberCards.versions`, `sessionAccess.seatMember`, `datedCardLore`, `promptAtReading`, `datedRows.versions`, `sessions.seatCast` and `seats.int`. In `lorebooks.castTags.int` only the cast-amendment case was removed.
   - `forkHistory.ts`'s reads stay; they are harmless.
3. **Profile fields reach every member.** This comes from the new `seatCardAsRead` plus `cardsNow` in the host's session cast, `greetings.ts` and `dispatch` layering.
   - `illustrateScene` now takes the member's own likeness first.
   - `ragContext` candidates read the seat's member.
   - The card embedding text moved to the current version.
   - `backdrop` counts a member's gallery (`files.cast_member_id`).
   - Confirmed already right: `resolveVoice`, `sprites/choices`, `cardStrokes`, `contextFields`, and `cardAction` (it runs on a card with no session and keeps reading the card's current version).
4. **Tests.** New tests:
   - `cast/seatedCast.cardsNow.int`;
   - `state/lorebookLinks.versions.int`;
   - `sessions/greetings.cardless.int`;
   - `embedding/characterEmbedText.int`;
   - `host.seatMembers.int`: a card-less member's post-history and likeness reach the cast row and the prompt; a seat reads the parent card version after a newer card version; A8;
   - `jump.int`: a rename through `newCardVersion` is found, the old name is not;
   - `turnPlan.playerSeats.int`;
   - `backdrop.int`: a member's gallery, and the gallery of a dated card written as a version;
   - card-less member timbre (`memberVoice.int`), sprites (`memberSprites.int`) and likeness (`illustrateScene.int`);
   - the `{{char:N}}` tag naming an own-named member and a later dated rename (`promptAtReading.int`), and a `castTagName` unit test;
   - `seatCards.test` rewritten against `MemberAsRead`.
   - Two expectations changed: `strokes` null became the member's strokes as read, in `host.seatMembers.int` and `seatCards.int`. Both quote "Everything in session is cast -> active card."

## What users now see differently
These follow the ruled intent; they show only where a member's own or evolved words differ from the card's.
- **Names that now come from the member:**
  - seat refusal sentences and the merge rule's removed name;
  - turn-yield, rewind and Back-strip line names, and the session list's last speaker;
  - names in links, hand edits, tie ends and zone owners;
  - dispatch speaker, form answerer and run status;
  - script `speakerName` and `castNames`;
  - typing, account visibility and state faces.
- **Prompt:** each seat reads the member's post-history, group-only greetings, notes, strokes, face and likeness, card-less members included. A card-less player seat's description is its member's.
- **Greetings and the envoy `{{characterNames}}`** use the member's words.
- **Scene pictures** use the member's own likeness.
- **The backdrop picker** accepts a seated member's gallery images.
- **RAG text** comes from the member.
- **Dated renames, aliases and dated cards written as versions** now count in `{{char:N}}` tags, lore cast names, the gazetteer, the side-character "known" check, session access, the person tab and the private-lore gate. This was the bug: before, they counted only when written as amendments.
- **Card-only names** come from the current card version, so after `newCardVersion` they follow the rename. Jump finds sessions and cards by the current version's name, and an old name no longer matches.
- **`lorebook_bindings.name` is no longer taken as the member's name.** A member with no own name in its version reads its card's name. Lifted data carries `ownName` where the names differed, so real data shouldn't change.

## Changed files
- **Supervisor (me):** `/home/jody/github/serene-pub/src/lib/server/cast/seatedCast.ts` (`cardsNow`), `/home/jody/github/serene-pub/src/lib/server/pipelines/prompt/seatCards.ts`, `seatCards.test.ts`, `seatCards.int.test.ts`, `/home/jody/github/serene-pub/src/lib/server/characters/frozenColumns.guard.test.ts` (the allowlist only), `/home/jody/github/serene-pub/src/lib/server/utils/castTags.ts` (the ⏳ key), `/home/jody/github/serene-pub/NOMENCLATURE.md` §25.
- **Workers, product code (under `src/lib/server/`):**
  - `sessions/{seats, turnPlan, turnYield, rowProjection, rewind, greetings, backdrop}.ts`
  - `state/{handEdits, resolve, write, lorebookState}.ts`
  - `rulesets/{ties, zones}.ts`, `messages/diceWords.ts`, `sprites/index.ts`
  - `utils/{castMemberCards, castTags}.ts`, `cast/seatedCast.ts` (`sessionsDrawingCard`), `conversations/store.ts`
  - `pipelines/entities/sideCharacter.ts`, `pipelines/prompt/{characterLore, promptFields}.ts`
  - `pipelines/runtime/{host, dispatchSpeech, fireAction, loreMatch, runStatus, illustrateScene}.ts`, `pipelines/scripts/chains.ts`
  - `sockets/{jump, pipelines, sessions, state}.ts`
  - `embedding/{ragContext, vectorizationQueue}.ts`
- **Tests:** the files listed under Items 2 and 4.

## Tests
- **Grouped run, 145 files, all green.** It covered:
  - `cast/*`, `pipelines/prompt/*`;
  - the sessions files `seats`, `turnPlan`, `rowProjection`, `rewind`, `greetings`, `backdrop`, `turnYield`;
  - the state files `handEdits`, `resolve`, `write`, `lorebookLinks`, `lorebookState`, `datedRows`;
  - `ties`, `zones`, `diceWords`, `sprites/*`, `speech/*`, `embedding/*`;
  - `castMemberCards`, `castTags`, `sessionAccess`, `conversations/store*`, `sideCharacter*`;
  - the runtime files `host`, `dispatchSpeech`, `fireAction`, `loreMatch`, `runStatus`, `illustrateScene`, `cardAction`, `datedCardLore`, `promptAtReading`;
  - `chains*`, `jump*`, `sockets/state*`, `sessions.{seatCast, accountVisibility}*`, `lorebooks.castTags*`, and the guard.
- **Typecheck:** `tsc` is clean.
- **Temp dirs:** my run left no `/tmp/serene-pub-vitest-*` behind, and I deleted none. One that appeared during the run belonged to another session's live vitest and was already gone.
- **Prettier:** my files are clean. Several worker-edited files weren't clean before; only their own hunks were formatted.
- **Worker reports:** checked against the briefs. Changed files match the owned lists, apart from the `castTags` → `narrativeGraph` compile fallout handled above.

## §25
One row appended to the character-versions table in `NOMENCLATURE.md`, line 3352, after cv-fix2's row.

## Open ★
- **★cv-readers-1: cast tags inside character versions.** Versions hold summary and description text where a `{{char:N}}` tag can sit, and nothing rewrites those tags on a merge or delete, so a tag can outlive its member (A16).
  - Recommendation: a rewrite writer in `characters/versions.ts` (cv-fix2's file), registered as a tag site.
  - I didn't build it because it would be a second writer of versions (P2).
- **★cv-readers-2: a member who follows a card that was later deleted.** `membersAsRead` still follows the deleted card version's name. The `host.ts` lore read patches in the A25 rule "a deleted card is nobody" locally.
  - Question: should `membersAsRead` apply that rule itself?

## Queued (not my files)
- `sockets/narrativeGraph.ts` ~5946: drop the `castAmendment:` key, then drop the ⏳ `CastTagRows.castAmendment` in `castTags.ts`.
- `state/entriesOnReading.ts` `castOverlaysFor` / `castMemberAt`: no reader is left in the lane's files, but `sockets/amendments.ts` (cv-fix2) still calls both, and a comment in `cast/memberAsRead.ts` mentions `castMemberAt`.
- `docs/sessions.md`: the backdrop section could mention that a member's own pictures count. No other doc line contradicts the change.

## Noticed, not done
- **Relational reads the guard can't see.** These `with: { character: true }` / `with: { persona: true }` reads still load whole card rows, frozen columns included:
  - `sockets/sessions.ts` (~378, 396, 1739, 1758, 1912–1975, 6636, 6775, 7786, 7897)
  - `sockets/pipelines.ts` ~5039
  - `pipelines/runtime/dispatch.ts` ~422 (it also loads whole binding rows with `lorebookBindings: true`)
  - Seats with a member are corrected by `seatCardsAsRead`. A seat with no member found would still read the stale frozen content.
  - Recommendation: a follow-up sweep onto `cardsNow`.
- `sessions/seatMembers.ts:71` (a boot pass) still reads `cast_amendments`.
- `characters.embed_text_hash` (a generated column) is now unread; it could be dropped at RC1. `ragContext` keeps a copy-column fallback for ids that `cardsNowAsSeatsRead` misses.
- Docstrings: `sockets/state.ts` `facesOf` still says "card avatar", and the header of `castMemberCards.versions.int.test.ts` still speaks of a "dated card".
- `illustrateScene`: the active card's likeness image still beats the member's own face (★pT-2, as before).
- No `scope-reviewer` was run; per the guide that belongs to the lead when accepting the lane.