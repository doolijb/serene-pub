# BRIEF s27-S3W-w1 — the client's seat-identity helpers, and the speaker/seat sites on the session page

Worker for lane **s27-S3W** (supervisor: Opus). App `/home/jody/github/serene-pub`. You type; you decide nothing outside this brief. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`; don't run one.)
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Why (the stage, in brief)
Seat-cast programme, stage S3: **consumers stop building refs or keys from card ids and read host-filled identity instead**, so they work on today's card-keyed data **and** on S4's member-keyed data. Rules from the lane contract (quoted):
1. "**Host fills, consumers read.** … fall back to today's card form only when a field is absent." SDK `castMemberId` = **the seat's cast member** (the payload seat row's `castMemberId`). `cardId` = the member's **active card on the timeline**.
2. "**Look up, never parse.** A consumer that needs the `state.cast.byId` entry for a ref finds the entry whose `ref` (or `castMemberId`) matches; it never parses a card id out of a ref or a key, and never does `Number(key)`."
3. "**Tests on both shapes:** every switched consumer gets a test on today's data (output unchanged) and on S4-shaped data (member refs `seated-member:<id>`, `player-seat:<id>` for carded player seats, member-keyed `byId`)."
4. "**No stored key changes, no migration, no removal.**"
5. "**New names** qualified (R3), 🚧-marked" — the supervisor writes the NOMENCLATURE rows; you mark each new export 🚧 in its doc comment.
6. "**Every session has a lorebook** — never write 'no book'" (nor "no lorebook", "bookless").
CLAUDE.md rules that apply: browser code runs on plain-http LAN addresses and phones — **no `crypto.randomUUID`, no `navigator.clipboard`**; `$state(new Set())`/`new Map()` is not reactive — none needed here (these are pure functions); it is a **session**, never a *chat*. Existing tests in your files stay green **unchanged**; a test you must edit is a finding — say why in your report.

**Today's data vs S4 data.** The session payload (`sessions:get`) seat rows are DB rows: `sessionCharacters[]` (`id`, `characterId`, `castMemberId` = the seat's member, `envoySlug`, `position`, `removedAt`, `character`) and `sessionPersonas[]` (`id`, `personaId`, `castMemberId`, `position`, `removedAt`, `seatName`, `persona`, `portraitMediaId`). Messages (`SelectSessionMessage`) carry `characterId`, `personaId`, `castMemberId` (the speaker's seat member, stamped at write), `metadata.speaker` (a host-stamped ref, e.g. `player-seat:<id>` / `envoy:<slug>`). **The payload does not carry a seat `ref` or `cardId` yet**; the lead is asking lane C to fill them. So every helper reads an optional host-filled `ref` / `cardId` on a seat row and, only when absent, falls back (⏳) to today's form. **S4-shaped test data** = seat rows that carry `ref` (`seated-member:<castMemberId>` for character seats, `player-seat:<seatId>` for every player seat, carded or not), messages carrying `castMemberId`, and **colliding ids**: e.g. card id 7 belongs to one person and cast member id 7 to another, so a reader that parses or joins on the wrong id picks the wrong person.

## Files owned (edit only these)
- NEW `src/lib/client/components/sessionPage/projections/seatIdentity.ts` + NEW `seatIdentity.test.ts` beside it
- `src/lib/client/components/sessionPage/sessionPageProjections.ts` (only the hunks named below)
- `src/lib/client/utils/messageSpeaker.ts`
- `src/lib/client/components/sessionPage/roundWaiting.ts`
- Tests: `sessionPageProjections.seatMember.test.ts`, `sessionPageProjections.castNames.test.ts`, `personLineSeat.test.ts`, `roundWaiting.test.ts`, `src/lib/client/utils/messageSpeaker.test.ts` — **add** cases; do not change existing ones (or report why).
Everything else is read-only. Many files are dirty with other lanes' uncommitted work: edit by hunk, never reformat a file, never run `prettier --write` on a file you didn't create.

## 1. `projections/seatIdentity.ts` — a leaf module (imports types only)
Write exactly this API (names are decided; keep them):

```ts
/** A seat row as the session payload carries it — structural, so the page's session and a fixture both fit. */
export interface PayloadSeat {
  id?: number | null
  /** A character seat's card. */ characterId?: number | null
  /** A player seat's card. */ personaId?: number | null
  /** The seat's cast member (s27 S1). */ castMemberId?: number | null
  envoySlug?: string | null
  position?: number | null
  removedAt?: unknown
  /** 🚧 The seat's participant ref, when the host fills it (s27 S3). */ ref?: string | null
  /** 🚧 The member's active card on the timeline, when the host fills it (s27 S3). */ cardId?: number | null
}
export interface SeatsPayload {
  sessionCharacters?: readonly PayloadSeat[] | null
  sessionPersonas?: readonly PayloadSeat[] | null
}
/** A seat found, with the table it sits in. */
export interface SeatFound<S extends PayloadSeat = PayloadSeat> { seat: S; form: "character" | "player" }
```
Make the functions generic enough that callers get their own row type back (e.g. `seatOfMessage<S extends PayloadSeat>(session: { sessionCharacters?: readonly S[] | null; sessionPersonas?: readonly S[] | null } …)`), or accept the structural types and let callers cast — your choice; no `any` leaking into callers' types.

- 🚧 **`seatRefOf(seat, form)`** → `string | null`: the seat's participant ref — its host-filled `ref` when a non-empty string; else ⏳ today's form: a character seat `character:<characterId>` (null when `characterId` is null or the row has an `envoySlug`); a player seat `character:<personaId>` when it voices a card, else `player-seat:<id>` (null when `id` is null). This is exactly today's `roundWaiting.ts` `refOf` for player seats.
- **seatOf order** (private helper; mirror of the server's `seatOf`, `sessions/seats.ts`, and of today's `seatCardIdOfRef` in `sessionPageProjections.ts` ~104–129 — read it and keep the same order): a live seat (`removedAt` falsy) before a departed one, in either table; then a character seat before a player seat; then the lowest `position` (null as 0); then the lowest seat `id` (null as 0); then payload order (stable). Envoy seats (`envoySlug` set) are never chosen.
- 🚧 **`seatOfCastMember(session, castMemberId, prefer?)`** → `SeatFound | null`: the seat whose `castMemberId === castMemberId`, in seatOf order; with `prefer` (`"character"` | `"player"`), seats of that form first (each group in seatOf order), then the other form. Null for a null id or no seat.
- 🚧 **`seatOfRef(session, ref)`** → `SeatFound | null`: the seat a ref names, **looked up, never parsed**: in seatOf order, the first seat with (a) `seatRefOf(seat, form) === ref`; else (b) a player seat with `` `player-seat:${seat.id}` === ref `` (a seat that took a card keeps answering to its seat ref); else (c) a seat with `castMemberId != null` and `` `seated-member:${seat.castMemberId}` === ref ``. Null otherwise. (Formatting a seat's own id and comparing is fine; extracting a number from `ref` is not.)
- 🚧 **`seatOfMessage(session, msg)`** → `SeatFound | null` for `msg: { characterId?, personaId?, castMemberId?, metadata? }`: the seat a line was spoken from. Branches, in this order:
  1. `msg.personaId != null` → a **player** seat: `seatOfCastMember(session, msg.castMemberId, "player")` restricted to player seats when `msg.castMemberId != null` and one matches; else the player seat with `personaId === msg.personaId` (seatOf order among those).
  2. `msg.characterId != null` → a **character** seat: by `castMemberId` among character seats when the message has one and one matches; else the character seat with `characterId === msg.characterId`.
  3. Otherwise, a stamped speaker: `metadata.speaker` a non-empty string → `seatOfRef(session, it)` restricted to **player** seats (a card-less player seat's line). Envoy refs find nothing.
  4. Else null. (Do **not** add a branch that finds a seat by `castMemberId` alone for a line with neither card column — S4 decides that; note it in your report.)
- 🚧 **`messageRefOf(session, msg)`** → `string | null`: the ref a line's speaker carries: the found seat's **host-filled** `ref` when present; else ⏳ **exactly today's** `sessionPageProjections.ts` ~629–633 expression on the message's own columns: `character:<characterId>`, else `character:<personaId>`, else null. (So a card-less player seat's line stays null today, as now — a change there is a ★ for the owner, not yours.)
- 🚧 **`castEntryOf(byId, ref)`** → `Record<string, unknown> | undefined` for a `state.cast.byId` map: the entry whose host-filled `ref === ref`; else, for a ref equal to `` `seated-member:${entry.castMemberId}` ``, that entry. ⏳ Only when **no entry in `byId` carries a string `ref`** (a host before S3): today's key — `player-seat:<id>` → `byId["player_seat:<id>"]`, `character:<id>` → `byId["<id>"]` (this is today's `fateOf` at `sessionPageProjections.ts` ~957 and `collects.ts` `holdsOf`). Never fall back while any entry carries a `ref` (in S4 a card id would hit a member's key — the wrong person).
- 🚧 **`castEntryOfMember(byId, castMemberId)`** → the entry whose `castMemberId === castMemberId`, else undefined.

`seatIdentity.test.ts`: each function on today's shapes and on S4 shapes, incl. the collision case (card 7 ≠ member 7), departed-before-live ordering, `prefer`, the ⏳ fallbacks, and `castEntryOf` refusing the fallback when entries carry refs.

## 2. `sessionPageProjections.ts` hunks
- `seatCardIdOfRef` (~104–129): keep its export, signature and doc's promise; resolve with `seatOfRef` → the found seat's card (`characterId` for a character seat, `personaId` for a player seat; null when it has none). Keep a ⏳ fallback reading `character:<id>` as that id **only if** an existing test pins an unseated `character:` ref (check `sessionPageProjections.seatMember.test.ts`); otherwise drop the regexes. Keep its interface `SeatRefSession` compatible (it can extend `SeatsPayload`). Its §25 row says "This must change with `seatOf`" — the order now lives in `seatIdentity.ts`; update that doc line to point there.
- `canControlMessageAs` (~168–222): the persona branch and the character branch find the line's seat(s) with `seatOfMessage` semantics — by the message's `castMemberId` when it has one and a seat of that form holds it, else by the card column as now — and judge by that seat's card owner exactly as now (`cp.persona?.userId` / `cc.character?.userId`; the non-guest rule unchanged). Keep `some(...)` semantics if several seats of that form match (e.g. a departed and a live seat on one card) — don't narrow to one seat unless the result is provably identical. Everything else in the function unchanged.
- `headerCastKeyOf` (~337–395): the character discs' `key` becomes `seatRefOf(cc, "character") ?? \`character:${cc.character.id}\``; persona discs keep `persona:<id>` (each-block keys must stay unique — a card can sit in both tables).
- `projectConversationDossier` line speaker (~628–633): `const ref = messageRefOf(session, m)`. Add `m.castMemberId` to the line cache key array (~605–622) so a re-stamped speaker re-projects.
- The scene-cast faces (`castOf`, ~698–725): for a member `b` (`b.id` is a cast member id, `b.characterId` its linked card), find `seatOfCastMember(session, b.id)`; the ref is that seat's `seatRefOf`, and the card face is `characterForRefIn(session, ref)`. When no seat holds `b.id`, ⏳ today's `character:<b.characterId>` (null when no card) as now.
- `fateOf` (~956–961): `const bag = castEntryOf(byId, ref)`; the rest unchanged.
Do not touch any other hunk.

