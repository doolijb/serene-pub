# BRIEF — worker `timeline-d-w2` — the timeless copy, client prompt and docs

Repo `/home/jody/github/serene-pub`. Supervisor: lane `timeline-d` (`plans/briefs/BRIEF-timeline-d.md`). You
cannot spawn agents. Report back in your final message (no report file).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Book settings' **Timeline** card asks before switching a lorebook's timeline off. Add the recommended way out to
that prompt: **Make a timeless copy**, which asks the server (worker w1 is building it now) for a new lorebook that
keeps each entry and cast member as it reads now on the line open in the workspace, undated, with its Timeline
off, and then opens the copy. The source is never changed and its switch is left on.

## Owner rulings (quoted)

- 2026-11-13: "Switch off, allow, but prompt the user with a recommendation to clone as a timeless variant
  instead. Do not provide SDK api for this yet."
- 2026-11-13, confirmed "Sounds good": a copy that keeps each entry as it reads now on the line being read,
  without dates, versions or other lines; scenes kept; history entries left out.
- 2026-11-14, the chosen screen: the prompt's buttons are **Make a timeless copy** (the primary, gold button),
  **Switch off here**, **Cancel**; its text ends *A timeless copy keeps this one as it is.*
- Standing: nothing in the source is deleted or changed; an entry's edit history never travels with a copy.

## The server contract you call (being built by w1 — code against it, mock it in tests)

`lorebooks:duplicate` (existing event) with params
`{ lorebookId: number; timeless: { branchId: number | null }; requestId: string }` (`name` omitted: the server
names it `‹name› (timeless)`). Reply on `lorebooks:duplicate`: `{ lorebook: WireLorebook; requestId?: string }`
(sent to every tab of the user — match on `requestId`; a plain Duplicate from another tab must not satisfy it).
Refusal on `lorebooks:duplicate:error`: `{ error: string; requestId?: string }`. The event is gated, not scoped
(`shared/sockets/interest.ts` ~989), so `awaitReply`'s default bare reply key is right. The two type fields
(`timeless`, `requestId`) are added to `Sockets.Lorebooks.Duplicate` in `shared/sockets/types.ts` by w1; **do not
edit that file**. If `tsc` complains before w1 lands, cast locally at the call site and say so.

## Files owned (edit only these)

- `src/lib/client/lorebooks/time/TimelineCard.svelte` and its test `time/timelineCard.dom.test.svelte.ts`
- `src/lib/client/lorebooks/BookSettings.svelte` — the card's props only (and the one new prop below)
- `src/lib/client/lorebooks/LorebooksWorkspace.svelte` — passing the open-book callback to `BookSettings` only
- `src/lib/client/components/Layout.svelte` — the `HANDLED_WHEN_ASKED_ERROR_EVENTS` list only (~372–375), and its
  test `src/lib/client/components/layoutHandledErrors.test.ts`
- a new DOM test beside `BookSettings.svelte` only if the wiring needs one
- Docs: `docs/lorebook-time.md` (the **Setting the switch** section, ~25–29) and `docs/lorebooks.md` (the
  **Creating, importing, duplicating and deleting** section, ~309–326). **Another lane (`timeline-c`) edits
  `docs/lorebook-time.md` right now: re-read the exact lines right before each edit, small edits with the Edit
  tool, never reformat.**

Never edit: `LorebookActions.svelte`, any server file, `shared/sockets/types.ts`, `NOMENCLATURE.md` (the supervisor
records names there), `STYLE-GUIDE.md`, session forms or the session page.

## Build

### TimelineCard (`time/TimelineCard.svelte`; the prompt is ~165–196)

