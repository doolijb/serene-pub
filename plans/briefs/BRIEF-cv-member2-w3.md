# BRIEF cv-member2-w3 — server: the Update socket (B1) and the admin lift list (B3)

Worker (Sonnet) for lane-supervisor cv-member2. App `/home/jody/github/serene-pub`. Use absolute paths. Hand back your report as your final message (no report file). A client worker runs at the same time against the same wire contract.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
Lane cv-member2's first server worker already made every cast member row carry the version in force at the book's present (owner 2026-11-06, "The most recently active"): `castMemberRowsOf(h, members)` in `sockets/lorebooks.ts`, `versionsAtBookPresent(h, members)` and the exported `bookPresentOf` in `characters/versions.ts`. Reuse them. The **wire contract is already written** in `src/lib/shared/sockets/types.ts` (read it): `Sockets.Lorebooks.UpdateMemberToCardVersion`, `Sockets.Admin.CastLiftNotes`, `Sockets.Admin.CastLiftFollowGreetings`, `Admin.Overview.Response.data.castLiftCount`. The events are registered in `src/lib/client/sockets/typedSocket.ts` and `src/lib/shared/sockets/interest.ts` (`GATED_EVENTS`; `lorebooks:updateMemberToCardVersion` is in `SCOPED_EVENTS` on top-level `lorebookId`). Implement exactly those names.

## Files owned (edit only these)
- `src/lib/server/sockets/lorebooks.ts` — only the new handler and its `register(...)` line.
- `src/lib/server/characters/versions.ts` — only the new writer `followCardGreetingsAfterLift` below.
- New `src/lib/server/admin/castLiftNotes.ts` (the read) and new `src/lib/server/sockets/adminCastLift.ts` (the two admin handlers), plus their registration in `src/lib/server/sockets/index.ts` (one import + one call, as `registerAdminOverviewHandlers`).
- `src/lib/server/sockets/adminOverview.ts` (`data.castLiftCount`) and `src/lib/server/admin/attention.test.ts` (fixture gains `castLiftCount: 0` — tsc fails on it today).
- New test files.

