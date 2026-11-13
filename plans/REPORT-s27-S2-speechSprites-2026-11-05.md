# REPORT s27-S2-speechSprites (2026-11-05): a seated speaker's voice, name and sprite sets now come from the cast member, own over card

**Status: BUILT.** Seated speakers now speak with their cast member's own voice and show its own sprite sets, falling back to the card's when the member has none. The lane's targeted run is 378/379; the one failure is in a test file I didn't touch (details under Tests). `tsc` shows nothing in lane files.

Two Sonnet workers did the typing. Briefs: `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-speechSprites-w1.md` (speech) and `/home/jody/github/serene-pub/plans/briefs/BRIEF-s27-S2-speechSprites-w2.md` (sprites). I read both diffs against their briefs and the contract and accepted them. No migration, SDK edit, `sdk:build`, commit or stash.

Status question: none was relayed.

## What switched (file → reader)
- **`src/lib/server/speech/resolveVoice.ts`**
  - **`speakerTimbre(db, ref, sessionId)`**
    - With a session, the ref goes through `parseSeatRef` and `seatOf` first. This step runs before the SDK's `parseParticipantRef`, which does not know `seated-member:`.
    - A seat with a member reads `memberAsRead(…, { sessionId, overCards: <the seat's card> })` and takes its `.timbre`: the member's own, else the card's.
    - A seat with no member reads its seat card.
    - With no seat or no session, today's code runs unchanged.
    - Accepts `character:`, `seated-member:` and `player-seat:`.
    - `null` and today's `{}` behave the same: `resolveVoiceCore` reads only `timbre?.x`.
  - **`speakerSilent(db, ref, sessionId?)`**: a member's own `timbre.silent` now silences. The new argument is optional.
  - **`usedVoiceSlugs`** (voices in use):
    - It keeps today's two seat queries, departed seats included, and adds `castMemberId`.
    - One `membersAsRead` call follows. A seat whose member has its own voice (`voiceFrom === "member"`) counts that voice; every other seat counts its card's, as today.
  - **Auto picks are untouched:** the `speechAutoVoice:<speakerRef>` key, the hash input, `rememberAutoPick` and `castingOf`.
- **`src/lib/server/pipelines/runtime/dispatchSpeech.ts`**
  - **`castRefs`** maps a `Name:` cue to a seat. It reads the live seats' members through `seatedCastOf` and keeps today's two queries.
    - A seat with a member is named by the member's name and nickname. A player seat is `seatName` first.
    - Emitted refs stay `character:<cardId>` and `player-seat:<seatId>`, with today's order and the first match winning.
  - **`nameOfRef(db, ref, sessionId)`** accepts `seated-member:` and names the speaker from the member as read; a player seat still uses `seatName` first.
  - Both `speakerSilent` and `nameOfRef` now receive `sessionId`.
- **`src/lib/server/sprites/index.ts`**: new reader 🚧 `spriteLabelsForMembers(db, memberIds)` beside `spriteLabelsFor`. It returns a member's own sprite labels that have an image, keyed by member id.
- **`src/lib/server/sprites/choices.ts`** — `spriteChoicesFor` keeps its signature, so its callers keep working.
  - It finds the seat with `seatOf(character:<id>)`, then reads `memberAsRead(…, { sessionId })` **without `overCards`, on purpose**: sprites draw the member, so they follow the dated card. A comment says so.
  - With a member:
    - the card is `activeCardId`;
    - the amendment rung is the member's `spriteSet`;
    - if the member has its own sets with images, those are the art and `characterId` is `null` (the doc on `SpriteChoicesV1.characterId` is updated);
    - otherwise today's card path runs, including the fallback from a swapped-in card with no art to the speaker's own card.
  - A seat with no member yet takes today's `cardMemberAt` path unchanged.
  - `setSessionSpriteSet` and `spriteSetOverridesFor` are unchanged: the slot stays on the `session_cast:<cardId>` owner.
- **`src/lib/server/sockets/sprites.ts`** — `sessions:setSpriteSet`:
  - The seat check uses `seatOf` and still accepts only a character seat. The refusal words are unchanged.
  - The set name is checked against the member's own sets when it has any (`spriteSetsFrom === "member"`), else against the card's, as today.
  - The write and the broadcast are unchanged.
- **`host.ts`, my hunk only (the `core:oracle/pick-sprite` case, now at ~6324)**: a comment edit. The default rung now reads "the seated cast member's own sets when it has any, else the card's". There is no code change: the hunk still passes `characterId`, and `spriteChoicesFor` resolves the seat itself.

