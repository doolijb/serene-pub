# REPORT mundi-27a (2026-11-05)

Relayed status question: none received. Every item in the brief is done.

**Result:**
- Port suite **678/678**. The baseline was 592/592; the 86 added tests cover both data shapes.
- `npx tsc --noEmit -p tsconfig.check.json` is **clean**.
- `npm run package` exited 0. The package and conformance tests pass, 24/24.
- New zip: `dist/mundi-0.2.0.zip`, **43,896,542 bytes**, sha256 **`891012ef9e80fe3983d5f542c723952bce4ae7508cee50a080b6686734da45bd`**.
- Nothing was touched in serene-pub or the SDK, apart from briefs under `plans/briefs/`.
- No lane report file was written. w1 was refused when it tried ("subagents return findings as text"), so this message is the report.

## The one door: `src/engine/identity.ts` (new; I wrote it as the workers' contract)
- **What it reads.** The host's identity fields:
  - on cast entries and on `who.user` / `who.owner`: `ref`, `castMemberId`, `cardId`;
  - on session-cast seat rows: `ref`;
  - on message rows: `castMemberId`.
- **Fallback.** It falls back to the card form only when a field is absent (a host before S3): the entry's `id` and `playerSeatId`, and the message's `characterId`.
- **It never parses a key.** No `Number(key)`.
- **Exports:**
  - entries: `castEntries`, `refOfEntry`, `cardOfEntry`, `memberOfEntry`, `entryByRef`, `entryByCard`, `entryByMember`;
  - the player: `playerEntryOf`, `playerRefOf`;
  - seat rows: `refOfSeatRow`;
  - messages: `speakerEntryOf` (`castMemberId` first, then the card, per ★S3-3), `spokeAsCast`;
  - avatars: `annexAvatars`, `annexVersionOf`, `exampleOfAvatar`, `entryByAvatarKey`, `avatarEntryOf`, `avatarRefOf`, `avatarCardOf`, `avatarOfCard`, `avatarOfSpeaker`;
  - ⏳ `cardRef`: the only template. It is used only for a number that is a card id by definition: a v1 annex value, or a phone lane.
- **Saves (★S3-5, as the brief gave it):**
  - **v1** (written by every Mundi so far, and still now): the `avatars` values are card ids, resolved through each entry's `cardId`.
  - **🚧 v2 reader**, with no writer: the values are `castMemberId`s.
  - **An unknown id is found again by the avatar key:**
    - An example person's tag (`exampleTag`, the card's `extensions.mundi.avatar`) is matched to the cast entry of that name through the world. The state's entries carry no card extensions, so the name is the bridge, as `avatarsOf` already did at new game.
    - Any other avatar key is the seat's `ref`, as the new game wrote it.
- **Phone lanes keep `phone:<cardId>`.** In v1 the lane number is the annex's own number and is never re-derived, so a thread stays on its lane. In v2 it is the entry's active card.

## What switched (file → what it reads now)
- **`engine/save.ts`**
  - `seatRefOf` → `playerRefOf`.
  - `valueOf` and `runEngine` names → `avatarEntryOf`.
  - `hudOf` skips the player by `avatarRefOf === seatRef`. Its signature is now `(g, input, shown, playerName?)`.
  - `writesOf`: the owner is `avatarRefOf`; a change with no ref is skipped. **The annex is written back at the version it read** (`annexVersionOf`), never a hard-coded 1 over a v2 map. This is a decision: a v2 map relabelled v1 would be corrupt.
  - The mirror rows (`save.hud.cast`) gain `castMemberId` / `cardId`, **only when the host filled them**, so a pre-S3 host's mirror is byte-identical. These are the SDK's names with the SDK's meaning, inside the port's own annex, so no new word.
- **`engine/relationships.ts`** `newGameHandler`:
  - names → `avatarEntryOf`;
  - the hero-age guard → `exampleOfAvatar(w, a)` together with `avatarRefOf === seatRef`. It replaced `tag.startsWith('character:')` / `` `character:${id}` ``.
