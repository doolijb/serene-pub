# BRIEF — hist-A-w2: two Loose-ends chores, and the Time-lens drop onto a taken date

Supervisor: lane hist-A. Repo `/home/jody/github/serene-pub`. Another worker (w1) is editing `src/lib/shared/lorebooks/lineReading.ts` at the same time and is adding `historyOwnerStep(line, date): LineStep` there (spec below). Never edit that file. If it isn't there yet when you need it, write the chore code against the spec, and run your tests once it lands (poll with `grep -n "export function historyOwnerStep" src/lib/shared/lorebooks/lineReading.ts`). Other sessions edit the lorebooks client nearby: before each edit, check the file's mtime and `git diff <file>` so you never overwrite live work you didn't make. `TimeLens.svelte` carries uncommitted work by others (toaster→notify): keep it.

## Owner rulings this work applies (2026-11-10, quoted)

- **★H1:** "Reuse the existing". A person's direct create, or re-date onto a taken date, is refused (the server now does this). The paths that mean "the entry of this day" find the existing entry instead.
- **★H3:** existing duplicates are **reported in Loose ends**, never merged automatically.
- **★H2, rule C:** "A line owns a history entry only for a date **strictly after** its fork date. On or before it, the date's entry belongs to the nearest ancestor that may own it. A dateless fork owns no dated history."
- **Partial dates are distinct** (`compareDates`, `shared/lorebooks/storyDate.ts:88`): *Year 2*, *Year 2 Month 5* and *Year 2 Month 5 Day 3* are three dates. Undated rows are ignored.
- Loose ends: "A row leaves only when it is FIXED — there is no per-row dismissal (owner, 2026-10-02)" (`looseEnds.ts` header).
- Views never call `toaster`; `$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE §6.1: "Actions that would be clutter as buttons are quiet text links."

`historyOwnerStep(line: Line, date: StoryDate): LineStep` (w1): the step of `line.steps` that owns a dated history day under rule C. A row is **misowned** when `historyOwnerStep(line, rowDate).branchId !== (row.branchId ?? null)`.

## Goal

### 1. `src/lib/client/lorebooks/looseEnds.ts` (pure) + `looseEnds.test.ts`

Two new chores. Labels are **exact** (the brief's copy):

| id | label | fix (🚧 provisional copy, ★ for the owner) | field |
|---|---|---|---|
| `doubled-history-date` | `Two history entries on one date` | `Give one of them another date, or move what it says into the other and delete it.` | `"date"` |
| `history-before-fork` | `A line's own history before its fork` | `Give it a date after the fork, or delete it.` | `"date"` |

Add both to `ChoreId` and to `CHORES` straight after `undated-history` (doubled first). Mark both fix sentences with a short 🚧 comment.

- `LooseEndsInput` gains `line?: Line` ("The line being read (`lineOf`); absent reads as main, where no row is before a fork."). Import `Line`, `historyOwnerStep` from `$lib/shared/lorebooks/lineReading`, `compareDates` from `$lib/shared/lorebooks/storyDate`.
- `LooseEnd` gains `alsoEntryIds?: number[]`: "The other entries of a doubled date, oldest first; the row itself opens the oldest (`target`)."
- **Doubled date:** over `input.items` of kind `HISTORY_TYPE_ID` with a `date` (the pool is already the line's rows, so no line filter is needed here), **archived rows included** (the server's one-per-date check counts them, so the person must see them), group rows whose dates compare equal with `compareDates === 0` (sort by `compareDates` then id, then take runs). For each group of 2+: one row, `id: \`doubled-history-date:${first.key}\``, `target: { kind: "entry", entryId: first.id }` where `first` is the **lowest id** (the server's tie-break winner), `key: first.key`, `name: first.name` (a history row's name is its date), `kind: HISTORY_TYPE_ID`, `updatedAt`: the group's latest, `alsoEntryIds`: the other ids ascending.
- **Before its fork:** in the existing per-item loop (archived skipped, as the loop already does), when `input.line` is given, the item is history with a `date`, and it is misowned (above) → `entry("history-before-fork", item)`. Main's rows are never misowned. Without `line`, nothing.
- Keep the module header true: add one line naming the two chores' source rulings (★H3 / rule C, owner 2026-11-10).

Tests in `looseEnds.test.ts` (follow its style): a doubled date → one row, target the lower id, `alsoEntryIds` the other; three on one date → one row with two also-ids; Y2, Y2 M5 and Y2 M5 D3 → no row (distinct); undated rows ignored; an archived twin still counts; the row leaves (`liveQueue`) once one is re-dated; fork chore with `line = lineOf(fork, branches)` for a fork at Y5: its own Y4 row and Y5 row flagged, its own Y6 row not, main's Y3 row not; a dateless fork's own dated row flagged; no `line` → no fork chore; chore order (`groupLooseEnds`) puts both after Undated history.

### 2. The queue rows — `src/lib/client/lorebooks/LooseEndsQueue.svelte`

