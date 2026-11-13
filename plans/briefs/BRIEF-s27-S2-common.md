# BRIEF s27-S2 common — the contract every S2 lane builds to (seat-cast programme, stage S2: readers to members)

Every S2 lane supervisor reads this file first, then its own lane brief.

## Read first
- `.claude/guides/multi-agent.md`.
- Plan `plans/PLAN-sdk-creation-seams-2026-10-30.md`: §26b, §27 and every bullet after it (rulings, v2 stages, the owner's user-POV direction: cast reads its active linked card by default, made visible; members own voice and sprites, own over card).
- `plans/REPORT-s27-S1-2026-11-05.md` (schema, the one seat writer) and `plans/REPORT-s27-S2core-2026-11-05.md` (**the readers you switch onto**, with the lead's dispositions at the end).
- `plans/briefs/INVENTORY-s27-S2-2026-11-05.md`: the card-reading sites, by lane. It is a starting list, not a boundary — grep your owned files for more.
- Memory `/home/jody/.claude/projects/-home-jody-github-serene-pub/memory/project_seat_cast_programme_2026_11_05.md` and `feedback_there_is_always_a_lorebook.md`.
- NOMENCLATURE §1, §24, §8 (cast member, retold), and the §25 rows for the seat writer, `memberAsRead`, `seatOf`, `seatedCastOf`.

## What S2 is
Stage S2 switches **readers** onto the seated cast member. It changes **no stored key and no stored data**. The key flip and the boot-pass rekey are S4; the SDK names are S3.

1. **What a seated character is** (name, shown name, retold text fields, greetings, example dialogues, face, voice, sprite sets) is read through `cast/memberAsRead.ts` (`membersAsRead` for a batch, `memberAsRead` for one) on the session's reading. When a seat has no member yet (`castMemberId` null), read the card as today.
   - **A seat reads the card it holds.** Pass `overCards` (member id → the seat's card id) so a dated card amendment doesn't move a seat's card with the story clock — today's `keepCard` rule (`state/entriesOnReading.ts` header). Only a reader that *draws* the member (sprites) follows the dated card; such a reader omits `overCards` and says so. Two seats on one member with different cards: read them in separate calls (`seatedCastOf` shows how).
   - **Seat sets keep today's queries.** Where your code selects seats (incl. departed seats with `removedAt`, as the next-speaker strategies and transcript names need), keep that query and only move the per-seat member lookup onto `membersAsRead`, keyed by each seat's `cast_member_id`. Use `seatedCastOf` only where the code means "live seats now". Existing ad-hoc overlays in your files (`retoldByCard`, `retoldMembersForSession`, card + `retold` merges, `cardMemberAt` name lookups) become calls to the one reader; delete an overlay helper only when your lane removed its last caller, and say so.
2. **Refs in, refs out.** Every parser in your files that accepts `character:<cardId>` also accepts 🚧 `seated-member:<memberId>`, resolved with `sessions/seats.ts` `seatOf` / `parseSeatRef`. Refs your code **emits** stay as today (`character:<cardId>` for a carded seat, `player-seat:<id>`) until S3/S4.
3. **Keys stay.** `session_cast:<cardId>` owners, `state.cast.byId[<cardId>]`, the turn order in the core annex, `turnTally`, speech Auto voice picks (`speechAutoVoice:<speakerRef>`), `rankings.speaker_ref`, `rewind_taken`, the sprite-set slot on the `session_cast` owner: **unchanged**. Do not rekey or rewrite them (S4 owns that).
4. **Payloads are additive.** App socket payloads and server-internal types that describe a seat or cast entry gain `castMemberId: number | null` where a reader on the other side needs it. **Do not change SDK types or objects handed to plugins** (`CastEntry`, `SessionCharacterV1`, `ParticipantRef`, …) — that is S3; no SDK edit, no `sdk:build`.
5. **Two live seats can share one member** until the next boot (import, branch, attach leave pairs). Resolve per seat, never per member; `seatOf` picks live, then lowest position, then lowest id.
6. **Behaviour stays the same for today's data — with one intended change.** The intended change (§27 B, under the owner's GO "Do all": "prompt/retold reads the seat's member in whichever book — ★26b-8 dissolves"): a seat's member is read **wherever it lives**, including the session's own book. Today the retold overlay reads only `sessions.lorebookId` (`lorebooks/retold.ts` ~252, `host.ts` ~4830), so own-book members' own names and retold text start reaching the prompt, greetings, stop strings and speaker names in sessions whose lorebook is their own book. Name every existing test that changes because of this, with the old and new value, in your report. Apart from that: A carded seat whose member has no voice or sprites of its own, and whose retold flags are what they were, must read exactly what it read before: the existing tests in your files stay green **unchanged** (a test you must edit is a finding — say why). New tests prove: member over card where the member has its own (name via `own_name`, a retold field, voice, sprite sets), a seat holding a dated card reading that card, a `seated-member:` ref accepted, and two seats on one member.
7. **The speaker stamp is S1's dual-write, not new data.** S1 added `messages.cast_member_id` / `session_messages.cast_member_id` (★27-7). A writer of a message spoken by a seat stamps `(await seatOf(db_or_tx, sessionId, speakerRef))?.castMemberId ?? null` — no new helper, no second writer rule.
8. **No migration, no SDK edit, no boot-pass change, no new setting, flag or event.** A new exported name goes in NOMENCLATURE §25 (R3: qualified) in the same change. Anything a user sees that changes — copy, a click target, a new line — is a ★ for the lead unless your lane brief says it is already ruled.
9. **Every session has a lorebook** — its own book (Session notes) or an overlay of a book. Never write "no book", "no lorebook", "bookless", "reads no lorebook" in code, comments, tests or copy; say "a session whose lorebook is its own book".

## Shared files
- `src/lib/server/sockets/sessions.ts` (≈10k lines) is edited by several lanes **by hunk** — each lane brief names its hunks. Re-read the hunk immediately before each edit; never reformat; never run prettier on it.
- `src/lib/server/pipelines/runtime/host.ts`: lane S2-promptText owns it except the sprite node hunk (~6347–6361), which lane S2-speechSprites owns.
- `src/lib/shared/sockets/types.ts`: additive edits by any lane, own types only.
- `NOMENCLATURE.md` §25: every lane adds rows. Re-read the section immediately before each edit; append rows, never reorder.
- The prompt files live under `src/lib/server/pipelines/prompt/` (there is no `src/lib/server/prompt/`).
- Files dirty at HEAD carry other lanes' uncommitted work: additive hunks, re-read before each edit.

## Rules (quote into every worker brief)
CLAUDE.md Principles/Decisions/Hard rules; NOMENCLATURE R1–R6, §24; `tx` only inside `db.transaction` (the outer `db` deadlocks PGlite); no static `$lib/server/db` import in modules tests mock (pass `db`); targeted tests only (your files' tests and the ones the lane brief names); never pipe vitest into `head`; 60 s timeouts on int tests that touch the DB; delete only your own `/tmp/serene-pub-vitest-*` dirs by name. Never write "no book"/"no lorebook".
Every implementation brief adds, verbatim:
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."*

## Done means
Tests green (the lane's files' existing tests unchanged, plus the new ones); `npx tsc --noEmit -p .` shows nothing in lane files. Full report in your hand-back (the lead saves it to `plans/REPORT-s27-<lane>-2026-11-05.md`): what switched (file → reader), what still reads the card and why, changed files, tests, §25 rows, open ★, **Noticed, not done** (incl. S4 rekey items you met).

## Helpers wave 1 built — wave 2 builds on these, never a second copy
- `cast/memberAsRead.ts` `membersAsRead` / `memberAsRead` (+ `overCards`), `cast/seatedCast.ts` `seatedCastOf`, `sessions/seats.ts` `seatOf` / `parseSeatRef` (S2core).
- `pipelines/prompt/seatCards.ts`: `seatCardAsRead`, `seatCardsAsRead(db, sessionId, rows)` (card-shaped rows filled from the seat's member, over the seat's card), `cardsAsSeatsRead`, ⏳ `cardFormRef(db, sessionId, ref)` / `cardFormRefInCast` (a `seated-member:` ref → the card form the keys still use) — s27-S2-promptText; lane s27-S2-pT2 is adding one find-only member rule in `seats.ts` underneath them (signatures unchanged).
- `state/seatRefs.ts`: `storedSeatRef(db, sessionId, ref)` / `storedSeatOwner` / `isSeatedMemberOwner` — the door that turns a `seated-member:` ref or `seated_member` owner into the stored form (s27-S2-state). `CastMemberLink.seatMemberId` = the seat's member (⚠ `castMemberId` there still means the attached book's member).
- `sprites/index.ts` `spriteLabelsForMembers` (s27-S2-speechSprites).
- `lorebooks/retold.ts` `retoldMembersForSession` callers in your files switch to `seatCards.ts`; `retoldByCard` / `applyRetold` have no non-test callers left (removal is S5).