## 3. `utils/messageSpeaker.ts`
- `messageSpeaker`: keep both branch conditions (`msg.personaId` → persona logic; `msg.characterId` → character logic) and everything they return, but find the seat with `seatOfMessage` (so a line stamped with a `castMemberId` reads the seat that holds that member, falling back to the card column). The envoy branch is unchanged. Add `castMemberId?` to the msg param type and the seat row types (`MessageSpeakerSource`) as optional structural fields.
- `seatPortraitOf` / `seatNameOf`: replace `Number(sender.slice(...))` + `find(p => p.id === seatId)` with `seatOfRef(session, sender)` restricted to player seats (keep the `startsWith("player-seat:")` guard only if dropping it would change a result; `seatOfRef` handles any form). `seatNameOf` keeps its `personaId == null` gate (S4 changes its meaning — note in report).
- `messageSpeaker.ts` imports from `projections/characters`; importing `seatIdentity.ts` from there is fine.

## 4. `roundWaiting.ts`
- `RoundSeat` gains optional `castMemberId?` and `ref?`; `RoundRow` gains `castMemberId?`.
- `refOf(s)` → `seatRefOf(s, "player")` (identical today).
- `speakerOf(m)`: the stamped `metadata.speaker` first (as now); else, when `m.castMemberId != null` and a seat in `opts.seats` holds that member, that seat's `seatRefOf(seat, "player")`; else ⏳ today's `character:<personaId>` / null. (`speakerOf` needs the seats: make it take them.)
- `fateOf` callers pass refs from `refOf`, unchanged.

