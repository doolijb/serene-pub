# BRIEF m3b-D-w2 — server: the book seats its cast at `sessions:create`; no binding rows into a provided book

Lane m3b-D (supervisor reads your report). Work in `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You do not need to build: the supervisor builds the SDK once. Until then the built SDK type lacks `castFromLorebook`; read it through a narrow local cast, see below.)

## Goal (owner rulings 2026-11-05, plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §23)
Ruling ★M3-4 "The book seats its cast, genre-declared": a genre declares that attaching the lorebook seats its cast members as the session's characters, whoever owns the cards; reading follows the book's pub-wide access; off for every other genre. The SDK declaration (lane worker w1, same time) is
`SessionShape.castFromLorebook?: { field?: string }` — `field` names a declared boolean field of the genre's shape that switches it per session; absent `field` = always for that genre. The shape reaches the server whole (`mode.shape` from `getSessionGenre`, stored from the genre's spec document).
Contract text (§23): "Server `sessions:create` ONLY (at create, as the ruling says; never on update/attach): when the genre declares `castFromLorebook` and its switch field is true (or absent) and a book is attached, core seats the book's cast members as `sessionCharacters` — **never a persona card, and for a provided book only its provided-marked cards** (`ProvidedCharacterMark`) — the ownership check skipped for exactly those rows (the book must be readable by the person: `lorebookAccessFor` ≠ none); the person's own picks still pass today's check. **The binding check (`runLorebookBindingCheck`) adds no members to a provided book for anyone, the enabling admin included** (today it would mint the admin's new persona into the pub-wide book and seat it in everyone's later games). Nothing happens for a genre without the declaration. No ledger row."

## Items
1. **`src/lib/shared/sockets/types.ts`** — the `sessions:genres` row's inline `shape` (~line 6620, beside `applet?: true` / `creationMode?`): add `castFromLorebook?: { field?: string }` with a one-line 🚧 doc "(SDK `SessionShape.castFromLorebook`, M3b): the attached lorebook seats its cast at create; `field` is the switch". The handler already sends `shape` whole (`genreRowFor` spreads the genre row) — confirm, change nothing there.

2. **`src/lib/server/sockets/sessions.ts`, `sessionsCreateHandler`** (~667–1530). Additive hunks; re-read the file right before editing (another programme edits it); never reformat.
   a. In the `if (mode) { … }` block (~943) capture into outer `let`s declared beside `declaredFieldKeys` (~905): the declaration `(mode.shape as { castFromLorebook?: { field?: string } }).castFromLorebook ?? null`, the `floored` shape and `mode.name`/`mode.shape.fields` as needed.
   b. After the genre-field filter (`genreFields = Object.fromEntries(...)`, ~1033) and before the rulesets block: compute the **seated cast** (`let seatedCast: number[] = []`) with a NEW helper (below) when: the declaration is present AND the switch is on AND `sessionDataWithoutTags.lorebookId != null` (the book the person chose — for `new-world` that is the source the copy is made from; same cards). The switch: no `field` → on; else the stored value `genreFields[field]`, falling back to the declared field's `default`; on only when `=== true` (P1: unset and no default = off).
   c. If `seatedCast.length`: re-run `shapeViolations(floored, { characters: characterIds.length + seatedCast.length, personas: personaIds.length, hasLorebook: true })` and on violations `return refuse(\`This session does not fit '${genreName}': ${violations.join("; ")}.\`)` — the same sentence the existing check uses (~935). No new copy.
   d. `isGroup: characterIds.length > 1` (~1236) → count the seated cast too (`characterIds.length + seatedCast.length > 1`). This is the only existing line you change.
   e. After the "Batch insert characters" block (~1307), a separate insert of the seated rows: `{ sessionId, characterId, position }`, positions continuing after the picked ones (`max(picked positions) + 1 + i`, or `i` when none were picked), in book order. Before `runLorebookBindingCheck` (it already runs after; the seated cards are already members so it mints nothing for them).
   f. No ownership check for the seated ids (they are computed server-side from the book, never taken from the request). The request's own `characterIds`/`personaIds` keep today's `checkCharactersOwnership`/`checkPersonasOwnership` unchanged.
3. **New helper `src/lib/server/sessions/seatBookCast.ts`** — `export async function bookCastToSeat(db: Db, { lorebookId, userId, isAdmin, exclude }: { lorebookId: number; userId: number; isAdmin: boolean; exclude: ReadonlySet<number> }): Promise<number[]>` (the module/function names are the supervisor's; keep them). Must not statically import `$lib/server/db` (take the handle). Logic:
   - read the book (`uuid`, `extraJson`); `const mark = markedBook(extraJson, uuid)` (`plugins/providedMarks.ts`);
   - access: a provided book (`mark` non-null) seats only when `(await providedBooksReadableBy(db, userId, [lorebookId])).has(lorebookId)` (a disabled or ownerless provided book seats nothing — for the admin owner too); any other book only when `lorebookAccessFor(lorebookId, userId, { db, isAdmin }) !== null` (`utils/ownedBook.ts`). No access → `[]`.
   - members in the book's order: `castMemberCards(db, lorebookId).cardsOf` (`utils/castMemberCards.ts`; insertion order = linked members by binding id ascending, then dated-only members); per member its FIRST card (the linked card when there is one).
   - one read of those cards (`id`, `isPersona`, `uuid`, `extensions`); drop: `isPersona` cards; for a provided book any card whose `markedCharacter(extensions, uuid)?.plugin !== mark.plugin`; ids in `exclude` (the request's characterIds AND personaIds); duplicates.
   - return the ids in order. Doc comment cites the ruling (owner 2026-11-05, ★M3-4) and P1 (only a genre's declaration calls it).
4. **`runLorebookBindingCheck`** (sessions.ts ~5544): right after the existing ownership gate (`if (!sessionRow || !(await findOwnedBook(...))) return`, ~5557), add: read the book's `uuid`/`extraJson`; if `markedBook(...)` is non-null → return (no member rows into a provided book for anyone, the enabling admin included; the book's cast is the plugin's and changes only through its write mode). Comment cites §23 and the challenger finding. Keep `findOwnedBook` gate as is.

## Tests (new file `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts`)
Model the fixture on `src/lib/server/plugins/providedBooksPubWide.int.test.ts` (db mock, `releaseDataDir`, temp dir named `serene-pub-vitest-cast-from-book-…`, the handler `call` pattern ~81/168) and publish two test genres the way `src/lib/server/sockets/sessions.turnControlPresence.int.test.ts` `publishModesGenre` does (~61–115; `genre(...)` + `compile(spec(...))` + `saveDocument(..., { publish: true })`): one with
`shape: { characters: { min: 0 }, personas: { min: 0, max: 1 }, lorebook: 'optional', composer: 'text', voice: 'narrator', greeting: { enabled: false }, fields: { examples: { type: 'boolean', label: { en: 'Examples' }, default: true } }, castFromLorebook: { field: 'examples' } }` (as any), and one identical without `castFromLorebook`. Make a provided book owned by the admin the way the pub-wide test does (find its helper for a plugin's/marked book and provided-marked cards; the card mark is `characters.extensions.serenepub.provided = { plugin, slug, version, uuid: <card uuid> }`, see `markedCharacter`). Its members: two provided-marked cards, one admin persona card (`isPersona: true`), one admin plain card with no mark. `vi.setConfig({ testTimeout: 60_000 … })`.
Cases:
- admin creates on the declared genre with the provided book: exactly the two provided-marked cards are seated, in book order; persona and unmarked cards not seated;
- a member (not admin) the same: the same two admin-owned cards seated; create not refused;
- switch off (`genreFields: { examples: false }`) seats none; genre without the declaration seats none; no book attached seats none;
- a picked character that is also a member is seated once;
- **the admin starts two games each with a NEW persona (insert an `isPersona` card per game, pass `personaIds`): the second game seats neither the first persona nor any new card, and the provided book's `lorebook_bindings` row count is unchanged after both creates**;
- the binding gate: the admin attaching the provided book on `sessions:update` to a session with one of the admin's own characters seated adds no binding row;
- an own (non-provided) book on the declared genre seats its non-persona members (cards owned by the person).
Then run, each with `npx vitest run <files>` (never pipe into `head`; no `npm test`):
`src/lib/server/sockets/sessions.castFromLorebook.int.test.ts src/lib/server/sockets/sessions.castBindings.int.test.ts src/lib/server/sockets/sessions.ownBookCreate.int.test.ts src/lib/server/plugins/providedBooksPubWide.int.test.ts src/lib/server/plugins/providedBooks.int.test.ts src/lib/server/sockets/sessions.creationModes.int.test.ts`
and `npx tsc --noEmit -p .` filtered to your files (`2>&1 | grep -E "seatBookCast|castFromLorebook|sockets/sessions.ts|sockets/types.ts"`). Delete only your own temp dirs by name. `npx prettier --check` on new files.
Also check: does the `sessions:create` reply / `sessions:get` list the seated cards for a member whose cards are admin-owned? If some read filters session characters by the card's owner, report the file:line — do not fix it.

## Rules (CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (Do your seating reads OUTSIDE the create transaction, before it.)
- "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing." (You add no event.)
- "P1 Deterministic, never hidden … A *new* automatic behaviour is **off in core until a genre opts in**." "P2 … A module owns its data and every write to it."
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'." No new setting, no migration, no new socket event, no ledger row. Not on `sessions:update` or attach.
- NOMENCLATURE R3/§24: the only new names are `bookCastToSeat`, `seatBookCast.ts`, `seatedCast` (local). Anything else new → stop and say so.
- Re-read a shared file immediately before every edit; additive hunks; never reformat.

## Files owned
`src/lib/server/sockets/sessions.ts` (the hunks above only), `src/lib/server/sessions/seatBookCast.ts` (new), `src/lib/shared/sockets/types.ts` (that one field), `src/lib/server/sockets/sessions.castFromLorebook.int.test.ts` (new). Readable: everything.

## Out of scope
Client files; the SDK; `sessions:update`/attach seating; persona creation on the server; any other door.

## Stop and ask when
A rule above can't be met; an existing listed test goes red for a reason you can't trace to your change; a new name seems needed.

## Report
`/home/jody/github/serene-pub/plans/briefs/REPORT-m3b-D-w2.md`: changed files with line ranges, tests run with pass/fail counts, the reply/`sessions:get` check result, Noticed-not-done.
