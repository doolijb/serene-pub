# BRIEF s4-cp-w2 — re-own faces on card-less, and stored names kept true (server) — 2026-11-08

Supervisor: lane `s4-cp`. Repo: `/home/jody/github/serene-pub`. Report back in your final message (the supervisor reads it); do not write a report file.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (One is up on :5199 — this task needs no `sdk:build`.)

## Goal — two parts

### Part A — ★s4-cl-1 (lead: accepted): face and likeness files re-owned when a member goes card-less

1. New writer in `src/lib/server/characters/versions.ts`: 🚧 `repointCastVersionFiles(tx, castMemberId, files: Map<number, number>)` — an **in-place rewrite** of `face_media_id` and `likeness.imageMediaId` (jsonb) on **every** version of that member (`character_versions.cast_member_id = castMemberId`, retired rows included), old id → new id, **no retire, no new version**. Same shape as `repointVersionHistory` (`versions.ts:2241`). Answers how many rows it changed. An empty map is a no-op. Card versions are never touched.
2. `src/lib/server/cast/cardless.ts` `makeMemberCardless` **step 5** (the placeholder comment at ~:136 "Faces and likeness images keep their file rows: see the lane report, ★s4-cl-1."): collect every file id the member's versions wear as `face_media_id` or `likeness.imageMediaId` **after** the detach above it (a detached version now holds the card's face as its own); for each whose `files.user_id` is not the book owner, `fileForOwner(tx, id, { userId: bookOwner, lorebookId })` (the `fileFor` already defined there); call `repointCastVersionFiles` with the map of ids that changed. Update the module's header bullet list and the `CardlessOutcome` with one count field (🚧, one JSDoc sentence) if you add one. Keep it idempotent (a second call changes nothing). Only edit step 5 and what it needs in that file.
3. Test (in `src/lib/server/cast/cardless.int.test.ts`, add to it): **a member made card-less in another user's book keeps its face after the card owner deletes that gallery picture** — user A owns a card whose face is a picture in its gallery; user B's book has a member linked to A's card; `makeMemberCardless(… { cause: "card-delete" })`; then delete A's gallery picture the way `characters:deleteGalleryImage` does (find it in `src/lib/server/sockets/characters.ts` ~:2439; call the same media function) → the member as read (`membersAsRead`) still has a `faceMediaId` whose file row exists and belongs to B. Also: likeness image re-pointed; same-owner card shares the file row (map empty, nothing rewritten); second call is a no-op. And a unit-level test of `repointCastVersionFiles` in `characters/versions.write.int.test.ts` or a new `characters/versions.repointFiles.int.test.ts` (your call).

### Part B — ★chr-read-1 (lead: accepted): `lorebook_bindings.name` = the member's shown name at its book's present

The Characters view sorts and searches by `lorebook_bindings.name` and shows the as-read name. Today they drift in two cases (see `src/lib/server/cast/characterRows.storedNames.int.test.ts`, the two `test.fails`):
- (1) a card renamed as a **new card version** and synced while the member stays behind on the old version — the sync writes the card's current name (`utils/characterBindingSync.ts` `syncLorebookBindingsForCharacter`, `memberShownName(names, character)` at ~:180);
- (2) a **dated Main cast version** renames the member — nothing writes the stored name back.

The ruling: **one writer keeps `lorebook_bindings.name` = the member's shown name at its book's present.**
1. Add 🚧 one helper in `src/lib/server/utils/characterBindingSync.ts` (e.g. `storeShownNames(tx, memberIds)`, your name) that reads `membersAsRead(tx, ids)` with the default reading (what `expectTracked` in the test compares against: `read.shownName`) and writes `lorebook_bindings.name` where it differs. It takes **no advisory lock** (it runs inside other writers' transactions; see the lock-order warning in that file's header). It must not statically import `$lib/server/db` (the file's header explains why).
2. `syncLorebookBindingsForCharacter` names each bound member with that helper's answer instead of `memberShownName(names, character)` (keep its alias merge as is; the alias merge may still use the card's names).
3. `writeCastVersion` and `updateCastVersion` (`versions.ts:1643`, `:2011`): when the write's changes touch `name` or `nickname` (own value or `{ follow: true }`), call the helper for that member after the write, on the same `tx`. `versions.ts` **must stay a leaf** (its header, :8–15: it must not statically import modules that reach the db) — use a dynamic `await import("$lib/server/utils/characterBindingSync")` inside the function, and check `cast/memberAsRead.ts` and `characterBindingSync.ts`'s imports don't reach `$lib/server/db` statically. If a dynamic import inside the writer is impossible for a reason you find, stop and say why.
4. Flip the two `test.fails` in `characterRows.storedNames.int.test.ts` to `test` and make them pass; the other five there must stay green.

