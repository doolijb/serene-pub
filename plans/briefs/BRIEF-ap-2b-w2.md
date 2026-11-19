# BRIEF — worker `ap-2b-w2` — the merge works for the session's owner on a live, a switched-off and a kept-at-uninstall provided lorebook, and leaves no tie to the plugin's cards

App repo `/home/jody/github/serene-pub`. Supervisor: lane `ap-2b`. SDK is read-only.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: do not run one.)

The repo is staged by the lead: run **no git command that changes the index or the working tree** (`git diff` / `git status` to read are fine). Never run prettier with `--write` or pipe its output into a file. No migration, no boot pass, no rewrite of stored rows outside the merge itself. No `npm run build`, no full test run.

## Owner rulings (quoted)

- 2026-11-17 AP3: "Leave them as they are and offer the merge, also when the lorebook was switched off".
- 2026-11-17 AP2: "… so we are never superimposing on something that can get deleted."
- 2026-11-05: "Plugins can only ship lorebooks as starters. They contain cast, not cards."
- Standing: existing sessions on a plugin's lorebook keep reading it (no rewrite of their rows).

## Rules (CLAUDE.md)

- Inside `db.transaction(async (tx) => …)` use only `tx` (the fold already does: keep every new statement on `t`).
- Comments state the rule, never history (no "now", "used to", "was", dates of change). `src/lib/shared/conformance/commentHistory.test.ts` checks it.
- No new user-facing sentence, name, setting or event. The only read widening allowed is the one below; the Lorebooks view, `lorebookAccessFor`, `assertReadableBook` and `providedBooksReadableBy` stay exactly as they are.

## Files owned (edit only these)

- `src/lib/server/lorebooks/foldInParent.ts`
- New test file `src/lib/server/lorebooks/foldProvided.int.test.ts`
- `src/lib/server/lorebooks/applyWritePredicate.int.test.ts` (re-pin only: the test "observed: disabled after the session started, Apply is still refused and the fold no longer finds the book" now expects the merge to work; any other test there that the card-less step below changes)
- Other existing test files only if they fail because of this change (re-pin only; list each)

Readable: anything. Not yours (never edit): `lorebooks/starterKits.ts` (already exports what you need), `utils/ownedBook.ts`, `plugins/providedMarks.ts`, `plugins/providedBooks.ts`, `sockets/ownBooks.ts`, client files, docs, NOMENCLATURE.

## Build — `lorebooks/foldInParent.ts`

1. **The narrow read** (~1707–1714 in `foldInParent`): the session's own stored link is the proof. The function already refuses a missing session, a session the asker does not own (`FOLD_REFUSALS.notOwner`) and a session with no attached lorebook; the book merged is `session.lorebookId`, re-read under the lock by `lockAndRead` (~116–149, no access check). Remove the `assertReadableBook` call and say the rule in a comment: *the session's owner may read, for the merge, the lorebook their own session reads; nothing else is widened.* No other access change.
2. **Is the parent a live provided lorebook?** In `lockAndRead`'s parent select (~141–145) also select `provided: liveProvidedBookSql()` (from `$lib/server/plugins/providedMarks`; true for a live provided lorebook whether switched off or not; false for one kept at uninstall, which is the administrator's ordinary lorebook) and return it.
3. **The merged cast holds no card of the plugin's.** `copyLorebookTables` keeps the copied members' real `character_id`s, so after a merge the notes' members would still link to the plugin's hidden carrier cards (made card-less only at uninstall, by `deleteProvidedBooks`). When the parent is a live provided lorebook, **after the read guard's compare** (after `if (difference) throw …`, still inside the transaction; the guard compares each member's active card, so this step must come after it), make the copied members card-less with `makeCopyCardless(t, ownId, copied)` (exported from `$lib/server/lorebooks/starterKits`, third parameter = the member ids to touch; it runs `makeMemberCardless` with cause `starter` and rewrites the notes' `character:<card>` annotations to `cast_member:<id>`). `copied` = the copies of the parent's members: `[...parentMembers].map((id) => maps.bindings.get(id)!)` (`parentMembers` is taken right after the copy, so it holds exactly the parent's member ids). Say the rule in a comment. A merge of an ordinary lorebook is unchanged.

## Tests — new `foldProvided.int.test.ts`

Fixtures: `applyWritePredicate.int.test.ts` builds a plugin's provided lorebook of kind `book` with a member's existing session on it (rows as today's code creates them), a switched-off case (`setProvidedBookDisabled`) and a kept-at-uninstall case; `foldInParent.int.test.ts` and `sockets/ownBooks.fold.int.test.ts` show fold assertions; `plugins/providedBooks.int.test.ts` shows uninstall that keeps (`deleteProvidedBooks`) and plugin disable. The provided lorebook's cast should carry at least one plugin-stamped (hidden carrier) card and one card-less member, and an entry annotation naming the card (`character:<id>`).

1. For each of **live**, **switched off**, **kept at uninstall** (a **member**'s session; the kept case is the one `lorebookAccessFor` refuses): before the merge the session still reads its lorebook (use the reader an existing test uses, e.g. the session's entries as read); `foldInParent` by the session's owner succeeds; afterwards `sessions.lorebook_id` is null and the notes' `overlay_of` is null; the provided lorebook's rows are byte-identical (except this session's scene captures, if your fixture has any).
2. Live and switched off: every notes member copied from the provided lorebook has `character_id` null; no notes annotation names a plugin card (`character:<id>`); seats still read the same members (seat `cast_member_id` set). Report what still names a plugin card afterwards (query and list: `session_characters.character_id`, `messages.character_id`, cast versions' card follows, anything else you find) — do not change those.
3. Kept at uninstall: its members were made card-less at uninstall; the merge keeps whatever the lorebook holds (an ordinary lorebook's merge rule).
4. Someone else: another member calling `foldInParent` on that session is refused (`notOwner`); another member still cannot read the switched-off lorebook (`lorebookAccessFor` null / `assertReadableBook` throws); `providedBooksReadableBy` and the member's `lorebooks:list` are unchanged by the merge code (switched-off lorebook still not listed for them).
5. Disabling the **plugin** (its `plugins` row disabled, not the lorebook switched off) hides nothing: `providedBooksReadableBy` still has the lorebook, the existing session still reads it, and the merge works.
6. An ordinary (non-provided) lorebook's merge still keeps its members' cards (one case).

## Done means

- Each test run as: first `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`, then
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ap-2b-w2-<n>.log 2>&1"` (always at least one path; one run at a time; never pipe vitest into `head`). An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- Green: the new file, `src/lib/server/lorebooks/foldInParent.int.test.ts`, `src/lib/server/sockets/ownBooks.fold.int.test.ts`, `src/lib/server/lorebooks/applyWritePredicate.int.test.ts`.
- `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` — 0 errors in your files.
- `commentHistory.test.ts` (same wrapper): no finding in your files. `npx prettier --check` on your changed files (report; do not `--write`).

## Report

Write to `/home/jody/github/serene-pub/plans/ap-2b-w2-report.md`: changed files, the three cases (what happened), exactly which links to plugin cards survive a merge, tests with pass counts and log paths, re-pins (before → after), assumptions, **Noticed, not done**.