## Files readable
`src/lib/server/characters/versionsLift.ts` (`LiftNoteV1`, `LiftDifference`, `parseLiftNote`, how the lift writes the base's `note`, its mixed-greetings rule), `characters/versions.ts` (`updateMemberToCardVersion`, `updateCastVersion`, `isBaseVersion`, `memberProfileOf`), `src/lib/server/cast/memberAsRead.ts` (`membersAsRead` → `shownName`), `src/lib/server/admin/overviewStale.ts`, `src/lib/server/sockets/adminOverview.ts` (the admin handler pattern), `characters/versionsLift.int.test.ts` (how its tests build a lifted member — reuse that route for fixtures), `characters/versionsWriter.guard.test.ts` (what the one-writer guard scans), `plans/REPORT-cv-client-2026-11-06.md` §Blocked B1/B3.

## What to build
### B1 — `lorebooks:updateMemberToCardVersion { castId }` (`refusable`, as the neighbouring handlers)
- The member must exist; the asker must own its book (`findOwnedBook`, the `updateBinding` gate) and `primerRowEditProblem` must be null — refuse with the same sentences `updateBinding` uses.
- In one transaction, under the book's lock (`select pg_advisory_xact_lock(<lorebookId>)`, as `updateBinding`), using only `tx`:
  - shown = `versionsAtBookPresent(tx, [member])`; its parent card version gives the card.
  - Card-less there → refuse: _‹name› reads no card in this lorebook, so there is no card version to update to._
  - current = the card's highest-numbered version. Already on it → refuse: _‹name› already reads the card's current version, ‹label›._ (label via `v<label>` when it starts with a digit, the label as is otherwise, `Version N` with none — the client's `versionLabelText` rule; put it in one small helper.)
  - `moved = await updateMemberToCardVersion(tx, castId, current.id)`.
  These sentences are provisional (★) — list them in your report.
- After it: `relistBindings(...)`, then emit `lorebooks:updateMemberToCardVersion` with `{ lorebookId, castId, moved, cardVersion: {id, number, label}, lorebookBinding: (await castMemberRowsOf(db, [row]))[0] }` and return it. (`lorebookId` top-level: the event is scoped on it.)
- ‹name› = the member's shown name (`memberShownName` against the card, as `bindingsForCharacter` names members).

### B3 — the admin lift list
- `castLiftNotes(db): Promise<Sockets.Admin.CastLiftNotes.Response>` in `admin/castLiftNotes.ts` (reads only): every member **base** version (cast, main, undated, no life point, no source session — `isBaseVersion`'s shape) whose `note` parses with `parseLiftNote` and has `differences.length > 0` or `mixedGreetings`. Do not filter on `written_by`: a later member edit may rewrite the base; check and report whether `writeCastVersion` / `updateCastVersion` keep `note` (do not change them if they don't — report it). Join the book's name; `memberName` = `membersAsRead(db, ids)` `shownName` (main at its head), else the binding's name. Order by book name, then member name, then id. `count` = `members.length`. A bounded number of queries.
- `followCardGreetingsAfterLift(tx, castMemberId, writtenBy)` in `characters/versions.ts` (the one writer of `character_versions`; `versionsWriter.guard` must stay green):
  - base = the member's base; note = `parseLiftNote(base.note)`. No `mixedGreetings` → refuse: _This cast member's greetings were not changed by the upgrade._ The base has no parent card version → refuse: _This cast member reads no card now, so there are no card greetings to follow._
  - Targets: the member's non-retired versions whose `writtenBy` is `'lift'` (the base included, whatever its `writtenBy`), that have a parent, do not follow `greetings`, and hold greetings JSON-equal to the base's — the lift's copies of the mixed list. Each: `updateCastVersion(tx, id, { changes: { greetings: { follow: true } } })` (a row a branch reads is retired and re-inserted by it).
  - Rewrite the base's `note` without `mixedGreetings`; null when no difference is left.
  - Answer how many versions now follow. Doc comment cites the owner ruling 2026-11-05 _"Own list, noted"_ (one-click **Follow the card's greetings**).
- `sockets/adminCastLift.ts`: `admin:castLiftNotes` (admin only — `if (!socket.user!.isAdmin) throw new Error("Unauthorized")`, as `admin:overview`) answers `castLiftNotes(db)` and emits it; `admin:castLiftFollowGreetings { castMemberId }` (admin only): one transaction with the member's book lock → `followCardGreetingsAfterLift(tx, id, \`user:${userId}\`)`; then emit `admin:castLiftNotes` with the refreshed list, push the Overview stale signal if `admin/overviewStale.ts` offers a plain call, and answer the refreshed list (emit it as `admin:castLiftFollowGreetings` too, so `awaitReply` hears it). Refusals through the existing `:error` mechanism (`refusable` if the admin handlers can use it; otherwise the pattern the admin handlers use).
- `adminOverview.ts`: `data.castLiftCount = (await castLiftNotes(db)).count` (or a count helper in the same module that shares the filter — one rule).

## Rules (quoted by the supervisor)
- CLAUDE.md: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never add a top-level `await` to `src/lib/server/db/index.ts`"; no static `$lib/server/db` import in a module tests mock (`characters/versions.ts` takes its handle as an argument — keep it so).
- Only `characters/versions.ts` writes `character_versions`; `frozenColumns.guard` and `versionsWriter.guard` stay green.
- "An event in `SCOPED_EVENTS` must carry its scope key … in the payload, or `emitToUser` silently sends nothing."
- "Members never see or touch model plumbing" — not touched here; the admin list is admin-only.
- Every session has a lorebook — never write "no book". It is a **session**, never a *chat*.
- Nomenclature R1/R3: use only the contract's names plus `castLiftNotes`, `followCardGreetingsAfterLift` and internal helpers (say which). No other new exported name, setting, event, table or migration — stop and report.
- Decide implementation inside this scope and name each choice; anything beyond → stop and report.

## Tests (Done means)
New int files (60 s timeout on every `it` that opens a DB):
- `src/lib/server/sockets/lorebooks.updateMemberToCardVersion.int.test.ts`: a carded member, the card gets v2 (`newCardVersion`) → the event moves it (`moved` ≥ 1, reply `cardVersion` = v2, `lorebookBinding.behindCard: false`); a second call is refused with the "already reads" sentence; a card-less member is refused; a non-owner is refused; the reply carries `lorebookId`.
- `src/lib/server/sockets/adminCastLift.int.test.ts`: a lifted member with mixed greetings and one with a difference → `admin:castLiftNotes` lists both (names, book name, notes), a non-admin is refused; **Follow the card's greetings** → the base follows `greetings`, the note loses `mixedGreetings` (null when nothing else is left), the count drops, the Overview's `castLiftCount` agrees, a second follow is refused.
Then run, `--maxWorkers=2`, never piped into `head`:
`npx vitest run src/lib/server/sockets/lorebooks.updateMemberToCardVersion.int.test.ts src/lib/server/sockets/adminCastLift.int.test.ts src/lib/server/sockets/lorebooks.memberShownVersion.int.test.ts src/lib/server/admin/attention.test.ts src/lib/server/characters/versionsLift.int.test.ts src/lib/server/characters/versions.authoring.int.test.ts src/lib/server/characters/versionsWriter.guard.test.ts src/lib/server/characters/frozenColumns.guard.test.ts src/lib/server/sockets/scopedReplies.lorebooks.int.test.ts --maxWorkers=2`
plus any test that checks `interest.ts` / `GATED_EVENTS` against emitted names (find it: `grep -rl GATED_EVENTS src --include=*.test.ts`), and `npx tsc --noEmit -p .` (no errors in your files; list others). List `/tmp/serene-pub-vitest-*` before and after; delete only your own, by name.

## Report (final message)
Names and signatures first; changed files; tests with counts; the provisional sentences (★); whether `note` survives member edits; choices you made; anything you stopped on; Noticed, not done.
