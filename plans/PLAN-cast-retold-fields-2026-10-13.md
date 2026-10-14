# PLAN — Cast members own their card fields (retold fields + face) — 2026-10-13

**Status:** BUILT + VERIFIED 2026-10-13 (browser walk: retold description + first message saved, retold greeting reached a new session, uploaded face drawn in header disc + message avatar, card banner). Uncommitted. (owner: "go ahead and get to work"). Supersedes the "full mirror +
cascade / no-merge + eager seeding" sketch of 2026-09-24 in `project_world_state_lives_on_the_lorebook`.

## Rulings (owner, 2026-10-13)

1. Description, personality and the face are editable on the cast member, **with a per-field toggle**
   that says whether the member's text replaces the card's.
2. Greetings (first message + alternate greetings), scenario and example dialogues too, same toggle.
3. The member's face may come from the card's gallery **or** a lorebook-owned upload.

The card is a **starter**: it gives enough to begin. A well-kept lorebook carries age, lore and
relationships elsewhere; the member's own text is for what *this* story retells.

## Vocabulary (NOMENCLATURE §8, §18; ledger §25)

- **retold** (field) — a card field the cast member tells in their own words. `lorebook_bindings.retold`
  is `Record<RetoldField, boolean>`; `true` = the member's column is read, `false`/absent = the card's
  value reads through. The member's column is **kept** either way (switching the toggle off hides,
  never discards). ⚠ Not *override* (config scope, §6), not *amendment* (dated overlay — the retold
  flags and columns are themselves amendable), not *diverged*.
- **RetoldField** = `description | personality | scenario | firstMessage | alternateGreetings |
  exampleDialogues | face`.