- **`genre/newGame.ts`**
  - `playerPersonaOf` matches `refOfSeatRow` to `playerRefOf`.
  - `avatarsOf` → `castEntries`; the value is `cardOfEntry`; the key is the example tag, else `refOfEntry` (the same `character:<id>` string today).
- **`world/deriveBook.ts`** `avatarsOf`: the same switch, examples only.
- **`engine/presence.ts`:** `characterId` → `avatarCardOf`. It stays a card-id port (★S3-6).
- **`engine/phone.ts`**
  - `phoneLaneOf` / `avatarOfLane` take `(annex, x, state?, world?)`. Without `state` they give the same answer as before.
  - Transcript and apply: `characterId` → `avatarCardOf`, `speakerRef` → `avatarRefOf`.
  - A private `laneWorldOf` loads a world only for a v2 annex.
- **`pipelines/turns.ts`**
  - `presentResidents(g, w, state, annex)`: the ref is `avatarRefOf`.
  - Texted resident: `avatarOfLane` → `avatarRefOf`, else ⏳ `cardRef(lane)`.
  - `last` comes from `speakerEntryOf`. The narrator test uses `spokeAsCast`, so its meaning is unchanged.
- **`pipelines/talkActions.ts`** `talkLineHandler`: `lane` / `characterId` / `speakerRef` come through the door. **Decision:** `talkLineDefinition` gains a `state: S.json` in-port, wired `state: $.state.main` at `posted` only. It is a port-internal spec change; there are no hash pins in the port.
- **`pipelines/scenes.ts`:** who you talked with → `avatarOfSpeaker`.
- **`nodes/sceneBlocks.ts`** `recentLines` and **`pipelines/judge.ts`** `nameOf` → `speakerEntryOf(...).name`.
- **`pipelines/diary.ts`** `dayLines`: `nameOf` now takes the row, and the narrator test is `!spokeAsCast`.
- **The frame (`ui/src`)**
  - `core/store.ts` gains `cardIdOfAvatar` and `avatarOfMessage`:
    - v1 reads the annex number;
    - v2 reads the mirror row's `cardId`;
    - a message's `castMemberId` is matched to the mirror row's `castMemberId`, with ⏳ `characterId` as the fallback.
  - It imports `annexVersionOf` from `identity.ts`. w2 checked that it bundles with esbuild.
  - `log.ts` `avatarOf`, `library.ts` `characterIdOf` and `phone/state.ts` `laneOf` / `laneAskOf` call them. `open-character` still takes a card id.

## What still builds the card form, and why
- ⏳ **`cardRef`** in `identity.ts`. It is reached only:
  - for a v1 annex value no entry names;
  - for a phone lane no avatar owns;
  - inside `refOfEntry` / `refOfSeatRow` when the host filled no `ref`.

  All three are the "field absent" fallback.
- **Phone lanes stay `phone:<cardId>`.** By ruling, S4 decides.
- **The new game still writes a v1 annex**, because the v2 writer is mundi-27b in S4. A cast member with no card is therefore left out of `avatars` until then.

## Changed files (`/home/jody/github/mundi-sp`)
- **Source:**
  - `src/engine/identity.ts` (new, mine);
  - `src/engine/{save,phone,presence,relationships}.ts`;
  - `src/genre/newGame.ts`, `src/world/deriveBook.ts`;
  - `src/pipelines/{turns,talkActions,scenes,judge,diary}.ts`, `src/nodes/sceneBlocks.ts`;
  - `ui/src/core/store.ts`, `ui/src/log.ts`, `ui/src/library.ts`, `ui/src/phone/state.ts`.
