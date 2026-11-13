# BRIEF cv-close-w2 — pre-versions fixtures, the parity cause, the retire step in Update (2026-11-06)

Worker for lane **cv-close** (supervisor: Opus lane-supervisor). App root `/home/jody/github/serene-pub`. Another worker (w1) runs at the same time on other files; never touch its files (listed under Out of scope).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

Extra for this lane: **do not delete any `/tmp/serene-pub-vitest-*` dir at all** — w1 runs tests at the same time and you cannot tell its dirs from yours. Before your first vitest run do `ls -d /tmp/serene-pub-vitest-* 2>/dev/null > <scratchpad>/cv-close-w2-tmp-before.txt` and after your last one the same into `cv-close-w2-tmp-after.txt`; the supervisor cleans up. Never pipe vitest into `head`/`tail -n` while it runs (write to a log file, then read the log). Always `--maxWorkers=2`. Int tests that open a DB inside a test need a 60 s timeout. Don't run `prettier --write` on whole files; keep diffs to the lines you change (other lanes' uncommitted hunks sit in these files).

`<scratchpad>` = `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad`.

## Rules you work under (quoted)
- CLAUDE.md Hard rules: "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never seed a row at a hardcoded id." "Migrations are generated" (none is expected here — if you think you need one, stop and ask).
- Plan §33.2 (settled): a cast version a session forked from still reads (`descendantReads`) is protected — an authoring change to it **retires** the row (`retired_order` = the next write order, `nextWriteOrder(tx)`) and inserts the changed copy with the same provenance; a row no branch reads is changed in place; **retired rows are never touched**.
- Plan §32 §9 (Update): "Update is authoring. It re-parents only that member's versions whose parent is an older version of the same card."
- In production every card is made by `insertCard` (it inserts the card and its v1; `src/lib/server/characters/versions.ts` ~435) and every cast member by `insertCastMember` (member + base version, ~640); the boot pass `character-versions` (`versionsLift.ts`) gives every older card its v1 and lifts every older member. `characters.avatar_media_id`, `characters.name`… are ⏳ **frozen copies** of the current card version, written only by `writeCardCopies`; readers read versions (`cardsNow`, `membersAsRead`, `faceMediaId` on versions). So a test fixture that inserts a card or a member raw, or sets a frozen column raw, is a **pre-versions fixture**.

## Goal

### A. `src/lib/server/sockets/shares.int.test.ts` › "jump — shared items reach the recipient" › "characters and lorebooks shared with the asker are found"
Decided (supervisor): **the fixture is pre-versions, the product is right.** The test inserts the card raw (`db.insert(schema.characters)`), so it has no version; `jumpSearch` (`sockets/jump.ts` `searchCharacters`) inner-joins the current card version, and in production no card lacks one. Change the fixture to make the card through `insertCard(db, { userId: owner.id, name, description: "" })` (import from `$lib/server/characters/versions`; use `.card`). Check the other tests in this file for the same raw card insert **only if they fail**; leave passing ones alone.

### B. `src/lib/server/sockets/sprites.int.test.ts` › "deleting a sprite deletes its file, unless the file is also the avatar"
Decided: **fixture is pre-versions.** It sets the avatar raw on the frozen column (`update(schema.characters).set({ avatarMediaId })`); `releaseSpriteFile` (`src/lib/server/sprites/index.ts` ~585) keeps a file any character version holds as its face, which is the right rule. Set the avatar through the normal path instead: call the `charactersSetAvatar` handler (`src/lib/server/sockets/characters.ts` ~2594: `{ characterId, mediaId }`) the way the file calls other handlers (`socket(user.id)`, `capture().emit`). If the handler refuses (e.g. the sprite file's `characterId` doesn't match), fall back to `updateCardVersion(testDb, (await ensureCardVersion(testDb, character.id))!.id, { faceMediaId })` and say why. Also check how `setup(...)` in this file makes the card; if raw, leave it (cardsNow/ensureCardVersion give it a lazy v1) unless that is what breaks the test.

### C. Parity harness `src/lib/server/pipelines/parity/harness.int.test.ts` › "session/decorated-lore"
The pipeline path leaves `{{char:1}}` unresolved in the lore entry while the legacy path names Alice. Supervisor's diagnosis (verify it): the fixture `decoratedLore` (~line 456) inserts the cast member raw (`db.insert(schema.lorebookBindings).values({ lorebookId, characterId, binding: "{{char:1}}" })`) with **no base version**. The pipeline host (`src/lib/server/pipelines/runtime/host.ts` ~4260–4295) names members from `membersAsRead(...)` (`read?.shownName`, `characterId: read?.activeCardId ?? null`); a member with no version reads as absent, so the binding gets no name and `hydrateBindings` gets `characterId: null`. Production never has such a member (`insertCastMember` / the lift). Fix the cause in the fixture: make the member with `insertCastMember(db, { lorebookId: w.lorebook.id, characterId: w.characters[0]!.id, binding: "{{char:1}}" })` (plus whatever required columns the raw insert had). Then run the harness and confirm `session/decorated-lore` agrees and **all 10 fixtures stay green**. If the cause turns out different (e.g. the member reads but `castTagName` gets nothing because the card raw-insert lacks a version at the reading), report what you found with file:line before changing product code — product changes in `host.ts`/`memberAsRead.ts` are **out of scope**; stop and report instead.

