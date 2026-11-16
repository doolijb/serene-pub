# BRIEF — worker `run-reads-entry-w2` — the earmark notice in the entry forms (client)

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`: no SDK file changes in this task.)

Also: never `git checkout`, `restore`; never `kill -9`; never `prettier --write` a directory.

## Goal

In Serene Pub (`/home/jody/github/serene-pub`), the server now **earmarks** a lore entry while a pipeline run that
was shown it may still replace its text, and **refuses** a person's save that changes the entry's name, content or
typed fields while it is earmarked (the refusal's `{ error }` is one sentence, e.g. *Story sweep in Mira's tavern may
update this entry when it finishes. Your changes are kept here: save again then.*). A new request,
`entries:earmark`, answers whether an entry is earmarked. Build the client half:

- **Notice on open.** When `EntryWorkspace.svelte` opens an **existing** entry it may save (not new, not read only,
  not a library piece, store `entries`), it asks `entries:earmark` **once**. When the answer's `notice` is a
  sentence: a **notice line** above the fields with that sentence and a **Check again** button, and every Save
  control disabled — the plain **Save** / **Save & next**, **Save as of ‹date›** and **Change the base**
  (`amendSave` snippet ~1937). *Off for a while…*, marks and Archive stay enabled (they are never refused).
  **Check again** asks once more; a `null` answer removes the notice and enables Save. No polling, no timer, no
  pushed event.
- **Notice on save.** After any refused save of an existing entry — the `entries:update` catch in `save()`
  (~1305) and the `saveAsAmendment` catch (~1078) — when the rejection is **not** a reply timeout
  (`isReplyTimeout`), ask `entries:earmark` once and, when it returns a sentence, enter the notice state. Do not
  change the refusal's shape and do not toast it yourself: Layout's `:error` catch-all already toasts it (Standing
  ruling: only the domain context toasts; views never call `toaster`).
- **The draft.** On that refusal the form must stay open with every field exactly as typed and no "discard" prompt.
  The catches already keep the draft — verify, and fix only what does not.
- **The cast member's Lore tab** — `CastWorkspace.svelte` ~690–760 (the character-lore editor saving through
  `entries:update`): the same notice on open of an existing lore entry, Save disabled, and the same ask after a
  refused save. Touch nothing else in `CastWorkspace.svelte`.

## Contract (server side is built; do not change it)

- Emit `entries:earmark` with `{ entryId: number }`. Reply `entries:earmark`:
  `{ entryId: number; lorebookId: number; notice: string | null }`. Refusal `entries:earmark:error`:
  `{ entryId?: number; error: string }`. Types: `Sockets.Entries.Earmark` in `src/lib/shared/sockets/types.ts`;
  entries already in `src/lib/client/sockets/typedSocket.ts`.
- The reply is SCOPED on `lorebookId` and GATED (`src/lib/shared/sockets/interest.ts`), so ask through `awaitReply`
  (`src/lib/client/utils/awaitReply.ts`) with `replyKey: interestKey("entries:earmark", lorebookId)`,
  `errorEvent: "entries:earmark:error"`, `match: (d) => d.entryId === id`, `matchError: (d) => d?.entryId === id`,
  exactly as the forms already ask `entries:update`. A failed or timed-out ask shows no notice (it never blocks
  Save) — the server still refuses the save if it must.
- Ignore an answer for an entry that is no longer the one open.

## Suggested structure (implementation is yours; name the choice in your report)

- `src/lib/client/lorebooks/editor/entryEarmark.ts`: 🚧 `askEntryEarmark(socket, lorebookId, entryId): Promise<string | null>`.
- `src/lib/client/lorebooks/editor/EntryEarmarkNotice.svelte`: 🚧 the notice line; props `notice`, `checking`,
  `onCheck`. Shared by both forms.
- No other new names. Any visible word beyond the server's sentence and **Check again** is a question: stop and
  report it instead.

## Rules your work depends on (quoted)

- STYLE-GUIDE §6.21: "A **notice** is a line inside the screen it concerns." "A notice says only what the viewer can
  act on". A toast "is raised through `src/lib/client/utils/notify.ts`, never the raw toaster". This notice is
  **not** a toast and **not** dismissible (it explains the disabled Save); a muted line
  (`text-surface-700-300 text-xs`, an icon from the file's existing `Icons` set), `role="status"`, the button a small
  quiet button (`btn btn-sm preset-tonal`), wrapping at phone width.
- STYLE-GUIDE §10: "Sentence case everywhere"; "A button says what happens"; "Help is one sentence."
- STYLE-GUIDE §6.14: "A form that buffers edits behind a Save asks before they are lost — and **only** then." "a
  refused Save stays, its reason on the form".
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
  "`socket.off(event)` with no handler removes **every** listener app-wide; always pass the handler." Browser code
  runs on plain-http LAN addresses and phones: "no `crypto.randomUUID`, no `navigator.clipboard`".
- An `$effect` that calls a method which writes state it also reads must `untrack` those reads (a known trap here:
  an effect that reads what it writes loops).
- Members never see model plumbing: show only the server's sentence; never a run id, connection or model.
- Never use "read"/"reading", "claim" or "held" in a new name or string (they already mean other things,
  NOMENCLATURE R1).
- "Comments state the rule, not the story" (`src/lib/shared/conformance/commentHistory.test.ts`): no dates, lane
  names or history in new comments.

## Files owned (edit only these)

- `src/lib/client/lorebooks/EntryWorkspace.svelte` (the ask on open, the notice, Save disabled, the ask after a refusal)
- `src/lib/client/lorebooks/editor/entrySave.ts` only if the amendment save needs it
- `src/lib/client/lorebooks/CastWorkspace.svelte` — the Lore tab only
- New: `src/lib/client/lorebooks/editor/entryEarmark.ts`, `src/lib/client/lorebooks/editor/EntryEarmarkNotice.svelte`
- New DOM test: `src/lib/client/lorebooks/entryEarmark.dom.test.ts` (or `.dom.test.svelte.ts` if it needs runes),
  and test fixtures beside it if needed. Harness to copy: `src/lib/client/lorebooks/lineConformance.screens.dom.test.ts`
  (mounts `EntryWorkspace`) and `src/lib/client/lorebooks/cast/memberPage.dom.test.ts` (mounts `CastWorkspaceFixture`).

Readable: anything. Not owned: `typedSocket.ts`, `types.ts`, `interest.ts`, any server file, `entryManager.ts`,
`TimeLens.svelte`, `EntryFireTest.svelte`, `sessionPage/storyMoved.ts` (their refusals already toast through the
shell; leave them).

## Out of scope

A pushed event; polling; a toast of your own; any server change; other callers of `entries:update`; docs and
NOMENCLATURE (the supervisor does those); restyling anything else.

## Stop and ask (in your report) when

The form cannot keep the draft without restructuring it; a new visible word beyond the sentence and **Check again**
seems needed; a file outside the list would have to change.

## Done means

A DOM test (fake socket, as the harnesses above do) that:
1. opening an existing entry whose `entries:earmark` answer is a sentence shows the notice with that sentence and
   Save disabled; **Check again** with a `null` answer removes it and enables Save;
2. with a `null` answer on open, typing into the content and pressing Save, then answering `entries:update:error`
   with the sentence and the follow-up `entries:earmark` with the sentence: the typed text is still in the field
   exactly as typed, no discard prompt, the notice is shown and Save is disabled;
3. the cast member's Lore tab shows the notice on open with Save disabled (one case is enough).

Run, one at a time, **only** inside:
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <files> > <log> 2>&1"`
with the log under `/tmp/claude-1000/-home-jody-github-serene-pub/c4d03dff-b9b2-4178-92cd-10084eb4de8b/scratchpad/`
named `run-reads-entry-w2-<n>.log`. **Before every run** check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep`;
if one is up, wait in a bounded loop (sleep 30, at most 10 tries, using that `ps` line — never
`pgrep -f "vitest run"`, which matches itself). Never pipe vitest into `head`. A failing assert on a happy-dom
element can blow memory: keep asserts on strings/booleans you pull out of the DOM.
Files: your new DOM test, `src/lib/client/lorebooks/lineConformance.screens.dom.test.ts`,
`src/lib/client/lorebooks/cast/memberPage.dom.test.ts`, `src/lib/client/lorebooks/cast/memberTabs.dom.test.ts`,
`src/lib/client/lorebooks/editor/entrySave.test.ts`, `src/lib/shared/conformance/commentHistory.test.ts`.
Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "EntryWorkspace|CastWorkspace|entryEarmark|EntryEarmarkNotice|entrySave"`
(svelte files are not covered by tsc; also run
`NODE_OPTIONS=--max-old-space-size=12288 npx svelte-check --threshold error 2>&1 | grep -E "EntryWorkspace|CastWorkspace|EntryEarmarkNotice|entryEarmark"`
and report only errors in your files) and `npx prettier --check <each file you touched>`.

## Report

Your final message (not a file): changed files; every new name and every visible string verbatim; where the ask
fires (open, Check again, after a refusal) and how a stale answer is ignored; what you verified about the draft;
tests run with exact commands and results; anything you stopped on; Noticed, not done.
