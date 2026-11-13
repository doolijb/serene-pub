# BRIEF — worker `s4-chr-read-w1` — the Characters view's read module (server, reads only) + its int tests — 2026-11-08

Supervisor: lane `s4-chr-read` (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §34.4). You build the read; worker w2 builds the socket around it in parallel, against the signature below — **do not change the signature or the shared types without saying so in your report**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

New `src/lib/server/cast/characterRows.ts` exporting exactly:

```ts
/** 🚧 A `characters:page` ask that can't be answered as sent (an out-of-date cursor). */
export class CharacterRowsRefusal extends Error {}

/** 🚧 One page of the Characters view's rows for `askerId` (plan §34.4). Reads only. */
export async function characterRowsPage(
	db: Db,
	askerId: number,
	ask: { cursor?: string | null; limit?: number; filters?: CharacterRowsFilters }
): Promise<{ rows: CharacterRow[]; nextCursor: string | null }>
```

Types are already written by the supervisor in `src/lib/shared/characters/characterRows.ts` (`CharacterRow`, `CharacterRowReach`, `CharacterRowsFilters`, `CHARACTER_ROWS_MAX_LIMIT` 100, `CHARACTER_ROWS_DEFAULT_LIMIT` 50) — read it first; every JSDoc there is the spec for that field. `Db` is a global type (see `cast/memberAsRead.ts`). **Must not statically import `$lib/server/db`**: every function takes its handle first (the rule in `memberAsRead.ts` / `seatedCast.ts`).

## What a row is (owner 2026-11-05, quoted: "the cast badge is probably redundant, any card that's been used will be a cast" → one badge, **Card**, plus a reach line)

