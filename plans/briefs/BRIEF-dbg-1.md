# BRIEF — build lane `dbg-1` — the admin switch that turns pipeline step time limits off (programme 1.8)

Repos `/home/jody/github/serene-pub` (app) and `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`NOMENCLATURE.md` §1, §24, `STYLE-GUIDE.md` (copy rules; the sections for the admin shell and notices),
`docs/pipelines.md` (limits), the admin docs page, `plans/REPORT-ss-7-2026-11-16.md` (the Turn line as built).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root. Before any `npm run sdk:build` (from the app root): `pgrep -af "vite"` (dev or preview up: do
not build, report "blocked on your dev server") and wait until no vitest is up. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/dbg-1-<n>.log 2>&1"`,
one run at a time (other lanes run tests: wait for them). Migrations are generated (`npm run db:generate`; a new
index must exceed the highest in `drizzle/meta/_journal.json`); prefer the existing home of pub-wide admin
settings over a new column: if a migration seems needed, say why in the report. No full run, no `npm run build`.

## Owner

2026-11-15: "Lets add a global debug off switch in the admin for pipeline step await time so we have a safety
fallback." Asked where it shows while on: "Yes, notification/activity, admin dashboard, and in the session
activity/turn order widget." Principles: P1 (every automatic thing shows its cause and how to undo it), P3 (a
setting answers who changes it, why, what breaks without it), P4 (one sentence of purpose).

## Build

### A. Inventory first (supervisor; file:line in the report)

Every place a pipeline **step** is given a time limit and cut off when it passes: the node policy `timeoutMs` /
`timeoutKind` (`sdk/src/descriptors.ts` ~1904–2242) and where the executor or host enforces it; the pub ceiling
(`sdk/src/validate.ts` ~1070 mentions it: find it); script budgets (`pipelines/scripts/chains.ts` ~301,
`scripts/host.ts` ~114), plugin node and tool hook limits (`runtime/pluginBindings.ts` ~380, `host.call.ts`
~777), a binding's own inner deadline (`bindings.summarize.ts` ~1529), `callTether.ts`. For each: what it
bounds, who set the number, what happens at the limit.

### B. The switch

- One pub-wide admin setting, stored where pub-wide admin settings live, **off by default**, admin only:
  🚧 **Turn off step time limits** with the purpose sentence *For finding out whether a time limit is what stops
  a step. While this is on, a stuck step waits until someone stops it.* (Wording per STYLE-GUIDE copy rules;
  place it with the other pipeline / diagnostics controls of the admin: find the right section, do not make a
  new one unless none fits, and say which.)
