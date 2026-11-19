# BRIEF io-1-w5 — a card-less member's name and nickname; aliases keep the file's order; final allowances

Repo `/home/jody/github/serene-pub`. Supervisor: lane `io-1`. You are a `lane-worker`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

Formatting: hand-format your added lines; never write prettier's output over a file (no `--write`, no scratch-copy-and-`cp`). Some of these files already fail `prettier --check` at HEAD; that is not yours to fix.

## Context

Lane io-1 makes a lorebook survive export → import. Read first:
- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts` (the lane's round-trip test: seed, snapshot, diff, allowance lists with reason constants; last run `plans/io-1-w3-6.log`);
- worker w4's change (uncommitted; `git diff -- src/lib/server/utils/lorebookExportBuilder.ts src/lib/server/utils/lorebookExportMapper.ts src/lib/server/sockets/lorebooks.ts src/lib/server/sockets/lorebooks.import-export.int.test.ts`): the binding item now carries the member's own sheet (`ownSheetOf` in the builder; `memberSheetOf` in `restoreBoundEntities`), and `restoreNarrativeGraph` merges a carded member's file aliases.

## Build

### 1. A card-less member's name and nickname (lost today)

Measured: Rook, a card-less member with base-version name `Rook` and nickname `The Crow`. His row's stored name is his shown name, `The Crow` (the app's writer sets it so). The export writes the narrative node's `name` from the **row** (`lorebookExportBuilder.ts` ~441–475, `mapNarrativeNode`), and nothing carries his nickname (`memberColumnsOfVersion`, `src/lib/server/lorebooks/retold.ts` ~236, returns `name` for a card-less member and no nickname). The import writes the node's name as his base version's name: after a round trip his name is `The Crow` and his nickname is gone.

Fix, in the writer and the reader, for a **card-less** member only (a carded member's names are the card's or its own names, which already travel as `ownName` / `ownNickname`):
- Writer: the node's `name` is the member's base-version name (`own.name` from `memberColumnsOfVersion`) when there is a base; the binding item carries `nickname` (the base version's nickname, read with `profileOf` from `$lib/server/characters/versions` or wherever `memberColumnsOfVersion` reads the profile), **only when set**. Keep the privacy rule (`isOwnedOrUnbound` / `safeNode`) exactly as it is: a card-less member is always "unbound", so it is unaffected, but do not weaken the stripped branch.
- Reader: a card-less member's `nickname` lands on its base version through the same path w4 used for the fields the row cannot hold (`writeMemberEdit(…, { onto: "base" })`), capped and typed like `ownNickname`'s reading; ignored for a carded member. Check the row's stored name ends as the app's own writer leaves it (the shown name) — compare with how `updateCastVersion` / `writeMemberEdit` set it — and say what you found.
- Add `nickname` to the `ExportedBinding` type and to the one header line in `lorebookExportMapper.ts` that lists the binding keys. Format version stays 2 (additive; an older reader ignores it).
- A file written before (the node's name is the shown name, no `nickname`) imports exactly as before.

### 2. A carded member's aliases keep the file's order

Measured: Maren's aliases `["the smith","Maren"]` come back `["Maren","the smith"]` — nothing lost, order changed, because the merge in `restoreNarrativeGraph` puts the row's existing aliases (the card's names, synced after the commit) first. Merge as **the file's aliases first, then any the row holds that the file lacks**, deduplicated.

### 3. Tests

- `src/lib/server/sockets/lorebooks.import-export.int.test.ts`: a card-less member with a nickname survives export → import (base name, base nickname, row name); the existing w4 tests stay green; extend the carded-aliases test to check order.
- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`: remove every `L_PENDING` allowance and the `"measured 2026-11-16, unclassified"` aliases-order allowance once they stop matching. For Rook's **row** `nodeState` / `nodeVisibility` (row `missing`/`hidden` → `active`/`normal`; his base version's node fields round-trip), add a by-design reason `D_VERSIONS` — "by design: a member's node state and visibility are its versions' (sockets/lorebooks.ts restoreNarrativeGraph: 'The node state and visibility are the member's versions', not the row's')" — unless your change makes those differences disappear. If `L_PENDING` would be left with no users, delete the constant. Every remaining allowance must carry a reason constant; report any that cannot.

Run, one at a time, after waiting for other runs (brackets matter):

```
until ! pgrep -f "^node .*vitest" >/dev/null && ! pgrep -f "[s]dk:build" >/dev/null; do sleep 5; done
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/io-1-w5-<n>.log 2>&1"
```

with `<paths>` = `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts src/lib/server/sockets/lorebooks.import-export.int.test.ts src/lib/server/sockets/lorebooks.importFinish.int.test.ts src/lib/server/sockets/lorebooks.import05.int.test.ts src/lib/server/sockets/import.mapperParity.int.test.ts src/lib/server/utils/lorebookExportMapper.test.ts src/lib/server/utils/lorebookExportBuilder.currentVersion.int.test.ts src/lib/server/utils/lorebookExportBuilder.ownershipScoping.int.test.ts src/lib/server/sockets/characters.import-export.int.test.ts src/lib/server/sockets/lorebooks.duplicate.int.test.ts`.

Type-check: `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`, filtered to your files.

## Files owned (the only files you may edit)

- `src/lib/server/utils/lorebookExportBuilder.ts`
- `src/lib/server/utils/lorebookExportMapper.ts` (`ExportedBinding`, the header line)
- `src/lib/server/sockets/lorebooks.ts` — only `restoreBoundEntities`, `restoreNarrativeGraph` and their local helpers (~3830–4960)
- `src/lib/server/sockets/lorebooks.import-export.int.test.ts`
- `src/lib/server/sockets/lorebooks.roundTrip.int.test.ts`
- logs `plans/io-1-w5-*`

Never edit the fixture `src/lib/server/sockets/fixtures/lorebook-format2-2026-11-16.json` or the frozen `seedRoundTripBook`'s writes.

## Rules you must follow (quoted)

- "Inside `db.transaction(async (tx) => …)` use only `tx` — the outer `db` deadlocks PGlite silently."
- "0.6 is in users' hands … a file exported by an earlier 0.6 build must still import; a changed file format carries a version and reads the old one."
- NOMENCLATURE R3/§24: no new names; the new file key `nickname` is the version column's own name.
- "It is a **session**, never a *chat*." "Never pipe vitest into `head`."

## Stop and ask when

The node-name change would alter what a carded or shared member exports; a field cannot land without a schema change; anything outside the files owned. CLAUDE.md §Decisions applies.

## Done means

The listed test files green; no `L_PENDING` or unclassified allowance left; `tsc` clean for your files.

## Report

Final message: changed files with one line per change; what the row's stored name ends as and why; tests run with results; the final allowance lists (constant → what it covers), compactly.
