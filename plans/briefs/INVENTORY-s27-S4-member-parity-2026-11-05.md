# INVENTORY s27-S4 member parity (2026-11-05): card-only features a cast member relies on, and the copy paths

Owner 2026-11-05: "If a casts feature in a lorebook/session can't survive without a card, then that feature needs to be copied to the cast member."

## Card-only features a seated or cast person uses, and what a card-less member loses

Context: card-less character seats can't exist yet. `seatedCastOf` filters `isNotNull(cs.characterId)` (src/lib/server/cast/seatedCast.ts:48), and `layerMemberAsRead` (memberAsRead.ts:168-275) already falls back to member columns when there is no card. Schema line numbers are in src/lib/server/db/schema.ts.

### A. Prompt and text features
1. **Post-history instructions.** Card: `characters.post_history_instructions` (schema:2326). Readers: `postHistoryInstructions()` and `charPostHistory()` in pipelines/prompt/contextFields.ts:106-131, used by promptFields.ts:484-491. They take the seat's card row through `seatCardAsRead` (pipelines/prompt/seatCards.ts:55-83), which never touches it. Member home: none. Card-less loss: the speaker's reinforcement text. The narrator-config fallback only applies when there is no current character.
2. **Group-only greetings.** Card: `characters.group_only_greetings` (schema:2325). Readers: sessions/greetings.ts:43-60; memberAsRead.ts:210-213 and seatCards.ts:80 empty them when greetings are retold. Member home: none (it is dropped when the member retells). Card-less loss: group-session greetings.
3. **Strokes.** Card: `characters.strokes` (schema:2296). Reader: pipelines/prompt/cardStrokes.ts (`core:task/card-strokes@1`); seatCards.ts:79 nulls them when description or personality is retold. The feature is paused (`STROKES_ENABLED = false`, shared/characters/strokesFlag.ts:50). Member home: none. Loss: keyword strokes, once re-enabled.
4. **Creator notes and multilingual notes.** Card: schema:2321-2324. Session reader: the speaker-picker search only (client/components/sessionPage/PickSpeakerModal.svelte:135). Member home: none. Loss: minor (search text).
5. **Depth prompt and system prompt.** `extensions.depth_prompt` is kept as a foreign key and only re-exported (characters/cardIO.ts:147-162). V3 `system_prompt` is dropped on import (sockets/characters.ts:920-960, no column). No session reader for either, so nothing is lost today.
6. **Character book.** Card: `characters.lorebook_id` (schema:2338). Session reader: only the embedding pre-warm in `enqueueSessionGroup` (embedding/vectorizationQueue.ts:612-636), plus card export (utils/characterCardParser.ts:1161). The prompt never reads it. Loss: none in the prompt.
7. **Card embedding for RAG.** Card: `characters.embedding` (name and description). Reader: embedding/ragContext.ts:763-836, by the session's card ids. Member home: partial (`lorebook_bindings.embedding` covers name and summary). Loss: the character RAG candidate.
8. **Persona description on a player seat.** The seat description reads only the card: `seatPersonaDescription` (pipelines/prompt/promptFields.ts:93) returns "" for a card-less seat, even when the seated member has a description. Member home: yes (`description`), but it isn't wired in.

### B. Look and media
9. **Likeness (prompt, negative, reference image).** Card: `extensions.serenepub.likeness` (characters/likeness.ts:13, 77-131); SillyTavern's `sd_character_prompt` is read in. Readers:
   - promptFields.ts:410-424 (`{{likeness}}`, `{{likenessNegative}}`, `core:var/likenesses@1`)
   - pipelines/runtime/illustrateScene.ts:189 (scene reference images)
   - pipelines/runtime/cardAction.ts:130
   - sockets/portrait.ts:156

   Member home: none. A member with its own face still gets the card's likeness image. Card-less loss: speaker and cast likeness, and illustration references.
10. **Avatar.** Card: `characters.avatar_media_id` (schema:2318). Readers: the session payload (sockets/sessions.ts:1689-1718) and `castFaces` in sessions/rowProjection.ts:557-575. Member home: yes (`face_media_id` with `retold.face`). Crops live on the file (`files.frame`, schema:3509), so a face carries its own crop.
11. **Gallery.** Card: `files.character_id` (schema ~3449); `files` has no cast-member column. Readers:
   - sessions/backdrop.ts:106-165 (`castImages`, `inCast` by card id)
   - the face rule in lorebooks/retold.ts:344 (`retoldUpdateProblem`: a face is a card gallery image or a book upload)

   Member home: partial (lorebook uploads via `files.lorebook_id`). Loss: card-less members contribute no gallery images to backdrops.
