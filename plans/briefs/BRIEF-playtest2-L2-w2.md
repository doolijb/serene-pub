# BRIEF playtest2-L2-w2 — server readers name a cast member by their own name in the book

Lane `playtest2-L2` · worker w2 · report `plans/REPORT-playtest2-L2-w2-2026-11-04.md` (if the harness refuses the write, put the full report in your final message).

## Background (read, do not edit)
- `src/lib/shared/lorebooks/memberIdentity.ts` is the ONE reader of what a cast member is called in a book (ruled 2026-11-04): `memberNames(member, card)` → `{ name, nickname }`; `memberShownName(member, card, fallback)` = nickname || name || fallback after the member's own; `withMemberNames(card, member)`; `hasOwnNames(member)`. A member is a `lorebook_bindings` row; its own names are the columns `own_name` / `own_nickname` (`schema.lorebookBindings.ownName` / `.ownNickname`), NULL = the card's.
- Server side, the members a session reads are resolved by `retoldMembersForSession(db, session | {id, lorebookId}, cardIds?)` in `src/lib/server/lorebooks/retold.ts` → `Map<cardId, RetoldMember>` (with `ownName`/`ownNickname`), already resolved at the session's reading (line, date, overlays). It returns only members that retell something or carry own names, so a card absent from the map reads as the card. `applyRetold` in the pipeline host already applies the names to the `session_cast` read — so a reader fed from that read may already be right: **check the source before changing anything.**
- Rule **R1 (NOMENCLATURE §1): one word, one meaning — and here, one rule.** Never write a second `ownName ?? …` rule; call the helper. **Keep each reader's own choice** between the plain name and nickname-or-name: where it read `card.name`, read `memberNames(member, card).name`; where it read `nickname || name` / `resolveCharacterName`, read `memberShownName(member, card, sameFallback)`. Personas (`personaId`, `sessionPersonas`) keep the card's name.
- Where a reader has a session id, use `retoldMembersForSession`. Where it has a book's binding rows directly, select `ownName`/`ownNickname` with them and pass the row. Never a new socket field.