## Files owned (edit only these)

- `src/lib/server/characters/versions.ts` (the new writer; the two call sites in `writeCastVersion` / `updateCastVersion`; nothing else)
- `src/lib/server/cast/cardless.ts` (step 5 only, plus header/outcome lines it needs)
- `src/lib/server/utils/characterBindingSync.ts`
- tests: `src/lib/server/cast/cardless.int.test.ts`, `src/lib/server/cast/characterRows.storedNames.int.test.ts`, `src/lib/server/characters/versions.write.int.test.ts` or a new `src/lib/server/characters/versions.repointFiles.int.test.ts`, `src/lib/server/utils/characterBindingSync.test.ts` if it breaks.

## Files readable

Everything. Especially `media/index.ts` (`fileForOwner` :711, `deleteFile`/`deleteMedia` :617–630), `media/access.ts`, `cast/memberAsRead.ts`, `characters/versions.ts` header and `repointVersionHistory`, `sockets/characters.ts` gallery delete, `sockets/lorebooks.ts` `writeMemberEdit` (:1541; it writes the binding row's columns, then the version — your helper running inside the version write therefore has the last word, which is what we want).

## Out of scope

`sockets/characters.ts` (worker w1 is editing it), `sockets/lorebooks.ts`, client code, NOMENCLATURE.md (supervisor queues rows). The book's present moving because something *else* was dated later (no cast write) — note it under "noticed", don't build a sweep.

## Rules that apply (quoted)

- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently; `db/transactionGuard.ts` throws in dev/test, warns in prod."
- CLAUDE.md: "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- Memory: "defaults.ts imports stay leaf — a barrel import from the boot path binds the real db before vi.mock; 12 int files" — `characterBindingSync.ts` is imported by `db/defaults.ts`; keep its static imports leaf.
- CLAUDE.md P2: "A module owns its data and every write to it … Two writers of one thing is a bug." — face/likeness pointers on versions are written only by `versions.ts`; files by the media module (`fileForOwner`).
- "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass and a test that a second boot changes nothing." — this task changes no schema and adds no boot pass; existing drifted names correct themselves on the next sync/write. Say so in the report; **do not add a boot pass** (that is a ★ for the owner if you think one is needed).
- Name new exported helpers with 🚧 in their JSDoc; one JSDoc sentence each.

## Done means

Run, inside a capped scope, logged (never pipe vitest into `head`):

```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/server/cast/cardless.int.test.ts src/lib/server/cast/characterRows.storedNames.int.test.ts src/lib/server/cast/characterRows.int.test.ts src/lib/server/characters/versions.write.int.test.ts src/lib/server/characters/versions.int.test.ts src/lib/server/utils/characterBindingSync.test.ts src/lib/server/characters/versionsWriter.guard.test.ts <your new test file> --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w2-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-cp-w2-tests.log'
```

All green, the two former `test.fails` passing. Also run any other test file that imports `characterBindingSync` or `writeCastVersion` and that your change could break (find them with grep; list what you ran). Then `npx tsc --noEmit -p .` under `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=8192; …'` (baseline 0 errors). **Prettier:** `npx prettier --check` on changed files, but only `--write` the lines you changed — never reformat a whole file; if a file fails only on lines you didn't touch, leave it and say so.

## Stop and ask (in your report, don't decide)

A boot pass or migration, a change to a file not listed, a new user-visible sentence, or a rule above that the code makes impossible.

## Report (final message)

Changed files; decisions (helper names, where the call sits, how a dynamic import was done); tests with pass/fail counts; tsc before/after; noticed-not-done.