12. **Sprites.**
   - Card sets: `sprite_sets.character_id` (schema:2060). Readers: sprites/choices.ts:186-199, the session payload (`SESSION_SPRITE_SETS`, sessions.ts:555), rowProjection.ts:648-690.
   - Member sets: `sprite_sets.cast_member_id` (schema:2068). There is no writer yet: `ensureDefaultSpriteSet` and `createSpriteSet` (sprites/index.ts:100, 183) are card-only, and the sprite sockets are `characters:*`.
   - Sprite choice is still keyed on the speaker's card id (`speakerId`, choices.ts:192-199).
13. **Default sprite set.** `sprite_sets.is_default` exists on both card and member rows. `extensions.serenepub.defaultSpriteSet` is CHARX import and export only (sprites/charx.ts:18, 115; sockets/characters.ts:1416, 1496). The member's set pick (`lorebook_bindings.sprite_set`) is resolved by name. Member home: yes.
14. **Card actions (sprite fill, generate portrait).** Code: pipelines/runtime/cardAction.ts:125-133; they run on the card, with no session, and write card sets and likeness. Member home: none. Loss: no generation for a card-less member.

### C. Voice
15. **Timbre, including speech language and `silent`.** Card: `extensions.serenepub.timbre`; `language` and `silent` are in shared/characters/timbre.ts:47-68. Readers: speech/resolveVoice.ts and pipelines/runtime/dispatchSpeech.ts, through memberAsRead (lines 224-235). Member home: yes (`lorebook_bindings.timbre`, schema:1703). I found no dedicated writer in sockets/lorebooks.ts or amendments.ts.

### D. Stats, sheets, dowry
16. **Card-layer attributes, sheets and dowry.** Card: `attribute_values`, `attribute_configs` and `owner_sheets` with `owner_kind='card'` (schema:9716-9971, 10468-10508). The dowry is built from these in characters/dowry.ts:100-140; card-side reads are in state/cardState.ts:103-160. Session readers:
   - `resolutionChain`: session_cast → cast_member → card (state/owners.ts:81-117)
   - vocabulary and sheets (state/resolve.ts:1240-1290)
   - earshot.ts:344-376

   Member home: yes (`owner_kind='cast_member'`, which the chain already reads before the card). Card-less loss: the card's template stats and sheets.

### E. Identity keyed on the card id (breaks without a card, even when the data is member-side)
17. **Session stats owner.** `session_cast` owner id is `characters.id` (schema:9724). The state document builds `cast.byId[characterId]` (state/resolve.ts:1597-1618); branch copy keeps it (sessions/branch.ts:611-627). A `seated_member` owner kind exists, but is CHECK-only "until S4" (schema:9728).
18. **Turn order, rotation and ties.** Refs are `character:N` (sessions/fireTurn.ts:160; rulesets/ties.ts:1243, 1258; sockets/sessions.ts:9701, 10092). Ties decide "person" vs "entry" by the `character:` prefix.
19. **Private character lore gate.** `isCharacterLoreEntryVisible` (pipelines/prompt/characterLore.ts:98-140) matches `memberCards(binding)` against the current card id. Player seats also match on `castMemberId`, but character speakers don't. Card-less loss: the member's private lore becomes narrator-only.
20. **Named-entity recognition.** `loadVocabulary` (annotations/index.ts:340-344) skips any binding without a live card. Refs and annotations use `character:<cardId>` and `message_annotations.character_id` (schema:9528). Card-less loss: no entity recognition of the member at all.
21. **Clone with changes.** `carryNotesValuesToCopy` (lorebooks/ownBook.ts:1035-1046) maps notes members to copy members by card. Card-less member values stay in the notes.
22. **Mundi.**
   - `avatarsOf` keys on `cast.byId[<characterId>]` (mundi-sp/src/world/deriveBook.ts:300; src/genre/newGame.ts:94).
   - Phone lanes are `phone:<characterId>` (src/engine/phone.ts:23-32); presence uses `characterId` (src/engine/presence.ts:50).
   - `deriveBook` writes `extensions.mundi.{avatar, example}` and the tags `[worldId, occupation]` on the card (deriveBook.ts:196). Nothing in the pub reads them; Mundi matches by name.

   Card-less members get no phone lane, presence or avatar mapping.