## What still reads the card, and why
- **`speech/preview.ts` and `speech/language.ts`:** neither reads a card. The preview resolves a draft timbre with `speakerRef: null`, and the language resolver is pure. Nothing to switch.
- **`pipelines/speech/cueLines.ts` (`castNamesOf`):** pure. It reads whatever the host's session-cast document carries under `character`. That read in `host.ts` belongs to lane s27-S2-promptText, which already overlays retold names there, so `Name:` names follow it.
- **`pipelines/speech/messageLine.ts`:** it emits refs only (`speakerRefOf`), and those stay as they are until S3/S4.
- **`entities/publishedValues.ts` (`publishedSprites`):** no card read. It is keyed by `cast.byId` id and the sprite-set slot, both S4 keys. Unchanged.
- **`sprites/attach.ts`, `reexpress.ts`, `fillAction.ts`, the `characters:*Sprite*` handlers, and `listSpriteSets` and the set CRUD in `sprites/index.ts`:** these are card-editor writers and readers with no session. The lane is readers only, so they stay keyed by card.
- **The recent-faces query in `spriteChoicesFor`** matches on `session_messages.character_id`. It stays keyed by card until S4 re-stamps lines.

## Changed files
- Edited:
  - `/home/jody/github/serene-pub/src/lib/server/speech/resolveVoice.ts`
  - `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatchSpeech.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sprites/index.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sprites/choices.ts`
  - `/home/jody/github/serene-pub/src/lib/server/sockets/sprites.ts` (the `sessionsSetSpriteSet` handler and two imports)
  - `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/host.ts` (the sprite-node comment only)
  - `/home/jody/github/serene-pub/NOMENCLATURE.md` (§25, one row)
- New tests:
  - `/home/jody/github/serene-pub/src/lib/server/speech/memberVoice.int.test.ts` (9)
  - `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatchSpeech.members.int.test.ts` (2)
  - `/home/jody/github/serene-pub/src/lib/server/sprites/memberSprites.int.test.ts` (7)
  - `/home/jody/github/serene-pub/src/lib/server/sockets/sprites.memberSets.int.test.ts` (3)

## Tests
- **Lane run:** `npx vitest run src/lib/server/speech src/lib/server/pipelines/runtime/dispatchSpeech src/lib/server/pipelines/speech src/lib/server/sprites src/lib/server/sockets/sprites src/lib/server/pipelines/entities/publishedValues` gives **31 files, 378/379**.
  - **No existing test was edited.**
  - No existing test changes value because of the intended own-book change: the existing speech and sprite fixtures seat cards with no member, or members with no own voice, sets or names.
  - **The one failure:** `publishedValues.int.test.ts > session.fields > is the stored value of a declared key, else its default, and nothing else`. It receives `ownerSheetLatitude`, `sessionLanguage`, `speechNarratorVoice` and `speechReadAloud`, which the test does not expect.
  - That test file is dirty from another lane's work, `publishedValues.ts` is unchanged by this lane, and `session.fields` touches no sprite code. Not this lane's.
- **New tests prove:**
  - a member's own timbre over the card's;
  - a member with no timbre reads the card;
  - a seat with no member reads the card;
  - a `seated-member:` ref resolves;
  - a `player-seat:` ref reads the seat's member;
  - a seat holding a dated card speaks with that card's voice;
  - two seats on one member, each with its own card's voice;
  - a member's own `silent` silences;
  - Auto avoids a member's own voice;
  - a `Name:` cue with the member's own name maps to the seat, and a member with no own names maps the card's name and nickname as before;
  - a member's own sprite sets show over the card's (`characterId` null);
  - a session pick resolves against the member's sets, and a card-only name with the member's sets in force reads as `missing`;
  - the member's stored `spriteSet` gives the amendment rung;
  - a seat with no member, or a member with no sets, reads the card;
  - a seat with a member follows a card-swap amendment to the dated card;
  - the `sessions:setSpriteSet` accept and refuse cases, including a player seat refused as before.
- **`npx tsc --noEmit -p .`:** no error in lane files. The only error is `TS6053 .svelte-kit/types/src/routes/$types.d.ts not found`: the generated types are missing, an environment problem, not code.
- **Prettier:** the four new test files are clean. The edited source files were already unformatted at HEAD and were left as they were.
- **Temp dirs:** the new tests' dirs clean up in `afterAll`. After my run, `/tmp/serene-pub-vitest-d0KG3W` and `/tmp/serene-pub-vitest-seatMember-nfQYOi` appeared, but other lanes were running at the same time and I can't tell whose they are. I deleted neither.

