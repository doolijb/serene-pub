# BRIEF — build lane `timeline-c` — a lorebook's Timeline switch: the session side

Repos: app `/home/jody/github/serene-pub`, SDK `/home/jody/github/serene-pub-sdk` (edit the SDK there).
Supervisor: read `.claude/guides/multi-agent.md` first, then `plans/REPORT-timeline-a-2026-11-14.md`,
`plans/REPORT-timeline-b-2026-11-14.md`, `src/lib/server/lorebooks/timeline.ts`,
`plans/PLAN-entry-time-and-lines-2026-11-14.md` §1 ("Presets and time"), §2 and §8's last block,
`../serene-pub-sdk/INTEGRATING.md` (the steps on genres and presets), `NOMENCLATURE.md` §1, §24 and the
session/preset/genre group sections, `STYLE-GUIDE.md` (copy rules), `docs/sessions.md`, `docs/genres.md`,
`docs/genre-story.md`, `docs/lorebook-time.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Lanes `timeline-a` and `-b` built the lorebook's Timeline switch and its lorebook screens. Today every new
session's notes and every lorebook made from the start form keep a timeline, whatever is played. This lane makes
a **new session's lorebook start with or without a timeline according to its preset and genre**, offers to
switch it on when a session is started on an undated lorebook, and removes time controls from the session's
screens when its lorebook has no timeline. **No migration is expected** (stop if one seems needed).

## Owner rulings this lane builds (quote them in worker briefs)

- 2026-11-13: "By default, Story Minimal will use an undated book. Messages will just display real time. All
  other Story presets will continue defaulting to timelined storybooks." Minimal on a timelined lorebook
  advances story time "as it does today". "the time incriment should be a property of whether the lorebook has
  it's own calendar or if the session is following real time."
- 2026-11-14 ("Lets go with all your recommendations", plan §8 item 14): Chat and Guide undated like Minimal;
  the Lair and Dungeon Crawler timelined as today.
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created."
- 2026-11-14, how a preset says it expects no timeline: "preset may override the genres default, but not it's
  mandate".
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- Standing: genres expect, never lock (a session on a lorebook that lacks what its genre expects plays, and
  says so in words); members never see model plumbing; "Do not provide SDK api for this yet" covers the
  **switch itself and the timeless copy**: no pipeline, outlet or plugin API reads or sets a lorebook's switch.

## Build

### A. SDK — two additive, optional names (🚧, ★ for the owner; no `@2`, nothing renamed or removed)

1. **A preset's default:** `PresetDefaults.timeline?: boolean` (`sdk/src/announce.ts` ~301–328; input mirror
   ~530–578): whether a new session's lorebook starts with a timeline. Left out = the genre's default.
2. **A genre's default and mandate:** the default is derived, no new name: a genre whose `keepsTime` is
   `'story'` (`sdk/src/genres.ts` ~236) defaults to a timeline; `'real'`, `'none'` or left out defaults to
   none. The mandate is one optional field on the genre, in the vocabulary the SDK already has for `dice`
   (`genres.ts` ~246–263: `'required' | 'optional'`): `timeline?: 'required'`. Validation (beside ~1196): a
   genre with `timeline: 'required'` and `keepsTime` other than `'story'` is an error; a preset whose genre
   requires a timeline and that declares `defaults.timeline: false` is an error naming both.
3. **Core catalogue** (`core-catalog/src/registry/genres.ts`, `core-catalog/src/seed/presets.ts` ~55–104): the
   Lair (~1180) and Dungeon Crawler (~1551) declare `timeline: 'required'`; Story does not; **Story Minimal**
   declares `defaults: { timeline: false }`. Chat and Guide need nothing (`'real'`).
4. SDK tests for the validation and the catalogue; `guides/` and `INTEGRATING.md` where presets' defaults and
   `keepsTime` are described. Then `npm run sdk:build` from the app root (rules below), and re-pin any hash
   tests the build moves.

### B. Server — one resolver, used at session start

1. `timelineDefaultFor(genre, preset)` in `src/lib/server/lorebooks/timeline.ts` (or beside the session
   resolvers if a cycle forbids): `genre.timeline === 'required'` → true; else `preset.defaults.timeline` when
   set; else `genre.keepsTime === 'story'`; **a genre that does not resolve → true**.
2. **How the preset's default reaches a stored preset.** Find how a declared preset's `defaults` reach
   `session_presets.defaults` (`db/schema.ts` ~8311–8391) and how an **existing** install's Story Minimal row
   picks up a changed declaration. If declared defaults already refresh stored rows at boot, add the test that a
   second boot changes nothing. If they do not, **stop and report** the smallest boot pass (0.6 is in users'
   hands). An admin's copy of a preset carries the value with `defaults`.
3. **Session create** (`sockets/sessions.ts`; preset loaded ~1079, transaction ~1548):
   - no lorebook chosen (notes are the whole world, `insertOwnBook` ~1594–1602; `lorebooks/ownBook.ts`
     ~206–241 sets the switch only for notes over a lorebook): the notes take `timelineDefaultFor`;
   - an existing lorebook attached, a `new-world` copy, a starter kit or primer copy: **unchanged**, the
     lorebook's own switch stands;
   - branch sessions: unchanged.
4. **The start form's data.** The genre and preset rows the start form already receives gain what it needs to
   show the default and the offer: on each preset row, the resolved boolean (`timelineDefault`); nothing else.
   `keepsTime` itself does not go to the client.
5. **Open sessions re-read on a flip.** Nothing new on the server (lane b emits `state:changed`).

### C. Client — the start form (`src/lib/client/components/sessionForms/StartSessionForm.svelte`)

1. **A lorebook made from the start form asks.** Mount `NewLorebookDialog` (~3400–3405) with `asksTimeline`
   and its switch preset to the chosen preset's `timelineDefault`; `createLorebook` (~939–977) sends
   `timelineEnabled` (Blank way only; the kit way sends nothing, as lane b ruled).
2. **The offer.** Under the selected lorebook's row (`bookPickRow` ~2614–2716 beside "Play it with"
   ~2698–2713, and `plainBookRow` ~2950), when the chosen preset's `timelineDefault` is true and the chosen
   lorebook's `timelineEnabled` is false (the row is already held, `chosenLorebook` ~1272–1276):
   - the lorebook's owner: one sentence 🚧 *This lorebook keeps no timeline. ‹Preset name› plays best with
     one.* and a button 🚧 **Switch the timeline on** (sends `lorebooks:update` with `timelineEnabled: true`,
     `awaitReply`; the row updates from the reply; a refusal shows in place);
   - anyone else (a shared lorebook): the sentence followed by 🚧 *Story time won't move in this session.* and
     no button.
   Starting the session without switching is always allowed. Nothing is shown in the opposite case (an undated
   preset on a timelined lorebook plays as today).
3. `SessionLorebookReading.svelte` (mounted in the start form ~2397–2402 and `EditSessionForm.svelte` ~3311,
   ~3323): with the lorebook's timeline off it shows no clock mode (~121) and no "Nothing on this line is
   dated yet…" line (~272–278); the line picker stays.

### D. Client — the session's screens with the timeline off

The session page does not know its lorebook's switch today. Give it one value, from the reply it already asks
for (`sessions:storyClock`, `src/lib/server/sockets/storyClock.ts` ~99–109; add `timeline: boolean` to the
`Reading` reply, `shared/sockets/types.ts` ~4609–4624), held in the session page data.
1. **Re-read on `state:changed`:** the page's own `sessions:storyClock` read
   (`src/routes/sessions/[id]/+page.svelte` ~463–472) also runs when `state:changed` arrives for this session
   (through the session page's existing inbox, `sessionPageInbox.svelte.ts` ~268–285; no new socket listener
   in a view).
2. **Hidden with the timeline off** (render nothing in their place): the Summarize modal's history day choice
   (`SummarizeLoreModal.svelte`; the server already refuses it) and any story-clock control in the session's
   own forms. List what else on the session page shows a story clock, date or history control and hide it the
   same way; report each.
3. **The Chronicle widget** (`../serene-pub-sdk/core-catalog/components/shared/chronicle/ChronicleWidget.svelte`
   ~313–350, view built in `core-catalog/src/shared/ui/chronicle/index.ts` ~358; data from the
   `history-entries` request, `src/lib/client/components/sessionPage/requests/historyEntries.ts` ~221–228):
   with the timeline off it shows no clock control and no history days; scenes stay. Carry the fact on the
   request's existing reply as one optional field; widgets from plugins that ignore it keep working. **Do not
   edit** `PluginFrame`, `widgetWire`, `sessionPageProjections` or the SDK `surfaces`/`testing` packages (a
   peer session's files); if the Chronicle cannot learn the fact without them, stop and report.
4. Messages: an unstamped message already shows real time (`SessionMessage.svelte` ~349–367); change nothing.
   Add a test that a message in a session whose lorebook has no timeline shows real time.

### E. Not changed, on purpose (assert with tests where cheap)

- The round tick: with no timeline the reading has no moment and the clock outlet never runs
  (`core-catalog/src/shared/roundTick.ts` ~60–100); Minimal keeps its tick so that on a timelined lorebook time
  advances as today.
- An existing session, an existing lorebook and the one-time pass: untouched. No existing row changes its
  switch because of this lane.

## Files owned

SDK: `sdk/src/announce.ts`, `sdk/src/genres.ts` (the two fields + validation), their tests,
`core-catalog/src/registry/genres.ts` (two lines), `core-catalog/src/seed/presets.ts` (Story Minimal),
`core-catalog/components/shared/chronicle/*`, `core-catalog/src/shared/ui/chronicle/*`, SDK `guides/` and
`INTEGRATING.md` where these are described, hash pins the build moves.
App server: `lorebooks/timeline.ts`, `sockets/sessions.ts` (session create's notes insert only),
`lorebooks/ownBook.ts` (`insertOwnBook`'s switch only), the preset/genre list handlers that feed the start
form, `sockets/storyClock.ts` (the reply field), `shared/sockets/types.ts`, the `history-entries` request's
server side, tests beside each.
App client: `components/sessionForms/StartSessionForm.svelte`, `createSession.svelte.ts`,
`SessionLorebookReading.svelte`, `EditSessionForm.svelte` (the mount's props only),
`components/modals/SummarizeLoreModal.svelte` (or where it lives), `routes/sessions/[id]/+page.svelte` (the
clock read), `components/sessionPage/sessionPageInbox.svelte.ts`, `sessionPageData.svelte.ts`,
`requests/historyEntries.ts`, tests beside each.
Docs: `docs/sessions.md`, `docs/genres.md`, `docs/genre-story.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md`
(rows + §25). Paths are as a sweep reported them; verify each before editing.

`sockets/sessions.ts`, `ownBook.ts`, `StartSessionForm.svelte` and `NOMENCLATURE.md` are shared: one worker at
a time in each, small edits, re-read right before editing, never reformat.

## Out of scope — written down, never built

Any admin screen or setting for a preset's timeline default; any pipeline, outlet or plugin API over a
lorebook's switch; the timeless copy; changing `keepsTime`'s meaning or `rulesetFit`; the lorebook's screens
(lane b); dating scenes or entries in bulk after switching on; the one-time pass; ★T-B5/★T-B7 of lane b.

## Stop and ask when

CLAUDE.md §Decisions applies; a migration or a boot pass seems needed (B2); a third SDK name seems needed; the
Chronicle needs a peer-owned file; resolving the default would change an existing session or lorebook.

## Rules

- **`sdk:build`:** only from the app root (`npm run sdk:build`), only after
  `pgrep -af "vite dev"` shows no serene-pub server (check the cwd) **and**
  `ps -eo pid,args | grep -E "node.*vitest" | grep -v grep` shows no test run. Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. After SDK edits run `npm run sdk:test` from the app root (capped scope as below). Never `npm test` or `npm run build` at the SDK root.
- Never `git checkout` / `restore` / `stash` in the SDK repo or the app. Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`. Never `prettier --write` a directory or glob.
- Never commit. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Sockets: one domain context per event family is the only listener and the only place that toasts; views never
  call `toaster`. `socket.off(event)` always with the handler. A scoped event carries its scope key.
- `SvelteSet`/`SvelteMap` for reactive sets and maps. Browser code: no `crypto.randomUUID`, no
  `navigator.clipboard`. It is a session, never a chat. No other product's name in any file. Comments state the
  rule, not the story (a ratchet test counts phrases such as "no longer").
- Inside `db.transaction(async (tx) => …)` use only `tx`. Never seed a row at a fixed id. Migrations are
  generated only; this lane expects none.
- A linked SDK package brings a second Svelte: component tests of SDK components run in the SDK's own test
  setup, not the app's.
- Tests: only the lane's files and the suites touched, inside
  `systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <full paths> > plans/timeline-c-<n>.log 2>&1"`
  from the app root, one run at a time; check for a running vitest first and wait if one is up (never
  `pgrep -f "vitest run"` in a loop). Never pipe vitest into `head`. An int test that opens a DB inside an `it`
  takes a 60 s timeout. After any session-create change include `src/lib/server/sockets/sessions.*` suites that
  create sessions. Then `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .`. Not `npm run check`
  or `npm test`; the lead runs those.
- Never `kill -9`. Never edit server files while a dev instance is booting.
- These files fail today and are not this lane's; do not fix them: `adapters/importBoundary`,
  `adapters/registry`, `dataUpgrades/0108_layering_registrations.int`, `plugins/coreRow.int`,
  `conformance/wiring`, `conformance/commentHistory`, `boot/paramsSlotWiring`, `boot/placedNodeReconcile.int`,
  `config/panel/groups.int`, `entities/publishedValues.int`, `entities/sessionGenres.int`,
  `sockets/presetFallback.int`, `sockets/sessionAdmin.presetActions.int`, `sessions/genreFieldDefaults.int`,
  `runtime/allPipelines.int`, `runtime/guideGrounding.int`, `runtime/scoreLedAllocation.int`,
  `sessionPage/narrateDraft.dom`, `sockets/sessions.forms.int` (one test). If your change makes one of them
  fail **differently**, report it.

## Done means

- SDK: validation tests (a required-timeline genre with a preset declaring `timeline: false` is refused;
  `timeline: 'required'` without `keepsTime: 'story'` is refused); catalogue tests; `sdk:test` green for what
  you touched; `sdk:build` done.
- Server: `timelineDefaultFor` table test (required; preset true/false; genre story/real/none/left out;
  unresolved); session create: Story Minimal, Chat and Guide with no lorebook get undated notes; Story Living,
  Rule Based, the Lair and Dungeon Crawler get timelined notes; any preset on an attached lorebook leaves that
  lorebook's switch alone; a second boot leaves stored presets unchanged; the two reply fields.
- Client DOM: the dialog from the start form asks, preset to the default; the offer for an owner (button
  switches and the offer goes), for a shared reader (no button), absent in every other combination;
  `SessionLorebookReading` with the timeline off; the session page re-reads on `state:changed`; the Summarize
  modal's history choice absent when off; the Chronicle with the timeline off (in the SDK's test setup).
- `tsc` clean. Docs and NOMENCLATURE updated.

## Report — `plans/REPORT-timeline-c-2026-11-14.md`

If the harness refuses the file, return the whole report as your final message. Changed files (both repos);
tests with results; every name, sentence and label added (🚧); what B2 found; each session-page time control
found and what was done with it; open ★; **Noticed, not done**. Say plainly that nothing was looked at in a
running app unless it was.

## Corrections from the cold review (2026-11-14) — these rule over the text above

1. **D3 is withdrawn: no SDK widget change.** The `history-entries` reply is the published `HistoryEntriesV1`
   (`sdk/src/widgets.ts` ~2589–2640), which plugin widgets may read; a timeline field there would be an SDK
   surface for the switch, which the owner ruled out for now ("Do not provide SDK api for this yet",
   2026-11-13). Do not edit the Chronicle, `sdk/src/widgets.ts` or the `history-entries` request. With the
   timeline off the Chronicle keeps showing its existing words for a line with nothing dated and no clock, and
   a move is refused with the server's sentence. Remove `core-catalog/components/shared/chronicle/*`,
   `core-catalog/src/shared/ui/chronicle/*` and `requests/historyEntries.ts` from Files owned. Report under
   open ★ what the Chronicle shows and offers with the timeline off (read the code; one DOM test in the SDK's
   setup only if it is cheap).
2. **C2, the offer, has three cases** (the form's modes: `StartSessionForm.svelte` ~214, ~257–262, ~826–829,
   ~2733–2738, ~3000–3004):
   - the person's **own lorebook attached directly**: the sentence and the button **Switch the timeline on**;
   - **copy mode** (`new-world`, and every shared lorebook, which is always copied): the original is never
     touched. The sentence, then 🚧 *You can switch it on in the copy's Book settings.* No button;
   - a **provided, read-only lorebook** attached directly: the sentence, then 🚧 *Story time won't move in this
     session.* No button.
3. **D2, the Summarize modal** (`SummarizeLoreModal.svelte` ~309, ~724, ~792, ~1100): with the timeline off the
   history day choice is not shown **and** the Scene path no longer requires it: it sends
   `historyEntryId: null` (the server accepts null, `sockets/scenes.ts` ~337, ~458). DOM test: a scene summary
   is made with the timeline off.
4. **A3: Story Minimal's description** (`core-catalog/src/seed/presets.ts` ~46–48 JSDoc, ~60 description; core
   preset rows have their description re-forced at boot, `pipelines/registrations/project.ts` ~126–141) says
   the clock moves each round. Replace that clause with 🚧 *On a lorebook with a timeline, the clock moves on a
   few minutes each round.* and keep the rest. Docs to match.
5. **B2 is answered: no boot pass.** `projectRegistrations` at boot (`pipelines/boot/bootstrap.ts` ~461,
   `registrations/project.ts` ~114–141) re-forces `defaults` onto core's immutable preset rows only when they
   differ. Add the test (first boot sets Story Minimal's `defaults.timeline`, a second changes nothing; an
   admin's copy is never touched). Say in the report that admin copies of Story Minimal made earlier lack the
   value and start timelined.
6. **Wording:** never "no lorebook" (owner, 2026-11-05: "There's always a lorebook"). Say "a session whose
   lorebook is its own notes" in code comments, test names, docs and the report.
7. `PresetDefaults`' doc comment says every key is advisory (`sdk/src/announce.ts` ~290–328): amend it for
   `timeline` (a genre that requires a timeline refuses `false` at declaration).
8. List as its own ★: the Lair and Dungeon Crawler declaring `timeline: 'required'` is the lead's choice (the
   owner ruled them "timelined as today", a default).
