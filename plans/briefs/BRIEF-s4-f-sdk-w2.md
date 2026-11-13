# BRIEF — lane `s4-f-sdk`, worker 2 — ★B-4: remove `core:outlet/attach-lorebook@1` (SDK + app) — 2026-11-08

You are a lane-worker for supervisor `s4-f-sdk`. SDK repo: `/home/jody/github/serene-pub-sdk` (edit SDK code **there**). App: `/home/jody/github/serene-pub`.

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*
*Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
*Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.*
*Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.*

You do **not** run `sdk:build` (the supervisor does, once worker 1 is also done). So the **app** half can't be typechecked or tested against the new SDK until then: write it, run the app tests that don't need the new SDK export if any, and list the rest as "waits on sdk:build" in your report. Never `git checkout` / `restore` / `stash` in either repo. Prettier: `--check` changed files and **only reformat lines you changed**. Scratch files: `/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w2-*`.

## Rulings (quoted; never reinterpret)

- 2026-11-05 ★27-10: "All sessions have a lorebook, [own book] or overlay. No exceptions so SDK data storage API is predictable. No swapping lorebooks."
- 2026-11-08 ★B-5: the book is **fixed at start** — chosen at create.
- 2026-11-08 ★B-4: "Remove the published `core:outlet/attach-lorebook@1` now (No swapping leaves it nothing to do)." — ruled as recommended.
- **Modder rule (owner 2026-11-08):** "a refusal says what to do instead; every removed/renamed published name gets a migration note (old → new, one example)."
- CLAUDE.md: "0.6 is in users' hands. A change to stored data or ids ships with a forward migration or boot pass…" — here **no stored data changes**: old `state_proposals` rows with `op: "attach-lorebook"` stay as they are and must keep **reading** (ledger lines) without crashing; accepting an old pending one is refused in words.
- CLAUDE.md "One verdict per law — core's doors quote the SDK's verdicts": the removal sentence lives once, in the SDK; the app quotes it.
- Memory rule "There is ALWAYS a lorebook": never word anything as a session having no lorebook.
- NOMENCLATURE R3: qualify, never the bare noun (`node definition`, never `definition` alone in a new name). "retired" already means a stat slot greyed but kept — so a definition that is gone is **removed**, not retired.

## Goal

### SDK

