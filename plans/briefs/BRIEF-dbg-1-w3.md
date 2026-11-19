# BRIEF — lane `dbg-1`, worker 3 — browser: the Diagnostics card, the Jump row, the dossier field

Supervisor: lane `dbg-1`. App repo `/home/jody/github/serene-pub`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

You do not run `sdk:build`, `db:generate`, `npm run build`, `npm test`, `tsc` or `npm run check`: the supervisor does. Never
`git checkout / restore / stash`. Never `prettier --write`.

## Goal

Owner, 2026-11-15: "a global debug off switch in the admin for pipeline step await time so we have a safety fallback."
The server side is done: the column `system_settings.step_time_limits_off` (boolean, default false) reaches the browser in
`systemSettingsCtx.settings.stepTimeLimitsOff` (the `systemSettings:get` payload excludes columns rather than listing
them), and the admin-only event `systemSettings:updateStepTimeLimitsOff` (`{ enabled: boolean }` →
`{ success, enabled }`, refusable, typed in `typedSocket.ts`) writes it and re-sends `systemSettings:get` to every
interested tab. The SDK dossier now has `SessionDossierV1.stepTimeLimitsOff?: true`, and the SDK's Turn line draws
*Time limits off* when it is set. Your part is the browser.

## Files owned (only these)

1. New `src/lib/client/components/admin/pub/StepTimeLimitsCard.svelte`.
2. `src/lib/client/admin/sections/diagnostics/Page.svelte` — place the card.
3. `src/lib/client/shell/adminSettings.ts` (+ `adminSettings.test.ts` only if its drift test needs a fixture change).
4. `src/lib/client/components/sessionPage/sessionPageProjections.ts` — the dossier field, nothing else.
5. New test `src/lib/client/components/sessionPage/stepTimeLimitsOff.projection.test.ts` (or append to the closest existing projection test if the session dossier builder can only be exercised through an existing harness: say which).

## Work

### 1. The card (`StepTimeLimitsCard.svelte`)

Copy the shape of `components/admin/pub/MessagingCard.svelte` exactly (a `SettingCard` holding one `SettingSwitch`,
`labelHidden`, `requireAdmin(userCtx.user)` before the emit; no status line under it):

- header JSDoc: the diagnostic switch (lane dbg-1, owner 2026-11-15); while on, runs that start apply no step time limit
  and no ceiling, Stop still ends every run, and limits inside a call (script and plugin sandboxes, tool hooks, the
  connection's ten-minute idle watchdog) stay on; administrators see a standing notification, a *Needs you* item and
  *Time limits off* on the Turn line while it is on.
- `SettingCard`: `id="step-time-limits"`, `title="Turn off step time limits"`, `titleId="step-time-limits-heading"`,
  `headingLevel={2}`, `layout="switch"`,
  `help="For finding out whether a time limit is what stops a step; a stuck step then waits until someone stops it."`
- `SettingSwitch`: `name="step-time-limits-off"` (this exact name: the notification and the Needs you item land on
  `/admin/diagnostics#step-time-limits-off`), `label="Turn off step time limits"`, `labelHidden`,
  `checked={!!systemSettingsCtx.settings?.stepTimeLimitsOff}`, `onCheckedChange` emits
  `systemSettings:updateStepTimeLimitsOff` with `{ enabled: event.checked }`.
- Do **not** listen to the reply or toast in the card (CLAUDE.md: "one domain context per event family (provided by both
  shells) is the only listener, and the only place that toasts; views register listeners for local state and never call
  `toaster`"). A refusal's `:error` is spoken by the layout's catch-all already; check that `systemSettings:*:error`
  events reach it (grep `:error` catch-all / `POLLED_ERROR_EVENTS` in `src/routes/+layout.svelte` or the shell) and say
  in your report what you found; do not add a listener.

### 2. Placement (`diagnostics/Page.svelte`)

Inside the existing `{#if systemSettingsCtx.settings}` block, directly after `<ContextDebuggingCard />`. Nothing else
on the page changes. (The section's purpose line stays.)

### 3. Jump row (`shell/adminSettings.ts`)

Beside the Context debugging row (~46), same shape:
`{ label: "Turn off step time limits", href: "/admin/diagnostics#step-time-limits-off", page: "Diagnostics", keywords: "timeout time limit stuck step debug" }`.
Read `adminSettings.test.ts` first: it is a drift test (one row per field); make it pass.

### 4. The dossier field (`sessionPageProjections.ts`)

In the session dossier object (~1119, right after the `rerunWaitsFor` spread, before `speech`), add, with a one-line
🚧 comment:

```ts
// 🚧 The pub's step time limits are off (Admin › Diagnostics): administrators only, as `debugPrompts` (lane dbg-1).
...(userCtx.user?.isAdmin && systemSettingsCtx.settings?.stepTimeLimitsOff ? { stepTimeLimitsOff: true as const } : {}),
```

Check how the dossier object is memoised / derived: if it is rebuilt only when some key changes (there is a `castKey`
for lines; check whether the top-level dossier has its own key or cache), make sure a change to
`systemSettingsCtx.settings?.stepTimeLimitsOff` rebuilds it, the same way `contextDebuggingEnabled` reaches
`debugPrompts`. Report what you found.

### 5. Test

Projection test: an admin with the setting on gets `stepTimeLimitsOff: true`; an admin with it off has no such key; a
member with it on has no such key. Find how the existing `sessionPageProjections.*.test.ts` files build the inputs
(`sessionPageProjections.cardless.test.ts`, `.ownLine.test.ts`, …) and reuse their builder; keep it small.

Run tests only like this, one run at a time, from the app root, after waiting for no other vitest:

```
until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dbg-1-w3-<n>.log 2>&1"
```

Run: your new projection test and `src/lib/client/shell/adminSettings.test.ts`. Never pipe vitest into `head`.

## Rules (quoted by the supervisor)

- STYLE-GUIDE §6.4 Setting cards: "the setting's name as the title (15px medium), **one sentence** of help … then the control. **The title is the control's label**: a field label, switch label or segmented label that would repeat it is kept for a screen reader only (`labelHidden`, `sr-only`), never drawn twice." "a status line the control already shows … is not drawn."
- STYLE-GUIDE §10: "Sentence case everywhere." "Help is one sentence."
- STYLE-GUIDE §6.11: "**Addresses can land on a field**: a `#target` (an element id, a `data-field`, or a `SettingSwitch` name) scrolls it into view and rings it once … Needs you actions and Jump's **Admin settings** rows (`shell/adminSettings.ts`, one row per field, drift-tested) land this way."
- CLAUDE.md standing ruling: "Members never see or touch model plumbing" — the dossier field is admin-only (correction: the Turn line marker shows to administrators only).
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." Svelte 5 runes only.
- Do the asked thing at the asked size; anything else you notice goes in your report under **Noticed, not done**.

## Done means

The five items done; the two test files green (log paths); `npx prettier --check` on each edited file (report; never
`--write`; say if a file failed before your edit — this repo has many files that already fail `--check`). Final message
to the supervisor: files changed, tests with results, what you found for the error catch-all and the dossier
memoisation, Noticed-not-done.
