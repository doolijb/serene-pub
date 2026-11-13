# BRIEF — lane `s4-chr-view`, worker w1 — the Characters read: shared-cards leg, row fields, tag search (2026-11-08)

Supervisor: lane `s4-chr-view` (brief `plans/briefs/BRIEF-s4-chr-view.md`). Repo `/home/jody/github/serene-pub`. Use absolute paths.

## Goal

The Characters view (one row per character: a card and its cast members, or one card-less cast member) is read by 🚧 `characterRowsPage` in `src/lib/server/cast/characterRows.ts`, types in `src/lib/shared/characters/characterRows.ts`. The view is about to stop reading the unpaged `characters:list`, so this read must carry everything the old list showed. Do:

1. **Shared-cards leg (regression guard, ★chr-read-3 ruled by the lead).** Cards other people shared with the asker (`sharedCharacterIdsFor(db, askerId)` in `src/lib/server/utils/shares.ts`) must be card rows even when they sit in no book the asker can read. Rules, matching what `buildCharactersList` in `src/lib/server/sockets/characters.ts` (~lines 350–380) does today for `characters:list`:
   - not deleted (`is_deleted = false`), not the asker's own (`user_id <> askerId`), never a hidden carrier card (`NOT genuineProvidedMarkSql()`, already imported);
   - listed whenever own cards are listed without a member (today `plan.ownCardsListed`, i.e. no lorebook/session filter); with a lorebook or session filter they appear only through the existing member rule (`hasMember`);
   - `favorites` / `personas` filters exclude them (those flags are the asker's own cards only); the `tags` filter applies to them (chr-read decided tags on any card row);
   - one row per card: a shared card that also has a member in a readable book is still ONE `card:<id>` row (it is one candidate in the `UNION ALL`; don't add a second branch row for the same card — widen the card branch's `WHERE`);
   - the row: `cardIsMine: false`, `isFavorite/isPersona/isDefaultPersona: false`, `folderId: null`, `embeddingModel: null`, **`isSharedWithMe: true`**, **`ownerName`** = the owner's `display_name || username || null` (the same expression `buildCharactersList` uses).
2. **New fields on `CharacterRow`** (shared file), each with ONE JSDoc sentence in the file's style:
   - `isSharedWithMe: boolean` — the card is shared with the asker by its owner (a share row); false on every other row. (Reuses the vocabulary of `MaybeSharedRow` in `src/lib/shared/utils/sharedRows.ts`, so the client can use `sharedFromLine`.)
   - `ownerName: string | null` — the owner's name on a shared card's row; null on every other row.
   - `isDefaultPersona: boolean` — the asker's own card is their default persona; false on every other row.
   - `embeddingModel: string | null` — the asker's own card's embedding model (the row's indexing badge); null on every other row.
   - `readableMember: { castMemberId: number; lorebookId: number } | null` — on a card row, one listed (non-overlay) cast member of it the asker may read: prefer one in a readable book (set A) over one in a story's notes (set S), then the lowest member id; null on a cast member's row and on a card row with no member in reach. (The view opens this member when the card itself can't be opened by the asker, and copies from it.)
3. **`q` matches tag names on card rows** too (the old list's search did): a card row matches when its stored name OR any of its tag names contains `q` (case-insensitive, same literal-escaping `likePattern`). Member rows unchanged (name only). Description search is NOT added (the lane reports it).
4. Leave the 🚧 `CHARACTER_ROWS_STALE_CURSOR` constant (already in the shared file; the server already uses it) as it is.

Read first: the whole of `src/lib/server/cast/characterRows.ts` (598 lines) and `src/lib/shared/characters/characterRows.ts`; `cardsNow` in `src/lib/server/cast/seatedCast.ts` (what it returns — you may need one extra batched select for `isDefaultPersona`, `embeddingModel`, owner names; never a per-row query); `src/lib/server/utils/shares.ts`; the existing tests `src/lib/server/cast/characterRows.int.test.ts` and `characterRows.storedNames.int.test.ts` for the fixture style; `src/lib/server/sockets/characterRows.ts` (unchanged by you).

## Files owned (edit only these)

- `src/lib/server/cast/characterRows.ts`
- `src/lib/shared/characters/characterRows.ts`
- `src/lib/server/cast/characterRows.int.test.ts` (extend) and a NEW `src/lib/server/cast/characterRows.sharedCards.int.test.ts`

## Files readable

Anything. Don't edit anything else; if another file must change (e.g. the frozen-column guard `src/lib/server/**/frozenColumns.guard*` flags a new column read, or `shared/conformance/socketEgress.test.ts`), stop and say exactly what in your report.

## Out of scope

The socket handler, the client, docs, NOMENCLATURE. No description search. No change to sort order or the cursor shape.

## Rules you must follow (quoted)

- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx`." "Never add a top-level `await` to `src/lib/server/db/index.ts`." The module header says: "⚠ Must not statically import `$lib/server/db`; every function takes its handle first." Keep it so.
- "It is a **session**, never a *chat*."
- NOMENCLATURE R1 one word one meaning; R3 qualify, never the bare noun; R6 mark 🚧 provisional. New field names above are decided by the supervisor — don't invent others; if you think you need another name, stop and ask in your report.
- Memory rule "There is ALWAYS a lorebook": never write copy or code comments framing a session as having no lorebook — say own book / session's notes / overlay.
- Hidden carrier cards (owner ★S4-1, 2026-11-08): a provided book's plugin-stamped cards are "hidden from every library, picker and search" — `genuineProvidedMarkSql()` must stay ANDed on every card leg.
- Permission matrix (plan §34.4): "never an admin's view of others' books". A shared card is visible because of its share row, nothing else.
- An int test that opens a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`.

## Tests (Done means)

- New `characterRows.sharedCards.int.test.ts`: a shared card appears as one card row with `cardIsMine:false`, `isSharedWithMe:true`, `ownerName`, flags off, `folderId:null`; not listed once the share is removed, once the card is deleted, or when it's a hidden carrier; one row (not two) when it also has a member in a readable book; excluded by `favorites`/`personas`; included by a matching `tags` filter; with a `lorebookId` filter only when it has a member there; keyset paging across a page boundary still yields each row once.
- In `characterRows.int.test.ts` (or the new file): `q` matches a card by a tag name; `isDefaultPersona`/`embeddingModel` set only on the asker's own card; `readableMember` prefers a readable-book member over a story-notes member and is null on member rows.
- Run, capped and logged (scratch dir `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad`):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/cast/characterRows.int.test.ts src/lib/server/cast/characterRows.sharedCards.int.test.ts src/lib/server/cast/characterRows.storedNames.int.test.ts src/lib/server/sockets/characterRows.interestGate.test.ts src/lib/shared/conformance/socketEgress.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w1-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-chr-view-w1-tests.log'`
  (`characterRows.storedNames.int.test.ts` has an expected `test.fails` — leave it.) Also run any `frozenColumns` guard test (`find src -name "*frozen*"`) the same way.
- `npx tsc --noEmit -p .` filtered to your files (`| grep characterRows`) shows nothing new. `npx prettier --check` on your files; only `--write` lines you changed.

## Verbatim rules

- *This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no sdk:build.)

## Report

In your final message: changed files, each decision you made (name it), tests run with pass/fail counts, anything you'd stop and ask about, Noticed-not-done.
