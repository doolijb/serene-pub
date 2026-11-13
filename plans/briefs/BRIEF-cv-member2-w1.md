# BRIEF cv-member2-w1 — server: the member page reads versions (B2), `laterVersions` delivered (B4), member group-only greetings (B5), card-version fields on member rows (B1 fields)

Worker (Sonnet) for lane-supervisor cv-member2. App `/home/jody/github/serene-pub`. Use absolute paths. Hand back your report as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Goal
Owner ruling 2026-11-06: **the member page shows and saves "The most recently active" version** — the cast version in force at the **book's present on main** (`bookPresentOf` in `characters/versions.ts`: the story clock, else the newest dated history entry; no present → main at its head). Make every cast member row the server sends carry that version, make Save write it, make the Changes rows carry each version whole, deliver `laterVersions` to the client, and keep a member's group-only greetings.

The wire contract is **already written** by the supervisor in `src/lib/shared/sockets/types.ts` — read it first and implement exactly it (do not rename): `Sockets.Lorebooks.CastVersionColumns`, `CastRowVersion`, `CastMemberRow`, `BindingList.Response.present`, `BindingsForCharacter.Response.members[].cardVersion / cardCurrentVersion / behindCard`, `UpdateBinding.Params.lorebookBinding.groupOnlyGreetings`, `UpdateBinding.Response.lorebookBinding: CastMemberRow`, `Amendments.CastRow.columns`, `Amendments.List.Response.laterVersions`. `npx tsc --noEmit -p .` currently shows the gaps you close (in `sockets/lorebooks.ts`, `sockets/amendments.ts`). Ignore `castSave.test.ts` (client worker) and `adminOverview.ts` / `attention.test.ts` (a later worker).

## Files owned (edit only these)
- `src/lib/server/sockets/lorebooks.ts`
- `src/lib/server/sockets/amendments.ts`
- `src/lib/server/lorebooks/retold.ts` (`MemberColumnsOfVersion`, `memberColumnsOfVersion`, `castChangesOfMemberEdit`)
- `src/lib/server/characters/versions.ts` — only: export `bookPresentOf`; add the read helper below; `memberProfileOf`'s greetings input. Nothing else.
- `src/lib/server/pipelines/testing/fixtures.ts` only if a fixture must learn `groupOnlyGreetings` (say so).
- New test files you create; existing test files listed under Tests, only where an expectation must move (see 2.4).

## Files readable
`src/lib/server/cast/memberAsRead.ts` (`castVersionsInForce`, `membersAsRead`, `layerVersionAsRead` — how `cardVersion` / `behindCard` are computed), `src/lib/shared/characters/profile.ts` (`legacyGreetingsOf`, `mergeGreetings`), `src/lib/server/state/reading.ts` (`lineOfBook`), `src/lib/shared/lorebooks/lineReading.ts` (`versionInForce`), plans `plans/REPORT-cv-client-2026-11-06.md` (§Blocked B2/B4/B5), `plans/REPORT-cv-fix2-2026-11-06.md`, `plans/REPORT-cv-fix3-2026-11-06.md`.

## What to build

### 1. The read helper (versions.ts)
- Export `bookPresentOf` as is.
- Add 🚧 `versionsAtBookPresent(h: Db, members: readonly { id: number; lorebookId: number }[]): Promise<Map<number, VersionRow>>` — for each book: `bookPresentOf`, then `castVersionsInForce(h, ids, { reading: { branchId: null, moment: present?.date ?? null, forkedAt: null, line: await lineOfBook(h, lorebookId, null) }, appearance: null })` (the same reading `reparentFromBookPresent` builds; dynamic imports as it does). One call per book, not per member. Doc comment cites the ruling.