- **Card row** — `rowKey` `card:<id>`: one card plus every cast member linked to it (`lorebook_bindings.character_id = card.id`) in books in the reach set. `hasCard` true, `cardId` set, `castMemberId` null. Name/summary/face come from the card's **current card version** via `cardsNow(db, ids)` (`cast/seatedCast.ts:65`) — never the ⏳ copy columns for display. `shownName` = the version's `name` (sorting uses the stored `characters.name`, which `characters/versions.ts writeCardCopies` keeps equal to the current version's name). `summary` = `characterSummary({ name, summary, creatorNotes, description })` from `$lib/shared/characters/characterSummary` on the cardsNow row. `face` from the version's `avatarMediaId` joined to `files` (`uuid`, `rev`, `frame`).
- **Cast member row** — `rowKey` `member:<id>`: a cast member that has no card the asker may see as a card row: `character_id` null, **or** its linked card is soft-deleted (`characters.is_deleted`), **or** its linked card is a hidden carrier card (below). `hasCard` false, `cardId` null, `castMemberId` set. Name/summary/face from `membersAsRead(db, ids)` (`cast/memberAsRead.ts:617`) with **no reading and no sessionId** = the book's present (Main at its head). `shownName` = `shownName`; `summary` = `characterSummary({ name, summary, description })` of the member as read; face from `faceMediaId`. A member absent from the membersAsRead map (no version — a logged error there) still gets its row from the stored row: `lorebook_bindings.name`, `summary` column, no face.
- A member with `overlay_of` set (an overlay of a parent book's member, in an own book) is **never its own row** — it is its parent's person. If linked to a card it still counts toward that card row's reach.
- `cardIsMine` = card row and `card.user_id = askerId`. `isFavorite`, `isPersona`, `folderId` = the card's own values **only when `cardIsMine`**, else false/false/null. `tags` = the card's tags (`character_tags` → `tags`: `{ name, colorPreset }`) on card rows; [] on member rows.
- `hasOwnWords`: a cast member has own words when `cardless` is true or its `followsCard` (from `membersAsRead`) has fewer entries than `RETOLD_FIELDS` (`$lib/shared/lorebooks/retold`). A member row: that member's value (a card-less member is always true). A card row: true when ANY listed member of it has own words; false otherwise (an unused card → false).

## Who may see what (the permission filter — never an administrator's view of anyone else's books)

Book sets, all with `shownLorebook()` ANDed (`plugins/providedMarks.ts:269`; hides a switched-off provided book):
- **A — readable books**: books the asker owns with `kind = 'book'` and `session_id IS NULL`; books shared with the asker (`lorebook_shares`, `utils/shares.ts sharedLorebookIdsFor`) with `kind = 'book'` and `session_id IS NULL`; live provided books (`providedBooksReadableBy(db, askerId)`, `plugins/providedMarks.ts:227`). Never `kind = 'starter_kit'`.
- **S — story notes**: own books (`lorebooks.session_id IS NOT NULL`) of sessions the asker owns (`sessions.user_id`) or is a guest of (`session_guests`). (The same membership `lorebooks/ownBook.ts ownBookAccessFor` checks; build it as one set query, not a call per book.)
- **Reach set R = A ∪ S, always.** `reach.lorebookCount` counts distinct books in R holding a cast member of the row (overlay members included for card rows); never a book outside R (no leak of a private book's existence). When the count is 1, `reach.lorebook` = that book's id and name, plus `sessionId` / `sessionName` (`sessions.name`, may be null) when it is an own book.
- **Listing set L** = A, plus S when `filters.inMyStories` is true. (Owner direction via §34.4: "Members kept only in one story's notes are behind an 'In my stories' filter by default (starter copies would otherwise flood the list)".)
- A **card row is listed** when the card is not soft-deleted, is not a hidden carrier, and (it is the asker's own card **or** it has a cast member in a book in L).
- A **member row is listed** when the member's book is in L (and it qualifies as a member row above).
- **Hidden carrier cards (owner ★S4-1, 2026-11-08: "provided books keep plugin-stamped cards hidden as the release carrier")**: a card whose `characters.extensions.serenepub.provided` is a genuine mark — `plugin` and `slug` are strings and `uuid` equals the card's own `uuid` (mirror `markedCharacter`, `plugins/providedMarks.ts:312`, exactly). It is never a card row — not even for its owner — and its members appear as member rows of their provided book. This must be a **SQL predicate** in the candidate query (paging depends on it). Reading `characters.extensions` is flagged by `src/lib/server/characters/frozenColumns.guard.test.ts` — **do not edit that guard** (not ours). Keep the read in ONE small named function in your file (e.g. `genuineProvidedMarkSql()`), with a comment naming the guard, and report the exact finding the guard prints; the supervisor queues the allowlist entry to the lead.

## Filters (`CharacterRowsFilters`; absent = no narrowing; a non-integer id narrows to nothing, never throws)

- `hasCard` true → card rows only; false → member rows only.
- `lorebookId` → rows with a cast member in that book; the book must be in R and, unless it is in S, in A (selecting a story's own book explicitly lists it even with `inMyStories` off). Not readable → empty page.
- `sessionId` → the asker must own or be a guest of that session, else empty page. Books = the session's own book ∪ `sessions.lorebook_id`, each kept only if in R; rows with a cast member in those books. (Selecting a story implies its notes are listed.)
- `follows` "card" → `hasOwnWords` false; "own" → true. Computed after the read (post-filter, see paging).
- `favorites` / `personas` → the asker's own cards with `is_favorite` / `is_persona` only (card rows only).
- `tags` → card rows whose card carries every named tag (case-insensitive name match). Implies card rows only.
- `q` → `lower(sort name) LIKE '%' || lower(q) || '%'` with `%`, `_` and `\` escaped; trimmed; empty = no narrowing.

## Paging — keyset on (lower(stored name), row key)

- One SQL query: a `UNION ALL` of card candidates (sort name `lower(characters.name)`, kind rank 0, id = card id) and member candidates (sort name `lower(lorebook_bindings.name)`, kind rank 1, id = member id), with the SQL-expressible filters applied, `ORDER BY sort_name COLLATE "C", kind_rank, id`, after the cursor with a row comparison `(sort_name COLLATE "C", kind_rank, id) > (…)`, `LIMIT n + 1`. One collation everywhere, so PGlite and the cursor always agree. Drizzle's `sql` template is fine for the union; keep table references through `schema.*` columns (the guards scan property access).
- Cursor: opaque string = base64url of JSON `{ n: sortName, k: rank, i: id }` of the last row the page **scanned** (not necessarily returned). A cursor that does not decode to exactly that shape → `throw new CharacterRowsRefusal("That page of characters is out of date. Ask for the first page again.")`.
- `limit`: integer clamped to 1…`CHARACTER_ROWS_MAX_LIMIT`; absent/invalid → `CHARACTER_ROWS_DEFAULT_LIMIT`.
- `follows` post-filter: read candidates in batches (`limit + 1`), build rows, drop non-matching, continue from the last scanned key until the page is full or the source is exhausted, at most 5 batches; then return what is held with `nextCursor` = the last scanned key (a short page with a cursor is allowed). Without `follows`, exactly one candidate query per page.
- `nextCursor` null only when the source is exhausted.
- Build row details for the page's rows only, batched: one `cardsNow`, one `membersAsRead` over every member the page needs (card rows' members for `hasOwnWords`, member rows themselves), one query each for tags, faces, reach counts, session names. No per-row query.

## Verify, by test, the stored names (lead's brief: "verify by test that `lorebook_bindings.name`/`character_id` track the book's present after the cv lanes — if not, stop and ask")

Write `characterRows.storedNames.int.test.ts`: through the real writers the app uses (find them: `characters/versions.ts` `insertCard`/`newCardVersion`/`insertCastMember`/`writeCastVersion`, `utils/characterBindingSync.ts`, the member edit path `writeMemberEdit` used by `sockets/lorebooks.ts`), assert after each write that `lorebook_bindings.name` equals `membersAsRead(db,[id]).get(id).shownName` and `lorebook_bindings.character_id` equals its `activeCardId`: card rename + sync; member own name/nickname edit; unlink; link; **a dated or branch cast version on Main that renames the member** (if the app has such a writer). **If any assertion fails, do not "fix" anything** — mark that test `test.fails(...)` with a one-line comment, keep going, and put the case first in your report: the supervisor stops and asks the lead.

## Tests — `src/lib/server/cast/characterRows.int.test.ts` (and the stored-names file)

Template: `cast/seatedCast.cardsNow.int.test.ts` (vi.mock of `$lib/server/db` with `createTestDb`, tmp data dir named `serene-pub-vitest-chrrows-…`, `releaseDataDir` in afterAll). An int test that opens a DB inside an `it` needs a 60 s timeout (`vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`). Cases (each its own `test`):
1. Permission matrix: own card listed; another user's private book's members and cards not listed; a `kind='book'` book shared with the asker → its members listed; a live provided book → its members listed **and its genuinely stamped card not a card row** (its member is a member row, `hasCard` false); a stamped card whose mark uuid is NOT its own uuid (a copy) IS a card row for its owner; an administrator asker does not see another user's private book; a guest of a session sees that session's own-book members only with `inMyStories: true`; a `starter_kit` book's members never.
2. One row for a card + its members: `reach.lorebookCount` 2 for a card in two readable books; 1 with `reach.lorebook` named; an unused own card → count 0, `lorebook` null; a card-less member → its own `member:` row with `reach.lorebook` its book (and `sessionId`/`sessionName` when an own book); a member linked to a soft-deleted card → member row; an overlay member → no row of its own.
3. Each filter: `hasCard` both ways, `lorebookId` (readable / unreadable), `sessionId` (member / non-member), `follows` both ways, `favorites`, `personas`, `tags`, `inMyStories`, `q` (incl. a `%` in the query matching literally).
4. Keyset: page through with `limit: 2` and collect every `rowKey` exactly once in `(lower(name), rank, id)` order; insert a card whose name sorts **before** the cursor and one **after** between two page reads → no row repeated, no row skipped among those that existed, the later insert appears; two rows with the same name tie-break by kind then id; a garbage cursor → `CharacterRowsRefusal`.
5. `cardIsMine`/flags: another user's card listed through a shared book has `cardIsMine` false, `isFavorite` false, `folderId` null even when its owner favourited it.

## Files owned (edit only these)

- `src/lib/server/cast/characterRows.ts` (new)
- `src/lib/server/cast/characterRows.int.test.ts` (new)
- `src/lib/server/cast/characterRows.storedNames.int.test.ts` (new)
- Read-only: everything else. `src/lib/shared/characters/characterRows.ts` is the supervisor's contract — if a field there can't be filled as specified, say so; do not edit it.

## Out of scope

Any socket, shared socket types, `interest.ts`, the egress test (worker w2). Any UI. Copy to my characters. Seating. Any change to another module (`memberAsRead.ts`, `seatedCast.ts`, `providedMarks.ts`, the guards, schema). No migration, no new setting.

## Rules you work under (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (You should need no transaction: reads only.) "Never add a top-level `await` to `src/lib/server/db/index.ts`."
- Frozen columns guard (`characters/frozenColumns.guard.test.ts`): no read of `characters` frozen content (aliases, summary, personality, scenario, firstMessage, alternateGreetings, exampleDialogues, groupOnlyGreetings, postHistoryInstructions, creatorNotes, creatorNotesMultilingual, strokes, extensions, characterVersion) nor `lorebook_bindings` frozen columns (description, personality, scenario, firstMessage, alternateGreetings, exampleDialogues, faceMediaId, retold, ownName, ownNickname, timbre, spriteSet, nodeState, nodeVisibility). `characters.name` and `lorebook_bindings.name` / `summary` / `character_id` / `overlay_of` are fine to read here (`cast/` is not a session-path dir). The one expected finding is the carrier predicate's `characters.extensions` read (above). ⚠ `lorebook_bindings.summary` is NOT frozen; `characters.summary` IS — card summaries come from `cardsNow`.
- NOMENCLATURE R1 one word one meaning; R3 qualify, never the bare noun. **No new exported names beyond `characterRowsPage` and `CharacterRowsRefusal`**; internal helpers are file-private. Mark both 🚧 in JSDoc. It is a **session**, never a chat. Owner rule "There is ALWAYS a lorebook": never write a comment, name or string that frames a session as having no lorebook — say own book / notes / overlay.
- Owner ruling 2026-11-05 (★27-10): "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable."
- pl3 (owner 2026-11-05): "Sharing a lorebook doesn't make it useable, but clone able." — a shared book's members are LISTED (reading), nothing here makes it attachable.
- Decisions: decide implementation inside your files and name each choice in your report. Anything the spec above doesn't settle that a user would see (a row's wording, which rows appear) → stop, write it as a ★ question with one recommendation, and build the rest.
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Prettier: run `npx prettier --check` on your files; `--write` only your new files.
- Never `kill -9` anything. Never `git checkout`/`restore`/`stash`.

## Tests — how to run (capped scope, logged; never pipe vitest into `head`)

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/cast/characterRows.int.test.ts src/lib/server/cast/characterRows.storedNames.int.test.ts src/lib/server/characters/frozenColumns.guard.test.ts src/lib/server/characters/versionsWriter.guard.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-read-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-read-w1-tests.log'
```
Then `npx tsc --noEmit -p .` is the supervisor's; you may run `npx tsc --noEmit -p . 2>&1 | grep characterRows` under a 12G scope (`systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'`) to check only your files.

## Done means

Both int files green (bar a `test.fails` stored-names case, reported), the frozen guard showing only the one expected `characters.extensions` finding in your file, the writer guard green, no tsc error in your files, prettier clean on your files.

## Report (your final message — no report file)

Changed files; tests run with pass/fail counts; the guard's exact finding text; the stored-names result case by case; each implementation choice you made; any ★ question; Noticed, not done.