## NOMENCLATURE §25
One row, appended after the `seatedCastOf` row. It records 🚧 **`spriteLabelsForMembers`** (⚠ not `spriteLabelsFor`) and lists the readers switched. That is the lane's only new exported name.

## Decisions taken inside scope (not ★)
- **A member's own sprite sets count only once one has an image.** Until then the card's art shows.
- **`SpriteChoicesV1.characterId` is `null` when the art is the member's own.** Nothing reads that field downstream, and its type was already `number | null`.
- **Sets are checked against the member's sets when it has any, else the card's.** The brief's "against the member's sets first" is read as the same rule the picker uses. I did not read it as "member's, then card's", because a card-only name would then pass the check and never show.
- **The voices-in-use count reads only the member's own voice.** It is read from the member, with no `overCards`, and a seat without its own voice counts its card's voice as today.
- **`castRefs` uses `seatedCastOf`** because it means the live seats now. The other readers keep their seat queries and look up each seat's member.
- **No `seated-member:` form was added to the sprite path.** The host and the socket both take a `characterId` number, and the refs being parsed belong to bindings.ts (next section).

## Queued for other lanes
- **s27-S2-promptText (`bindings.ts`):** `speakingCharacterId(input.speaker)` in the `core:oracle/pick-sprite@1` binding (~8410) should also accept `seated-member:<id>`. It would turn the seat's card into `characterId`, or pass the ref through. That parser is theirs; until it changes, a `seated-member:` speaker gets no sprite pick. No emitter produces that ref before S3/S4.
- **s27-S2-client:** the client draws a shown sprite (`{ set, label }`) from the speaker's card's sets. Once a member owns sets, the session payload needs the member's set list (images) and the client needs to draw from it. That covers `withSessionExtras` / `characters:listSprites` and `requests/setSpriteSet.ts`.

## Open ★
None new.

## Noticed, not done
- **UI a member's own voice or sprites would need (out of scope, readers only):**
  - a member editor field for `lorebook_bindings.timbre`, with the voice picker the card editor has;
  - member-owned set CRUD (`sprites/index.ts`'s create/rename/default/delete/import, `attach.ts`, `fillAction.ts`, `reexpress.ts`, all keyed by card today);
  - the `characters:*Sprite*` sockets, or new member-scoped events (★ new names);
  - the card profile's "made visible" line saying where the voice and sprites come from (`voiceFrom`, `spriteSetsFrom`).
- **Departed seats:**
  - `seatOf` falls back to a departed seat, so `nameOfRef`, `speakerTimbre` and the `sessions:setSpriteSet` check now resolve a departed seat's member. The old check had no `removedAt` filter either, so the socket behaves as today.
  - `castRefs` is live-only, as before.
- **Empty member sets:** `memberAsRead.spriteSetsFrom` says `"member"` even when no member set has an image. The socket then validates against those empty sets while the picker shows the card's art. This is an edge case until a UI can make member sets.
- **Narration voice:** `speakerSilent` in the dispatch loop gets `group.speakerRef`, not the narration's `lineSpeakerRef`. Unchanged from before.
- **S4 rekey items I met:**
  - `speechAutoVoice:<speakerRef>`, whose hash input is `speakerRef|sessionId`;
  - the sprite-set slot on `session_cast:<cardId>` (`choices.ts`);
  - the `publishedSprites` keys by card id;
  - `session_messages.character_id` in the recent-faces query and in `sessionMessages:setSprite` ("Only a character's lines show sprites").
- **Outside the lane:** the `publishedValues.int.test.ts` `session.fields` expectation needs its owner to update it, and `.svelte-kit` types are missing for `tsc`. Running `svelte-kit sync`, or the lead's `npm run check`, regenerates them.
## Scope review (lead, 2026-11-05) — no objection on scope; three low notes, dispositions
1. **Picker and socket used two rules for "the member owns sprite sets"** (picker: a member set with an image; socket: any member set row) → **fixed by the lead** in `sockets/sprites.ts`: the socket checks `spriteLabelsForMembers` (non-empty → the member's names, else the card's). Test: a member whose own sets have no image reads the card's names. "A member's sets count once one has an image" becomes a ★ with the member-sets UI (S4 or later).
2. **`sprite-choices@1` `characterId: null`** when the member's own art is used (never null before; no reader) → **S3 item**: what the SDK shape says when no card draws the art.
3. **The seat check resolved a card's live player seat over its departed character seat** → **fixed by the lead**: the handler asks for the card's character seat directly (live first), as before S2; the two now-unused imports dropped. Test: a departed character seat plus a live player seat still takes a set.
Lead's run: `sockets/sprites*` + `sprites/**`: 10 files, 71/71.