## Tests (both shapes for each switched site)
Run from the app root, each file explicitly (never pipe into `head`):
`npx vitest run src/lib/client/components/sessionPage/projections/seatIdentity.test.ts src/lib/client/components/sessionPage/sessionPageProjections.seatMember.test.ts src/lib/client/components/sessionPage/sessionPageProjections.castNames.test.ts src/lib/client/components/sessionPage/personLineSeat.test.ts src/lib/client/components/sessionPage/roundWaiting.test.ts src/lib/client/utils/messageSpeaker.test.ts src/lib/client/components/sessionPage/pinnedImagesRetired.test.ts`
New cases: today's data gives byte-identical output (`seatCardIdOfRef`, `canControlMessageAs`, the dossier line `speaker.ref`, the scene-cast refs, `fateOf`/`roundWaitingFor`, `messageSpeaker`, `seatNameOf`, `seatPortraitOf`); S4 data (seat refs `seated-member:`/`player-seat:`, colliding ids) gives the member's seat. If testing the dossier line is heavy, test `messageRefOf` directly and one dossier-level case if an existing test already builds a dossier (look for one; don't build a large new harness).
Then `npx tsc --noEmit -p .` and report any error in your files (the old `arrangeCanvas.dom` error and other lanes' in-flight errors are not yours — list them separately). `npx prettier --check` on the two new files only (they must pass).

## Report (final message)
Changed files; each site → what it now reads; anything that still builds card form and why; tests run with counts; any existing test you had to edit and why; tsc result; assumptions; Noticed, not done (incl. S4 items such as the card-less-line branch and `seatNameOf`'s gate).