23. **Branch speaker stamp.** Copied lines get their member per card (branch.ts:420-442); card-less lines get none.

### F. Library-only (no session reader)
Tags: `character_tags`. memberAsRead.ts:428-444 exposes `asRead.tags`, but nothing in sessions, pipelines, state or speech reads it. Also library-only: `category`, `creator`, `source`, `characterVersion`, `metadata`, `isFavorite`, `folderId`, `isPersona` (a library fact), shares. `aliases` and `summary` already have member homes.

## Paths that make a member card-less or copy members

- **Unlink** (`lorebooks` binding update with `characterId: null`, sockets/lorebooks.ts:1660-1790): copies nothing to the member. A member that hadn't retold a field gets empty description and greetings, and loses likeness, post-history, card sprites, card stats and private-lore visibility. Linking (unbound → bound) only folds names into `absorbedAliases` (lorebooks.ts:1767-1779).
- **Card delete** (sockets/characters.ts:838-860; library/writes.ts:465; provided uninstall, plugins/providedBooks.ts:1395-1428): soft delete (`isDeleted`). memberAsRead still reads the card, but NER drops it (annotations/index.ts:341). A real hard delete only happens through the user cascade; `lorebook_bindings.character_id` then becomes SET NULL, and card sprite sets and tags cascade away.
- **Starter or primer copy, `ownCastCards`** (lorebooks/starterKits.ts:443-622):
  - Copies the full `characters` row: post-history, group-only greetings, strokes, creator notes, extensions (likeness, timbre, mundi, depth_prompt). The provided mark is stripped and `lorebookId` is nulled.
  - The avatar is re-uploaded in `afterKitCopy`; entry annotations are re-keyed.
  - Does not copy: card tags, card sprite sets, gallery, card-layer stats and sheets. Likeness `imageMediaId` still points at the original file.
  - Primers (`writePrimerInto`) mint fresh cards.
- **Book duplicate** (`duplicateLorebookRows`, utils/lorebookDuplicate.ts:69, via lorebooks/tableRegistry.ts):
  - Copies member rows verbatim, including `timbre`, `face_media_id`, `retold`, own names, `sprite_set`, and cast_member stats and sheets (registry:779-781).
  - Does not copy member sprite sets (`sprite_sets` isn't in the registry). `face_media_id` still points at the source book's upload, which isn't re-owned.
  - Keeps the card links (shared cards).
- **Provided books** (plugins/providedBooks.ts:1015-1100): members link plugin-marked cards owned by the book's user. A provided book refuses own names and faces (`providedCastProblem`, lorebooks/castOwnNames.ts:62; amendments.ts:509-520), so its members depend entirely on the card. A copy goes through `ownCastCards({all:true})`, with the same gaps as above.
- **`copyOwnBookToBranch`** (lorebooks/ownBook.ts:620-712): copies entries only. No members, member stats, member sprite sets, timbre or faces; the docstring itself says "links and stat rows do not come across yet".
- **Copy to my characters** (`characters:duplicate`, sockets/characters.ts:2215-2310): copies the row, tags (re-made as the asker's) and avatar file. `lorebookId` is kept only for the owner. Not copied: sprite sets, gallery, card-layer stats and sheets (the dowry). The likeness image pointer is kept as is. Card to card only; it never touches members.

## No member home yet
- Post-history instructions
- Group-only greetings
- Strokes (paused)
- Creator notes and multilingual notes
- Likeness (prompt, negative, reference image), plus portrait and sprite-fill card actions
- Gallery (members only have lorebook uploads)
- Character book (no prompt reader)
- Card tags (no session reader)
- Card embedding (members only have name and summary)
- Persona description on a player seat (member text exists but isn't wired into `seatPersonaDescription`)
- Identity keys: `session_cast` owner, `cast.byId`, `character:N` turn and tie refs, the private-lore gate, NER, clone-with-changes matching, Mundi phone, presence and avatars. They need `seated_member` or member ids in place of card ids.

Homes that exist but have gaps:
- Member sprite sets: no writer, and book duplicate doesn't copy them.
- Member timbre: no dedicated writer found.
- Member face: duplicate copies the pointer, not the file.