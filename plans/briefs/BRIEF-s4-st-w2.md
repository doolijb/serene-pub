# BRIEF s4-st-w2 — hidden carrier cards: one SQL hide predicate, applied to every card list, picker and search; docs (lane s4-st, wave 5) — 2026-11-08

Supervisor: lane `s4-st`. Repo `/home/jody/github/serene-pub`. Use absolute paths. Report in your final message (the harness may refuse report files): changed files, tests run with results, decisions, anything you could not do, Noticed-not-done.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You should not need `sdk:build`.)

**Prettier:** run `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file you didn't otherwise edit (a whole-file `--write` reflows code other work owns). If a file fails only on lines you didn't touch, leave it and say so.

## Owner rulings (quote, never reinterpret)

- 2026-11-08 ★S4-1: "the provided book keeps its plugin-stamped cards **hidden from every library, picker and search**, so the plugin-upgrade Update offer works; every starter copy is card-less; the hide rule is new work."
- 2026-11-05: "Plugins can only ship lorebooks as starters. They contain cast, not cards."
- The provided book's own members **stay linked** to their hidden cards (that is the carrier). Only **cards** are hidden, never members; reading a card **by id** (a session seat, `characters:get`, a member's words) is not a list and is untouched.
- Memory rule "There is ALWAYS a lorebook": never write copy that frames a session as having no lorebook.

## Goal

1. **Lift** `genuineProvidedMarkSql()` from `src/lib/server/cast/characterRows.ts` (~135–146, private today) into `src/lib/server/plugins/providedMarks.ts`, exported, **same name, same SQL body** (it reads `schema.characters.extensions` and `schema.characters.uuid` directly — keep that, the frozen-column guard keys on it). JSDoc: the SQL twin of `markedCharacter` (as `shownLorebook` is of `isDisabledProvidedBook`): TRUE when the card's `extensions.serenepub.provided` is a genuine mark (its own uuid); such a card is a provided book's hidden **carrier** card (★S4-1, 2026-11-08); every card list, picker and search reader ANDs `NOT genuineProvidedMarkSql()`; no one re-derives it; reads of one card by id don't use it. Place it beside `markedCharacter`.
2. **`cast/characterRows.ts`**: import it; delete the local copy. Nothing else in that file.
3. **`src/lib/server/characters/frozenColumns.guard.test.ts`**: the allowlist entry for `src/lib/server/cast/characterRows.ts` / `characters.extensions` / read moves to `src/lib/server/plugins/providedMarks.ts` (reason: `${PROVIDED_MARK} (\`genuineProvidedMarkSql\`: the one hide predicate for hidden carrier cards, ★S4-1)`). The guard is checked both ways: an entry no finding matches fails. Nothing else in that file.
4. **Apply the hide** (`sql\`NOT ${genuineProvidedMarkSql()}\`` in the where) to every card list / picker / search read — these, and only the hunks named:
   - `src/lib/server/sockets/characters.ts` `buildCharactersList` (~331): both the owned and the shared `db.query.characters.findMany` `where` callbacks. This one query feeds `characters:list`, so it covers the library, `CharacterSelectModal`, `PersonaSelectModal`, `StartSessionForm`, `CastWorkspace` and every other client picker. In the relational `where: (c, ops) =>` callback the root table renders as `"characters"`, so the predicate's `schema.characters.*` columns resolve — prove it in the test.
   - `src/lib/server/sockets/jump.ts` the character search (~350–380).
   - `src/lib/server/sockets/characterFolders.ts` `buildFoldersList` counts (~41–50), so a folder count matches what the list shows.
   - `src/lib/server/sockets/appletLibrary.ts` `runLibraryCharacters` (~113–140) — a plugin applet's view of the person's library.
   - `src/lib/server/conversations/store.ts` `askerCandidates` character branch (~1155–1175, the attach/share picker) and `person`'s list of the other person's characters (~1295–1320).
   Grep once more (`from(schema.characters)`, `query.characters.findMany`, `const K = schema.characters`) for any **other** reader that lists cards to a person and tell me in the report; do not edit files outside this list (`sockets/lorebooks.ts`, `sockets/state.ts`, `state/**` belong to another lane — name any hit there).
