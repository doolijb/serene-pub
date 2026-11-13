# BRIEF s4-on-w1 — NOMENCLATURE merge for the S4 flip unit (2026-11-08)

Supervisor: lane `s4-on`. You edit **one file**: `/home/jody/github/serene-pub/NOMENCLATURE.md`. Nothing else.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*
(You run no tests and no builds: this is a docs-only task. Never `git checkout`/`restore` anything.)

## Goal

Merge every NOMENCLATURE row the S4 flip-unit lanes queued, as listed below, into `NOMENCLATURE.md`. The words already exist in code — you are recording them, not inventing names. Do not add any name not listed here.

## Rules you must follow (quoted from NOMENCLATURE.md and CLAUDE.md)

- "**R1 — One word, one meaning.** Where a word is already load-bearing in one place, the _other_ use renames. Not both."
- "**R6** — Mark anything impermanent ⏳ transitional or 🚧 provisional — so it can be pruned rather than accumulate."
- "A change that renames a concept updates this file **in the same change**." "The change ledger (§25) tracks renames…"
- §24 step 5: "Say what it is **not**, in the declaration, if a near-neighbour exists."
- CLAUDE.md: "It is a **session**, never a *chat*." Memory rule: never write that a session has "no lorebook" — say own book / overlay.
- Every row queued 🚧 stays 🚧 (and ⏳ where the queue says so). Mark each new row with its lane and date: "lane s4-<x>, 2026-11-08".
- **Read by line range** (`sed -n 'A,Bp'`, `grep -n`), never the whole file (3,700 lines, very long table rows). Edit with the Edit tool or a small Python replace that asserts the old text occurs exactly once.

## Where rows go (follow what the lead already did for s4-ner / s4-cl / s4-f-sdk)

- The seat-cast rows live in the big table inside **§25 Change ledger**, roughly lines 3280–3380 (format: `| Was | Now (bold 🚧 name + charter text) | Ruling / lane, date |`). Look at line ~3297 (`storedSeatRef` row), ~3322 (`SeatRefOfMember`), ~3376 (s4-ner `cast_member` row) for shape. New table rows go **after line ~3376** (after the s4-ner row), one row per item below, in the order given.
- The dated bullets at the very end of the file (lines ~3717–3719: s4-bk-lock, s4-f-sdk, s4-cl) — add one bullet per lane at the end, same style: `- **2026-11-08 (lane s4-f-door — …; plan §34.1).** … Merged by lane s4-on.`

## Rows to merge