- While on: the **step** limits from the inventory that exist to stop a slow model call or step do not fire.
  **Limits that protect the server stay on** whatever the switch says: script VM budgets and the sandbox's
  interrupt deadline, plugin node / tool hook limits, network connect timeouts, anything whose removal lets
  untrusted code spin forever. State the split in the report, per inventory row, with the reason. Stop still
  works for every run (the Turn line's Stop, `pipelines:cancelRun`).
- Read once per step start through one function (🚧 `stepTimeLimitsOff()` in the module that owns the setting);
  no caller reads the stored value itself. A change applies to steps that start after it.
- It does not survive silently: see C.

### C. Shown while on (the owner's three places)

1. **Notifications / activity:** a standing notice to administrators while it is on (*Step time limits are off.*
   with a way to the setting), through the existing notifications / activity path; cleared when switched off.
2. **Admin dashboard:** a visible state line or badge on the dashboard while on, linking to the setting.
3. **The session's Turn line:** a short marker while on (*Time limits off*), on the SDK `TurnLine.svelte`, fed
   by one field on the session dossier (🚧 `stepTimeLimitsOff?: true`); shown to everyone in the session (it
   explains why a step may wait), with no link for a member (members never see model plumbing or admin).
   The dossier is pushed when the switch changes, through the existing push path, scoped events carrying
   `sessionId`.

Sockets: the admin domain context is the only listener and the only place that toasts.

### D. Docs and names

`docs/pipelines.md` (limits) and the admin page: one short paragraph; `INTEGRATING.md` where the dossier field
and limits are described; NOMENCLATURE rows for the setting and the field (🚧, purpose, owner, §25).

## Files owned

The module that owns pub-wide admin settings and its socket; the enforcement sites named in the inventory (one
guarded read each); the admin section and dashboard components that show it; the notifications path (one
notice); SDK `sessionDossier.ts`, `TurnLine.svelte`; the app code that fills the dossier; tests; the docs;
`NOMENCLATURE.md`. **Not** `src/lib/server/sockets/sessions.ts` beyond the one dossier field (another lane has
just split that file: find where the dossier is built now).

## Out of scope

Changing any limit's number; per-session or per-pipeline switches; a new admin section; the knowledge filter's
own failure behaviour ("stays as built"); routine caps and the idle-running setting (programme 2.8).

## Stop and ask when

CLAUDE.md §Decisions applies; no existing home for a pub-wide admin setting; switching a limit off would let a
plugin or script run unbounded; the Turn line cannot learn the state without a new socket event.

## Done means

Tests: with the switch off nothing changes (each limit still fires: one test per enforcement site kept or
existing); on: a step past its limit keeps running and Stop ends it; the protected limits still fire; the notice
appears and clears; the dashboard state; the dossier field and the Turn line marker (member and admin); only an
admin can change it. `sdk:build` then `npm run sdk:test` (capped form; only the four known failures).
`NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` 0 errors; `npm run check` 0 errors.

## Report

Final message = the report (lead saves `plans/REPORT-dbg-1-<date>.md`): the inventory table with the split and
reasons; where the setting lives and shows; every new name and sentence; changed files; tests; open ★;
**Noticed, not done**. Under about 700 words.

## Cold review corrections (2026-11-16) — these rule over the text above

1. **The switch is an SDK executor option.** The executor computes a step's limit as
   `Math.min(d.timeoutMs ?? Infinity, opts.timeoutCeilingMs ?? Infinity)` (`sdk/src/executor.ts` ~1884); core
   only passes the ceiling (`runTurn.ts` ~1200, `cardAction.ts` ~282, `callTether.ts` 44–62). Add one
   `RunOptions` field (🚧 name is the lane's proposal, marked ★ in the report; it is a published SDK name) that
   makes the executor apply **no step limit and no ceiling** for that run. `sdk/src/executor.ts`, its tests and
   the INTEGRATING step that documents run options are owned. **Read at run start; applies to runs that start
   after the change** (not per step).
2. **What stays on, and why the lane does not stop on it:** plugin node limits (`pluginBindings.ts` ~380), tool
   hook limits (`host.helpers.ts` ~310) and script budgets are enforced inside the sandbox call, not by the
   executor's clock, so they keep firing. The model-call idle watchdog (`connectionAdapters/idleTimeout.ts`,
   `LLM_IDLE_TIMEOUT_MS`: no data for 10 minutes) **stays on**: it ends a dead connection, not a slow step; say
   so in the setting's docs paragraph.
3. **Storage:** one `system_settings` column beside `scriptsEnabled` / `contextDebuggingEnabled`
   (`db/schema.ts` ~4344), by a **generated** migration (index above the journal's highest). `systemSettings:get`
   already reaches every signed-in user and both shells listen (`sockets/systemSettings.ts` 30–36).
4. **The dossier is built in the browser** (`client/components/sessionPage/sessionPageProjections.ts`; precedent
   `promptDetails` from `systemSettingsCtx.settings?.contextDebuggingEnabled`, ~848, ~967). Fill the dossier
   field there. No server push, no scoped event, no session socket file changes.
5. **The Turn line marker shows to administrators only** (as `promptDetails` does; STYLE-GUIDE §6.21: a notice
   says only what the viewer can act on). Showing it to members is DISCUSS-LATER D24, not built.
6. **Copy:** help is one sentence (STYLE-GUIDE §10): *For finding out whether a time limit is what stops a
   step; a stuck step then waits until someone stops it.* Label and notice wording are ★ in the report.
7. **Homes:** the setting card in Admin › Diagnostics (`client/admin/sections/diagnostics/Page.svelte` ~58,
   beside `ContextDebuggingCard`; `components/admin/pub/SettingSwitch.svelte`); the dashboard through an item in
   `server/admin/attention.ts` (precedent `extensions:sandboxOff` ~208, shown on the Overview *Needs you* card);
   the notice through `notifications/store.ts` `raiseNotification` / `clearNotifications` (as
   `updateAvailable.ts` 24–37). The Turn line is
   `../serene-pub-sdk/core-catalog/components/shared/messages/TurnLine.svelte`.
