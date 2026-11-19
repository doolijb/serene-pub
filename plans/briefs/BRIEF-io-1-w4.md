# BRIEF io-1-w4 — a lorebook file carries the cast member's sheet and aliases

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: the SDK is not touched.)

Formatting: hand-format, check with `npx prettier --check`. Never write prettier's output over a file (no `--write`, no scratch-copy-and-`cp`).

## Goal

Two losses measured by the lane's round-trip test (`src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`, which **another worker is editing right now — do not touch or run it**):

1. **A carded cast member's aliases are dropped on import.** The export writes them (the narrative-graph node's `aliases`, `lorebookExportBuilder.ts` ~441–475). The import's `restoreNarrativeGraph` (`src/lib/server/sockets/lorebooks.ts` ~4567) strips `name` and `aliases` for a row linked to a card (`isEntityLinked`, ~640: "A bound row's name/aliases are entity-derived … never overwritten from graph-node data"). That comment predates the owner's ruling, quoted in `src/lib/server/utils/characterBindingSync.ts` ~68–77: "**The name is the card's unless the member has its own in this book; the aliases are the member's** (#114, cast-first, ruled 2026-09-28 …). `aliases` are MERGED: the card's names (and its real name, below) are added to whatever the member already answers to, never written over it". Fix: for a card-linked row, keep stripping `name`, but land the node's `aliases` merged (deduplicated) with what the row already holds, on the row and its base version (the existing `writeMemberEdit(…, { onto: "base" })` call). Mind the second-node case (`landedOn`, A16 fold) the same way absorbed aliases are merged there. Note the card sync (`syncCharacterIds`) runs after the commit and merges the card's names in; order must not lose the file's aliases.

2. **A cast member's own sheet never reaches the file.** The writer (`lorebookExportBuilder.ts` ~246–261) puts on each `bindings[]` item only `spriteSet`, `ownName`, `ownNickname` from the member's base version (`own = memberColumnsOfVersion(base, { carded })`, `src/lib/server/lorebooks/retold.ts` ~236). So a card-less member's description, personality, scenario, greetings and example dialogues, and a carded member's retold fields, are lost by any copy by file. Fix in the writer **and** the reader:
   - Writer: add to the binding item, each **only when set** (so a book without them exports exactly the bytes it did — the import's unchanged-vs-conflict check hashes those bytes), the fields `memberColumnsOfVersion` returns that are the member's own text: `description`, `personality`, `scenario`, `firstMessage`, `alternateGreetings`, `groupOnlyGreetings`, `exampleDialogues`, `postHistoryInstructions`, `creatorNotes`, `timbre`, and `retold` (a carded member's flags; `{}` is not set). Use exactly those property names as the file keys (they are the member columns' own names; the binding item already mirrors `spriteSet` / `ownName` / `ownNickname` the same way). **Not** `faceMediaId` or `likeness` (images and appearance are not in the file: the supervisor holds that as an open question) and nothing already carried (`name`, `aliases`, `summary`, node state/visibility ride on the node).
   - Reader: `restoreBoundEntities` (`sockets/lorebooks.ts` ~3832; the landing struct ~3905–3965, the `insertCastMember` call ~3996) lands them on the member and its base version the way `spriteSet` / `ownName` land (`insertCastMember` → `insertMemberBase` → `memberProfileOf` derives the base from the row; check `$lib/server/characters/versions` for which fields the row can hold and land any it cannot onto the base version with the existing writer). A file is untrusted: each text is a string capped like the import's other texts (`LOREBOOK_IMPORT_LIMITS.maxTextChars`), each greeting list an array of capped strings (cap the count sensibly, reuse an existing limit if one fits), `timbre` only in the shape the column takes (see its type), `retold` only known flag keys with `true`; anything else is dropped. Extend `assertLorebookImportWithinLimits` / `assertEntryWithinImportLimits` style checks only if the existing pattern for bindings calls for it.
   - A card-less member has no `retold`/own names (`memberColumnsOfVersion`: only when carded); the reader applies `retold` only to a carded member, like `ownName`.
   - **Format version stays 2**: every key is additive and optional; an older reader ignores them and loses them as it does today, which is not a misreading. Say this in the mapper's "Format 2" header comment (one line listing the new binding keys), and in the `ExportedBinding` type.
   - The overwrite path (`overwriteLorebookFromParsedCard`) shares these functions, so an overwrite now restores the aliases and sheet the file carries. That matches what the docs promise an overwrite does (the book becomes the file's content, minus the listed losses); say so in your report.

## Files owned (the only files you may edit)

- `src/lib/server/utils/lorebookExportBuilder.ts`
- `src/lib/server/utils/lorebookExportMapper.ts` (the `ExportedBinding` type and header comment)
- `src/lib/server/sockets/lorebooks.ts` — **only** `restoreBoundEntities`, `restoreNarrativeGraph` and the import-limit helpers near them (~3365–4960). Nothing else in this file.
- `src/lib/server/sockets/lorebooks.import-export.int.test.ts` — add focused tests here.
- logs `plans/io-1-w4-*`

## Files readable

`src/lib/server/characters/versions.ts`, `src/lib/server/lorebooks/retold.ts`, `src/lib/server/utils/characterBindingSync.ts`, `src/lib/server/utils/lorebookImportMapper.ts`, the fixture `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` (never edit), `docs/lorebooks.md`.

## Tests

Add to `lorebooks.import-export.int.test.ts`:
- a card-less member with description, personality, scenario, greetings, example dialogues, timbre, post-history instructions and creator notes survives export → import as a new book (on the row and its base version);
- a carded member's retold fields (description retold, the rest following the card) and own aliases survive, the card's own names merged in, not replacing them;
- a book whose members set none of the new fields exports with no new keys on its bindings (bytes unchanged);
- a file with a binding carrying oversized or wrongly typed values imports with those values dropped or capped, never failing the import.

Then run these files (each passing before and after your change, except the new tests):
`src/lib/server/sockets/lorebooks.import-export.int.test.ts src/lib/server/sockets/lorebooks.importFinish.int.test.ts src/lib/server/sockets/lorebooks.import05.int.test.ts src/lib/server/sockets/import.mapperParity.int.test.ts src/lib/server/utils/lorebookExportMapper.test.ts src/lib/server/utils/lorebookExportBuilder.currentVersion.int.test.ts src/lib/server/utils/lorebookExportBuilder.ownershipScoping.int.test.ts src/lib/server/sockets/characters.import-export.int.test.ts`

One run at a time, after waiting for other runs (brackets matter):

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "[s]dk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/io-1-w4-<n>.log 2>&1"
```

Type-check: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, filtered to your files (another lane's in-flight `bindings.retrieval.ts` errors are not yours).

## Rules you must follow (quoted from CLAUDE.md and the project)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently." (`restoreBoundEntities` runs inside the import's transaction on `dbOrTx`; `restoreNarrativeGraph` opens its own small transactions.)
- "0.6 is in users' hands. … a file exported by an earlier 0.6 build must still import; a changed file format carries a version and reads the old one." A file without the new keys must import exactly as before.
- NOMENCLATURE R3/§24: introduce no new names. The new file keys are the member columns' existing property names; no new exported functions unless a helper is needed, then name it after what it does in existing words and say so.
- "It is a **session**, never a *chat*." "Never pipe vitest into `head`."

## Stop and ask when

A field cannot land without a schema change or a new writer; landing it would change what an import does beyond carrying the field; anything outside the files owned. CLAUDE.md §Decisions applies.

## Done means

The new tests and the listed files green; `tsc` clean for your files; `prettier --check` passes on your files.

## Report

Final message: changed files with a line on each change; the exact new file keys; tests run with results; anything not landed and why.