- New props (🚧, report each): `branchId: number | null` (the line open in the workspace; null is main),
  `branchName: string | null`, `lineCount: number` (how many lines the book has, main included),
  `sessionNotes?: boolean` (the book is a session's notes), `onDuplicated?: (lorebookId: number) => void` (the
  same name and meaning as `LorebookActions`' prop: a copy landed, open it).
- The prompt's text becomes: *This lorebook has {asking}. With the timeline off that is hidden, not deleted, and
  sessions read the lorebook as it stands now. A timeless copy keeps this one as it is.* 🚧
- When `lineCount > 1`, a second line in the prompt: *The copy is made from the line ‹name›.* 🚧 (`‹name›` is
  `branchName ?? "main"`). Not shown with one line.
- Buttons, in this order: **Cancel** (`btn btn-sm preset-tonal-surface`), **Switch off here** (`btn btn-sm
  preset-tonal-surface` — it is no longer the gold one), **Make a timeless copy** 🚧 (`btn btn-sm
  preset-filled-primary-500`). STYLE-GUIDE §2: "Gold is for the next action… one filled primary per region."
- **Make a timeless copy** sends `lorebooks:duplicate` with `{ lorebookId, timeless: { branchId }, requestId }`
  (`requestId` from `uuid` — the card already imports `v4 as uuid` from "uuid"; never `crypto.randomUUID`) through
  `awaitReply` (`client/utils/awaitReply.ts`) with `errorEvent: "lorebooks:duplicate:error"`,
  `fallbackError: "The lorebook could not be duplicated."` (the server's existing fallback),
  `match: (d) => d?.requestId === requestId`, `matchError` the same on the refusal, and
  `timeoutMs: TIMELESS_COPY_TIMEOUT_MS` — a module constant, `60_000` for now (the supervisor sets it from the
  measured time).
- While it runs: the button reads *Copying…* 🚧, the other two buttons and the switch are disabled.
- On success: the prompt closes, **no `lorebooks:update` is sent** (the source's switch is left on), and
  `onDuplicated?.(reply.lorebook.id)` opens the copy. No toast (views never call `toaster` or `notify`).
- On a refusal: the error shows in the card (the existing `role="alert"` line) and the prompt stays open, so
  **Switch off here** and **Cancel** are still there.
- `sessionNotes`: the prompt keeps today's text (without the copy sentence or the line sentence) and only
  **Cancel** / **Switch off here**, with **Switch off here** staying gold (a session's notes cannot be copied as a
  lorebook; the server refuses it). This is a supervisor's call pending the owner (★); build it as written.
- The copy button exists only in this prompt. No menu item, no other entry point.
- Update the component's header comment to state the rule (comments state the rule, not the story; a ratchet test
  counts phrases such as "no longer").

### BookSettings (`lorebooks/BookSettings.svelte`; the card is mounted ~419)

- Pass `{branchId}`, `{branchName}`, `lineCount={branches.length}`, `sessionNotes={notesName != null}` and
  `{onDuplicated}` to `TimelineCard`. `BookSettings` already has `branchId`, `branchName`, `branches` and
  `notesName` props.
- New optional prop `onDuplicated?: (lorebookId: number) => void` (JSDoc: a copy made from this page landed; open
  it).

### LorebooksWorkspace (`<BookSettings` ~3036)

- Pass `onDuplicated={(id) => openBook(id)}` — the same callback the workspace already gives `LorebookActions`
  (~3395; `openBook` ~1687). Nothing else in this file.

### Layout (`components/Layout.svelte` ~364–375)

- Add `"lorebooks:duplicate:error"` to **`HANDLED_WHEN_ASKED_ERROR_EVENTS`** (said in place when the refusal names
  its asker by `requestId`, toasted otherwise) — **never** to `HANDLED_ERROR_EVENTS`: plain Duplicate sends no
  `requestId` and keeps its toast (`LorebookActions.svelte` ~396–406). Extend the list's comment by one clause
  naming the timeless copy.
- `layoutHandledErrors.test.ts`: a helper that parses `HANDLED_WHEN_ASKED_ERROR_EVENTS` the way
  `handledErrorEvents()` parses the other set, and a test that `lorebooks:duplicate:error` is in it and **not** in
  `HANDLED_ERROR_EVENTS`.

### Tests (DOM, `time/timelineCard.dom.test.svelte.ts`, extend the existing file's pattern)

- the three buttons in order (Cancel, Switch off here, Make a timeless copy) and only the copy button is
  `preset-filled-primary-500`;
- the copy button sends `lorebooks:duplicate` with `timeless: { branchId }` for the open line (main → null, a line
  → its id) and a `requestId`, and calls `onDuplicated` with the copy's id on the matching reply;
- a reply with another `requestId` does not settle it;
- the source's switch is not sent (no `lorebooks:update` emitted) on a copy;
- *Copying…* while it runs, the other buttons disabled;
- a refusal shows in the card and the prompt stays;
- the line sentence only with more than one line;
- with `sessionNotes`, no copy button and no copy sentence.

### Docs

- `docs/lorebook-time.md` **Setting the switch**: the prompt's new text, the three buttons in order, and what
  **Make a timeless copy** makes: a new lorebook named *‹name› (timeless)* that keeps each entry and cast member as
  it reads now on the line you're reading (every dated change on that line applied), with no dates; links and
  stats as they stand now; scenes kept, not filed under history; no history entries, dated changes, presences,
  other lines, clock or calendar; its timeline off. The original is not changed and its switch stays on; the copy
  opens. With more than one line the prompt names the line the copy is made from. A refusal shows in the card.
  Session notes are offered only **Switch off here** and **Cancel**. Mark new copy 🚧 as the section does.
- `docs/lorebooks.md` **Creating, importing, duplicating and deleting**: one sentence after the **Duplicate**
  paragraph pointing at the timeless copy (offered only when switching a lorebook's timeline off, see
  `./lorebook-time.md#setting-the-switch`). It is a session, never a chat.

## How to run tests (rules)

- Only your files, from the repo root, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-d-w2-<n>.log 2>&1"`
  one run at a time; before each run check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` and wait if
  one is up, checking each minute (another worker, another lane and another session run tests too; never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. A failing `assert` on a happy-dom element has
  OOM-killed VS Code before: keep assertions on strings and booleans.
- Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . > plans/timeline-d-w2-tsc.log 2>&1`; report
  errors in your files only. Not `npm run check` or `npm test`.
- If tests fail on a missing SDK `dist` file, another lane is running `sdk:build`: wait a few minutes and rerun.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.
- Never `prettier --write` a directory or glob; never `git checkout`, `restore` or `stash`; never `kill -9`.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`. `socket.off(event)` always with the handler. Browser code: no `crypto.randomUUID`, no
  `navigator.clipboard`. No other product's name in any file.

## Stop and report (do not decide) when

A label, sentence or name beyond those marked 🚧 here seems needed; a file outside Files owned would have to
change; the prompt cannot be built as written.

## Report (your final message)

Changed files; tests run with results (log paths); every name, sentence and label added (🚧); anything you could
not do; **Noticed, not done**.