5. **Docs** (user-facing, plain words; read STYLE-GUIDE.md's copy rules section first: `grep -n "^## " STYLE-GUIDE.md`):
   - `docs/lorebooks.md` §Starter lorebooks: line ~249 says a book from a starter lorebook opens "with its cast's character cards made for you" → it brings the cast as cast members, with no character cards; to keep one as a character of your own, open the member and choose **Copy to my characters** (link `./characters.md#copy-a-cast-member-to-your-characters`). Check line ~250 (session from a starter) and ~257/263 for any other "cards" claim and correct it the same way. Line ~290 (**Duplicate**: "Character cards are shared, not copied") is about Duplicate, not starters — leave it.
   - `docs/getting-started.md`: the one place starters come up (~84, The Ninth Mile) — add at most one sentence only if it's needed to stay true; if nothing there claims cards come with a starter, leave the file and say so.
   - `docs/plugins.md` ~54 (provided books): one sentence — a book a plugin provides brings its people as cast members; the character cards that came with them stay hidden from every library, picker and search, and carry the plugin's updates to those members (the **Update** offer). Starting a lorebook or session from a starter never copies a card.
   Never say "chat"; say session. Never frame a session as having no lorebook.

## Files owned (edit only these, and only the hunks named)

`src/lib/server/plugins/providedMarks.ts`, `src/lib/server/cast/characterRows.ts` (the predicate switch), `src/lib/server/characters/frozenColumns.guard.test.ts` (the moved entry), `src/lib/server/sockets/characters.ts` (`buildCharactersList`), `src/lib/server/sockets/jump.ts` (character search), `src/lib/server/sockets/characterFolders.ts` (counts), `src/lib/server/sockets/appletLibrary.ts` (`runLibraryCharacters`), `src/lib/server/conversations/store.ts` (the two character reads), `docs/lorebooks.md`, `docs/getting-started.md`, `docs/plugins.md`, and a new test `src/lib/server/plugins/hiddenCarrierCards.int.test.ts` (plus edits to existing tests of those readers only if a fixture needs it).

**Another worker (w1) is editing** `lorebooks/starterKits.ts`, `cast/cardless.ts`, `lorebooks/tableRegistry.ts`, `plugins/providedPrimers.ts`, `sockets/starterKits.ts`, `sockets/sessions.ts` right now — don't touch them.

## Out of scope

Starters card-less (w1); any migration or cleanup of existing cards (★5: 0.6 starter-copied cards stay); hiding members; the Characters view UI; new names (the predicate keeps its existing name), new settings, events or copy beyond the doc sentences above.

## Stop and ask when

A hide would also hide something a person owns **and** uses beyond the carrier (e.g. a card with a genuine mark that is someone's default persona, or seated as a persona in a live session) — check `characters.is_default_persona` handling: if a hidden carrier card could be the asker's default persona, say so with a recommendation instead of guessing; a reader outside the list needs the hide; a new name seems needed.

## Hard rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx`. Never add a top-level `await` to `src/lib/server/db/index.ts`.
- Never `socket.off(event)` without its handler (not expected here).
- A DB-opening int test: `vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })`; mock `$lib/server/db` with `createTestDb` as `src/lib/server/lorebooks/starterKits.int.test.ts` does. Never pipe vitest into `head`.

## Done means

New `hiddenCarrierCards.int.test.ts`: an admin holds a provided book (`extra_json.provided` genuine) whose member is linked to a card with a **genuine** card mark (`extensions.serenepub.provided = { plugin, slug, version, uuid: <the card's own uuid> }`), plus an ordinary card, plus a card whose mark names **another** uuid (a re-import — must stay visible). Then:
- `buildCharactersList(admin)` leaves the carrier out and keeps the other two; the carrier shared with another user (`character_shares`) is left out of that user's list too;
- Jump search, folder counts (put the carrier in a folder), `runLibraryCharacters`, `askerCandidates`/`attachable` and `person` leave it out;
- `characterRowsPage` still leaves it out (existing chr-read tests; run them);
- the provided book's member still reads its words (name/description through `membersAsRead`) and stays linked (`character_id` = the carrier).

Also run: `src/lib/server/plugins/providedBooks.int.test.ts` (the plugin-upgrade **Update** offer, ~1311, must stay green), `src/lib/server/characters/frozenColumns.guard.test.ts`, the `characterRows` tests (`src/lib/server/cast/characterRows*.test.ts`), and existing tests of jump / characterFolders / appletLibrary / conversations that exist (find them with `ls`).

Run in a capped scope, logged (scratch in `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/`, names starting `s4-st-w2`):

```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub && npx vitest run <files> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-st-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-st-w2-tests.log'
```

Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0` with `NODE_OPTIONS=--max-old-space-size=8192` (baseline 0 errors; w1 is editing in parallel, so attribute any error to its file). Report counts.
