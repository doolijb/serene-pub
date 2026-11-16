# BRIEF — worker `time-t8b-fix-w2` — rows that begin later stay in the list; the Decay dialog's words; touch size

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b-fix`. Return your report as your final message
(the harness refuses report files): changed files, tests run with results, anything you could not do, Noticed-not-done.
Under 400 words.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

**Never run `sdk:build` at all in this lane** (another lane owns it). Use no GPU, no local model, start no dev instance.

## Rules your work depends on (quoted from CLAUDE.md, STYLE-GUIDE and the lane brief)

- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
- Sockets: views never call `toaster`; `socket.off(event, handler)` always with the handler; scoped events carry
  their scope key. (You should need no socket code.)
- "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- A control is never nested inside the row's pick part (`role="button"`): the list's own comment, "a control nested
  in a role=button is a nested interactive, and its keys reached the row instead of it" (plan B7). Text may go
  inside the pick; a button goes in the row's controls column beside it.
- STYLE-GUIDE (the entries list's two toggles): each row of *could exist here* has "a 12px muted cause line (_On
  ‹line›_, _Begins in ‹date›_) and its one tonal control beside the pick part". Touch targets: `pointer-coarse:min-h-11`
  on buttons, `pointer-coarse:size-6` on the list's checkboxes.
- Comments state the rule, not the story. Never `prettier --write` beyond the lines changed.

## Files owned (edit only these)

`src/lib/client/lorebooks/EntryPool.svelte`, `CouldExistHereGroup.svelte`, `couldExistHere.ts`, `BulkTimeDialog.svelte`
and their tests: `entryPool.couldExistBulk.dom.test.svelte.ts`, `couldExistHereGroup.dom.test.svelte.ts`,
`couldExistHere.test.ts`, `bulkTimeDialog.dom.test.svelte.ts`.

Not yours: `BulkEditBar.svelte`, `bulkEdit.ts` and their tests (another worker), `EntryWorkspace.svelte`, every socket
and server file, docs, `NOMENCLATURE.md`, `STYLE-GUIDE.md` (the supervisor does the words).

## Work

### 1. Rows that begin later stay in the list body (lead's decision ★T8B-1)

Today, with the **Could exist here** toggle on, `EntryPool.svelte` (~227–233) moves the rows in `dimmedKeys` out of
the list body into the group (`later`). Change it so that:

- Rows in `dimmedKeys` **stay in the list body** exactly as with the toggle off: dimmed (`opacity-50`), at the end
  (the caller already orders them, `orderByMoment`), with their checkbox in bulk edit, row menu, drag, retrieval mark
  and place in the tree. Remove `later`; the body is `items` (drop the `body` derived and use `items`, or keep `body`
  as `items` — your call, smallest clear diff). `selectableBody` / select-all then count them, as before the lane.
- **Only with the toggle on** (`couldExist && offered`), such a row gains its cause and control: inside the pick part,
  after `<Row …/>`, the 12px muted line `<p class="text-surface-700-300 mt-1 text-xs" data-could-exist-why>` reading
  `couldExistWhy({ kind: "later", date }, words)` (*Begins in ‹date›*); in the row's controls column (list row:
  the `flex shrink-0 items-start gap-2 py-3 pr-3` div, before the retrieval mark; card: its `shrink-0 pt-3 pr-3`
  column) a `<button type="button" class="btn btn-sm preset-tonal-surface pointer-coarse:min-h-11"
  data-could-exist-read-from>` reading `Read from {formatDate(date)}` that sets the moment the way
  `CouldExistHereGroup.svelte`'s `readFrom` does today (`loreRoute.set(reduce(loreRoute.route, { type: "setMoment",
  moment: momentKey(date) }))`). Move that logic into `EntryPool`; the group no longer needs it.
- `date` is the row's own `{ year, month ?? null, day ?? null }` from `sourceOf(item)` (the same fields `dimmedKeys`
  is built from in `EntryWorkspace.svelte` ~583–612); draw nothing when `year` is not a number.
- **A History entry never gets the line** (its date is its own): skip when `item.kind === HISTORY_TYPE_ID`
  (`$lib/shared/entries/types`). It stays dimmed in the body as today.
- Both list (and tree) rows and cards.

### 2. The group holds only entries on lines forked from this one

`CouldExistHereGroup.svelte`: remove the `later` prop, its loop, `readFrom`, and imports left unused; the trailing
count is `forked.length`; the section renders when `forked.length > 0`. Rewrite the charter comment to say: the group
at the end of an entries list for the entries of lines forked from the one being read; rows that begin later stay in
the list body, where they gain their cause line and **Read from ‹date›**. Update `couldExistHere.ts`'s header comment
the same way (keep `CouldExistReason`'s `"later"` and `couldExistWhy`: the list uses them). Update the
`EntryPool` mount (`later` gone, `sourceOf` simplifies to `forkedSource.get(item.key)` if nothing else needs the
fallback — check).

### 3. Touch size

`CouldExistHereGroup.svelte` ~198: the forked row's checkbox class gains `pointer-coarse:size-6`, as `EntryPool`'s
`bulkCheck` has.

### 4. No word of fading

`BulkTimeDialog.svelte` ~129: the Decay description *Sets how each entry fades. Their other fields stay as they are.*
becomes exactly *Sets the Decay stored on each entry. Their other fields stay as they are.* Update its test if it
asserts the old sentence.

## Tests (each run one at a time)

Before every run: `ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep`; if anything is
listed, wait (`timeout 900 bash -c 'while ps -eo pid,args | grep -E "node.*vitest|sdk:build|tsup|tsc -b" | grep -v grep >/dev/null; do sleep 20; done'`).
Run as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/time-t8b-fix-<name>.log 2>&1"`
from the repo root, then read the log's tail. Never pipe vitest into `head`.

- `entryPool.couldExistBulk.dom.test.svelte.ts`: replace the test at ~264 ("a dimmed row moves to the group…") with:
  a dimmed row stays in the list body (`[data-entry-row]`, not inside `[data-could-exist-here]`) with the toggle off
  and on; with bulk edit on it has its checkbox (`[data-bulk-check]`) either way; it shows *Begins in ‹date›* and
  **Read from ‹date›** only with the toggle on, and pressing **Read from** sets the route's moment; a dimmed History
  row never shows the line; the group's count leaves later rows out.
- `couldExistHereGroup.dom.test.svelte.ts`: drop the later-row cases (~194–220) and the `later` input; add an
  assertion that a forked row's checkbox has `pointer-coarse:size-6`.
- `bulkTimeDialog.dom.test.svelte.ts`, `couldExistHere.test.ts`.
- Then the four together plus the neighbouring lorebook DOM tests that mount `EntryPool`
  (`grep -ln "EntryPool\|LorebooksWorkspace" src/lib/client/lorebooks/*.dom.test*` — run at most the 8 most relevant,
  in one capped run, log `plans/time-t8b-fix-w2-neighbours.log`).

Done means those pass and `npx prettier --check` is clean on each file you changed (if a file was already unclean
before you, say so rather than reformat it).
