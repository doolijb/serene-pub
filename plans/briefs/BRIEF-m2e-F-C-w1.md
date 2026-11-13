# BRIEF m2e-F-C-w1 — foreign-rules marks keyed by book (★D3-1) + one svelte-check fix

Lane **m2e-F-C** (supervisor reads your report). Work from `/home/jody/github/serene-pub`. Use absolute paths.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

## Goal
### A. ★D3-1 (owner ruled 2026-11-04 "Build it now"): the "other rules" marks are kept per book
Today `src/lib/client/lorebooks/sections/derivedPiece.ts` (~243–263) holds ONE `OTHER_RULES = new SvelteMap<string, string>()` (typeId → rules name) for "the open book", cleared on every `entries:types` reply. Two workspaces / a book switch can read another book's marks. Make it per book:

1. `derivedPiece.ts`:
   - `OTHER_RULES` becomes `SvelteMap<number, Map<string, string>>` (lorebookId → (typeId → rules name)). Store a fresh plain `Map` per book and `set` it on the SvelteMap (replace whole, never mutate the inner map in place — the inner Map is not reactive).
   - `rememberOtherRules(lorebookId: number, groups)` replaces that book's marks whole (an empty `groups` stores an empty map, or deletes the key — your choice, say which).
   - NEW `forgetOtherRules(lorebookId: number): void` — drops one book's marks. Doc comment starts `🚧` and says: drops one book's other-rules marks when its workspace unmounts or leaves the book.
   - `otherRulesNameOf(typeId: string, lorebookId: number | null | undefined)` → `undefined` when no book id.
   - Update the existing doc comment (it says "Per book, so it is replaced whole") to say it is keyed by book.
2. `src/lib/client/lorebooks/sections/index.ts`:
   - `rulesListDoor(list: PieceList, lorebookId: number | null)`; reads `otherRulesNameOf(list.typeId, lorebookId)`; the door cache `rulesListDoors` is keyed `` `${lorebookId}:${typeId}` `` (null prints as "null"; fine). Keep the `sig` check as is.
   - `rulesListDoorOf(typeId, lorebookId?: number | null)` (stays non-exported) passes `lorebookId ?? null`.
   - `descriptorFor(scope: LoreScope, lorebookId?: number | null)` passes it to `rulesListDoorOf`.
   - `descriptorForKind(kind)` is UNCHANGED (its callers — EntryWorkspace, LoreRail, TimeLens — never read `creatable`). Do not change those callers.
3. `src/lib/client/lorebooks/lenses/PoolMount.svelte`: `descriptorFor(scope, book.lorebookId)` and `rulesListDoor(list, book.lorebookId)` (`book = getBookData()`; it has a `lorebookId: number | null` getter — check `bookData.svelte.ts`).
4. `src/lib/client/lorebooks/LorebooksWorkspace.svelte`:
   - `handleEntryTypes` (~1990): `rememberOtherRules(msg.lorebookId, others)`.
   - `rulesListDoors` derived (~766): `rulesListDoor(list, openBookId)` (the book whose lists those are).
   - Forget the OLD book when the book switches: in the `whenBookOpens(() => openBookId, (id) => { … })` callback (~2482) call `forgetOtherRules(previous)` for the previously opened id when it differs from `id`; keep the previous id in a plain (non-`$state`) `let` beside it. Do not move or reorder the existing resets.
   - Forget on destroy: the existing `onDestroy` (~2633) also calls `forgetOtherRules` for the book this workspace last remembered/opened (when not null). Edit its comment minimally.
   - Additive hunks only; this file has other lanes' uncommitted hunks — re-read the exact lines right before each edit; never reformat the file (it was prettier-dirty before you; do not run `prettier --write` on it).
