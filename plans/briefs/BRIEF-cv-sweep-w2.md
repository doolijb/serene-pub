# BRIEF cv-sweep-w2 — relational whole-card reads onto `cardsNow` / the member as read

Read `/home/jody/github/serene-pub/plans/briefs/BRIEF-cv-sweep-wcommon.md` first; its rules bind you.

## Goal
The relational `with: { character: true }` / `with: { persona: true }` reads (and the `lorebookBindings` whole-row reads) on the session path load whole `characters` rows — the ⏳ copies AND the frozen content columns (personality, scenario, firstMessage, alternateGreetings, exampleDialogues, postHistoryInstructions, strokes, extensions…), which nothing writes any more since S4, so they are **stale**. The static guard cannot see relational `with:` reads (its stated blind spot). Move every one listed below so that **card content comes from `cardsNow`** (the card as its current card version has it; `src/lib/server/cast/seatedCast.ts`) — and, where the read is a seat, from the member as read (the existing `seatCardsAsRead` layering over it). **Ids and library facts may stay** on the relational read (id, userId, isDeleted, folder, timestamps, relations such as `spriteSets`).

Owner ruling (2026-11-05), quoted: "Everything in session is cast -> active card." cv-readers (2026-11-06) moved every column-named read; these are the leftovers it listed: "Seats with a member are corrected by `seatCardsAsRead`. A seat with no member found would still read the stale frozen content."

## Files owned
- `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.ts` — ONLY the hunks at the sites below (it is a shared file; touch nothing else in it).
- `/home/jody/github/serene-pub/src/lib/server/sockets/pipelines.ts` — only `previewCastFor` (~5013).
- `/home/jody/github/serene-pub/src/lib/server/pipelines/runtime/dispatch.ts` — only `loadAdapterSession` (~417).
- New test file(s) you add for these (e.g. `/home/jody/github/serene-pub/src/lib/server/sockets/sessions.cardsNowReads.int.test.ts`), and existing tests of these three files only if an expectation must follow (stop and ask first — see below).

## The sites (line numbers approximate)
`sockets/sessions.ts`:
- ~378 / ~396 — the sessions list: `character` / `persona` with `columns: { id, name, avatarMediaId }` + `avatarMedia { uuid, rev }` (sent to the client).
- ~1740 / ~1759 — `getSessionFromDB` (client payload): full `persona` / `character` + `avatarMedia` + `spriteSets`.
- ~1913 / ~1922 / ~1931 / ~1968 / ~1976 — the prompt session (`getPromptSessionFromDb`): live seats' full rows, `lorebook.lorebookBindings.with.character`, and the removed seats (`removedSessionCharacters` / `removedSessionPersonas`).
- ~6637 / ~6776 — participant sync (`existingCCs` / `existingCPs`): reads `userId` and falls back to the card for `removedName`.
- ~7787 / ~7898 — reassign a removed participant: reads `userId` only.
- (~11106 already reads `columns: { userId: true }` — leave it.)
`sockets/pipelines.ts` ~5030 / ~5035 — `previewCastFor`.
`pipelines/runtime/dispatch.ts` ~422–424 — `loadAdapterSession`: `sessionCharacters.with.character`, `sessionPersonas.with.persona`, `lorebook.with.lorebookBindings: true` (whole binding rows — frozen binding columns included).

## How (decide the details; name your choices)
- Where only ids / library facts are read (sync, reassign): narrow the relational `columns` to what is read (e.g. `{ id: true, userId: true }`); a name fallback that read the card's copy reads the card from `cardsNow` (or the member as read when one exists, which `seatCardsAsRead` already gives).
- Where content is read or sent: keep the relational read to ids / library facts / relations, then attach the card from `cardsNow(db, ids)` — it returns the `characters` row shape, so readers and wire types keep working. Keep relations the payload sends (`spriteSets`); resolve `avatarMedia { uuid, rev }` from the `cardsNow` row's `avatarMediaId` (one `files` query for the set), not from the stale relation. The wire shape the client receives must not change.
- Seats keep going through `seatCardsAsRead` exactly as today (it layers the member as read over whatever card row it gets).
- For `lorebookBindings` (prompt session and adapter session): find who reads `session.lorebook.lorebookBindings` downstream and load only the binding columns they read — never the frozen binding columns — and card content via `cardsNow` (or the member as read: `membersAsRead` in `src/lib/server/cast/memberAsRead.ts`) if a reader needs a name or text. If a downstream reader needs a frozen column, STOP and report it.
- A small local helper per file is fine (e.g. "attach cards now"). Do NOT add exports to other modules or create new files besides tests.
- Soft-deleted cards: `cardsNow` reads them like any other (the copy reads never filtered them) — keep each site's existing null / deleted handling as it is.
- Mind query cost: one `cardsNow` call per read (two queries for any number of cards), never one per row.

## Tests (int tests: 60 s timeouts)
Add tests that pin the move, e.g.: a card given a new card version (`newCardVersion` / `updateCardVersion` from `characters/versions.ts`) whose frozen columns still hold OLD text — the prompt session / adapter session / `getSessionFromDB` / list read the new version's words (name, description, a greeting, post-history) for a seat with no cast member, and the member's words for a seat with one. Write the stale frozen value straight into the row in the test fixture to prove it is not read (tests are outside the guard's scope).
Run also the existing tests touching these paths: `sockets/sessions.listLastMessage.int.test.ts`, `sockets/sessions.updateKeepsTags.int.test.ts`, `pipelines/runtime/dispatch.int.test.ts`, `sockets/pipelines.previewRetrieval.int.test.ts`, `sockets/pipelines.previewRetrievalAdmin.int.test.ts`, `pipelines/prompt/seatCards.int.test.ts`, `pipelines/prompt/seatCards.test.ts`, `characters/frozenColumns.guard.test.ts`, and any `sockets/sessions.*.int.test.ts` whose name says reassign / participants / seatCast (find them with `ls`). All green.

## Out of scope (write down, never build)
`pipelines/runtime/host.ts` (lane cv-sdk), client files and docs (lane cv-client), any other relational read you find (report under Noticed), any change to what a user sees.

## Stop and ask when
An existing test expectation would change; a downstream reader needs a frozen column; the wire shape would change; you need a file not listed.

## Done means
Tests green, `tsc` clean on your files, prettier clean on your hunks. Report per the common brief.