- **face** (of a cast member) — the picture a member is drawn with when `retold.face`:
  `lorebook_bindings.face_media_id` (FK `files.id`, `SET NULL`). ⚠ Not *portrait* (the picture
  pipeline), not *avatar* (the card's own picture).
- **lorebook-owned media** — a `files` row with `lorebook_id` provenance (no FK, like the other
  provenance columns), uploaded for a member's face.

## Schema (one generated migration, 0112)

`lorebook_bindings` += `description text`, `personality text`, `scenario text`, `first_message text`,
`alternate_greetings json string[] default []`, `example_dialogues text`, `face_media_id integer
FK files.id on delete set null`, `retold json default {}`.
`files` += `lorebook_id integer` (provenance, no FK).

Rule: with `retold = {}` every session read is byte-identical to today (parity goldens).

## Read seams

- **Server, prompt:** `host.ts` `case "session_cast"` — for each seat whose card is a member of the
  session's book (`castMemberCards().memberOf`), resolve the member at the session's reading
  (`castMemberAt`, overlays include the new fields + `retold`), and for each retold prose field
  replace `cc.character.<field>`; when `description` or `personality` is retold also set
  `cc.character.strokes = null` (strokes would otherwise beat the prose).
- **Server, greetings:** `sessions/greetings.ts` `collectSessionGreetings` — same overlay for
  `firstMessage` / `alternateGreetings` (needs `sessions.lorebookId` + reading).
- **Server, `sessions:get`:** next to `spriteSetOverrides`, attach `castFaces:
  Record<characterId, mediaId>` for seats whose member has `retold.face` and a `faceMediaId`.
- **Client, session projection:** `projections/characters.ts` `memberOf` — `face` from
  `castFaces[characterId]` via `avatarSrc({ avatarMediaId }, { full: true })` when present; `pinOf`
  matches that face too.
- **Client, lorebook:** `CastWorkspace` faces + `CastMemberForm` header use the member's face when
  retold.

## Write seams

- `lorebooks:updateBinding` passes new columns through; validate `faceMediaId` (a `files` row the
  asker may use: their own upload for this book, or a gallery image of the member's card) and
  `retold` (keys ⊆ RetoldField, booleans).
- `amendments:create` — `CAST_AMENDABLE` += the 7 columns + `retold`; `cleanCastFields` validates.
- New `lorebooks:uploadMemberFace { castId, imageFile, mimeType }` → `createMedia({ userId,
  lorebookId, bytes })`, sets `faceMediaId` + `retold.face = true`, replies with the member row.
- `lorebooks:bindingsForCharacter` reply += `members: { lorebookId, castId, retold: RetoldField[] }[]`
  for the card editor banner.

## UI

- Member page › **Member** tab, after the summary: a **From the card** block, one row per field:
  label, toggle *Retold here* / *From the card*, the field (textarea; greetings as a list; example
  dialogues textarea), and **Take from card** (copies the card's current text into the member's
  field). Toggling on with an empty member field copies the card's text first.
- Face: in the header, **Change face** → picker with the card's gallery (`characters:listGallery`)
  and **Upload** (lorebook-owned); **Use the card's picture** clears `retold.face`.
- All of it goes through the existing `onSave` / `onAmend` (dated when reading as of a date).
- Card editor banner (top of `CharacterForm` in edit mode): "Represents N cast members in M
  lorebooks" with member links; "K of them retell parts of this card" when any do.

## Docs

`docs/lorebook-cast.md` (new section *What the member tells in their own words*), `docs/characters.md`
(a card is a starter; the banner), NOMENCLATURE §8/§18/§25.

## Lanes

A server (schema, migration, amendments, host overlay, greetings, sessions:get, sockets, types).
B client lorebook (memberDraft, CastMemberForm, face picker, CastWorkspace faces).
C client card banner + docs + nomenclature.
D client session projection.
One grouped verification at the end: `npm test` targeted suites, parity goldens, tsc, svelte-check,
browser walk.

## As built — deviations and loose ends (2026-10-13)

- Member example dialogues are ONE text column; `applyRetold` splits it on `<START>` into the
  card's array shape (`splitExampleDialogues`).
- A face **upload** writes the member directly (`lorebooks:uploadMemberFace`), so it is never
  dated even while reading as of a date; a **gallery pick** goes through the draft and can be.
  ★ Owner: should an upload while reading as of a date file a dated change instead?
- Persona seats are not overlaid (personas are voiced, not cast). Side characters picked by the
  narrator (`sideCharacter.ts`) read the raw card.
- A group session's `groupOnlyGreetings` still win over a retold first message.
- `castFaces` rides only `sessions:get`; a face change re-lists the cast, which refreshes open
  sessions through the bindingList push (seen working in the walk), but no dedicated push exists.
- Retold fields are not in lorebook export/import (export is paused). `isBlankMember` ignores them.
- The admin media panel shows lorebook-owned faces as unattached.
- `lorebook_bindings.retold` sends the whole flags object on every save (amendments overlay it
  whole).
- Header cast discs and message faces follow the retold face when no sprite is shown
  (`sessionPageProjections.ts headerFaceOf`).

## Review fixes (2026-10-13, independent review + double check)

- Group sessions: retold greetings clear the card's `groupOnlyGreetings` (`applyRetold`), so a
  member's greetings no longer lose to the card's group-only ones.
- Face upload: bytes sniffed BEFORE writing (no orphan on refusal); a reused file (one row per
  user + bytes) is never re-stamped; a reused PRIVATE file is refused; the upload no longer echoes
  `lorebooks:updateBinding` (it could settle an unrelated pending Save).
- Who may view a face (`canViewMedia`): follows the books whose members WEAR the file, plus the
  file's own stamp — fixes a face reused in a second book, and an old card's gallery face after a
  card swap.
- Dated face pick: `faceMediaProblem` accepts a gallery image of any card the member is drawn
  with on any line at any date (`castMemberCards().cardsOf`), not only the stored card.
- Docs: a face Upload is not dated; a gallery pick is.
- Still open (plausible, not fixed): an upload while reading as of a date writes the base flags,
  which a dated `retold` overlay hides; toggling a field on then off leaves the form dirty with
  the card's text copied in; list discs use the full-size face.

## Owner follow-up (2026-10-13, "that works, go")

- **Upload stores only.** `lorebooks:uploadMemberFace` replies `{ castId, lorebookId, mediaId }`
  and never writes the member. The form adds it to **This book's pictures**
  (`lorebooks:listMemberFaces`: images stamped with the book + non-gallery faces its members wear,
  newest first, owner only) and picks it into the draft; **Save** / **Save as of a date** writes
  it, so a face is dated like every other field. Closes the ★ on dated uploads and the
  "upload looks lost behind a dated retold" concern.
- `faceMediaProblem` accepts the asker's own non-private image (an upload, or the row an upload
  re-used), a gallery image of any card the member is drawn with, nothing else.
- **Switching a field off drops an untouched copy:** when the saved member had no text and the
  draft still holds exactly the card's copy, the saved value comes back (`setRetold(…, saved)`).
- **List discs use thumbnails** (`memberFaceSrc(…, { full: false })`, `castFaceSrc`).
- Walk 2026-10-13: upload → listed under This book's pictures → picked into the draft (member row
  untouched) → Save writes `faceMediaId` + `retold.face` → form clean (no discard prompt). After a
  reload the session's header disc and message avatar draw the face.
- **Open gap, seen in the walk:** an OPEN session does not redraw a changed face until reloaded —
  `castFaces` rides only `sessions:get`, and nothing pushes a cast change to sessions reading the
  book. Same for retold text in the prompt? No: the prompt reads `session_cast` per run, so text
  is current on the next reply; only the drawn face is stale.