For a row with `alsoEntryIds`, draw after the row's button a quiet text link per other entry, in the row's `<li>`: label `Other entry` when there is one, `Other entry 2`, `Other entry 3`… when there are more (🚧 provisional copy, ★), `aria-label="Open the other history entry for {row.name}"` (numbered the same way when more). Pressing one calls `onOpen({ ...row, target: { kind: "entry", entryId: id } })` so the workspace opens it with the date field asked for. Keep the existing row layout; no new component. Use existing quiet-link classes found in nearby lorebook components (grep for an existing quiet text button, e.g. `anchor` or `text-primary-…` with `underline`, and reuse that exact class string).

### 3. The Time-lens drop — `src/lib/client/lorebooks/time/TimeLens.svelte` (the drop only)

Today `offerDate(row, date)` (~:445-462) for a non-history row (`dropOffer(row) === "history-about"`) always calls `startCreate(date, name)`, which opens a **new** dated entry with the dropped row's name prefilled as its content. A drop snaps to an existing tick (`dateAtRatio`), so that date nearly always already has a history entry, which the server now refuses.

Change: in that branch, first look in `dated` for a history row (`row.typeId === HISTORY_TYPE_ID`) whose date compares equal to `date` (`compareDates(dayOnly…)` — the rows are day-grain; use `compareDates` on `{year, month, day}`); of several, the lowest id. When found, **open that entry with the mention ready**, the same way the date-drop branch above holds `pendingDate` until the entry's draft exists:
- If that entry's draft is already open (`draft && !creating && draftKey === \`entry#${id}\``), append the mention straight away.
- Otherwise `if (!(await loreRoute.confirmLeave())) return`, `discardDraft()`, hold `pendingMention = { entryId, text }` (a new `$state`, documented like `pendingDate`), and `loreRoute.navigate({ type: "openEntry", entryId })`. Apply it in the same `$effect` that applies `pendingDate`, only to that entry's draft (an `applyPendingMention()` beside `applyPendingDate()`), and clear it in `discardDraft()` where `pendingDate` is cleared.
- The mention is the dropped row's trimmed name (what `startCreate` prefills today); appended as `content ? \`${content}\n\n${name}\` : name`. A blank name appends nothing (still open the entry).
- When no history row is on that date, keep `startCreate(date, name)` as today.
Don't change the date-drop branch, the save path or anything else.

## Files owned

- `src/lib/client/lorebooks/looseEnds.ts`, `src/lib/client/lorebooks/looseEnds.test.ts`
- `src/lib/client/lorebooks/LooseEndsQueue.svelte`
- `src/lib/client/lorebooks/time/TimeLens.svelte` (the drop only)

## Files readable

`src/lib/client/lorebooks/LorebooksWorkspace.svelte` (`liveLooseEnds` ~:1155 and `openLooseEnd` ~:1217 — **don't edit**; passing `line` there is queued for the lead), `src/lib/client/lorebooks/poolFilter.ts` (`PoolItem`), `src/lib/client/lorebooks/sections/index.ts` (history pool item: `name` is `formatDate`), `src/lib/client/lorebooks/time/storyTime.ts`, `moment.ts`, `src/lib/shared/lorebooks/lineReading.ts`.

## Done means

- `looseEnds.test.ts` green with the cases above; existing client lorebook tests that touch Loose ends or the time lens still green. Run (capped, verbatim rule):
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=4096 npx vitest run --maxWorkers=2 src/lib/client/lorebooks/looseEnds.test.ts src/lib/client/lorebooks/time/ ; echo test-exit=$?'`
  plus any `*.dom.test*` that mounts `LooseEndsQueue` (`grep -rln LooseEndsQueue src --include=*.test*`).
- svelte-check on your two Svelte files only: `systemd-run --user --scope -p MemoryMax=12G -p MemorySwapMax=0 --quiet bash -c 'cd /home/jody/github/serene-pub && NODE_OPTIONS=--max-old-space-size=8192 npx svelte-check --threshold error 2>&1 | grep -E "LooseEndsQueue|TimeLens|looseEnds" ; echo done'` — report errors in your files only.

## Out of scope (write down, never build)

`LorebooksWorkspace.svelte` (passing `line`), server files, the date-drop of an undated history row onto a taken tick (write it under Noticed: the server will refuse that save), docs, NOMENCLATURE, any other copy change.

## Stop and ask when

A name beyond those in this brief is needed; anything needs a file not listed; `historyOwnerStep` behaves differently from its spec.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `git checkout`, `restore` or `clean` in either repo. **Never run `prettier --write` on a file**; format only your own hunks by hand.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (This work needs no `sdk:build`.)
- Never pipe vitest into `head`. Scratch files start with `hist-A-w2-`.

## Report

`plans/briefs/REPORT-hist-A-w2.md`: changed files, each test run with pass/fail counts, assumptions, **Noticed, not done**.
