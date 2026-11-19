# BRIEF — build lane `ss-3a` — a prompt choice for every model call, for the session's owner, on by default (programme 2.2, first half)

Repos `/home/jody/github/serene-pub` (app), `/home/jody/github/serene-pub-sdk` (SDK: edit it there; never
`git checkout / restore / stash` in it). Supervisor: read `.claude/guides/multi-agent.md`, then
`plans/INVENTORY-prompt-rows-2026-11-16.md` (the map of this lane: **re-verify every file:line**),
`plans/PLAN-session-settings-cleanup-2026-11-15.md` 255–285 (★S3-a, ★S4-a), `plans/REPORT-ss-2a-…`, `-ss-2b-…`,
`-ss-5-2026-11-16.md` (the one store, locks, `settingLocksOf`), `docs/sessions.md` (the Settings tab),
`STYLE-GUIDE.md` (form rows, read-only in words), `NOMENCLATURE.md` §1, §24, rows **prompt**, **agent**,
**settings group**, **session settings**; `../serene-pub-sdk/INTEGRATING.md` where `expose` / `promptReach` is
described.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never `git stash`; `npx prettier --check` only, never `--write`. Never commit. Never `npm test` / `npm run build`
at the SDK root. `sdk:build` only from the app root after checking no dev / preview server (`pgrep -af "vite"`;
the Svelte language server's esbuild does not count) and no vitest is up
(`until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done`). Tests only as
`systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-3a-<n>.log 2>&1"`,
one run at a time. `NODE_OPTIONS=--max-old-space-size=10240` for `tsc` and `npm run check`. **No migration.**
Inside `db.transaction` only `tx`. No full run, no `npm run build`.

## Owner

2026-11-15: "making sure prompt choices are easilly accessible for all session owners in each of the
sections/pipelines." Ruled 2026-11-15 evening ("Yes, I agree with you."), ★S3-a: the owner's prompt choice is on
by default for every model call; `promptReach` becomes redundant. Standing: members never see or touch model
plumbing; **the prompt choice is the session owner's: a pick among prompts, never the text**; a guest sees
neither. P3 / P4 (each control one sentence of purpose), P5 (derived from declarations).

## Build

1. **Every agent of every pipeline the session runs gets a Prompt row in the derived settings form**
   (`sessions/settingsForm.ts`), for the session's owner, with advanced controls on or off: the reply, other
   event pipelines, enabled actions, routines, the create spec where the form already shows a card for it. An
   *agent* is the panel's settings group that pairs a model call with the step holding its prompts slot
   (`pipelines/config/panel/groups.ts`): reuse that pairing (one function both the panel and the form call; do
   not write a second enumeration; the form's own `MODEL_SLOTS` rule goes if the shared one covers it). Today
   only a step declaring `expose.promptReach === 'owner'` gets a row (559–563): that gate goes.
2. **The row:** label names the call, not just "Prompt" (the agent's existing label from the panel, e.g.
   *Reply · prose*, then "prompt"; exact form is ★, follow STYLE-GUIDE's label rules), the existing one-sentence
   description, the pool as today (`listPrompts` by node type + slot + spec; hidden prompts left out for a
   non-admin unless in force), locks through `settingLocksOf` in words as built by `ss-5`. **No row** when the
   pool holds fewer than two prompts the owner may pick (a choice of one is not a choice: P3) unless a lock or a
   prompt in force must be shown; a call whose prompt is fixed text in the spec, a script, or a tool-only call
   gets no row. A card that has only prompt rows still shows.
3. **`promptReach` in the SDK:** it no longer decides whether core shows the row. Do **not** remove or rename
   the published field (owner's call): mark it ⏳ transitional in its doc comment and in NOMENCLATURE
   ("ignored by core since 0.6.x: every model call's prompt is the session owner's to pick"), keep `validate()`
   accepting it. If any value of it means "hide from owners" and a shipped or plugin spec uses that to keep a
   prompt admin-only, stop and report (that would be a ruling conflict to surface with both quotes).
4. **A guest sees no prompt, anywhere on the Settings tab.** The inventory found (from code only) that a
   session guest with advanced controls on gets the **Pipelines** card with a Prompt per agent and **Read the
   wording** (`sessionPipelines.ts` 97–127; `EditSessionForm.svelte` ~2949; pinned by
   `editSessionAdvanced.dom.test.svelte.ts:333`). Verify on the server reply and in the DOM test what a guest
   actually receives. If prompt names, ids or wording reach a non-owner non-admin: fix **at the server** (the
   reply carries no prompt rows and no wording for a guest; the client shows nothing rather than a disabled
   control) and pin it with a test. If the test at :333 pins the leak, re-pin it and say so (old → new).
5. **The Pipelines card's own Prompt row** (advanced only) stays for now, reading and writing the same
   `registrations.values` address: prove one write shows in both places. Whether it goes is ★ (report).
6. **Stale text:** the form's header comment (39–40, "never in the form") and the refusal sentence that calls
   prompts an administrator's (~1240) state today's rule.
7. **Docs and names:** `docs/sessions.md` (the Settings tab: every model call's prompt, who sees it; the
   Pipelines card needs advanced controls), `docs/pipelines.md` if it describes `promptReach`,
   `INTEGRATING.md`, `NOMENCLATURE.md` (rows **prompt row** and **model call** with charters; §25).

## Out of scope

The two views and the tab's switch (lane `ss-3b`); order across pipelines; showing prompt wording to an owner
where it is not shown today; any change to what a run reads (storage is already one store).

## Tests

Server: the form for each shipped genre / preset lists a prompt row for each agent that has a real choice
(enumerate and pin the list per genre: old → new counts in the report), none for a single-prompt pool; routines
and event pipelines included; a lock shows in words; a write from the form is read by the run and shown by the
Pipelines card; a guest's replies (form and Pipelines card) carry no prompt id, name or wording; an admin in
their own session unchanged. DOM: rows render with their labels with advanced controls off; guest sees none.
SDK: `promptReach` still validates. Both prompt baselines unchanged (no run-time change).

## Files owned

`src/lib/server/sessions/settingsForm.ts`, `sessionPipelines.ts` (the guest reply only),
`pipelines/config/panel/groups.ts` (only to export the shared pairing), the client form
(`client/components/sessionForms/sessionSettingsForm.ts`, `SessionSettingsForm*.svelte`, the guest branch in
`EditSessionForm.svelte`), their tests, the SDK doc comment, the docs.

## Stop and ask when

CLAUDE.md §Decisions applies; a shipped spec relies on `promptReach` to hide a prompt from owners; the shared
pairing cannot serve the form without changing the panel's output; more than about 40 rows appear for one
shipped genre (report the list first: that is a layout question for the owner).

## Report

Final message = the report (lead saves `plans/REPORT-ss-3a-<date>.md`): rows per genre (before → after); the
no-row rule; the guest finding and fix; `promptReach`; tests changed (old → new); every label and sentence (★);
**Noticed, not done**. Under about 600 words.

## HELD (2026-11-16) — not launched; cold review

Do not build from this brief. It waits on the owner: D58 (who may read prompts: the fix is in
`sockets/pipelines.ts` `viewerFor` ~143, `config/panel/scopes.ts` `visibleTo` 59–60, `pipelines:promptWording`
~301–340, not in `sessionPipelines.ts`; `editSessionAdvanced.dom.test.svelte.ts:333` does not pin the leak) and
D59 (pools are per node type: `entities/prompts.ts` 115–125; one pool of 25 mixes prose and JSON prompts).
Other corrections for the rewrite: keep `MODEL_SLOTS` (it gates plain settings and the write refusal;
`modelCallsOf` excludes loadout and auxiliary steps); `planGroups` returns no agents for a spec with one model
call or none (`groups.ts:153`), so the label needs a fallback (step heading or pipeline name,
`settingsForm.ts:770`); `promptReach`'s only value is `'owner'` (`sdk/src/builder.ts` 591–593), its documented
promise is `guides/where-values-come-from.md:69`, the error text at `builder.ts:593` and comments at 246 / 518
and `document.ts:69` need the ⏳ mark; count rows per genre first and stop at about 8 rows per card. Cut:
`ss-3a-1` member / guest prompt reads at the server; `ss-3a-2` the rows.