## Goal — change only the name expression (plus the reads it needs)
1. `src/lib/server/sessions/rowProjection.ts` `lastVisibleMessages` (~93-160, session cards' "speaker: excerpt"): a character line's `speakerName` reads the member's own names. It serves up to ~40 sessions in one call, so do NOT call `retoldMembersForSession` per session blindly: first one query for which of these sessions' books have any member with an own name or own nickname (`sessions.lorebookId` joined to `lorebook_bindings` where `own_name IS NOT NULL OR own_nickname IS NOT NULL`), then `retoldMembersForSession(db, { id, lorebookId }, [characterIds])` only for those sessions. Add `characterId` (and what else you need) to the select. A session with no such member costs one extra query in total, not per session.
2. `src/lib/server/pipelines/runtime/runStatus.ts` (~221, the `{speaker}` status): `memberShownName(member, row, "")` with the member from `retoldMembersForSession(db, opts.sessionId, [id])` when `opts.sessionId` is a number.
3. `src/lib/server/pipelines/runtime/fireAction.ts` `answererName` (~1258): the character answer's name via the member of the form's session (find the session id the caller has; pass it in if needed — a private function's parameter is yours to add). Keep `nickname?.trim() || name` semantics via `memberShownName`.
4. `src/lib/server/pipelines/scripts/chains.ts` (~754-775): `out.speakerName` and `out.castNames` read the members of `scope.sessionId` (one `retoldMembersForSession` call for both); they read `c.name` today → `memberNames(member, card).name`.
5. `src/lib/server/pipelines/runtime/transcript.ts` `castNames` (~117): trace where `input.cast` comes from (the `session_cast` read in `runtime/host.ts` already runs `applyRetold`, which sets `name` to the own name). If every source already carries the shown names, change nothing in the code and add the test below proving a cast whose `name` was applied reads through; if a source does not, say which one in the report (host.ts is NOT yours — queue it).
6. `src/lib/server/pipelines/entities/sideCharacter.ts` `listSideCharacterOptions` (~295): a removed cast member offered again shows the book's names — apply `withMemberNames` with the session's members (`retoldMembersForSession(db, sessionId, ids)`), keeping the returned `{ id, name, nickname }` shape.
7. `src/lib/server/sockets/narrativeGraph.ts`:
   - ~1027-1045 `bindingMap`: select `ownName`/`ownNickname` beside the binding; a carded member's label = `memberShownName({ ownName, ownNickname }, { name: characterName, nickname: characterNickname })`; the card-less branch stays.
   - ~1495-1515 the graph builder's message `senderName`: a character's sender name reads the session's members (`retoldMembersForSession` for that session and those character ids) with the same fallback chain it has now.
   Touch nothing else in this file.

Rows that lack the own-name columns' values (NULL, older rows) must read exactly as before.

## Tests (one case per reader group; add beside the file)
- New `src/lib/server/sessions/rowProjection.castNames.int.test.ts`: a session whose book's member has an own name → the card's `speakerName` is it; another session in the same call without → the card's name.
- `src/lib/server/pipelines/runtime/runStatus.int.test.ts` (+1): `{speaker}` is the own name.
- `transcript`: a case in an existing transcript test (find `transcript*.test.ts` under `pipelines/`, or add `src/lib/server/pipelines/runtime/transcript.castNames.test.ts`): `castNames` over a cast whose entry went through `applyRetold` with an own name gives it.
- `narrativeGraph`: +1 in the `narrativeGraph.*.int.test.ts` that already exercises binding tokens / build (read them; `narrativeGraph.buildReadsStoredCast.int.test.ts` is a likely home) — the graph names the member by the own name.
- `fireAction`, `chains`, `sideCharacter`: a case each where an existing test file makes it cheap (`fireAction.collects.int.test.ts`, `chains.sideCharacterExtras.int.test.ts`, `sideCharacterSpeaker.test.ts`); otherwise say in the report why not.
Int tests that open a DB inside a test get `vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })`. Make temp data dirs with the prefix `serene-pub-vitest-l2-` and release them with the existing `releaseDataDir` helper (see `src/lib/server/lorebooks/castOwnNames.int.test.ts` for the pattern, including `vi.mock("$lib/server/db", …)` with `createTestDb`). Seed own names by updating `lorebook_bindings.own_name` directly. Never seed a row at a hardcoded id.

## Files owned (edit only these)
`rowProjection.ts`, `runStatus.ts`, `fireAction.ts`, `chains.ts`, `transcript.ts`, `sideCharacter.ts`, `sockets/narrativeGraph.ts` (the two blocks), and the test files above (new or +cases).
NOT yours: `runtime/host.ts`, `sockets/sessions.ts`, `lorebooks/retold.ts`, `memberIdentity.ts`, `shared/sockets/types.ts`, `NOMENCLATURE.md`, `server/plugins/**`, `scenes/liveScenes.ts`, anything under `client/`. If one of those needs a change, put the file:line and exact text in your report.

## Rules (from CLAUDE.md, quoted)
- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "Never add a top-level `await` to `src/lib/server/db/index.ts`; await `dbReady`."
- Modules that say "Must not statically import `$lib/server/db`" take their handle; keep that.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing 'for later'."
- No new exported name, field, event or error string. A private parameter or local is fine; say it in the report. If you think you need a new export, stop and say so.

## Stop and ask when
A reader can't reach a member row or the session without a new socket field; a name is new.

## Done means
Green, run like this (one run per batch; read the log after; never pipe vitest into `head`):
```
systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 <the test files you touched or added> > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest2-L2-w2-<n>.log 2>&1; echo exit=$?'
```
Include `runStatus*.test.ts`, the `narrativeGraph.*.int.test.ts` you touched, the new rowProjection test, and the transcript test. `npx prettier --check` each changed file. Never `tsc` over the project, `npm run check`, or `npm test`.

## Report
Changed files with one line each · tests run, exact command, pass/fail counts · assumptions made · Queued for other lanes (file:line + exact text) · Noticed, not done.

## Verbatim lane rules
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."* Also never `git checkout`, `git restore` or `git clean` in either repo.
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (You should not need an SDK build.)
