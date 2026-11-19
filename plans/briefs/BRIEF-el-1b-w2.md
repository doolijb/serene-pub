# BRIEF — worker `el-1b-w2` — the cast member lock on screen: the control on the member's page, the list mark, the reader line

App repo `/home/jody/github/serene-pub`. SDK repo is read-only. Supervisor: lane `el-1b`. Report: your final message
(under ~500 words) — changed files with lines, tests run with results, every label or sentence you wrote,
Noticed-not-done.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` at all.)

## Rules you work under (quoted from CLAUDE.md, STYLE-GUIDE.md and the lane brief)

- The repo is staged by the lead: run **no git command that changes the index or the working tree**. Never run
  prettier with `--write` (no prettier writes at all) and never pipe its output into a file. No `npm run build`, no SDK
  edit.
- Comments state the rule, never history. Run `src/lib/shared/conformance/commentHistory.test.ts` before you finish.
- **Views never toast** (CLAUDE.md: "views register listeners for local state and never call `toaster`"): a refusal is
  shown inline (`InlineError`), as the entry lock does. `socket.off(event)` always with the handler. `$state(new Set())`
  is not reactive: use `SvelteSet` / `SvelteMap`. Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- STYLE-GUIDE: "**A view is complete at 400px.** … Width changes the arrangement, never the feature set." · "Help text
  is one sentence per card; a label is written once." · Muted text is `text-surface-600-400`. Absent, never disabled:
  a control a person may not use is not drawn.
- Tests only as
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/el-1b-w2-<n>.log 2>&1"`
  (always at least one path), one at a time, each after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
  Never pipe vitest into `head`. A failing `assert` on a happy-dom element has OOM-killed VS Code: assert on strings and
  booleans you read off elements. `NODE_OPTIONS=--max-old-space-size=10240` for `npm run check` (once, at the end;
  report only errors in your files).
- Files owned: `src/lib/client/lorebooks/CastWorkspace.svelte` (the control, the reader line, the list mark only),
  `src/lib/client/lorebooks/castPool.ts` (only if the row must carry the lock), a new DOM test
  `src/lib/client/lorebooks/cast/memberLock.dom.test.ts` (or `.svelte.ts` if a fixture needs runes). Never edit server
  files, `shared/sockets/types.ts`, docs or `NOMENCLATURE.md`. Re-read any file right before each edit. No new
  component file unless the markup cannot live in `CastWorkspace.svelte` (then stop and say why).

## What exists (built by lane el-1a for entries; copy it)

- `src/lib/client/lorebooks/EntryWorkspace.svelte`: `lockOn` / `lockStored` / `toggleLock` (~1280–1340), the
  `lockToggle` snippet (~2716–2752: a pressed-state button **Locked** with `Icons.Lock`, `aria-pressed`,
  `aria-describedby`, a check that shows when on, `FieldHelp` with one sentence, `InlineError`), and where it renders
  (~3168–3175: the toggle for someone who may edit; for a reader only when it is on, the line
  `Locked: sessions and their routines leave it as it is.` with `data-lore-lock-note`).
- `src/lib/client/lorebooks/EntryPool.svelte` ~531–545: the `lockMark` snippet (an `Icons.Lock size={14}` in
  `text-surface-600-400`, `role="img"`, `aria-label="Locked"`, `title="Locked"`, `data-lock-mark`).
- Its DOM test: `src/lib/client/lorebooks/entryWorkspace.lock.dom.test.svelte.ts`.
- Server (built by worker el-1b-w1): `lorebooks:updateBinding` with `params.lorebookBinding = { id, castMemberLock: boolean }`
  and **nothing else** sets the lock (same access as a hand edit; a reader, a stranger, a provided book are refused in
  words on `lorebooks:updateBinding:error`); it answers `lorebooks:updateBinding` with the member row and re-sends
  `lorebooks:bindingList`. Every cast member row the client already gets (`CastMemberRow`, a spread of the
  `lorebook_bindings` row) carries `castMemberLock: boolean`. A full member save ignores the field.

## What to build (in `CastWorkspace.svelte`)

1. **The control** on a selected, stored member's page, beside its edit controls (at the top of the **Member** tab,
   where **Copy to my characters** and the member actions sit; pick the spot that reads as "about this member", not a
   field of the draft), only when the book is not `readOnly`: the same button as the entry lock — label **Locked**,
   help (one sentence, `FieldHelp`): 🚧 `Sessions and their routines leave this cast member as it is; you can still edit it.`
   It writes at once (never part of the draft, never needs **Save**), through its own `awaitReply` on
   `lorebooks:updateBinding` with `{ lorebookBinding: { id, castMemberLock: !on } }`, `errorEvent`
   `lorebooks:updateBinding:error`, `fallbackError` `The lock could not be saved.`, matching the reply by member id.
   Busy while waiting; a refusal shows inline under it and clears when another member is selected. Do not reuse
   `sendBinding`/`writeBase` if they toast or touch the draft. `w-full justify-start sm:w-auto` as the entry button,
   so it fits at 400px. Mark copy `<!-- 🚧 Provisional copy: the owner has not seen this … -->` as el-1a did.
2. **The reader line**: when the book is `readOnly` and the member is locked, instead of the button, the line
   🚧 `Locked: sessions and their routines leave it as it is.` (`data-cast-lock-note`, `text-surface-600-400 text-chip`).
   Nothing when unlocked. (A provided lorebook's rows are `readOnly` too and can't be told apart; they are never locked,
   so nothing shows.)
3. **The list mark**: on each cast list row whose member is locked, the same small lock as `EntryPool`'s
   (`data-lock-mark`, `aria-label="Locked"`, `title="Locked"`), placed with the row's other badges (state / visibility,
   ~2025–2045). Thread `castMemberLock` through `castPool.ts`'s row if the row there does not already carry the binding.
4. Keep the shown state right after a toggle (from the reply or the re-sent list) without a reload.

## Tests (the new DOM test; model it on `entryWorkspace.lock.dom.test.svelte.ts` and the existing
`src/lib/client/lorebooks/cast/memberPage.dom.test.ts` / `CastWorkspaceFixture.svelte`)

- an owner sees **Locked** unpressed on an unlocked member; pressing it emits `lorebooks:updateBinding` with exactly
  `{ lorebookBinding: { id, castMemberLock: true } }`; after the reply it reads pressed (`aria-pressed="true"`);
- a refusal reply on `lorebooks:updateBinding:error` shows the words inline, no toast;
- a reader (`readOnly`) sees no button; sees the reader line only when the member is locked;
- a locked member's list row has `[data-lock-mark]`; an unlocked one has none.
Also run `src/lib/client/lorebooks/cast/memberPage.dom.test.ts`, `memberTabs.dom.test.ts`, `castRowTag.dom.test.ts`,
`castPool.test.ts` (if you touched `castPool.ts`), and `src/lib/shared/conformance/commentHistory.test.ts`.

## Stop and ask (in your report, then stop) when

A new socket event or a server change would be needed; the control can't be placed without restructuring the page; a
label other than the two sentences and **Locked** would be needed.