### A. From s4-f-door (`plans/REPORT-s4-f-door-2026-11-08.md` — read its "NOMENCLATURE rows queued" and "Translator" lines)
1. New row 🚧 ⏳ **`memberFormSwitch`** · **`memberFormOn()`** (`src/lib/server/state/memberForm.ts`): the flip's one switch point. Off = card form stored/emitted and doors translate member form in to card form; on = member form (`seated_member:<castMemberId>` / `seated-member:<id>` for a character seat, `player_seat:<seatId>` / `player-seat:<id>` for every player seat, carded or not) and doors translate card form in to member form. **On from 2026-11-08 (lane s4-on); removed in S5.** A leaf module; tests may set `.on` and restore it.
2. New row 🚧 **`SeatMap`** · **`SeatMapSeat`** · **`seatMapOf`** · **`loadSeatMap`** · **`memberFormOf`** · **`memberFormTargetsOf`** (`state/seatRefs.ts`): the one card-form → member-form translator (★K-1/★K-2), shared by the `seat-keys` pass and every runtime door. `memberFormOf(map, ref|owner|key)` → one designation (null when no seat answers); `memberFormTargetsOf` → every seat holding the card (★K-2 copies values to each). ⚠ Not `seatOf` (a ref to its seat). `StateOwnerOrSeated` removed (`StateOwner` now includes `seated_member`).
3. New row 🚧 **`castOwnerOf`** (`state/owners.ts`) · 🚧 **`castLinkKey`** (`state/keys.ts`): the stored owner / the byId key of a cast link (`castMemberKey` of its entry; a link's own `castMemberId` is the attached book's member, the seat's is `seatMemberId`).
4. New row 🚧 ⏳ **`CastMemberLink.playerSeatId`** (`state/resolve.ts`): when on, a carded player seat stays in `links.cast` as its own link (one per seat, ★K-2) carrying its seat id; byId keys it `player_seat:<id>`.
5. New row 🚧 **`restoredInMemberForm`** (`state/write.ts`) and 🚧 **`tallyInMemberForm`** (`sessions/rewind.ts` or where `grep -rn tallyInMemberForm src` finds it): restore paths translate card-form rows/tallies to member form (a failed session, a pre-flip backup).
6. **Fix stale row ~l.3287** (owner kinds in five CHECKs): replace "CHECK only — no writer or TypeScript union yet (S3/S4)." with a sentence saying: `seated_member` is now in `OwnerKind` (`state/owners.ts` `OWNER_KINDS`) and written from the flip (2026-11-08, `memberFormSwitch` on; s4-f-door / s4-on); `session_cast` stays in the CHECKs until S5.
7. **Fix stale row ~l.3297** (`storedSeatRef` door): its "**no row is ever written under `seated_member` in S2** (`assertSessionOwner` refuses the kind)" is now true only while the switch is off. Add: "🚧 From the flip (on 2026-11-08) the doors invert: a card form that comes in (`character:<cardId>`, `{session_cast, <cardId>}`) is stored as its seat's member form through `memberFormOf`, and a `seated-member:` ref of a member seated only in a player seat as that seat's `player-seat:<id>`; a card-form input the translator can't answer comes back unchanged (a member-less character seat keeps card form until S5; ★f-emit-2, applied by s4-on). `assertSessionOwner` accepts `seated_member` when on." Keep the rest of the row. Change "Expires (⏳ in effect) when S4 keys values by member" to "Kept until S5 (plugins, Mundi's `cardRef` fallback, old tabs)".
8. End bullet: "s4-f-door 2026-11-08: member-form switch, translator, inverted doors, state/rulesets readers and writers ready for `seated_member`."

### B. From s4-f-pass (`plans/REPORT-s4-f-pass-2026-11-08.md` — read "NOMENCLATURE rows queued" and "Pass:")
1. In the **seat writer** row (~l.3288, `sessions/seats.ts` `seatCast`…): replace the text "else none yet — S1 never mints into the own book (…)" (find the exact wording with grep; the parenthesis content may vary) with "else a new one in the own book (★B-5, 2026-11-08: the book is fixed at start, so an own-book member may count as play; s4-f-pass)".
2. In the **`seat-members`** row (~l.3289): add "Since ★B-5 (2026-11-08) a live carded seat of a session with an own book is also a candidate: the own book takes a new member for a live card (s4-f-pass)."
3. New row ⏳ 🚧 **`seat-keys`** boot pass (`sessions/seatKeys.ts`: `seatKeys(db)`, `SeatKeysReport` `{ sessions, rekeyed (per store), copied, dropped, left, failed }`, `SEAT_KEY_STORES`, `SeatKeyStore`): after `seat-members` and `character-versions`, before `plugins` (`startup/index.ts`, **in startup from 2026-11-08, lane s4-on**); `failsHealth`; one transaction per session; moves every carded seat's stored keys from card form to member form over 15 stores (attribute_values, attribute_configs, zone_contents, owner_sheets, attribute_carries, state_proposals, zone_towards, annex_core, annex_audiences, genre_fields, widget_settings, message_speakers, message_blocks, rewind_taken, annex_deltas); values/who-may-see copied to every seat holding the card (★K-2), a designation to one seat; only exact `character:\d+` strings translated. **Left** in card form (★K-3): genre presets' widgetSettings, `lorebooks.annex_audiences`, `rankings.speaker_ref`, receipts' portrayals, `session_changes.payload`, Mundi annex, other plugins' delta documents. A second boot changes nothing; a restored backup reruns it. Lives until S5. ⚠ Not `seat-members` (gives seats their member).
4. End bullet: "2026-11-08 (lane s4-f-pass, plan §34.1, ★B-5/K-2/K-3/K-4 as ruled): own-book mint in `resolveSeatMember` (supersedes S1's 'never mints into the own book'); ⏳🚧 `seat-keys` boot pass (`seatKeys`, `SeatKeysReport`, `SEAT_KEY_STORES`), in startup from the turn-on (lane s4-on)."

### C. From s4-f-client (`plans/REPORT-s4-f-client-2026-11-08.md`)
1. New row 🚧 **`participantForRefIn(session, ref)`** (`client/…/sessionPage/sessionPageProjections.ts` — grep for the path): the name and face `sp-avatar` and the turn line draw for a participant ref, by the seat the ref names (never by card id); a player seat on a card by the header's persona rule, a card-less player seat by its seat name and portrait (★S3W-1). `headerCastKeyOf`'s second argument is now the head's ref.
2. **Amend the s27-S3W row (~l.3319**, "the session page built `character:<id>` / `player-seat:<id>` from card ids in a dozen places…"): add one sentence: "From s4-f-client (2026-11-08): `seatOfMessage` — a narrator line names nothing; a stamped `metadata.speaker` naming a seat wins (character or player seat); else the line's form (`personaId` → player seat, `characterId` → character seat, else `role`) with its `castMemberId`; ⏳ the card column last. `messageRefOf` returns the found seat's ref for every line (a card-less player line → `player-seat:<id>`, ★S3W-1). `attendance.v1` `personaRefs` include card-less player seats (★S3W-3)."
3. End bullet for s4-f-client.

### D. From s4-f-emit (`plans/REPORT-s4-f-emit-2026-11-08.md` — "NOMENCLATURE rows queued" and "Built")
1. New row 🚧 ⏳ **`hostSeatRefOf(seat)`** (`pipelines/prompt/seatCards.ts`): the one emit rule — on → `player-seat:<seatId>` / `seated-member:<castMemberId>` / ⏳ `character:<card>` when member-less; off → card form. ⚠ Not the client's `seatRefOf`. Until S5.
2. New row 🚧 ⏳ **`storedSeatRefInCast(cast, ref)`** (`pipelines/prompt/seatCards.ts`): the in-hand door (from a cast read, no db) — `storedSeatRef`'s rule over a `session_cast` read; `cardFormRefInCast` stays for card-id parsers until S5.
3. **Amend `SeatRefOfMember` row (~l.3322):** `SeatRefOfMember` is now `(castMemberId, seatKind?)` — the kind ranks first (character-seat → character seats first; player-seat → player seats first; the other list falls back).
4. **Amend** wherever `CastOwner` is described (grep; if no row, put it in the hostSeatRefOf row): `CastOwner` (`runtime/bindings.state.ts`) widened to `seated_member`.
5. **Amend** the `session_cast` read row (~l.3321, "the app's server handed plugins and widgets seat identity only as card ids…"): its `lorebookBindings[]` rows gain `id` and `cardDeleted`.
6. **Speaker stamp:** amend the row that records the speaker stamp / `messages.cast_member_id` writer (~l.3286 or ~l.3309 — grep `castMemberId` on messages / `speakerSeatOf`): when on, the stamp also writes `metadata.speaker` (★TIDY-2 settled at S4) by one rule `speakerSeatOf` (`messages/store.ts`; a persona line → its player seat, never a character seat); `restampSpeakers` re-stamps both; `speakerRefOf(row)` (`messages/sessionChanges.ts`) reads the stamp.
7. **s4-ner row (~l.3376):** its tail "Not yet: retrieval's `castEntityRefs` (★s4-ner-2)." → "`castEntityRefs` (retrieval) emits `cast_member:<id>` for roster members with no live card too (★s4-ner-2, lane s4-f-emit, 2026-11-08)."
8. **§23 / `LibraryNeed`:** grep `LIBRARY_NEEDS` / `lorebooks-into-sessions` in NOMENCLATURE; if a row names `"lorebooks-into-sessions"`, mark it removed (2026-11-08, s4-f-emit, with ★B-4's removal) and `"sessions"` ⏳ (goes with ★f-sdk-4 in S5). If no row exists, add one line to §23 in the style of the `core:outlet/attach-lorebook@1` row (~l.1534): library need `"lorebooks-into-sessions"` removed in 0.6 with `attach-lorebook@1`; `"sessions"` ⏳ until S5.
9. **Do NOT add** a row for turn candidates' `castMemberId` (★f-emit-1 is unruled). Instead add exactly one line inside the hostSeatRefOf row or the s4-f-emit end bullet: "⏳ Turn-pool candidates carry `castMemberId` in the annex (`turnOrder.candidates`) from the flip, pending the owner's ★f-emit-1 (no SDK type or canon row yet)."
10. End bullet: "s4-f-emit 2026-11-08: core emits member form behind `memberFormSwitch` (one rule `hostSeatRefOf`; in-hand door `storedSeatRefInCast`; speaker stamp one rule, ★TIDY-2 settled); ★K-2 durable filing by character seat (★f-emit-3, rec keep); `castEntityRefs` emits `cast_member:`."

### E. From s4-chr-read (`plans/REPORT-s4-chr-read-2026-11-08.md`)
1. New row 🚧 **`characters:page`** socket (`{ cursor, limit, filters, requestId }` → `{ rows, nextCursor, requestId }` to the asking socket only; errors `characters:page:error` with `requestId`; in `GATED_EVENTS`, not scoped, never pushed). ⚠ Not `characters:list` (the unpaged card list). 🚧 **`characterRowsPage(db, askerId, {cursor, limit, filters})`** · 🚧 **`CharacterRowsRefusal`** (`server/cast/characterRows.ts`, reads only) · 🚧 **`charactersPage`** · **`registerCharacterRowsHandlers`** (`server/sockets/characterRows.ts`) · 🚧 **`CharacterRow`** · **`CharacterRowReach`** · **`CharacterRowsFilters`** · `CHARACTER_ROWS_MAX_LIMIT` (100) · `CHARACTER_ROWS_DEFAULT_LIMIT` (50) (`shared/characters/characterRows.ts`). One row per character: `card:<id>` (a card and its members in reach) or `member:<id>` (a member with no visible card); filter `hasOwnWords` (⚠ not `follows`, which is `MemberAsRead.follows` — R1). Two error sentences are ★chr-read-2 (open, rec keep): _"That page of characters is out of date. Ask for the first page again."_ and _"Couldn't load the characters."_ Lane s4-chr-read, 2026-11-08.
2. End bullet for s4-chr-read.

### F. The turn-on itself (lane s4-on)
End bullet: "2026-11-08 (lane s4-on — S4 wave 3 turn-on; plan §34.1/§34.5): `memberFormSwitch` on; `seat-keys` in startup after `character-versions`; the doors pass an untranslatable card form through unchanged (★f-emit-2); `withinEarshot`'s holder is the speaker's own `state.cast.byId` entry (`castMemberKey`), so a voice hears its own holder-only values in member form; SDK `sessionCharacters[]/sessionPersonas[].ref` JSDoc says the member form. Rows from s4-f-door, s4-f-pass, s4-f-client, s4-f-emit and s4-chr-read merged."

## Done means

- Every item A1–F above is in the file (or, for an "amend", the old row edited) — and nothing else changed. `git diff --stat NOMENCLATURE.md` shows only additions/edits near the lines named plus the end bullets.
- No row says a session has "no lorebook"; no "chat" for session.
- `grep -c "s4-on" NOMENCLATURE.md` ≥ 2.

## Stop and ask when

A row you're told to amend doesn't exist or reads differently from what's described (say what you found, with line numbers, and skip it); an item would need a name not listed here.

## Report

Return in your final message: each item A1–F with the line number it landed on (or "skipped: why"), and anything noticed but not done.
