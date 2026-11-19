# BRIEF — worker `ss-3b-2-w2`: a prompt row on every model call that has a choice, in the session's derived settings form, with its label

Supervisor: lane `ss-3b-2`. App repo `/home/jody/github/serene-pub`. Paths below are under `src/lib/server/` unless they start with `src/` or `plans/`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (This task needs no `sdk:build`: don't run one.)

Also: run no git command that changes the index or the working tree (read-only `git diff` is fine). Never run prettier with `--write` and never pipe its output into a file. No migration. No `npm run build`, no full test run.

## Context (already built; read, don't redo)

- `promptsOffered(pool, { specId, address, defaults, inForce, administrator, pluginsOff })` in `pipelines/entities/prompts.ts` (~586–645) is **the one rule** for which prompts a model call offers; the panel's `choicesFor` and the form both call it. A prompt that records no pipeline, a hidden prompt and a switched-off plugin's prompt are offered to an administrator only (to anyone else only when in force; the first also where it is the call's own default).
- `callHeadingsOf({ plan, nodes, decls, language? })` in `pipelines/config/panel/groups.ts` (just added) gives each model call's settings-group heading (the panel's agent name, e.g. *Reply · prose*), by `plan.calls` index. `planGroups` (~139) and `modelCallsOf` (~362) are exported there; `plan.ownerOf(address)` gives the call index a node belongs to, `-1` for the whole pipeline. `read.ts` feeds them from `loadDocument(db, at.specVersionId)` (`pipelines/boot/store.ts`): `doc.nodes`, `doc.edges`, and clauses mapped as at `read.ts` ~989.
- The Step 0 table is pinned in `pipelines/entities/promptsOffered.int.test.ts` (the panel's non-administrator session view, per shipped genre and preset). Under today's rule the calls with two prompts or more are Story's `story-respond` `context`, `story-generate-image` `render`, `story-illustrate-scene` `context` (Story's three presets); every other call offers one.

## Goal

### 1. Server: `sessions/settingsForm.ts` (prompt rows only; lanes `kn-5`, `gs-1` edited other parts — re-read before each edit)

- **Drop the `promptReach` gate** (~570–574): `promptDecls` becomes every `prompts-ref` declaration with a `nodeDefinitionId`. Remove `nodeExpose` if nothing else reads it. **Keep `MODEL_SLOTS`** and `modelCalls` untouched (they gate plain settings and the write refusal).
- **A row only where there is a choice:** after `promptsOffered`, show the row when it offers **two prompts or more**, or **one that is in force and differs from the call's own default** (`promptDefaults.get(addr)`); otherwise `continue`. (Today: any non-empty offer.)
- **Load each pool once per pipeline** (a `Map` keyed by `nodeDefinitionId\u0000slot` around `listPrompts`), and load the document for the label only when there are prompt decls.
- **The label names the call**, `‹name› prompt`, where ‹name› is, in order:
  1. the panel's agent heading, when the spec has two model calls or more and the prompt's step belongs to one: `plan = planGroups({ nodes: doc.nodes, edges: doc.edges, clauses, modelCalls: modelCallsOf(decls) })`, `i = plan.ownerOf(d.nodeKey)`, `i >= 0` → `callHeadingsOf(...)[i]`;
  2. else the step's own label, `expose.label` on the node as placed (`i18nText(node.expose.label)`), never the definition's name;
  3. else the pipeline's name (`at.name`).
  E.g. *Reply · prose prompt*, *Drafting prompt*, *Generate image prompt*. Print every row's label in your report.
- Description stays the existing sentence. Members, value, inherited, source, locks (`settingLocksOf`, read-only with *Set by the session's preset.* / *…genre.*), the write (`registrations.values` on every registration key, the leftover override cleared) and the `stepOf` entry stay exactly as today. Hidden members keep the existing ` (hidden from owners)` suffix; add ` (its plugin is switched off)` for a member whose plugin is off (`pluginsOff.owns(p.ownerPluginId)`), shown only to an administrator (a non-administrator only ever gets one in force: no suffix for them).
- **Comments, rule not history:** the comment above the prompt loop (~833–836) and the module header (lines 22–41) say: the session's owner gets the prompt choice of each model call that offers a choice (`promptsOffered`; two prompts or more, or one in force that isn't its default), named after the call.
- **The stale refusal** (~1363–1366): it calls prompts an administrator's. Prompt slots are in `isModelPlumbing`, so a write to a prompt address the form does not show lands in that branch. Change it so a prompts slot (`promptSlotNames(db)` in `pipelines/entities/prompts.ts`) falls to the other sentence (*That is not a setting this session offers you here. Nothing was saved.*), and the plumbing sentence reads *What a step runs on — its connection, sampling, loadout and templates — is an administrator's, in the pipeline's own settings. Nothing was saved.*

### 2. Client (`src/lib/client/components/sessionForms/`)

`SessionSettingsForm.svelte` (~128–170, ~245–257) and `sessionSettingsForm.ts` already treat any prompt row generically (`isPromptRow`, **Read the wording**, `PromptWordingDialog` by `fieldId`). With several rows in one card:
- each **Read the wording** button gets `aria-label={`Read the wording: ${f.label}`}` (the visible text stays *Read the wording*; STYLE-GUIDE §9: every interactive element has an accessible name; repeated identical names in one card are ambiguous);
- the dialog's `rowLabel` is the card heading when the card holds one prompt row, else `‹card heading› · ‹row label›`.
Do not touch `EditSessionForm.svelte` or any seat component (lane `walk2-fix-A` is live there).

### 3. Tests

- `sessions/settingsForm.int.test.ts`: tests that find the row by `x.label === "Prompt"` (lines ~784, ~810, ~1167, ~1269, ~1631) find it by its address slot instead (`slot === "prompts"`, and the reply's `nodeKey`); keep each test's assertions. Add (one `describe`, "a prompt row on every model call that has a choice"): per shipped Story preset, the owner's form has a prompt row exactly on the calls the Step 0 table marks `row: true` for the pipelines the form shows (creation excluded), each member list equal to the panel's choices for that call (ids, same order), each label as built; a call offering one prompt has no row; a row shows with advanced controls off (the form has no advanced gate: assert the field has no `advanced` flag); a pick written through the form on `story-illustrate-scene` (or `story-generate-image`) is read back by the panel's session view (`namespaceView` … option `value`) and by the run's resolver (whatever the existing R54 test uses to prove the run reads it; find it), and a pick through the panel shows as the form's value; a lock shows the row read-only in words; a guest's form is empty (existing test may cover: reuse); a non-administrator never gets a hidden or switched-off plugin's prompt unless in force, an administrator gets them with the two suffixes.
- `src/lib/server/sockets/pipelines.promptReaders.int.test.ts` line ~134 only: find the reply's row by slot, not by the label "Prompt" (lane `gs-1`'s test; that one line, nothing else).
- `src/lib/client/components/sessionForms/sessionSettingsForm.dom.test.ts`: two prompt rows in one card render with their labels and two **Read the wording** buttons with distinct accessible names; the row renders with advanced controls off.

## Files owned

`src/lib/server/sessions/settingsForm.ts` (prompt rows, its header, the refusal), `src/lib/server/sessions/settingsForm.int.test.ts`, `src/lib/server/sockets/pipelines.promptReaders.int.test.ts` (line ~134 only), `src/lib/client/components/sessionForms/SessionSettingsForm.svelte`, `src/lib/client/components/sessionForms/sessionSettingsForm.ts`, `src/lib/client/components/sessionForms/sessionSettingsForm.dom.test.ts`.

**Files readable:** anything. Re-read each file right before you edit it.

## Out of scope

`promptsOffered`, the panel (`pipelines/config/panel/*`), `PipelineConfigOptions.svelte`, `PromptWordingDialog.svelte`, `EditSessionForm.svelte`, docs, NOMENCLATURE, the SDK, what a run reads (`config/world.ts`), the step-settings projection (`sessions/stepSettings.ts`), the order of rows in a card (prompt rows stay after the plain rows, in declaration order).

## Stop and ask when

A card would hold more than 8 prompt rows; the label needs a word beyond the rule above; a lock or write path would have to change; a test outside your files fails because of your change (report it, don't edit it); the panel and the form offer different lists for one call.

## Rules your work depends on (quoted)

- Owner 2026-11-15: "making sure prompt choices are easilly accessible for all session owners in each of the sections/pipelines." ★S3-a: the session owner's prompt choice is on by default for every model call; `promptReach` becomes redundant.
- Owner D58: "The session's owner picks and may read the wording; a guest sees nothing; outside a session only an administrator."
- Owner P1 (2026-11-17): "Offer all for that node/pipeline to any user that owns a session. Only show disabled/hidden prompts to admins for use."
- Owner P3: "a choice of one is not a choice" (the lane's reading: no row for a call offering one prompt, unless what is in force is not its default).
- CLAUDE.md: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "Inside `db.transaction(async (tx) => …)` use only `tx`." · "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing." · Browser code: "no `crypto.randomUUID`, no `navigator.clipboard`."
- STYLE-GUIDE §10: "Help is one sentence." · §6.17: "Read-only is the value's name plus [words] … never a disabled control." · §9: "Every interactive element is a real `button`, `a` or input with an accessible name."
- Lead: "Comments state the rule, never history."

## Done means (tests, one at a time, at least one path each)

Wait first: `until ! pgrep -f "^node .*vitest" >/dev/null; do sleep 5; done` (other lanes share vitest; waits can be long). Then
`cd /home/jody/github/serene-pub && systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/ss-3b-2-w2-<n>.log 2>&1"` and read the summary with `tail -n 40`. Never pipe vitest into `head`.

1. `src/lib/client/components/sessionForms/sessionSettingsForm.dom.test.ts`
2. `src/lib/server/sessions/settingsForm.int.test.ts`
3. `src/lib/server/sockets/pipelines.promptReaders.int.test.ts src/lib/server/pipelines/entities/promptsOffered.int.test.ts`

Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (report only errors in your files) and `NODE_OPTIONS=--max-old-space-size=10240 npm run check` (report only errors in your files; it is slow).

## Report

Your final message: files changed (line ranges), every prompt row's label per Story preset as built, each test run and its result, anything you noticed and did not do. Under about 450 words.
