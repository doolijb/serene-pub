# BRIEF — worker `time-t8b-w2` — the bulk **Beginning…** / **Decay…** dialog

Repo `/home/jody/github/serene-pub`. Supervisor: lane `time-t8b`. You type; you do not decide product questions.
If something below does not fit the code, stop and say so in your report rather than inventing.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build`.)

## Goal

One dialog component that asks, for several selected lorebook entries at once, either a **Beginning** or a
**Decay**, and hands the value back to its caller. It sends nothing itself: a later worker's bulk action bar
sends one existing `entries:update` per entry. Another worker is writing other files at the same time; touch
only yours.

## Owner rulings and the fields (quoted; they decide, you do not)

- 2026-11-14: bulk actions include **Beginning** and **Decay**; with the lorebook's Timeline off, Beginning is
  not offered (the caller never opens your dialog in that mode then; you need not check).
- The fields are lane `time-t2`'s: **Beginning** is the entry's own `year`, `month`, `day` (all three `null` =
  **Perpetual**); **Decay** is `decayRate`, a number from 0 (**Fact**) to 1 (**Living** above 0).
- Copy and controls must match the single-entry row the entry form already has, `src/lib/client/lorebooks/time/
  BeginningDecayRow.svelte` (read it; do not edit or mount it — it binds one entry's draft and shows both
  fieldsets): radio **Perpetual** / **Began at**; **Year** (required, marked `*`), **Month**, **Day** number
  inputs with the same placeholders; the calendar line (*Reads as ‹date›*, or the calendar's problem, from
  `dateProblem(date, openBookTime.calendar)` and `formatDate`) with `aria-live="polite"`; help *The entry is not
  read before this date.*; radio **Fact** / **Living**; a range 0–1 step 0.01 with `aria-label="Decay rate"` and
  the value beside it; choosing Living from Fact starts at 0.25; help *Stored now; recall does not use it yet.*

## File owned (edit only these)

- NEW `src/lib/client/lorebooks/BulkTimeDialog.svelte`
- NEW `src/lib/client/lorebooks/bulkTimeDialog.dom.test.svelte.ts`

## The component

```ts
interface Props {
  open: boolean
  mode: "beginning" | "decay"
  /** How many entries the value goes to (after the caller left out the ones it does not fit). */
  count: number
  onApply: (patch: { year: number | null; month: number | null; day: number | null } | { decayRate: number }) => void
  onClose: () => void
}
```

- Skeleton `Dialog` in a `Portal`, `role="dialog"` (not an alertdialog: nothing is deleted), backdrop and
  positioner exactly as `time/MoveDownTheTreeDialog.svelte` draws them (`z-50`), content
  `card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl`.
- Header (STYLE-GUIDE §6.6): `Dialog.Title` class `h4` — `Beginning for ${count} entries` / `Decay for ${count}
  entries` (`1 entry` when count is 1); `Dialog.Description` muted 14px — beginning: *Sets when each entry starts
  being read. Their other fields stay as they are.*; decay: *Sets how each entry fades. Their other fields stay
  as they are.*; an `X` `Dialog.CloseTrigger` (`btn-icon hover:preset-tonal min-h-11 min-w-11`,
  `aria-label="Close"`).
- The fieldset for the mode only, starting at **Perpetual** / **Fact** each time the dialog opens (state reset on
  open, read through `untrack` in the effect as the move dialog does).
- Footer: **Cancel** (`btn preset-tonal min-h-11`) and the primary `btn preset-filled-primary-500 min-h-11`:
  `Apply to ${count} entries` (`Apply to 1 entry`). Disabled while Began at has no whole-number year, or while
  a month or day is given that is not a whole number from 1, or a day without a month, or the calendar says the
  date is a problem. Pressing it calls `onApply` with the patch (Perpetual → all three null; Began at → the
  numbers, missing parts null; decay → the number, Fact = 0) then `onClose`.
- Unique input ids per instance (`Math.random().toString(36).slice(2, 8)`, as the move dialog does; never
  `crypto.randomUUID`). Every input has a `<label>`; touch targets `min-h-11`.

## STYLE-GUIDE rules that apply (quoted)

- §6.6: "Dialogs are Skeleton `Dialog` in a `Portal` at `z-50`. Nothing in the app renders its own `fixed inset-0` backdrop." (the Skeleton `Dialog.Backdrop` the move dialog uses is the allowed one) — "A dialog's header is its `Dialog.Title` (heading font, 18px semibold), a muted 14px `Dialog.Description` under it saying what the dialog is for or where things stand, and an `X` `Dialog.CloseTrigger` (a small icon button, `aria-label="Close"`) at the top right."
- §6.1: "One primary button per surface."
- §9: "Every interactive element is a real `button`, `a` or input with an accessible name"; "Targets are 44px on touch."
- §10: "Sentence case everywhere"; "A button says what happens"; "Help is one sentence."

## Hard rules

- `SvelteSet` / `SvelteMap` for any reactive set or map; no `crypto.randomUUID`, no `navigator.clipboard`.
- The view never toasts and registers no socket listener (it sends nothing).
- Comments state the rule, not the story. Never `prettier --write` beyond your own files.

## Tests (`bulkTimeDialog.dom.test.svelte.ts`)

Model the harness on `src/lib/client/lorebooks/time/moveDownTheTreeDialog.dom.test.svelte.ts` (mount into
`document.body`, `flushSync` / `tick`, `openBookTime.open(...)` for the calendar; no book data context needed
unless your component reads one). Cases: beginning mode opens on Perpetual and Apply sends all three null;
Began at with no year → Apply disabled; year 5 month 3 → `{ year: 5, month: 3, day: null }`; a day without a
month → disabled; decay mode opens on Fact (Apply sends 0); Living starts at 0.25 and the range value is sent;
the titles and the Apply label for 1 and for 3 entries; Cancel calls `onClose` and not `onApply`; reopening
resets to Perpetual / Fact.

## Done means

Check `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows no vitest first (wait if one runs); never
pipe vitest into `head`:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/client/lorebooks/bulkTimeDialog.dom.test.svelte.ts > plans/time-t8b-w2.log 2>&1"
```

Green. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p . 2>&1 | grep -E "BulkTimeDialog|bulkTimeDialog"` shows nothing.

## Report

Return your report as your final message (the harness may refuse a file write): changed files, tests run with
results, every label and sentence you added, assumptions, **Noticed, not done**.
