# BRIEF io-1-w6 — review fixes: a carded member's hidden text stays out of the file; a stale comment; the lines allowance

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Formatting: hand-format your lines; never write prettier's output over a file.

## Context

Workers w4/w5 made the export carry a cast member's own sheet on each `bindings[]` item (`ownSheetOf` in `src/lib/server/utils/lorebookExportBuilder.ts` ~66–100, called ~311) and the import land it (`memberSheetOf` in `restoreBoundEntities`, `src/lib/server/sockets/lorebooks.ts` ~3941). Read `git diff` of both files first.

## Build

### 1. A carded member's hidden text never goes into the file (privacy)

`ownSheetOf` writes each text whenever the base version's column is non-empty. For a **carded** member a field the member **follows** from the card can still hold text: the member form keeps it when a field is switched back to the card ("switching a field back to the card keeps the member's text (hidden, never discarded)", `src/lib/client/lorebooks/cast/memberDraft.ts` ~181–183). That hidden text must not reach the file. The reader already lands carded text only where the field is retold.

Fix: for a carded member's base version, write each sheet field only when the base version **does not follow** that profile field (its `follows` list, the column `character_versions.follows`; the same rule `memberColumnsOfVersion` uses for `retold`, `src/lib/server/lorebooks/retold.ts` ~236–278, and `memberProfileOf` in `src/lib/server/characters/versions.ts` ~181–298 for which profile field each sheet key maps to: greetings for `firstMessage` / `alternateGreetings` / `groupOnlyGreetings`, `exampleDialogues`, `timbre`, `postHistoryInstructions`, `creatorNotes`, …). A card-less member follows nothing, so nothing changes for it. Pass what `ownSheetOf` needs (the base's `follows`, or whether the member is carded) from where `baseOfMember` is built (~197–230). The writer and reader must agree: if the reader reads a field for a carded member that the writer now never writes (or the reverse), make them match and say which rule you used.

Test (in `src/lib/server/sockets/lorebooks.import-export.int.test.ts`): a carded member whose base version holds text in a field it follows (write it the way the app does — through the member writer with the field switched back to the card — or set the base row directly if no writer exposes it), and a retold field: the file carries the retold field's text and not the followed field's. Also one with a card **another user owns** bound in the book (as `lorebookExportBuilder.ownershipScoping.int.test.ts` does, but with a real base version through `insertCastMember`): the export carries no card text for it beyond what the member retells.

### 2. A stale comment

`src/lib/server/sockets/lorebooks.ts` ~4775–4777 (in `restoreNarrativeGraph`) still says a bound row's name/aliases are entity-derived and never overwritten from graph-node data; fifty lines later the code merges the file's aliases. Reword it to the ruling: the name is the card's (or the member's own name); the aliases are the member's and are merged, never written over (#114, ruled 2026-09-28). Keep it short.

### 3. The lines allowance names the open question

In `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, rename the constant `D_LINES` to `U_LINES` and make its reason start "★ unclear (ruling conflict):" followed by the rest of its current text, so the test labels lines as an open question, not settled design. Update every reference.

## Files owned (the only files you may edit)

- `src/lib/server/utils/lorebookExportBuilder.ts`
- `src/lib/server/sockets/lorebooks.ts` — only `restoreBoundEntities`, `restoreNarrativeGraph` and their local helpers
- `src/lib/server/sockets/lorebooks.import-export.int.test.ts`
- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`
- logs `plans/io-1-w6-*`

Never edit the fixture `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json`.

## Rules you must follow (quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "0.6 is in users' hands … a file exported by an earlier 0.6 build must still import." A file without the sheet keys imports as before.
- No new names (NOMENCLATURE R3/§24). "Never pipe vitest into `head`."

## Tests

One run at a time, after waiting for other runs (brackets matter):

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "[s]dk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/sockets/lorebooks.roundTrip.int.test.ts src/lib/server/sockets/lorebooks.import-export.int.test.ts src/lib/server/utils/lorebookExportBuilder.ownershipScoping.int.test.ts src/lib/server/utils/lorebookExportBuilder.currentVersion.int.test.ts src/lib/server/sockets/characters.import-export.int.test.ts > plans/io-1-w6-<n>.log 2>&1"
```

Type-check: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, filtered to your files.

## Stop and ask when

The follows rule cannot be read for a base version; a fix would change what a card-less member exports; anything outside the files owned. CLAUDE.md §Decisions applies.

## Done means

Those test files green; `tsc` clean for your files.

## Report

Final message: changed files with one line per change; the rule used for each sheet key (carded); tests run with results.
