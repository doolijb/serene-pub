# BRIEF playtest3-S7-w2 — one day rule: `dayOnly` in shared

Lane `playtest3-S7`, worker 2. Supervisor checks your diff against this brief. Report back in your final message (changed files, the exact test command, pass/fail counts, anything you could not do).

## Goal
The day rule for history entries — "a date's day: hour and minute dropped; a day without a month dropped too" — has three copies: the server's `dayOnly` (`src/lib/server/scenes/historyEntryOfDate.ts` ~41–45), the client's `sceneDayOf` (`src/lib/client/lorebooks/sections/unfiledScenes.ts`), and the compile modal's `isAskedDay` (`src/lib/client/components/modals/CompileHistoryEntryModal.svelte` ~121–131). Make it one function.

1. **Move `dayOnly`** (body and its doc comment, unchanged in behaviour) into `src/lib/shared/lorebooks/storyDate.ts`, placed after `compareDates`. Keep the doc comment's sense; it may now say it is shared so the client's *Not yet compiled* grouping and the compile modal read the same rule as the server.
2. **Re-export from `historyEntryOfDate.ts`** so its callers stand: remove the local function, add `dayOnly` to the existing `import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"` and `export { dayOnly } from "$lib/shared/lorebooks/storyDate"` (or the equivalent). `historyEntryOfDate` still uses it internally. Do NOT edit `unfiledScenesByEntry.ts` or `sockets/scenes.ts` — they import `dayOnly` from `./historyEntryOfDate` / `$lib/server/scenes/historyEntryOfDate`, which must keep working.
3. **`sceneDayOf` calls it.** In `unfiledScenes.ts`, `sceneDayOf(scene)` returns `null` when `scene.openedStoryClockYear == null`, else `dayOnly({ year, month: scene.openedStoryClockMonth ?? null, day: scene.openedStoryClockDay ?? null })`. Import `dayOnly` from `$lib/shared/lorebooks/storyDate`. Replace the "⚠ This MIRRORS the server's one day rule … cannot be imported here … must never disagree" paragraph with one line saying it reads the day through the one `dayOnly` (`$lib/shared/lorebooks/storyDate.ts`) that the compile files by. `sceneDayOf` keeps its name and signature.
4. **`isAskedDay` calls it.** In the modal, `isAskedDay(row)` keeps its two guards (`if (!askedDate) return true`, `if (!row) return false`) and then returns `compareDates(dayOnly(row), dayOnly(askedDate)) === 0` — the same comparison the server uses (`compareDates(dayOnly(x), day) === 0`). Import `compareDates` and `dayOnly` from `$lib/shared/lorebooks/storyDate`. A history row has `year`, `month`, `day`; pass it as `{ year: row.year, month: row.month ?? null, day: row.day ?? null }` if the type needs it. Touch nothing else in the modal.
5. **Tests.**
   - `src/lib/client/lorebooks/sections/unfiledScenes.test.ts`: the `describe("sceneDayOf — mirrors the server's dayOnly", …)` block becomes `describe("sceneDayOf — the one dayOnly", …)`; each case asserts `sceneDayOf(...)` `toEqual(dayOnly({...}))` of the same clock (import `dayOnly` from `$lib/shared/lorebooks/storyDate`) in addition to (or instead of) the literal it checks now — keep the literal expectations too, so the rule itself is still pinned. "no clock is no day" stays `toBe(null)`.
   - `src/lib/shared/lorebooks/storyDate.test.ts` (exists): add a small `describe("dayOnly", …)` — hour/minute dropped; a day without a month dropped; a month without a day kept; a full date unchanged.
   - The modal's DOM test `src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts` must stay green unchanged (it covers by-date adoption and the error filter, which call `isAskedDay`).

Run (capped; never pipe vitest into `head`):
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/client/lorebooks/sections/unfiledScenes.test.ts src/lib/shared/lorebooks/storyDate.test.ts src/lib/client/components/modals/CompileHistoryEntryModal.dom.test.svelte.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w2a.log 2>&1; echo exit=$?'`
then the two server int tests that read `dayOnly` through the re-export:
`systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run src/lib/server/scenes/historyEntryOfDate.int.test.ts src/lib/server/scenes/unfiledScenesByEntry.int.test.ts > /tmp/claude-1000/-home-jody-github-serene-pub/c41f3a32-b4a2-4ba6-ada8-2d81ff90e6ed/scratchpad/playtest3-S7-w2b.log 2>&1; echo exit=$?'`
Read each log. Then `npx prettier --check` on every file you changed (report the result; never `--write` — if a check fails only on lines you touched, fix those by hand; pre-existing failures elsewhere in a file are reported, not fixed).

## Files owned (the only files you may edit)
- `src/lib/shared/lorebooks/storyDate.ts` (`dayOnly` added) and `src/lib/shared/lorebooks/storyDate.test.ts`
- `src/lib/server/scenes/historyEntryOfDate.ts` (local `dayOnly` removed; re-export)
- `src/lib/client/lorebooks/sections/unfiledScenes.ts` and `unfiledScenes.test.ts`
- `src/lib/client/components/modals/CompileHistoryEntryModal.svelte` — `isAskedDay` and its imports only
Re-read each file immediately before every edit (another agent may be editing `sockets/scenes.ts` beside you; you never touch it). Use Edit, never Write, on existing files.

## Rules your work depends on (quoted from CLAUDE.md and the lane brief)
- "Before any new identifier, field, event key, label or error string: NOMENCLATURE §1 and §24." — this task adds NO new name: `dayOnly`, `sceneDayOf`, `isAskedDay` keep their names. Do not add a helper (no `sameDay`, no `isSameDay`).
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`." `storyDate.ts` is shared (client + server): keep it free of server imports.
- Do what was asked, at the size asked. Anything else you notice goes in your report under **Noticed, not done**, never fixed in passing.

## Out of scope
`unfiledScenesByEntry.ts`, `sockets/scenes.ts`, `historyDates.ts`, `NOMENCLATURE.md`, any copy or behaviour change in the modal, any other file.

## Stop and report (do not decide) when
The modal's day comparison cannot be expressed as `compareDates(dayOnly(a), dayOnly(b)) === 0` without changing behaviour a test pins; a new name seems needed; anything outside the files above would have to change.

## Verbatim
- *"This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."*
- *"Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."*
- *"Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."*
- *"Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'."* (No SDK build is needed for this task.)
- Never `git checkout`, `git restore` or `git clean` in either repo. Never a full `npm test`, `npm run check`, or project-wide `tsc`.