1. `contracts/src/outlets.ts` ~2167-2192: delete the `attachLorebook` declaration and its JSDoc. Check nothing else in `contracts/src`, `sdk/src`, `core-catalog/src` names it (grep `attachLorebook`, `attach-lorebook`).
2. **The words a stored pipeline fails with.** Today the executor (`sdk/src/executor.ts` ~1512-1513, `invokeInner`) answers a node whose definition is gone with `err(\`unknown type ${id}@${v}\`)`. Add, in `sdk/src/descriptors.ts` next to `getDefinition` (~2873), one `@internal` 🚧 table and one `@internal` 🚧 reader (these two names are proposed by the supervisor; use exactly them):
   - `REMOVED_NODE_DEFINITIONS: Readonly<Record<string, string>>` — definition id **without** the `@N` pin → the sentence. One entry:
     `'core:outlet/attach-lorebook'` → `"Reading a lorebook into a session was removed in 0.6: a session keeps the lorebook it started with. Write into the session's lorebook instead, or start a new session with that lorebook."`
   - `removedNodeDefinitionSentence(definitionId: string): string | null` — accepts an id with or without `@N`; null when not removed.
   - Export both from the sdk barrel like their neighbours (the surface test requires every export to carry exactly one tag: `@internal`). One JSDoc sentence each.
   - Executor: `if (!d) return err(removed ? \`${node.key}: ${removed}\` : \`unknown type …\`)` (keep today's text for everything else).
   - `sdk/src/registry.ts` `checkInstall` E_UNKNOWN_TYPE (~404-417): when the pin's id is removed, `fix` is the sentence (message unchanged).
3. `sdk/src/descriptors.ts` genre `writes.library` docs (~1190-1196 and the error string ~768): `lorebooks` no longer "read one into the session"; `sessions` let only the removed outlet name another session — mark it ⏳ in its JSDoc ("nothing reads it since `attach-lorebook@1` was removed in 0.6"), **do not remove the field** (a published name; the supervisor asks the owner). Leave the error string's shape as is unless it names attach.
4. `guides/forms-and-effects.md` ~158-166: drop `attach-lorebook@1` and "read one into the session"; say `sessions` is ⏳ read by nothing since 0.6. Grep `guides/` for any other mention.
5. **Migration note** in `/home/jody/github/serene-pub-sdk/INTEGRATING.md` — a **new section appended at the very end of the file** (worker 1 edits §1c–§1f; don't touch those): `## 6. Removed names — migration notes`, then `### \`core:outlet/attach-lorebook@1\` — removed in 0.6 (★B-4, 2026-11-08)`: why (a session keeps the lorebook it started with — ★27-10/★B-5), old → new, **one example** (a spec node placing the outlet, then what to do instead — check the real builder API in `sdk/src/builder.ts` and an existing spec that writes a lore entry, e.g. grep `createLoreEntry` in `core-catalog/src`, so the example compiles in spirit), and what a stored pipeline that still names it does (halts at that node with the sentence; `checkInstall` refuses a plugin pinning it with the sentence as its fix). The SDK has no changelog file (release notes live on GitHub) — this section is the note.
6. Tests (`sdk-tests/`): `writes.test.ts` ~310 asserts `C.attachLorebook.id` — change to assert it is gone (`'attachLorebook' in C` false). New cases (in `writes.test.ts` or the file that already tests the executor's unknown-type halt / `checkInstall` — grep `unknown type` and `E_UNKNOWN_TYPE` in `sdk-tests/`): a spec document whose node pins `core:outlet/attach-lorebook@1` run through the executor halts with the sentence; `checkInstall` on a document pinning it returns E_UNKNOWN_TYPE whose `fix` is the sentence; `removedNodeDefinitionSentence` with and without `@1`, and null for a live id. `sdk-tests/coreCatalog.test.ts:1047` is a dated history comment — leave it.

### App (`/home/jody/github/serene-pub`) — only these hunks

7. `src/lib/shared/state/ledgerLines.ts` ~59-112: `LibraryOp` becomes the three live ops. Old rows must still read: `LedgerLibraryChange.op` and the three text functions take `LibraryOp | "attach-lorebook"` (⏳ inline, a comment: "a row written before 0.6 removed the op") and **keep** their attach cases; the private reading filter `LIBRARY_OPS` (~112, used ~416, ~658) keeps `"attach-lorebook"` with the same ⏳ comment. No new exported name. `ledgerLines.test.ts` ~569, ~595: keep the cases, retitle them as old-row readings.
8. `src/lib/server/library/writes.ts`: header comment (drop "a lorebook read into a session"); `LIBRARY_OPS` three ops; delete the attach cases of `describeLibraryChange` (~392), `applyLibraryChange` (~473), `undoLibraryChange` (~583), `redoLibraryChange` (~645); delete `setSessionBook` (only attach uses it — confirm by grep) and the `isNewAttachOfDisabledBook` import (still used by `sockets/sessions.ts`; don't touch that file); drop `before.lorebookId` and the "(attach: …)" comment from `LibraryChangePayload`. An op that is not live reaching `describeLibraryChange` / `applyLibraryChange` (an old pending Review row someone accepts — `state/write.ts:2813` calls `applyLibraryChange` with the stored op; **don't edit `state/write.ts`**) throws `LibraryWriteRefusal` with `removedNodeDefinitionSentence(\`core:outlet/${op}\`)` (import from `@serene-pub/sdk`), else `"That library change is not known."`. Undo/redo of an old row with the removed op do nothing (they already fall through — keep it so, no throw).
9. `src/lib/server/pipelines/runtime/host.ts` — **only** the `libraryOutlet` function (~2433-2560: the JSDoc's op list, the `else` branch that reads `lorebookId`/`sessionId` for attach, the `needs` arms `"lorebooks-into-sessions"` / `"sessions"`, and the `op === "attach-lorebook" ? "attached"` word ~2542) and the dispatch `case "core:outlet/attach-lorebook"` ~10484-10485. Nothing else in host.ts (lane f-emit owns it in wave 3). Leave `LibraryNeed` in `messages/writes.ts` alone (not yours — list the now-unused members under Noticed).
10. `src/lib/server/pipelines/runtime/bindings.ts` ~8808-8810: delete the `"core:outlet/attach-lorebook@1"` binding entry only (it names `C.attachLorebook`, which no longer exists).
11. `src/lib/server/pipelines/runtime/receipts.ts:64` comment, `src/lib/server/pipelines/config/panel/flows.ts:169` entry, `src/lib/server/state/announce.ts:48` regex: drop attach.
12. Tests: `src/lib/server/library/writes.bookLock.int.test.ts` pins the op's refusal — rewrite it (keep the file name and its DB setup) to pin what is true now: `applyLibraryChange(db, person, "attach-lorebook" as never, …)` and `describeLibraryChange(…)` refuse with the SDK sentence and the session keeps its book; `undoLibraryChange` / `redoLibraryChange` of a stored `applied` attach row leave the book and don't throw; a stored row's ledger line still reads (if the file already covers this cheaply). `src/lib/server/plugins/providedBooksPubWide.int.test.ts` ~280-297: only the `applyLibraryChange(… "attach-lorebook" …)` assertion and its comment — it now refuses with the removal sentence (not `BOOK_LOCK_REFUSAL`). `src/lib/server/pipelines/boot/registryHashes.test.ts:1849`: delete the `"core:outlet/attach-lorebook@1"` pin line. Grep `src/` for any other test naming the outlet or the op and list it (don't edit files not named here — report them).

## Files owned (edit only these)

SDK: `contracts/src/outlets.ts`, `sdk/src/descriptors.ts`, `sdk/src/executor.ts` (the one line), `sdk/src/registry.ts` (`checkInstall`'s E_UNKNOWN_TYPE), the sdk barrel file that exports from `descriptors.ts` (only to export the two names, if it isn't `export *`), `guides/forms-and-effects.md`, `INTEGRATING.md` (new final section only), `sdk-tests/writes.test.ts` + the one test file that holds the executor/checkInstall cases.
App: the files in 7–12, only the hunks named.

Worker 1 runs beside you on `core-catalog/**`, `sdk/src/widgets.ts`, `contracts/src/queries.ts`, `INTEGRATING.md` §1c–§1f, `guides/widget-examples.md` and some sdk-tests. Lane s4-cl runs beside the lane on `cast/cardless.ts`, sprites, media, dowry, `tableRegistry.ts`, `lorebookDuplicate.ts`, unlink sites, `providedBooks.ts`, `schema.ts` — never touch them.

## Out of scope

Removing `writes.library.sessions` or the `LibraryNeed` members (ask first — published / not yours). `src/lib/shared/sockets/types.ts` (its op union describes stored rows; leave it). `state/write.ts`. Any migration. Any other host.ts hunk.

## Tests (capped scope, logged)

SDK (from `sdk-tests`):
```
cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx tsx --test writes.test.ts <executor/checkInstall test file> surface.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w2-sdk-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w2-sdk-tests.log'
```
(`surface.test.ts` has one known red: "every export is tagged" for `CREATE_SESSION_PERSONA_*_MAX` — not yours; make sure your two names don't add a second.) Typecheck: `cd /home/jody/github/serene-pub-sdk && npx tsc --noEmit -p sdk-tests` (before/after counts).

App vitest, when they can run (they import the SDK's dist — after the supervisor's `sdk:build`):
```
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run src/lib/shared/state/ledgerLines.test.ts src/lib/server/library/writes.bookLock.int.test.ts --maxWorkers=2 > /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w2-app-tests.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad/s4-f-sdk-w2-app-tests.log'
```
`ledgerLines.test.ts` doesn't need the SDK export — run it now. An int test opening a DB inside an `it` needs a 60 s timeout. Never pipe vitest into `head`. Run touched suites once **before** your edits for a baseline.

## Done means

SDK test files above green (known red listed), the new cases present, `tsc -p sdk-tests` no new errors, `ledgerLines.test.ts` green; the app edits written and listed as "waits on sdk:build" for the int tests and app tsc; prettier clean on lines you changed; `grep -rn "attach-lorebook\|attachLorebook"` over both repos' sources shows only: the ⏳ ledger readings, the removal table, the migration note, the tests, the dated coreCatalog comment, `shared/sockets/types.ts`, docs/generated.

## Report (your final message)

Changed files (one line each), tests run before/after, tsc before/after, the final grep output, what waits on sdk:build, **Noticed, not done**.