- **Tests:**
  - new `test/engine/identity.test.ts` (26 tests: today's, S3 and S4 shapes; v1 and v2; re-resolve by example tag and by ref key);
  - new `test/ui/identity.test.ts`;
  - extended `test/engine/{save,hud,relationships,presence,phone,helpers}.test.ts`, `test/genre/newGame.test.ts`, `test/world/deriveBook.test.ts`, `test/pipelines/{turns,talkActions,scenes,judge,diary}.test.ts`, `test/nodes/sceneBlocks.test.ts`, `test/ui/{library,phone}.dom.test.ts`.
- **`CHANGELOG.md`**, 0.2.0 section, following the M3b precedent (0.2.0 is not yet released):
  - one bullet: "**Ready for Serene Pub's cast members.** …";
  - the install line now gives the new size and sha.
- **Regenerated by `npm run package`:** `dist/**`, `ui/mundi.{js,css}`, `assets/books/*`.
- **Briefs:** `/home/jody/github/serene-pub/plans/briefs/BRIEF-mundi-27a-common-rules.md`, `BRIEF-mundi-27a-w1.md`, `BRIEF-mundi-27a-w2.md`.

I checked the files changed during the lane by mtime. Every one is inside its worker's owned set. I re-read the key hunks (`save.ts`, `turns.ts`, the frame's door) and re-ran the suite myself. No `scope-reviewer` was run: the port is untracked, so there is no git diff base. That follows M3b-S5's precedent.

## Tests (both shapes)
- **Shapes covered:**
  - today's host (entries `{ id, name }`, no fields): every existing assertion is unchanged;
  - an S3 host (`ref: character:41`, `castMemberId`, `cardId`);
  - S4-shaped data: member-keyed `byId`, `seated-member:` refs, `player-seat:` for a carded player seat, `id: 0`, a card-less speaker, a v2 annex, an unknown v2 id.
- **Commands run:**
  - `npx vitest run`: 56 files, **678/678**;
  - `test/package` + `test/conformance.test.ts`: 24/24 after packaging;
  - `tsc` (the check config): clean.
- **Fixture changes** (my decision, not a ★): four existing fixtures held `cast.byId` entries with no `id`. Those only worked by reading the key. The real host always fills `id` (`resolve.ts`). w1 added `id` to them (`newGame.test.ts`, `helpers.test.ts`, `phone.test.ts` ×2), and every assertion is unchanged. w2 added `id` to two entries in the diary fixture, again with no assertion changed.
- **Behaviour change on today's data:** only a card-less player seat. `newGame.avatarsOf` used to write `"character:<key>": NaN` for it, and now leaves it out.

## Repins
None. The port has no spec or golden hash pins, and `talkLineDefinition`'s new in-port moves only the port's own manifest. The app's `specHashes` / `registryHashes` are untouched by this lane.

## §25 rows
None. No new names went into Serene Pub's vocabulary. The mirror's two fields reuse the SDK's `castMemberId` / `cardId` inside Mundi's own annex.

## Open ★
None new. ★S3-5 (the v2 shape) was built as the brief stated: avatar → `castMemberId`, phone lanes keep their v1 numbers, the reader now and the writer in S4.

## Noticed, not done (incl. S4 items)
- **S4 / mundi-27b:**
  - the v2 writer and the save upgrade;
  - the phone lane form for card-less members (no card means no lane);
  - `newGame.avatarsOf` skips card-less members until v2.
- **Dated cards in S3.** If a seat's active card on the timeline differs from the card a v1 annex recorded, `entryByCard` misses on `cardId`. The person is then found again by the avatar key: an example's name, or the `character:<id>` ref key. Their phone lane keeps the recorded number.
- **The two `avatarsOf` functions** (`genre/newGame.ts`, `world/deriveBook.ts`) could share one body with an examples-only flag. Not merged.
- **Leftover types and comments:**
  - `StateDoc.cast` in `save.ts` is no longer read;
  - an unused `MundiAnnex` type import in `presence.ts` predates the lane;
  - the header comment of `ui/src/phone/contacts.ts` is slightly stale (it says "characterId from annex").
- **`presentAt`'s output** carries only `characterId`, a card. In S4 its consumers may want `castMemberId`. Not added, since that would be a new output field.
- **The re-resolve by tag matches on name.** The state's cast entries don't expose card `extensions`, so `extensions.mundi.avatar` is only reachable on session-cast rows, which only the create pipeline reads. A host field carrying the tag would make this exact.
- **Temp dirs:** the `/tmp/serene-pub-vitest-*` dirs present belong to other lanes. The port's tests make none, so nothing was deleted.