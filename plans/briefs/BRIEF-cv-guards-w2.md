# BRIEF cv-guards-w2 — no straggler read; one insert; frozen-column fallbacks out

Worker for lane **cv-guards** (supervisor: lane-supervisor, Opus). Repo `/home/jody/github/serene-pub`. Use absolute paths. Report back as your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk` or `../mundi-sp`.

## Context
Character versions (S4 stage 1, owner GO 2026-11-05). One table `character_versions` holds every card version and every cast-member version; `src/lib/server/characters/versions.ts` is **the one writer** (a leaf: no static `$lib/server/db` import; callers own the transaction; other modules reached by `await import()`). Every member gets a **base** version when it is made (`insertCastMember`), and the boot pass `character-versions` lifted every existing member. The old member columns are **frozen** (⏳, dropped in S5): `lorebook_bindings` `description, personality, scenario, first_message, alternate_greetings, example_dialogues, face_media_id, retold, own_name, own_nickname, timbre, sprite_set, node_state, node_visibility`, and the `cast_amendments` table. Nothing writes them any more, so **any read of them is stale**.

Owner-settled design (plan §33.5, quoted): "the straggler legacy read is **deleted in S4's guards step** (a member with no base is a logged error)." And §32 §8: "**No** lifted member keeps a legacy read or write. `cast_amendments` and the retold columns freeze. The duplicate writer at tableRegistry.ts:644-667 moves onto versions."

A guard test now exists (`src/lib/server/characters/frozenColumns.guard.test.ts`, `versionsWriter.guard.test.ts`, scanner `characters/guardScan.ts` — **don't edit those three**; run them to see your sites disappear). Another worker (w3) edits at the same time: `utils/lorebookExportBuilder.ts`, `sockets/characters.ts`, `sockets/import.ts`, `utils/personaCard.ts`, `lorebooks/starterKits.ts`, `characters/cardIO.ts`, `rulesets/ties.ts`, `pipelines/runtime/host.ts`, `media/access.ts`, `sockets/jump.ts` and their tests. Never touch those.

Rules (CLAUDE.md, quoted): "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." "Never add a top-level `await` to `src/lib/server/db/index.ts`." No static `$lib/server/db` import in `versions.ts` or `cast/memberAsRead.ts` (tests mock it). "It is a **session**, never a *chat*." Every session has a lorebook — never write "no book"/"no lorebook" in a comment or message. Name every choice you make in the report; do not add an option, flag, setting or exported name beyond the ones named here.

## Files owned (edit only these)
- `src/lib/server/cast/memberAsRead.ts` and its tests (`cast/memberAsRead*.test.ts`)
- `src/lib/server/characters/versions.ts` (items 4, 5, 6 only) and its tests
- `src/lib/server/lorebooks/retold.ts`, `lorebooks/retold.int.test.ts`
- `src/lib/server/pipelines/prompt/seatCards.ts` (the one doc comment), `pipelines/prompt/seatCards.test.ts`, `pipelines/runtime/transcript.castNames.test.ts`, `pipelines/runtime/host.seatMembers.int.test.ts` (header comment only)
- `src/lib/server/lorebooks/tableRegistry.ts` and its tests (`lorebooks/tableRegistry*.test.ts`, `lorebooks.duplicate.int.test.ts` wherever it lives)
- `src/lib/server/pipelines/testing/fixtures.ts`
- `src/lib/server/sockets/amendments.ts`, `sockets/lorebooks.ts`, `sockets/narrativeGraph.ts`, `utils/characterBindingSync.ts`, `utils/forkHistory.ts` — only the hunks named below
- **Test fixtures elsewhere that break only because of item 1** (a test inserted a member raw, `tx.insert(schema.lorebookBindings)`, with no base, and now reads nothing): switch that fixture to `insertCastMember` (or `insertLorebookBindingRow` from `pipelines/testing/fixtures.ts`) and list every such file in the report. Don't change what a test asserts unless the assertion was about the legacy read itself; say which.
- **Do not edit `NOMENCLATURE.md`.** Put proposed §25 rows in your report.

## Items

### 1. Delete the straggler legacy read (`cast/memberAsRead.ts`, §33.5)
- In `membersAsRead`, a member with no version that reads on the reading (`picks` lacks it) is **left out of the map** and logged with `console.error`, once per member id per process: two sentences, one for "has no character version at all" and one for "has character versions, but none reads on this reading" (keep the `hasVersions` query to tell them apart). No legacy read, no `castOverlaysFor` / `castMemberAt` import, no legacy card select (the `cards` map and the `c.description…extensions` select exist only for it), no `asRowForReading`, no `warnedLegacy`. `MEMBER_COLUMNS` keeps only `id`, `lorebookId`, `characterId` (no frozen column may be read here).
- Keep `layerMemberAsRead`, `MemberRowForReading`, `CardRowForReading`, `followsCardFields` exported: the boot lift (`characters/versionsLift.ts`) compares today's fold with them, and `sockets/lorebooks.ts` uses `followsCardFields`. Re-document `layerMemberAsRead` as the lift's comparison (pure; reads no table).
- Rewrite the file header's "## The legacy read" and `membersAsRead`'s doc: a member with no base is a logged error and is absent from the map, as an unknown id is. `castVersionId`'s doc: null only from `layerMemberAsRead`.
- Update `memberAsRead` tests: one test that a raw-inserted member (no version) is absent and `console.error` is called once (spy), and that a member whose only rows are cut away is absent too if such a test is cheap.

### 2. Retire `retold.ts`'s dead frozen readers
Delete `retoldMembersForSession`, `retoldByCard`, `castIdentityExtras`, `applyRetold`, `RETOLD_MEMBER_COLUMNS`, the private `asRetoldMember`, and `RetoldMember` if nothing else uses it (`retellsAnything` takes a `Pick<RetoldMember,…>` — re-type it inline if it stays used; delete it if unused). Grep first (`grep -rn` over `src`); production callers must be none. Tests:
- `retold.int.test.ts`: delete the describes/tests that exercise only the deleted functions (`applyRetold`, `own names (§0-D)` cases on `applyRetold`, `retoldMembersForSession`, `castIdentityExtras`, the face test's `retoldMembersForSession` half — keep its `faceMediaProblem` half). Update its header list.
- `seatCards.test.ts` uses `applyRetold` as an oracle (`expect(seatCardAsRead(c, asRead(m, c))).toEqual(applyRetold(c, m))`): replace the oracle with the explicit expected object for each case (compute it once from today's `applyRetold` behaviour before deleting it), so the cases keep testing the same thing.
- `transcript.castNames.test.ts`: same — replace `applyRetold(card, {...})` with the literal shown card it produced.
- `seatCards.ts` ~50 doc and `host.seatMembers.int.test.ts` header: reword the mention of the deleted function (no behaviour change).

### 3. Remove every "a member with no version keeps its columns" fallback (the guard's sites)
With item 1 no member lacks a base, so these fallbacks read frozen, stale columns. Remove the frozen column from the select and the fallback branch; where a value is needed and there is no version, use the version's default (`ownName/ownNickname` null, `nodeState` "active", `nodeVisibility` "normal", `spriteSet` null, `faceMediaId` null) or skip the member — say which at each site.
- `sockets/amendments.ts` ~770–794: the `row` select of `faceMediaId, retold, ownName, ownNickname` from `lorebookBindings` when no `held` base. A missing base is now an error: throw the existing lift sentence used elsewhere for a member with no base (find it in `versions.ts`, `ensureMemberBase`) or treat `stored` as empty — pick the one that keeps the provided-book check safe, and say which.
- `sockets/lorebooks.ts` ~2493–2503: `wornStored` (the faces of members with no version). Delete it and its union.
- `sockets/narrativeGraph.ts`: ~1132–1135 (`ownName, ownNickname, nodeState, nodeVisibility` selected then replaced by the version's — take them from the version only; check what reads `b.nodeState`/`b.nodeVisibility` later); ~1394 `characters.summary` + `characters.description` for `fallbackSummary` (frozen card content: read the card's **current version** profile instead — `ensureCardVersion` / `profileOf` from `versions.ts` / `shared/characters/profile.ts`, or one select of `character_versions` current rows for those card ids; the description copy is allowed outside the session path but use the version for both so one source answers); ~2773–2775 (`nodeState, nodeVisibility` selected beside `id` for `storyStatesOf` — select only what `storyStatesOf` needs); ~5569–5571 (`spriteSet, nodeState, nodeVisibility` of the tag holder — take them from `holderRead` only).
- `utils/characterBindingSync.ts` ~105: `characters.aliases` (frozen card content) → the card's current version's `aliases` (keep `name`, `nickname`, `userId` from the row — those are allowed copies outside the session path, or take name/nickname from the version too; say which); ~135–136: the frozen `ownName/ownNickname` fallback → remove.
- `utils/forkHistory.ts` ~355–359: the `castAmendments` UPDATE (a write to the frozen table). Delete it — `repointVersionHistory` just above replaces it, and `cast_amendments.history_entry_id` is `ON DELETE SET NULL`, so a deleted entry never strands a row. Adjust `forkHistory*.int.test.ts` only if one asserts the amendment re-point (say which).

### 4. One insert: the book copy's member insert (`tableRegistry.ts` ~356–376; queued by cv-member)
The member copy inserts `lorebook_bindings` raw on purpose: `insertCastMember` would add a second base beside the copied versions. Add to `versions.ts` 🚧 `insertCastMemberCopy(tx, values): Promise<MemberRow>` — inserts one member **without** a base, documented as "the book copy only: its versions are copied right after by the `character_versions` spec"; `tableRegistry.ts` calls it. Guard 1 must then pass.

### 5. Stop copying the frozen `cast_amendments` (`tableRegistry.ts` ~645–670)
Per §32 §8 ("The duplicate writer at tableRegistry.ts:644-667 moves onto versions"): its `copy` copies nothing and the spec sets `notCopied` with the reason (frozen; the versions copy carries the member's history). Keep its `purge` and `count`. Check `lorebooks.duplicate.int.test.ts`'s equality handles `notCopied` (it is the registry's documented field); fix the test only if it compares this count. Remove `remapAmendedFields` if it becomes unused, and fix the `castAmendments` spec doc that still calls the table live.

### 6. `versions.ts` small items
- **`insertCard` strips U+0000** from the card's own text/json columns before its `characters` insert (the private `withoutNul` already exists; a NUL in a card field must not fail the insert). Add a test: a card whose description and an extension string contain `\u0000` inserts, and the stored values have it removed.
- **One `isBaseVersion`:** export the private `isBase` as 🚧 `isBaseVersion(v)` from `versions.ts` (same predicate); `sockets/amendments.ts` imports it and drops its own copy.

### 7. Fixtures (`pipelines/testing/fixtures.ts`)
`insertNarrativeNodeRow`'s bound branch (`lorebookBindingId` given) UPDATEs binding columns, which leaves the member's base stale for frozen keys. Split `rest`: live columns (`name, aliases, absorbedAliases, summary, sceneId, historyEntryId, parentNodeId`, …) still UPDATE the row; frozen keys (`nodeState, nodeVisibility`, and any other frozen one present) go to the member's base version through `updateCastVersion` (find the base with `isBaseVersion`). The unbound branch already uses `insertCastMember`. Check `sprites.pipeline.int.test.ts` `scene()` and `retold.int.test.ts` `cast()` — cv-fix reports they already use `insertCastMember`; confirm, change nothing if so.

## Done means
- `npx vitest run src/lib/server/characters/versionsWriter.guard.test.ts` passes; `frozenColumns.guard.test.ts` no longer lists any site in your files (other sites remain — not yours).
- Targeted runs pass (`--maxWorkers=3`, never piped into `head`): `src/lib/server/cast src/lib/server/characters src/lib/server/lorebooks`, `src/lib/server/pipelines/prompt/seatCards.test.ts src/lib/server/pipelines/runtime/transcript.castNames.test.ts src/lib/server/pipelines/runtime/host.seatMembers.int.test.ts`, `src/lib/server/sockets/amendments* src/lib/server/sockets/lorebooks* src/lib/server/sockets/narrativeGraph* src/lib/server/utils/characterBindingSync* src/lib/server/utils/forkHistory*`.
- **The fallout run:** after item 1, run every test file listed in `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad/cv-guards-rawmember-files.txt` (160 files that insert members raw; all 160 passed before your change) plus every test file that imports `insertNarrativeNodeRow`: `npx vitest run --maxWorkers=3 $(cat <that file>) <the others> > <scratchpad>/cv-guards-w2-fallout.log 2>&1` (scratchpad = `/tmp/claude-1000/-home-jody-github-serene-pub/66e86768-ea43-4e92-bc4d-5f956a670b22/scratchpad`). Fix each failure that comes from a raw member fixture; report any failure that is something else, with its first error line, without fixing it.
- `npx tsc --noEmit -p .`: no errors in your files (others' may exist; list only yours). Prettier: new test files clean; in old files format only your hunks.
- Before your first vitest run, list `/tmp/serene-pub-vitest-*`; after your last, list again; delete only the dirs your runs left (by name). Report them.
- Report: names and signatures first; changed files; tests with counts; every fixture you switched; proposed §25 rows; choices; Noticed, not done.