### D. `updateMemberToCardVersion` gets the retire step (`src/lib/server/characters/versions.ts` ~711)
Today it re-parents with one bulk `UPDATE … SET parent_version_id` every version of the member whose parent is an older version of the target's card — retired rows and rows a branch reads included. Change it so that:
- only **non-retired** rows are in scope (`retired_order IS NULL`); retired rows are never touched;
- each in-scope row a session forked from still reads (`row.sourceSessionId != null && await descendantReads(tx, row.sourceSessionId, row)`) is **retired** (`retiredOrder: await nextWriteOrder(tx)`) and a copy with the new parent is inserted with the same provenance — exactly the step `reparentCastVersions` does (~1062–1105: `copyOf(...)` with branch/date/history/hour/minute/life point/source session/message/validFrom/writtenBy/note, then `insertRows(tx, [{ ...copy, parentVersionId }], false)`); its `own` is the row's own profile unchanged and its `follows` the row's own (Update changes only the parent);
- every other in-scope row is updated in place (parent only), as today;
- the return value still counts every changed row (both kinds); the doc comment says the retire step.
Prefer extracting the retire-then-copy block of `reparentCastVersions` into one **non-exported** helper both functions call, over duplicating it — but only if `reparentCastVersions`' behaviour stays byte-for-byte the same; its existing tests prove it. Name the helper plainly (it is private; no NOMENCLATURE row). No new export, option or parameter.
Keep the existing refusals (unknown id; a cast version as target).

**Test** — add to `src/lib/server/characters/versions.int.test.ts` (where `updateMemberToCardVersion` is already tested), modelled on `versions.authoring.int.test.ts` ~663 "the retire step: a row a branch reads is retired and the re-parented copy inserted; a retired row is never touched": a member with (1) a version a branch reads, (2) a session-written version no branch reads, (3) an already-retired row, all on card v1; update to v2 → (1) retired and a copy on v2 with the same provenance, (2) moved in place, (3) unchanged (parent and `retiredOrder` as before); the returned count. Reuse that file's helpers for sessions/branches; read how the authoring test builds "a branch reads it".

## Files owned
- `src/lib/server/sockets/shares.int.test.ts`
- `src/lib/server/sockets/sprites.int.test.ts`
- `src/lib/server/pipelines/parity/harness.int.test.ts`
- `src/lib/server/characters/versions.ts` (only `updateMemberToCardVersion`, and `reparentCastVersions` for the helper extraction)
- `src/lib/server/characters/versions.int.test.ts`

## Files readable
Anything in the repo.

## Out of scope (never edit)
w1's files: `CharacterForm.svelte`, the `*.interestGate.test.ts` files, `castVersionRead.ts`, `guardScan.ts`, `ownBook.ts`, `seatCards.ts`, `vectorizationQueue.ts`, `docs/sessions.md`. Also `host.ts`, `memberAsRead.ts`, `jump.ts`, `sprites/index.ts`, `sockets/lorebooks.ts`, NOMENCLATURE.md, any client file, any migration.

## Stop and ask when
A fix would need product code outside `versions.ts`; a new export/name/option/setting/migration; the parity cause is not the fixture. Write it in the report and stop that item.

## Done means
One run per group, each to a log in `<scratchpad>`:
- `npx vitest run src/lib/server/sockets/shares.int.test.ts src/lib/server/sockets/sprites.int.test.ts --maxWorkers=2 > <scratchpad>/cv-close-w2-ab.log 2>&1` — green.
- `npx vitest run src/lib/server/pipelines/parity/harness.int.test.ts --maxWorkers=2 > <scratchpad>/cv-close-w2-parity.log 2>&1` — green.
- `npx vitest run src/lib/server/characters/versions.int.test.ts src/lib/server/characters/versions.authoring.int.test.ts src/lib/server/characters/versions.test.ts src/lib/server/characters/versions.write.int.test.ts src/lib/server/sockets/lorebooks.updateMemberToCardVersion.int.test.ts --maxWorkers=2 > <scratchpad>/cv-close-w2-versions.log 2>&1` — green (drop a path that doesn't exist and say so; `ls src/lib/server/characters/versions*` first).
- `npx tsc --noEmit -p .` — 0 errors (to a log).
- `npx prettier --check` on every file you touched (if a file was unformatted before you, say so; don't reformat it).

## Report
Return your report as your final message (no report file): for each of A–D what the cause was and what you changed (file:line), the helper's name and signature if you extracted one, tests with pass/fail counts and log paths, the tmp-dir before/after file paths, open questions, Noticed-not-done.
