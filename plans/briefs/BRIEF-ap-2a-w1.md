# BRIEF — worker `ap-2a-w1`: the write rule (server code)

Repo `/home/jody/github/serene-pub` (app). Supervisor: lane `ap-2a`. SDK: read-only, never edit or build it.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

The repo is staged by the lead: run **no git command** that changes the index or the working tree. Never `prettier --write`, never pipe prettier's output into a file. No migration, no boot pass, no rewrite of stored rows.

## Goal (owner ruling AP1, 2026-11-17)

"The plugins and core catalogues starter lorebooks are not owned by users, but by the source. Admins have limited management and can't mutate or delete them, only disable them or remove the plugin. To mutate, the admin/user clones it first."

So **every live provided lorebook is read-only to every person, the enabling administrator included**. "Live provided" means exactly what the existing deciders mean: **the row carries its own genuine provided mark (`markedBook(extraJson, uuid)` non-null) AND its owner is present** (`"core"` always; a plugin while its `plugins` row exists — `providedOwnerPresent`). A lorebook kept at uninstall (mark kept, plugin row gone) is NOT provided: it is the administrator's ordinary lorebook, writable. Disabled or not makes no difference to "provided".

## Rules you must follow (quoted from the project rules)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Comments state the rule, never the history." (No "was/used to/lane x changed"; describe what the code does now.)
- "**No statement is added per reply** (prompt baselines' counts must not rise)": the automatic Apply and `loreWriteRoute`'s readers run per reply. Fold the provided fact into the **existing** selects as an extra column; never add a query on those paths.
- "`findOwnedBook` stays about ownership only: do not put 'provided' into it (every door calls it first and would answer 'Lorebook not found.' before the worded refusal)."
- Plugin sync, enable, disable and removal (`syncProvidedBooks`, `setProvidedBookDisabled`, `deleteProvidedBooks`, `providedBooks.ts`) are **not touched**.
- New names: only the ones this brief names. Anything else you think needs a name: stop and say so in your report.

## Files owned (edit only these, only the parts named)

1. `src/lib/server/plugins/providedMarks.ts`
   - `primerRowEditProblem` (~157–182): **drop the kind test**. Select only `uuid`, `extraJson`; `if (!book) return null`; the rest unchanged. Rewrite its doc comment to state the rule: the one decider for "a person may not edit this lorebook": the refusal sentence when the lorebook is a live provided lorebook (its OWN genuine provided mark, the mark's owner present; any book kind, disabled or not), else null; called at the socket doors that act for a person, never by the syncs or the admin disable/enable.
   - Add, next to `shownLorebook`, one exported SQL helper **`liveProvidedBookSql(table = schema.lorebooks): SQL<boolean>`** — the SQL twin of "`markedBook(...)` non-null AND `providedOwnerPresent(...)`": `coalesce(json_typeof(mark->'plugin') = 'string' AND json_typeof(mark->'slug') = 'string' AND json_typeof(mark->'version') = 'string' AND mark->>'uuid' = uuid::text AND (mark->>'plugin' = 'core' OR EXISTS (SELECT 1 FROM plugins WHERE plugins.plugin_id = mark->>'plugin')), false)` where `mark` is `${table.extraJson}->'provided'` (the column is `json`, as `genuineProvidedMarkSql` and `shownLorebook` already treat it). Use drizzle `sql` with `${schema.plugins}` / `${schema.plugins.pluginId}` interpolations, as the neighbours do. Doc comment: one expression so a select that already reads the row carries the fact with no statement of its own; disabled or not; not a read permission.
2. `src/lib/shared/lorebooks/primerRow.ts` — `primerRowEditRefusal` keeps its name and signature; its sentence becomes exactly:
   `` `This lorebook comes with ${pluginName === null ? "the pub" : pluginName}: make your own copy to change it.` ``
   Update its doc comment: the sentence for a person's edit of a **live provided lorebook** (any kind: a primer row or a plugin's provided book), not only a primer row.
3. `src/lib/server/sockets/lorebooks.ts` — **only** the two `readOnly` sites:
   - list row (~531): `...(book.kind === "starter_kit" ? { readOnly: { pluginName } } : {})` → always `readOnly: { pluginName }` inside the existing `providedBy && ownersPresent.has(providedBy.plugin)` branch.
   - open book (~862): the same — `readOnly` always inside the existing `providedBy && providedOwnerHere` branch.
   - Their comments: "A live provided lorebook: every edit is refused; make your own copy." Touch nothing else in this file.
4. `src/lib/server/utils/ownedBook.ts`
   - `canWriteLorebook(userId, book: { userId: number; provided: boolean })` → `userId != null && !book.provided && book.userId === userId`. `provided` is **required** (each caller states it). Doc comment: whether this person may WRITE this lorebook row; its owner only, and nobody for a live provided lorebook (owned by its source, AP1); `provided` is the row's fact, read where the row is read (`liveProvidedBookSql`); the one place a later co-editing permission widens; not read access.
   - `findOwnedBook`: call `canWriteLorebook(userId, { userId: book.userId, provided: false })` with a one-line comment stating the rule: ownership only here; each door refuses a live provided lorebook in words after this (`primerRowEditProblem`). No new query in `findOwnedBook`.