5. Tests:
   - `src/lib/client/lorebooks/sections.test.ts` (~415–445, describe "🚧 ★50 a list of other rules…"): pass a book id everywhere (`rememberOtherRules(1, …)`, `rulesListDoor(WEAPONS, 1)`), and ADD one two-book test: book 1 remembers WEAPONS as Vis Itineris, book 2 remembers none → `rulesListDoor(WEAPONS, 1).creatable === false` and `rulesListDoor(WEAPONS, 2).creatable === true` at the same time; then `forgetOtherRules(1)` → `rulesListDoor(WEAPONS, 1).creatable === true`. Also one assertion through `descriptorFor(listScope(WEAPONS.typeId), 1)` after `rememberRulesLists([WEAPONS])` (from `derivedPiece`) — `listScope` is in `$lib/shared/lorebooks/loreRoute`.
   - `src/lib/client/lorebooks/sections/derivedEntryEditor.dom.test.svelte.ts` calls `rulesListDoor(WEAPONS)` 4×: pass a book id (`1`).
   - If `sections/derivedPiece.test.ts` or `scopes.test.ts` call any changed signature, update them; otherwise leave them.

### B. svelte-check error, `src/lib/client/admin/sections/plugins/IdPage.svelte:304`
`listShows` (~231) is typed `(res: { plugins: Row[] }) => boolean`, but `awaitReply`'s `match` is typed on the EVENT's response (`SocketEventMap[K]["response"]`), and the provided-book steps (~290–305) send `plugins:disableProvidedBook`/`plugins:enableProvidedBook` whose response is `Sockets.Plugins.SetProvidedBookDisabled.Response` — while the reply actually heard is `plugins:list` (`replyKey`). Fix it in `listShows` only: take `res: unknown` and read `(res as { plugins?: Row[] } | undefined)?.plugins`, with a one-line comment that the reply heard is `plugins:list` whatever event was sent. Behaviour unchanged. No other change to IdPage.

## Files owned (edit only these)
`src/lib/client/lorebooks/sections/derivedPiece.ts`, `src/lib/client/lorebooks/sections/index.ts`, `src/lib/client/lorebooks/lenses/PoolMount.svelte`, `src/lib/client/lorebooks/LorebooksWorkspace.svelte` (only the hunks named above), `src/lib/client/lorebooks/sections.test.ts`, `src/lib/client/lorebooks/sections/derivedEntryEditor.dom.test.svelte.ts`, `src/lib/client/lorebooks/sections/derivedPiece.test.ts` and `src/lib/client/lorebooks/scopes.test.ts` (only if a signature forces it), `src/lib/client/admin/sections/plugins/IdPage.svelte` (`listShows` only).
## Files readable
Anything under `src/`.
## Out of scope
Everything else: no NOMENCLATURE/docs edits (the supervisor writes them), no server files, no new names beyond `forgetOtherRules`, no other refactor, no change to `descriptorForKind` or its callers.
## Stop and ask (in your report, then stop) when
A change needs a file not listed, a new name beyond `forgetOtherRules`, or a behaviour change a user would see.

## Rules you work under (quoted)
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- NOMENCLATURE R6: "mark ⏳ transitional / 🚧 provisional vocabulary" — `forgetOtherRules` is 🚧.
- Views never call `toaster` (do not add any).
- Targeted tests only; never pipe vitest into `head`.

## Done means
One run: `npx vitest run src/lib/client/lorebooks/sections.test.ts src/lib/client/lorebooks/scopes.test.ts src/lib/client/lorebooks/sections/derivedPiece.test.ts src/lib/client/lorebooks/sections/derivedEntryEditor.dom.test.svelte.ts src/lib/client/lorebooks/loreRail.dom.test.ts src/lib/client/lorebooks/lorebooksWorkspace.counts.dom.test.ts src/lib/client/admin/sections/plugins/providedBooks.dom.test.svelte.ts` — all green (record counts). `npx prettier --check` on each file you edited (report pre-existing failures; check with `git diff` that your hunks are the only formatting you introduced). `npx tsc --noEmit -p .` is optional; svelte-check is the lead's.

## Report
Write `/home/jody/github/serene-pub/plans/briefs/REPORT-m2e-F-C-w1.md`: changed files with the hunks' purpose, test command + results, prettier results, choices made, Noticed-not-done.