### 2. Member rows (`sockets/lorebooks.ts`)
2.1 Replace `withBaseColumns` / `withBaseColumnsOf` with one projection (e.g. `castMemberRowsOf(h, members)`) used at **every** call site that used them (bindingList build, bindingsForCharacter, createBinding replies ~1975/~1990, updateBinding's `storedMember` and reply). For each member:
- `shown` = `versionsAtBookPresent` pick; `base` = `baseVersionsOf` (exists).
- One query for the parent card versions of `shown` and `base` (`id, cardId, number, label`), one for each card's current version (highest `number`, with its `label`).
- Frozen columns from `memberColumnsOfVersion(shown, { carded: shown.parentVersionId != null })`; the row's own `name`, `aliases`, `summary` stay the row's (as today).
- `characterId` = the shown version's parent's `cardId` (null when card-less). Where the row carries a joined `character` (bindingList), and the id differs from the stored `lorebook_bindings.character_id`, attach that card's `characters` row (null when card-less) — one query.
- `castVersionId` = shown.id; `groupOnlyGreetings` from the projection; `baseColumns` = `memberColumnsOfVersion(base, { carded: base.parentVersionId != null })` + `characterId` of the base's parent card (null when no base); `cardVersion` = `{id, number, label}` of the shown parent; `cardCurrentVersion` = that card's highest version; `behindCard` = `cardVersion.number < cardCurrentVersion.number`.
- A member with no version keeps `columnsOfRow` columns, `castVersionId: null`, `baseColumns: null`, card fields null / false (no throw; `membersAsRead` already logs).
2.2 `BindingList.Response.present` = `bookPresentOf(db, lorebookId)?.date ?? null`.
2.3 `bindingsForCharacter`: each `members[]` entry also gets `cardVersion`, `cardCurrentVersion`, `behindCard` from the same projection. `retold` / `followsCard` / `memberName` keep their current rules, now over the projected row.
2.4 **Save writes the shown version** (`updateBinding` only). `writeMemberEdit` gains an option `onto: "base" | "shown"` (createBinding ~1961 and the merge path ~3954 keep `"base"`; updateBinding passes `"shown"`). With `"shown"`:
- `before` = columns of the version shown before the write (what the form showed).
- Keep the link / unlink / swap calls to `reparentFromBookPresent` exactly as they are.
- Then re-pick the target inside the transaction (`versionsAtBookPresent(tx, [member])`): after a link or unlink at a present it is the carrier; with no present it is main's head pick.
- `card` = the target's parent card version profile (null when card-less); `after.characterId` = the target's parent card id. This replaces `baseKeepsCard` / `reparented` for the `"shown"` path.
- Write: target is the base (`isBaseVersion`) → today's `writeCastVersion` author path; otherwise `updateCastVersion(tx, target.id, { changes })` (it retires and re-inserts a row a branch reads; use the row it answers).
- ★CV-13 later versions = main, cast, non-retired, ≠ target, and **after the target**: every dated one when the target is the base (today's list); otherwise date later than the target's, or the same date with a higher `writeOrder`. Keep today's "takes" rule.
- After the write, also emit `amendments:list` for the book to the asker (`buildAmendmentsList(userId, lorebookId)`; import dynamically if a static import would be circular) — the shown version is a Changes row and its columns changed.
- Existing tests that assert the **base** took a form edit while the book has a present must move to the shown version. For each expectation you change, report: file, test name, old expectation → new, and why ("The most recently active", owner 2026-11-06). Do not change any other expectation; if one fails for another reason, stop and report it.

### 3. Changes rows (`sockets/amendments.ts`)
- `buildAmendmentsList` cast rows add `columns: columnsOfVersion(v, cards)` (already computed there; it includes `characterId` and, after step 5, `groupOnlyGreetings`).
- **B4:** the socket layer emits no handler return value. In `amendments:create` (cast subject) emit `amendments:list` as `{ ...res, laterVersions }` when `laterVersions` is set; in `amendments:update` (cast) emit `{ ...res, laterVersions }`. Return the same object.

### 4. B5 group-only greetings
- `MemberColumnsOfVersion` + `memberColumnsOfVersion`: `groupOnlyGreetings: string[]` (from `legacyGreetingsOf(profile.greetings).groupOnlyGreetings`).
- `memberProfileOf`'s member input: optional `groupOnlyGreetings?: readonly string[] | null`; passed as `mergeGreetings`' third argument in the card-less and both-retold branches. The mixed branch (the upgrade lift) stays as it is. Fix its doc comment.
- `castChangesOfMemberEdit`: greetings are touched when `groupOnlyGreetings` differs too.
- `columnsOfRow`: `groupOnlyGreetings: []`.
- `updateBinding`: `groupOnlyGreetings` is a version key, never a `lorebook_bindings` column — never in the row's `set`, always picked by `writeMemberEdit`. Validate it as `string[]` with the alternates' rules.
- Cast `amendments:create` / `update`: `cleanFields` accepts `groupOnlyGreetings` (string[]); the dated write carries it.

## Rules (quoted by the supervisor; your work depends on them)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." — every read in 2.4 inside the transaction goes through `tx`.
- "Never add a top-level `await` to `src/lib/server/db/index.ts`." No static `$lib/server/db` import in a module tests mock.
- Only `characters/versions.ts` writes `character_versions` (`versionsWriter.guard.test.ts`, empty allowlist); frozen `lorebook_bindings` columns are never written (`frozenColumns.guard.test.ts`). Both guards must stay green.
- "An event in `SCOPED_EVENTS` must carry its scope key (`sessionId`, `lorebookId`…) in the payload, or `emitToUser` silently sends nothing." `amendments:list` and `lorebooks:bindingList` are scoped on top-level `lorebookId`.
- "Every session has a lorebook — never write 'no book'" (comments and sentences too).
- Nomenclature: R1 one word one meaning; R3 qualify, never the bare noun. Use only the names in the contract plus `versionsAtBookPresent`, `castMemberRowsOf` (or similar internal helper names — say which). No other new exported name, setting, event, table or migration: stop and report instead.
- It is a **session**, never a *chat*.
- Decide implementation inside this scope and name each choice in your report; anything a user sees or that outlives the change beyond this brief → stop and report.

## Tests (Done means)
New int file `src/lib/server/sockets/lorebooks.memberShownVersion.int.test.ts` (60 s timeout on every `it` that opens a DB), at least:
1. A book with a story clock (a present) and a card-less member with an earlier dated version: **link** a card from the member page (`updateBinding` with `characterId`) → the `bindingList` row has `characterId` = the card, `castVersionId` = the carrier, retold flags matching the carrier's follows, `cardVersion` = the card's v1, `behindCard: false`; the earlier Changes row's `columns.characterId` is null and keeps its words.
2. A carded member, **unlink** at the present → the row has `characterId: null`, its columns hold the card's words, `castVersionId` = the carrier; earlier Changes rows stay carded in `columns`.
3. Save writes the shown version: a dated change at Y10 and a present at Y20 → `updateBinding` of `description` changes the Y10 version, the base is unchanged, and `laterVersions` counts only versions after Y10; the reply's and the emitted `amendments:list` carry the new words.
4. No present → the row is main's head pick; a base-only member's Save writes the base.
5. `newCardVersion` on the card → the row's `behindCard: true`, `cardCurrentVersion` = v2; `bindingsForCharacter` members carry the same.
6. B4: a cast `amendments:create` with `changeLaterVersions: true` → the emitted `amendments:list` payload carries `laterVersions` (capture `emitToUser`).
7. B5: `updateBinding` with `groupOnlyGreetings` → the row and the shown version carry them; a later edit of `firstMessage` keeps them. Plus unit cases in `src/lib/server/lorebooks/retold.test.ts` for `memberColumnsOfVersion` / `castChangesOfMemberEdit` with group-only greetings.

Then run, with `--maxWorkers=2`, never piped into `head`:
`npx vitest run src/lib/server/sockets/lorebooks.memberShownVersion.int.test.ts src/lib/server/sockets/lorebooks.castVersions.int.test.ts src/lib/server/sockets/amendments.castVersions.int.test.ts src/lib/server/sockets/amendments.int.test.ts src/lib/server/sockets/castMemberLifecycle.int.test.ts src/lib/server/sockets/lorebooks.memberName.int.test.ts src/lib/server/sockets/lorebooks.providedCast.int.test.ts src/lib/server/sockets/lorebooks.mutationScoping.int.test.ts src/lib/server/sockets/scopedReplies.lorebooks.int.test.ts src/lib/server/sockets/refusals.int.test.ts src/lib/server/lorebooks/retold.test.ts src/lib/server/lorebooks/retold.int.test.ts src/lib/server/lorebooks/castOwnNames.int.test.ts src/lib/server/characters/versions.test.ts src/lib/server/characters/versions.authoring.int.test.ts src/lib/server/characters/versions.write.int.test.ts src/lib/server/characters/versionsWriter.guard.test.ts src/lib/server/characters/frozenColumns.guard.test.ts src/lib/server/cast/memberAsRead.int.test.ts --maxWorkers=2`
and `npx tsc --noEmit -p .` (no errors in your files; list any others you see). List the `/tmp/serene-pub-vitest-*` dirs before and after; delete only ones your run made, by name.

## Report (final message)
Names and signatures first; changed files; each moved expectation (2.4); tests run with counts; choices you made; anything you stopped on; Noticed, not done.