5. `src/lib/server/lorebooks/ownBook.ts` — only these sites (re-verify line numbers):
   - `loreWriteRoute` (~395): facts gain **`bookProvided: boolean`**; the test becomes `facts.bookOwnerId == null || !canWriteLorebook(facts.sessionOwnerId, { userId: facts.bookOwnerId, provided: facts.bookProvided })`. Update its doc comment's `own-book` bullet: "…or a lorebook the session's owner may not write (someone else's, or a live provided lorebook)".
   - `loreWriteTargetFor` (~444–458), `loreWriteBookIdOf` (~526–540), `keepsValuesInOwnBook` (~560–575): add `provided: liveProvidedBookSql()` to the existing `select({ userId: … })` on `schema.lorebooks`, and pass `bookProvided: !!book?.provided` to `loreWriteRoute`.
   - `applyOverlayItems` (~2081–2087), `takeBackApply` (~2711–2716), `applyHeldAutomatically` (~3129–3134, and its `loreWriteRoute` call ~3254 with `bookProvided: !!book.provided`), `overlayAccessOf` (~3343–3357): add `provided: liveProvidedBookSql()` to the existing book select; `canWriteLorebook` then receives it through `book`.
   - Refusal words in `applyOverlayItems` and `takeBackApply`: when the predicate says no **and `book.provided`**, throw `new OwnBookRefusal(<the sentence>)` where the sentence is `(await primerRowEditProblem(db, bookId)) ?? APPLY_OVERLAY_REFUSALS.notOwner` (an extra read only on that refusal path, which is a person's press, never per reply). Otherwise the existing `notOwner` refusal unchanged. A small local helper for this is fine. `applyHeldAutomatically` stays silent (returns null).
   - Comments of these functions that say "the session's owner owns it" may gain "and it is not a live provided lorebook" where the rule is stated. Nothing else in this file.
6. `src/lib/server/state/durable.ts` — only the delete safeguard (~178–193): add `bookProvided: liveProvidedBookSql()` to the existing select (it joins `lorebooks`; the helper's default table is right), and replace `owners.bookOwnerId !== owners.sessionOwnerId` with `!canWriteLorebook(owners.sessionOwnerId, { userId: owners.bookOwnerId, provided: !!owners.bookProvided })`. Update the comment above it: a lorebook the session's owner may not write (someone else's, or a live provided lorebook) records nothing — the same test `loreWriteRoute` applies.
7. Unit tests, so they compile and pin the rule:
   - `src/lib/server/lorebooks/ownBook.test.ts`: every `loreWriteRoute` call gains `bookProvided: false`; add cases: own book + `bookProvided: true` + full → `own-book`; and a table row for it.
   - `src/lib/client/lorebooks/starterKitCards.test.ts`: the two expected sentences become the new wording.

## Out of scope (do not do)

`StartSessionForm.svelte`, `sessions.create.ts`, `sockets/sessions.shared.ts` (the start path), any client component, `starterKits.ts`, `state/write.ts`, `sessions/seats.ts`, `lorebooks/entryKnowledge.ts`, `providedBooks.ts`, the int tests (another worker), docs, NOMENCLATURE. Live lanes' files: `scenes/liveScenes.ts`, `utils/sceneCast*.ts`, `sockets/scenes.ts`, `utils/activityStore.ts`, `messages/debugMeta.ts`, `sockets/sessions.messages.ts`, `pipelines/runtime/liveRow.ts`, `utils/runReply.ts`, `utils/generationStatus.ts` — never touch.

## Stop and ask (in your report, then stop) when

A site does not match this description; a caller of `canWriteLorebook` or `loreWriteRoute` exists outside the files above (grep `src` — tests included — and list every one); a select you'd fold into does not exist and you'd need a new query; anything needs a new name beyond `liveProvidedBookSql` / `bookProvided`.

## Done means

- `grep -rn "canWriteLorebook(\|loreWriteRoute(" src` shows every call passing the provided fact.
- Tests, one at a time, after waiting: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/lorebooks/ownBook.test.ts src/lib/client/lorebooks/starterKitCards.test.ts > plans/ap-2a-w1-1.log 2>&1"` — green. Never pipe vitest into `head`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/ap-2a-w1-tsc.log 2>&1` — 0 errors in your files (report any others by file, don't fix them).
- `npx prettier --check` on each file you changed; report results (don't fix pre-existing failures outside your lines).

## Report (your final message, under 400 words)

Each change by file:line; the exact SQL of `liveProvidedBookSql`; every caller found; test and tsc results with log paths; anything you stopped on; **Noticed, not done**.
