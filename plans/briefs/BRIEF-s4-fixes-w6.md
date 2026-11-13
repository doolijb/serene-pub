# BRIEF s4-fixes-w6 — remove the starters' empty `cards` stub (queued from lane s4-st by the lead, 2026-11-08)

Supervisor: lane `s4-fixes`. Report back in your final message (no report file).

*This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.*

## Goal

Lane s4-st made starters copy their cast card-less (owner 2026-11-05: "every starter copies people card-less"), so `KitCopy.cards` (`src/lib/server/lorebooks/starterKits.ts` ~424–430) is a ⏳ stub that is always `[]`. The lead queued its removal with its one reader:

1. `src/lib/server/sockets/lorebooks.ts` ~714–717 (in `lorebooks:create`, after `afterKitCopy`): delete
   ```ts
   if (copy.cards.length && emitToUser)
   	await emitToUser("characters:list", () =>
   		buildCharactersList(userId)
   	)
   ```
   Then, if `buildCharactersList` is no longer used anywhere in that file, remove it from the import list (~118). Nothing else in `sockets/lorebooks.ts`.
2. `src/lib/server/lorebooks/starterKits.ts`: delete the `cards` field and its ⏳ JSDoc line from `interface KitCopy`, and the `cards: [],` / `cards: []` values in `bookFromKit` (~471 and ~498). Nothing else in the file.
3. `src/lib/server/sockets/starterKits.ts` ~140 (`saveFromBook`'s `finishCopy` call): delete `cards: [],`. Nothing else.

Grep `src/` (tests included) for any other `.cards` read of a `KitCopy` / `madeFromKit` / `copy` of a kit, and for `cards: []` passed where a `KitCopy` is expected; fix only those (list them). Don't touch `sockets/sessions.ts` (another lane's file) — if it reads `.cards`, stop and report.

## Files you may edit

`src/lib/server/sockets/lorebooks.ts` (only the lines above), `src/lib/server/lorebooks/starterKits.ts` (only the stub), `src/lib/server/sockets/starterKits.ts` (only the one value), and any test file your grep finds constructing a `KitCopy` with `cards`.

## Tests and checks

```
S=/tmp/claude-1000/-home-jody-github-serene-pub/9382c94a-1330-4480-b65e-0cfdb1f75e97/scratchpad
cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c "export NODE_OPTIONS=--max-old-space-size=4096; npx vitest run <files> --maxWorkers=2 > $S/s4-fixes-w6-tests.log 2>&1; echo test-exit=\$? >> $S/s4-fixes-w6-tests.log"
```
Run every test file whose name contains `starterKit` (`ls src/lib/server/**/ | grep -i starterkit` or `find src -name "*starterKit*test*"`). Never pipe vitest into `head`. Then `npx tsc --noEmit -p .` under a 12G scope (`-p MemoryMax=12G`, `NODE_OPTIONS=--max-old-space-size=8192`) → `$S/s4-fixes-w6-tsc.log` (baseline 0).

## Rules

- CLAUDE.md Decisions: "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing."
- **Prettier:** `npx prettier --check` the changed files; never `--write` them whole. A removal shouldn't need formatting.

## Verbatim rules

- *Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.*
- *Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.* (No `*` in an `rm`.)
- *Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.* (You need no `sdk:build`.)
- Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9` anything.

## Report (final message)

Changed files with the exact lines removed; grep results; tests with counts and log path; tsc; **Noticed, not done**.
