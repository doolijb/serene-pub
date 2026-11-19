# BRIEF — build lane `ss-3b` — a prompt choice on every model call that has one, for the session's owner (programme 2.2, first half; owner rulings ★S3-a, D58, D59)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (doc comments only; no build
unless a compiled file must change, then say so first). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-prompt-rows-2026-11-16.md` (**re-verify every file:line**; the settings form and the panel
changed since), the HELD section at the end of `plans/briefs/BRIEF-ss-3a.md` (this brief replaces that one),
rows D58, D59 in `plans/DISCUSS-LATER.md`, `plans/REPORT-gs-1-2026-11-16.md` (who reads prompts;
`pipelineReaderOf`; **Read the wording** on the form's prompt row; `fieldId` on `pipelines:promptWording`),
`plans/REPORT-kn-5-2026-11-16.md` (the form's ganged field: the form's field code moved),
`plans/REPORT-ss-5-2026-11-16.md` (`settingLocksOf`, locks in words), `docs/sessions.md` (the Settings tab),
`STYLE-GUIDE.md` (form rows; one sentence of help; read-only in words), `NOMENCLATURE.md` §1, §24 and rows
**prompt**, **agent**, **settings group**, **session owner**.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Both repos are staged by the lead: run no git command that changes the index or the working tree. `npx prettier
--check` only, never `--write`. **No migration.** Inside `db.transaction` only `tx`. Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-3b-<n>.log 2>&1"`
(always at least one path), one at a time, after `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`.
`NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. No full run, no `npm run build`.

## Owner

2026-11-15: "making sure prompt choices are easilly accessible for all session owners in each of the
sections/pipelines." ★S3-a (2026-11-15, "Yes, I agree with you."): the session owner's prompt choice is on by
default for every model call; `promptReach` becomes redundant. 2026-11-16 (D58): "The session's owner picks and
may read the wording; a guest sees nothing; outside a session only an administrator" + "There should be a
preview button for prompts". 2026-11-16 (D59): "A call offers only the prompts made for its own pipeline, plus
its default". Standing: P3 (few settings: a choice of one is not a choice), P5 (derived from declarations),
members never see model plumbing (a prompt pick is not plumbing; connections, sampling, loadouts are).

## Step 0 — count before building (report this table first, then continue unless a stop fires)

For every shipped genre and preset, for each pipeline the session runs (reply, event pipelines, enabled
actions, routines, create): each model call, the step holding its prompts slot, the **pool under the D59 rule**
(below) and its size. One table: genre → pipeline → call → pool size → row or no row. **Stop and report if any
one card would hold more than 8 prompt rows** (a layout question for the owner), with the table.

## The pool rule (D59)

Today `listPrompts` filters by pool key (node type) and slot only; the spec only orders
(`pipelines/entities/prompts.ts` 115–125; `sessions/settingsForm.ts` ~836): one pool,
`core:task/build-template-context`, holds 25 shipped prompts mixing prose reply prompts and JSON routine
prompts. **New rule, in one function both the form and the panel's session view call:** a model call offers
(a) the prompts **made for its own pipeline** (find how a prompt records the pipeline it was made for: its
spec slug / origin on the prompt row or the seed; if a prompt records none, it is offered only where it is a
step's default), plus (b) that step's **default** prompt, plus (c) the prompt **in force** if it is neither
(so the row never hides what is running: shown, marked as today's value, and choosable away from). Hidden
prompts stay out for a non-admin unless in force (R54). An administrator's Pipelines screens outside a session
are **not** narrowed by this lane (they keep the whole pool: say so; narrowing them is a ★ for later).

## Build

1. **A Prompt row for the session's owner on every model call whose pool, under the rule, holds at least two
   prompts** (or one in force that differs from the default), in the derived settings form
   (`sessions/settingsForm.ts`), advanced controls on or off, on every card the form already shows (reply,
   event pipelines, actions, routines, create where a card exists). The gate `expose.promptReach === 'owner'`
   (inventory: 559–563) no longer decides. **Keep `MODEL_SLOTS`** (it gates plain settings on a model step and
   the write refusal; `modelCallsOf` excludes loadout and auxiliary steps): do not replace it; find the prompt
   slot of a call through the panel's pairing (`pipelines/config/panel/groups.ts`) without changing the
   panel's output.
2. **The row:** label names the call: the agent's label from the panel where one exists (e.g. *Reply · prose*)
   + "prompt"; `planGroups` returns no agents for a spec with one model call or none (`groups.ts:153`): then
   the step's heading, else the pipeline's name (`settingsForm.ts` ~770 already has such a fallback): exact
   form ★. One sentence of help (the existing one). The pick is a Listbox per the project's select pattern,
   as the existing row is. **Read the wording** on every row (lane `gs-1` added it to the one row: same
   control, same server read by `fieldId`). Locks through `settingLocksOf`, in words. Writes land where the
   existing row's do (`registrations.values`): prove a pick made here is read by the run and shown by the
   Pipelines card, and the reverse.
3. **The Pipelines card's own Prompt rows** (advanced, in a session): they follow the same pool rule for a
   session's owner (one function), so the two surfaces never offer different lists.
4. **`promptReach` in the SDK:** core ignores it for showing the row. Do not remove or rename it (owner's
   call): mark it ⏳ transitional in its doc comments (`sdk/src/builder.ts` ~246, ~518, ~591–597;
   `document.ts` ~69) and in `guides/where-values-come-from.md` ~69; its only value is `'owner'`; the error
   text at `builder.ts:593` ("an administrator's choice is the default") is corrected. Doc comments only: no
   SDK build (they are compiled files: if a comment change alone forces a dist difference that tests read,
   run `sdk:build` under the usual checks and say so).
5. **Stale text:** the form's header comment about prompts, the refusal that calls prompts an administrator's
   (~1240).
6. **Docs and names:** `docs/sessions.md` (the Settings tab: a prompt choice on each model call that has one;
   what is offered), `docs/pipelines.md` (which prompts a call offers; `promptReach`), `INTEGRATING.md` if it
   describes the pool, `NOMENCLATURE.md` (rows **prompt row**, **model call**, the pool rule's function with
   charters; §25).

## Out of scope

The two views and the tab's switch (the second half of 2.2); order across pipelines; narrowing an
administrator's pool outside a session; any change to what a run reads.

## Tests

The Step 0 table pinned as a test (per shipped genre: the calls that get a row and their pool ids): old → new
counts in the report. The pool function: own-pipeline prompts, the default, the one in force, hidden prompts,
a prompt with no recorded pipeline. A pick from the form is read by the run and shown by the Pipelines card;
locks in words; a guest's replies carry no prompt (lane `gs-1`'s tests still pass); an administrator's
out-of-session pool unchanged. DOM: rows render with labels and **Read the wording** with advanced controls
off. Both prompt baselines unchanged (no run-time change). `tsc` 0; `npm run check` 0 errors in lane files.

## Files owned

`src/lib/server/sessions/settingsForm.ts` (prompt rows only: lanes `kn-5` and `gs-1` edited other parts:
re-read first), `pipelines/entities/prompts.ts` (the pool function), `pipelines/config/panel/` (the session
owner's prompt list only; `groups.ts` only to export the pairing), the client form
(`client/components/sessionForms/sessionSettingsForm.ts`, `SessionSettingsForm*.svelte`), their tests, the SDK
doc comments and guide, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; Step 0 shows more than 8 rows on one card; a prompt records nothing that says
which pipeline it was made for (then report what the seed and custom prompts do carry: do not invent a
field); the shared pairing cannot serve the form without changing the panel's output; a shipped spec relies
on `promptReach` to mean something else.

## Report

Final message = the report (lead saves `plans/REPORT-ss-3b-<date>.md`): the Step 0 table; the pool rule as
built and what "made for its own pipeline" reads; rows per genre (before → after); labels (★); `promptReach`;
tests; **Noticed, not done**. Under about 650 words.

## Cold review corrections (2026-11-17) — these rule over the text above

**The lane is cut in two. This brief builds `ss-3b-1` only: the Step 0 table, one shared pool check, and the
form's existing prompt row switched over to it. Then report and stop.** Rows on every call, labels, the SDK
comments and the docs are `ss-3b-2`, briefed after the owner has seen the table. Logs `plans/ss-3b-1-<n>.log`;
report `REPORT-ss-3b-1-<date>.md`.

1. **A pool-by-pipeline rule already exists in the panel** (owner 2026-10-02, note 37: "Prompts need to be
   properly filtered by pipeline across the app"): `promptsForPipeline`
   (`src/lib/server/pipelines/config/panel/choices.ts` 486–508) drops rows marked as **another** pipeline's
   prompt (the mark is set at 206–210); `choicesFor` calls it (522–528); `read.ts:577` passes the prompt in
   force and the default as rows to keep. Only the settings form still offers the raw pool
   (`sessions/settingsForm.ts:835`). So: move the check inside `promptsForPipeline` into
   `pipelines/entities/prompts.ts` as the one function; the form calls it in place of its raw `listPrompts`
   pool; `choicesFor` calls the same function. An administrator's screens outside a session keep note 37's
   rule unchanged (they already have it). Strike "Today `listPrompts` filters by pool key and slot only" and
   "Pipelines screens outside a session keep the whole pool".
2. **What a prompt records:** `created_for_spec_id` (a spec id; `db/schema.ts:6542`, documented "GROUPING
   ONLY, never a permission"), `defaultForSpecs` (spec slugs), `seedKey` / `templateId`; no genre column.
   Prompts that record **no** pipeline: a Library copy (`sockets/pipelines.ts` 2217–2226), every plugin prompt
   (`boot/registrySync.ts` 1313–1317), the shipped summarize-scene rows (seed `prompts.ts` 345, 355, 370, 393).
   **In this lane they stay offered, as note 37 offers them today** (whether D59 narrows them to "only where
   they are a step's default" is with the owner: rulings page P1 / D69). Do not change that.
3. **The lead's reading of D59 within one pipeline (build it; ★ in the report):** from a pipeline's own
   prompts, a call is **not** offered a prompt that **another call of the same pipeline uses as its default**
   (the defaults are already read as `declared`, `settingsForm.ts:584`). Reason, from D59's own question: a
   pipeline's prompts share one pool by step type, so Dungeon Crawler's reply (parley, edits, the Planner's
   JSON turn, the prose narrate: seed `prompts.ts` 1065, 1079, 1106, 1120), the interview pipeline (1009–1051)
   and the goal pipeline (`goal.ts:259`) would otherwise offer a JSON prompt on a prose call and the reverse.
   Story's reply keeps its four Roleplay prompts (three are no call's default). This applies to the one
   function, so the panel's session view and the form agree; say what it changes on an administrator's screens
   (if it removes a choice there, list it: that is a visible change to report, not to hide).
4. **Step 0's table** uses the rule as built in 1–3: genre → pipeline → call → prompts offered → row or no
   row, and for each row the prompts by name. Expected from the review: Story reply 4 → a row; reckon, sweep,
   the Lair's keeper / scratchpad / reply, Chat memory 1 each → no row; no card over 8. Add a stop: a pool
   still contains another call's default after rule 3.
5. **Not in this half:** Build items 2 (rows on every call, labels), 4 (`promptReach` comments; note
   `sdk/src/builder.ts:593` is running code pinned by `sdk-tests/stepLabel.test.ts:145`), 6 (docs beyond one
   sentence where the form's pool is described). Stale "grouping never refuses" comments that the moved check
   makes false are corrected now: `db/schema.ts` 6537–6540, `choices.ts:177`, `sockets/pipelines.ts` 913–915.
6. Line fixes: the label fallback is at ~`settingsForm.ts:867`; `planGroups` and `modelCallsOf` are already
   exported (`groups.ts` 139, 362).

## `ss-3b-2` — launch note (2026-11-17 evening; owner's answers PR and P1) — rules over everything above

**Build the second half now:** Build items 2 (a prompt row on every model call that has a choice, for the
session's owner, with its label), 4 (`promptReach` comments) and 6 (docs), on top of what `ss-3b-1` built
(`plans/REPORT-ss-3b-1-2026-11-17.md` and its fix: `promptsOffered(pool, {specId, address, defaults, inForce,
showHidden, pluginsOff})` in `pipelines/entities/prompts.ts`; the panel write refuses non-offered prompts; the
Step 0 table pinned in `promptsOffered.int.test.ts`). Logs `plans/ss-3b-2-<n>.log`; report
`REPORT-ss-3b-2-<date>.md`.

Owner (2026-11-17): **PR** "Build it as the table shows". **P1** (asked: is a prompt that records no pipeline
offered to a session's owner): "What do you mean by unmarked? That a prompt has no node it belongs to? Prompts
should always be listed under a specific. Offer all for that node/pipeline to any user that owns a session.
Only show disabled/hidden prompts to admins for use."

Lead's reading of P1 (★ in the report):
- **Every prompt is listed under one specific pipeline step.** A session's owner is offered **every enabled,
  not-hidden prompt of that step's pipeline** that the Step 0 rule gives (unchanged: rule 3's "not another
  call's default").
- **Disabled or hidden prompts are shown to administrators only** (`showHidden` is true only for an
  administrator; find where it is set and make sure a non-administrator owner never gets hidden or disabled
  rows, in the form and in the panel's session view; an administrator sees them, marked as hidden / disabled
  with the existing words).
- **A prompt that records no pipeline belongs nowhere**: it is offered to **no** session's owner. Today such
  prompts stay offered everywhere (correction 2 above: a Library copy, every plugin prompt, the shipped
  summarize-scene rows). Change: they are offered to a session's owner only where they are **a step's
  declared default or the prompt in force** (so nothing a session uses today disappears); an administrator
  still sees them on the administrator's prompt screens, where they can be given a pipeline (use the existing
  way a prompt's pipeline is set: find it; if none exists, report that: giving a prompt a pipeline is then a
  follow-up, not this lane). Re-pin the Step 0 table with this rule and list every (genre, pipeline, call)
  whose offered set changes, by prompt name: the owner sees that list in the report. **Stop** if any shipped
  call would lose its prompt in force or its default.
- Guests still see nothing (gs-1); a member who owns no session has no prompt screens.

Notes: never run prettier with `--write` or pipe its output into a file. No migration. SDK: doc comments only
(`promptReach`); `sdk/src/builder.ts:593` is running code pinned by `sdk-tests/stepLabel.test.ts:145`: do not
change it; if a compiled SDK file must change, stop and say so (no `sdk:build` while other lanes test). An
isolated built-app instance may run for a UI walk: no `npm run build`. Live lanes, not your files: `dg-1d-1`
(`pipelines/runtime/haltExplanation.ts`, `runtime/host.ts`, `host.types.ts`, `host.loreWrites.ts`,
`bindings.summarize.ts`, `runtime/runTurn.ts`, `utils/runReply.ts`, `sockets/sessions.pipelines.ts`,
`sessions/seatName.ts`, `sessions/seats.ts`), `walk2-fix-A` (`client/components/sessionForms/*`
seat components and `EditSessionForm.svelte`: **the session settings form lives beside them: if you must
edit `EditSessionForm.svelte`, re-read right before each edit and touch only the settings / prompt-row
lines**), `walk2-fix-B` (`scenes/liveScenes.ts`, lorebook workspace components, `cast/sharedCardCopy.ts`).
`shared/sockets/types.ts`, `docs/sessions.md`, `NOMENCLATURE.md` are shared: re-read before each edit.
