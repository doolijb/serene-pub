# REVIEW — decisions and code that aren't sensible — 2026-11-11

**Asked (owner, 2026-11-11):** "actually review the project and look for decisions and code that aren't sensible. We
want a smooth operating engine that's opinionated where it counts and iron out arbitrary, over-complicated behaviors
that are difficult to design around or will confuse users."

**How it was done.** Six read-only reviewers, one domain each (variable layouts · model plumbing · session engine ·
settings surface · pipelines and SDK · world data and vocabulary). Nothing was run, built or edited. The lead then
re-read the code behind the strongest claims. Each item below is marked:

- **✔ lead-checked** — the lead read the cited lines and they say what is claimed.
- **◦ reviewer-read** — the reviewer cites lines it read; the lead did not re-read them.
- **? inferred** — a consequence derived from the code, not traced end to end. Confirm before building on it.

**Nothing here is a go.** Every item is a proposal. Items marked **⚖** argue against a dated owner ruling, which is
quoted; those are the owner's to reopen or keep.

Not covered: channel lanes, private messages, annotations, the Pipelines view's Configure tab contents, widgets,
plugins' runtime sandbox, images, speech beyond the speak step, Windows and macOS process paths.

---

## A. The screen says one thing and the engine does another

These are the cheapest and the most damaging: each one makes a user distrust a control.

| # | What happens | Evidence | Fix | Size |
|---|---|---|---|---|
| A1 | **The turn pool ignores the bench.** With Turn order › Characters = all, a benched character is a candidate again; the pool's player-seat filter has no bench test at all. `seats.ts` says every reader of turns uses `inPlay` "and never spells the condition again". | ✔ `pipelines/runtime/bindings.ts:4454-4467`, `:4509-4513`; `sessions/seats.ts:1745-1751`. ? whether a benched player actually gets "‹name›'s turn" downstream. | Pool filters on `inPlay`, always. Drop the `all` option, or map it. | S |
| A2 | **A swipe un-benches but keeps the plan.** Swipe passes `annex: 'keep'` ("re-tells, never re-plans"), but the seat-bench retraction is not gated by that flag, so a companion can stand back up while the kept plan still says they fell. | ✔ `state/write.ts:807-830`, `:907-910`; `sockets/sessions.ts:9962`. ? the visible outcome. | Gate bench retraction with the annex, or see C2. | S |
| A3 | **"In use" on the Variable layouts page is only the pub-level answer.** It skips the leftover pick, the preset's choice, a name in the template and the author's per-step pick. Its header claims "the screen and the run cannot disagree". | ✔ `pipelines/config/variableLayoutsView.ts:226-252`; `config/world.ts:1358-1385`. | A "Where this differs" block listing the presets, templates and held steps that override the pub's choice. | S–M |
| A4 | **"Use the pub's" may not give the pub's.** The button clears a leftover pick; the next level down is the preset's choice. | ✔ `components/pipelines/StepVariableLayouts.svelte:88-93`; order in `world.ts`. | Relabel "Remove this pick". | S |
| A5 | **The inspector says "the default" for four different outcomes** (author's pick, package default, automatic row, no row). | ✔ `world.ts:1372-1397`; `inspector/receiptView.ts:962-968`. | One reason word per real cause. | S |
| A6 | **The first model becomes Reply only if the dialog is still open.** The fill is a client effect that returns when the Set up chat dialog is closed. Close the tab during a multi-GB download and the model arrives with Reply empty. The server already does the equivalent for the image default and the projector. | ✔ `components/connections/SetupChatFlow.svelte:193-200`; `sockets/koboldcpp.ts:733` is the only server default write. | The download request carries "fill Reply on arrival if empty"; the server does it. | S |
| A7 | **An unfilled specialist loadout shows its own sampling but runs on Reply's.** Unfilled "falls through whole — pair and sampling together", so Extraction's low-temperature sampling is never used on a typical install, while its tile names it. | ✔ `loadouts/index.ts:12-17`; `config/world.ts:573-598`. ◦ tile: `sockets/loadouts.ts:229-233`. | Borrow the pair only; keep the loadout's own sampling except context size. Then Scene prompt can fold into Extraction (same declaration). Behaviour change on existing installs; needs a note. | M |
| A8 | **The default star can leave Reply while every reply step still names Reply.** After a star move, the status strip and "is chat set up" read the starred row; replies run on the Reply row. | ◦ `sockets/loadouts.ts:556-592`; `shared/loadouts/defaultLoadoutName.ts:14-20`; core-catalog `genres/chat/respond.ts:452`. ? strip behaviour. | A transform's default is the core loadout declared `defaultFor`, fixed; the star exists only where core ships none. Removes the cause of `foldPubDefaults`. | M, boot pass |
| A9 | **"Stream speech" is a labelled setting that does nothing.** The speak step reads it and treats it as off. | ✔ SDK `contracts/src/oracles.ts:966-972`; `runtime/bindings.ts:6678`. | Remove the parameter until streaming exists. | S |
| A10 | **Behaviour with no control.** `on_revision_default` (pub and user) is read at session create and written by nothing. `require_two_factor` is enforced and has a handler and a typed event, and no screen. | ✔ grep: `sessions/revision.ts:65-80` is the only use; `requireTwoFactor` appears client-side only in `typedSocket.ts`. | Build the one control, or delete the layer. | S each |
| A11 | **Docs contradict code on a default.** `docs/system-settings.md:66` says lorebook writes default to Review; the code defaults to Full (ruled 2026-10-16). The plugin guide says an unwired prompt step "does not publish" (line 79) and that `check` only warns (line 101). | ✔ `shared/lorebooks/loreWriteMode.ts:41`; SDK `guides/your-first-plugin.md:79,101`. | Fix the docs now. | S |
| A12 | **Genre page Events card still writes an unread column.** Backlog R-5, still present. | ◦ `session-genres/IdPage.svelte:455-470`; `entities/presetBindings.ts:1-7`. | Rewire or remove (already ★). | S |
| A13 | **"Fell in the story" is guessed.** The skull is an OR of three heuristics, so any genre bench reads as a death, and genre and undo benches are announced with cause "settings". "A person's later move wins" compares values, not who moved. | ✔ `sockets/sessions.ts:5748-5760`. ◦ `sessions/seats.ts:1906,1925`; `state/write.ts:1065-1068`. | Store who benched and why on the seat; the skull, the cause label and the undo test all read it. This is the open "★ cause label". | M, column + boot fill |
| A14 | **"Read in?" says "nothing reported on it" for most real reasons.** The ranker records precise reasons; an entry that never became a candidate gets the catch-all. | ✔ `client/lorebooks/editor/readIn.ts:120-126`. ◦ `pipelines/ranking/select.ts:507-878`. | State the first gate that stopped the entry. Hide "Let other entries pull this one in" while chain depth is 0. | M |

---

## B. Too many layers, and a different rule in each feature

| # | What happens | Evidence | Simpler rule | Size |
|---|---|---|---|---|
| B1 | **Nine precedence rules for layered settings.** Genre settings (session › preset › genre › core, with lock), pipeline values (five layers plus a ⏳ sixth), scenes (no preset layer), lore writes (strictest wins), routine caps (lowest wins), language (user else pub), on-revision (copied at create), variable layouts (preset over pub, nothing inherited), plugin settings (user › admin › default). | ◦ SDK `sdk/src/exposure.ts:1-27`, `config.ts:51-73`, `sceneSettings.ts:347-361`; `shared/lorebooks/loreWriteMode.ts:7-18`; `db/schema.ts:4205-4220`. | Two named rules: **nearest wins** and **limits only tighten**. Every layered setting declares which. Scenes gain the preset layer. | M–L |
| B2 | **Variable layouts resolve through eight levels, not six.** The author's per-step pick is a hidden tier below the pub's; the leftover level is itself a scope chain. | ✔ `world.ts:1372-1385`. ◦ `config/named.ts:627-669`. | Remove the author tier: an author who needs a layout names it in the template (reliable today; the tier is not). | S–M |
| B3 | **⚖ A preset can pick layouts and can pick a context template that names layouts.** Two ways for a preset to do one job, with a 582-line fieldset for the first. | ◦ `session-presets/PresetVariableLayouts.svelte`; `docs/context-templates.md:19`. | Keep pub (everyday) and template (exception). **Against ★2, 2026-11-10: "B, any changes or explicit decisions a preset declares."** Lost: one preset entry covering every pipeline at once. | M–L, stored data |
| B4 | **Each undo verb takes back a different set.** One function, four flag combinations: swipe keeps the annex; regenerate takes it; Back also takes the clock tick and scene boundaries; delete takes the tick and not the scenes. `docs/sessions.md:285` says a swipe "takes back everything the old reply changed". | ✔ `state/write.ts:807-830` and the four call sites (`sockets/sessions.ts:9326`, `:9962`; `sessions/rewind.ts:646`; `runtime/host.ts:9842`). | Two cases: the message is **replaced**, or the message **leaves**; each takes back everything it wrote. **⚖ "a swipe re-tells, never re-plans (Dungeon Crawler, ruled 2026-10-17)"** is one genre's rule hard-coded in the generic handler; make it a declaration on the genre's shape, as `history.back` is. | M |
| B5 | **A stat value falls through six layers over nine owner kinds, and nothing shows which won.** The code says the answer belongs on the Cast member page; the member page has no Stats tab. | ✔ `state/resolve.ts:1689-1692`. ◦ `state/owners.ts:36-46`, `:92-120`; `docs/lorebook-cast.md:32`. | Two layers a person can name: the rules' start value and this session. Keep "Across sessions" only with a visible home and source. | M–L, boot pass |
| B6 | **Remove does three things; the bench has more than one writer.** `unseat` benches a seat in play, refuses a benched seat with lines, soft-removes a benched seat without. `is_active` is also written by the seat-cast revive, `seatPlayer` (`input.isActive ?? true`, so re-adding a benched persona un-benches it) and a boot merge. | ✔ `sessions/seats.ts:714`, `:1025`, `:1090`, `:1402`, `:1831`. | Two states: seated and benched. Stop writing soft-removal; keep reading it. In line with "Also fold Removed in" (2026-11-10); the built rule keeps a third state. | M |
| B7 | **Who speaks next: one decider (sound), about eleven inputs on three cards.** Strategy Manual ≈ Auto-advance Off; Strategy "Narrator replies" vs Narrator's turn; "decided by: the model" vs Strategy. Half vanish with advanced controls off and still act. | ◦ core-catalog `registry/genres.ts:75-127`, `:245-282`; `docs/group-sessions.md:55-72`. | One Turns group; Strategy absorbs "decided by" and Manual. Pool params become declarations. | M, mapping |
| B8 | **Routine caps at three levels.** Two numbers, settable by pub, user and routine; defaults (4,320 minutes, 12 runs) marked "🚧 the plan's example, for the owner to confirm". | ◦ `db/schema.ts:4205-4220`, `:147-149`. | One pub cap plus the routine's own off switch. Rule the defaults. | S |
| B9 | **Three "write mode" pickers, same words, opposite defaults.** Lorebook writes default Full; Library writes default Review and have no pub layer; routines carry a third `off|review|full`. | ✔ `shared/lorebooks/loreWriteMode.ts:41`; `library/writes.ts:100-108`. | One "What sessions may change" card, one default, one layering. | S |
| B10 | **"One entry per date" has three unstated side rules.** Partial dates are distinct (Year 2 and Year 2 Month 5 coexist); an undated scene compiles into the newest dated entry or creates Y1-M1-D1; an undated pipeline write uses story-now. Two defaults for "no date". | ◦ `scenes/historyEntryOfDate.ts:13-17`, `:151-156`, `:255-262`. | No date always means story-now; with no clock, refuse in a sentence. A coarser entry covers its finer dates. | M |
| B11 | **A blank session has a calendar and no clock.** A move by an amount refuses ("no clock yet: set one in the lorebook"); a move to a time of day silently starts the clock at Y1-M1-D1. A user-made lorebook starts with no calendar at all. | ✔ `state/storyTime.ts:400-407`, `:436-444`. ◦ `lorebooks/ownBook.ts:17-19`. | Any first clock move starts at `FIRST_STORY_DAY`; one default calendar for every new book. | S |

---

## C. Not opinionated where code already knows the answer

| # | What happens | Evidence | Fix | Size |
|---|---|---|---|---|
| C1 | **The validator knows the fix for an unwired prompt step, and only warns.** The spec publishes; on a real pub the run halts or a chat connection gets a prompt with no messages. The speak node's red `paramsSlotWiring` test is the same omission. | ✔ SDK `sdk/src/validate.ts:1274-1300`. | `assemble` defaults its template and connection; a model-call oracle defaults its connection and sampling slots. | S–M, SDK |
| C2 | **⚖ `shape.writes` has opposite defaults in one object and ignores unknown keys.** `lore` and `scenes` are on when absent; `seats` and `library.*` are off. `writes: { seat: true }` reads as off and is refused only at run time. | ✔ SDK `sdk/src/descriptors.ts:786-797`. | Every write is off unless declared; unknown keys refused at `genre()`. **Against R-B, 2026-09-17: "absent means on, and only an explicit false takes the write away."** | S + boot fill |
| C3 | **⚖ Scene suggestions are on in core unless a genre opts out.** The Dungeon Crawler had to declare `timeAction: false` to stop a chip after every round (★D1-1 is the proof). P1 says off in core until a genre opts in. | ◦ SDK `sdk/src/sceneSettings.ts:153-168`; core-catalog `registry/genres.ts:1637`. | Core default Manual, no triggers; Story and the Lair declare theirs. **Against live-scenes ★1, 2026-10-13: "Suggested; day crossed, time action, place changed on"** (built on recommendation; the backlog lists it as never ruled). | S |
| C4 | **⚖ Co-load is a switch where none is needed and absent where one is.** On NVIDIA the measurement decides; on AMD and Apple there is no reading, so it never co-loads whatever the checkbox says. The reason goes to the server console only. | ✔ `koboldcpp/coLoad.ts:47-76`; `koboldcpp/modelManager.ts:1031-1032`. | With a measurement: no setting, and the last decision sentence on the status card. Without: one explicit "This machine can hold both", off by default. **Against 2026-11-11: "yes, make sure it's manageable via the admin."** | S–M |
| C5 | **Managed KoboldCpp keeps Server URL and Port as two editable facts,** with a warning for when they disagree. | ◦ `koboldcppManager/KoboldCppSettingsTab.svelte:132-150`, `:745-830`. | Managed: port only, URL computed. | S |
| C6 | **⚖ External mode is a third way to reach a KoboldCpp.** The supervisor's own header says "Someone running their own KoboldCPP points a plain API connection at it; the managed card is only ever ours." External mode carries its own grace period, reload trap and errors. | ✔ `managed/supervisor.ts:36-40`. ◦ `koboldcpp/modelManager.ts:545-580`. | Managed, or the plain connection. **Against 2026-11-11: "5. keep."** Lost: remote model swapping on a self-run instance. | M |
| C7 | **A script failure is absorbed at a port seam and rethrown at an interior point.** The type's own contract says a thrown applier "must never cost somebody their reply". | ✔ SDK `sdk/src/executor.ts:1640-1656`, `:1962-1968`. | The point path absorbs and records the same way (backlog ★). | S |
| C8 | **Two mechanisms for "this step's failure must not cost the reply".** The SDK has a declared `optional: true`; speak and pick-sprite catch everything by hand and return ok with null ports, so the receipt shows success. | ◦ SDK `sdk/src/descriptors.ts:1775-1792`; `runtime/bindings.ts:6671-6718`. | Declare `optional: true` and throw. | S |
| C9 | **`defaultFor: true` is honoured three ways** (seed side effect, a hardcoded `STARRED_BY_SEED` map, lazily on first fill), and about ten boot passes run with no ledger, each in a try/catch that logs and continues. | ✔ `db/defaults.ts:695-706`. ◦ `connections/capabilityDefaults.ts:201-244`; `loadouts/foldPubDefaults.ts:52-58`. | The seed pass claims every `defaultFor` whose transform has no default. One-shots get a ledger row and a retirement version. | M |
| C10 | **An admin must type an "Owner slug" to save a layout, and `@N` means two things** (the variable's major for core and personal layouts; the layout's own major for a plugin's). | ✔ `pipelines/boot/registrySync.ts:1272`. ◦ `entities/variableTemplates.ts:300-320`. | The major is always the layout's own; a pub's layouts get a fixed owner. | M, boot pass |
| C11 | **The `@1` pin is typed everywhere and promises nothing before 0.7; one field holds two id formats.** A document node stores `core:task/x` plus a version; a receipt stores `core:task/x@1`. Four id shapes in all. | ◦ SDK `sdk/src/executor.ts:1529,1540`; `runtime/specShape.ts:72`; `runtime/runTurn.ts:2032`. | One stored form. Until 0.7, `C.assemble(...)` with no `.vN`. | M |

---

## D. Carried weight: paused, transitional and dead

Delete before RC1's squash rather than carry.

| # | What | Evidence | Size |
|---|---|---|---|
| D1 | **⚖ Strokes.** Flag false since 2026-10-11; 12 non-test files import the flag, about 30 branch sites; nine stroke-named files plus SDK `strokes.ts`. Every card save, import, export and prompt compile reasons about a feature that is off. **Against 2026-10-11: "disable strokes for now … we will revisit later."** Backlog R-3e already recommends removal. | ✔ `shared/characters/strokesFlag.ts:50`; grep count. | M, column drop |
| D2 | **Member-form flip.** Switch on since 2026-11-08, "removed in S5"; 108 `memberFormOn()` calls outside tests, both paths carried. | ✔ `state/memberForm.ts:22-26`; grep count. | M |
| D3 | **Card Stats tab.** Authors sheets and slots that a session's vocabulary no longer reads; a card value reaches play only when the ruleset happens to share the slot id. Backlog R-3, "must be ruled before RC1". Also fixes the stat / attribute / slot / flag / sheet word pile. | ◦ `state/resolve.ts:1552-1650`; `state/cardState.ts:135-140`. | L, stored data |
| D4 | **Old "what a genre runs" grammar.** Registrations are the model; `configs`, preset `bindings`, `actions.include` and extra author presets are still accepted and do nothing or are derived. Install still writes `pipeline_configs` rows that `docs/pipelines.md:256` says nothing reads. | ◦ `pipelines/registrations/project.ts:6-16`; SDK `sdk/src/extension.ts:605-615`; `plugins/install.ts:513-580`. | M, boot pass |
| D5 | **Dead columns.** `pipelines_enabled` (no reader); four `lock_*` columns (attic only); `show_home_page_banner` (handler, no reader); `show_all_character_fields` (superseded 11-10); `session_presets.bindings`, `configSelections`, `includedActions`, `callsPerTurn`. | ✔ grep for the first three groups. ◦ the rest. | S–M, migration |
| D6 | **Opaque step handles on admin-only sockets.** The rule ("no topology") was written when the pipeline view was for everyone; pipelines are now admin-only, scripts admin payloads already carry raw node keys, and the rule hid a bug that only a browser walk caught. | ◦ `pipelines/config/panel/ids.ts:1-14`; `plans/HANDOVER-variable-layouts-2026-11-11.md:38,51`. ⚖ SDK plan 05 §0a (undated). | M |
| D7 | **Two full editors each for Connections, Loadouts and Sampling** (rail view and Admin › Models). | ◦ `admin/sections/defaults/Page.svelte` (1,227 lines), `connections/IdPage.svelte` (1,137). | M |
| D8 | **Env vars that are behaviour switches.** Plugins on/off, the NSFW library gate, Document View's default. | ◦ `docs/environment-variables.md:78`. | S–M |
| D9 | **Hardcoded id 1.** `koboldcpp_settings`, `ollama_settings`, `system_settings` seeded and written at `id = 1`; `audiocpp/settings.ts:23-39` has the compliant pattern. | ◦ `db/defaults.ts:627,770,791,841`. | S |

---

## E. Words

- **"Advanced" means three things** — the per-user switch, the fold on genre settings (shown in both modes), and admin fieldsets. With the switch off, hidden controls in a non-default state keep acting with only "Some controls are hidden." **⚖ ★C, 2026-11-10 ("Works for me")** accepted that the line cannot say which. Proposal: name the count that differ from default; the switch hides controls, never whole views or verbs. ◦ `EditSessionForm.svelte:641`, `:3371-3770`.
- **"Layout"** is the session screen layout and a variable layout; in code the second is a `variable template` across two sibling modules. A stale error still says "Fix it in the pipeline's settings". ◦ `entities/variableLayouts.ts:1205-1209`.
- **"Preset"** is a session preset, a package preset and a spec's author preset; the session preset now carries which pipelines run, their tuning, the genre's settings, the start form, variable layouts and the cast minimum.
- **"Cast"** excludes the player on the start form and includes everyone in a lorebook; the same people are also Participants and seats.
- **Three idle timers in three units** — KoboldCpp seconds, audio.cpp minutes, `idle_unload_ms`.
- **NOMENCLATURE.md** is 3.1 MB in 3,894 lines; §25 Change ledger runs from line 1796 to 3604. 🚧 appears on 1,128 lines there and 5,658 times in `src`, including on rows that say "Built". R6 defines it as "designed but not built". The marker no longer marks anything. Proposal: move the ledger and dated prose out; strip 🚧 from built things; ⏳ only with a named expiry.

---

## F. Structure (for contributors, not users)

- `runtime/host.ts` is 12,144 lines, `sockets/sessions.ts` 12,238, `runtime/bindings.ts` 9,877. A core node type needs coordinated edits in a contract, the catalogue, a handler, one of three `switch` blocks and a dispatcher, across two repos; completeness is checked by tests, not at boot. Speech shipped with those tests red. Proposal: boot refuses a registered core type with no binding or host case.

---

## G. Session data: where it lives, when it reaches the lorebook, how branches cut (second round)

**Asked (owner, 2026-11-11):** "Now what about where session data is stored, and when it's applied to the lorebook and
how branching is handled." Three more read-only reviewers; the lead re-read the lines marked ✔.

**Two notes on record are stale.** `sessions.lorebook_branch_id` IS read now and retrieval is line- and date-aware
(`state/reading.ts:312` → `state/entriesOnReading.ts:66`). The schema comment at `db/schema.ts:2709-2713` and memory
`project_branches_built_b1_b3` still say "read by nothing". "Compiling forks a riding branch session" forks a lorebook
**line**, never a session (`sockets/scenes.ts:1094-1104`).

### G1. Where it lives

| # | What happens | Evidence | Simpler rule | Size |
|---|---|---|---|---|
| G1.1 | **"Three homes" is about fourteen, each with its own undo.** The retraction returns them one by one: values, configs, proposals, zones, lore imprints, own-book entries, cast versions, clock moves, annex deltas, scenes, scene notes, ruleset conversions, seat benches. Beside those: plugin files, the user annex, the lorebook annex, session columns. ⚖ Against the count in 2026-10-24 "Three homes: annex · messages · lorebook. Settings are columns (admitted fourth)": attribute values and plugin files are homes it does not name. | ✔ `state/write.ts:926-943`. | Keep three as the *author's* model, and make it true: one table at the top of the SDK storage guide, one row per home, columns Back / swipe / branch / who sees it / reaches a prompt. The guide today says "two kinds of data" at the top and "the three storages" further down. | S, docs |
| G1.2 | **"Which book does this write land in" has three rules.** Clock, scenes, summaries, graph: the attached book if there is one, else the own book. Lore entries: the attached book only if the session owner owns it AND the mode is Full, else the own book. Stat values: ownership only, mode ignored. One turn on a book the session owner does not own lands in two books under three rules. | ✔ `lorebooks/ownBook.ts:236-245`, `:345-355`, `:464-490`. | One function and one stated rule. ⚖ Works against ★M3b-W-1 (2026-11-05), which keeps values on the owner's own book. | L, stored data |
| G1.3 | **The `core` annex document is three unrelated things.** Declared genre fields, host runtime state (`turnOrder`, `turnTally`, `laneReads`, `rulesetDecks`), and two undo logs (`rulesetConversions`, `seatBenches`). The header says "five pieces", lists six, and says "never retracted" about the two that Back replays. Each needs a `TIMELESS` exception, a strip for pipeline reads and a refusal for pipeline writes. ⚖ Against 2026-10-24 "`sessions.metadata` runtime keys → annex owner `core`". | ✔ `sessions/coreAnnex.ts:6-34`. | The `core` annex holds declared fields only. Runtime state becomes columns or one row; undo logs become message-anchored rows like every other change. | M, boot pass |
| G1.4 | **A branch inherits runtime keys "as they stand now".** `annexAt` gives the document at the fork message, but timeless keys keep today's values, and `annexAudiences` is cloned as of now. The same file remaps seat ids in message metadata for exactly this reason. | ✔ `sessions/branch.ts:168-175`; `coreAnnex.ts:30-33`. ? whether stale seat or message ids cause a visible fault or are re-derived next turn. | Falls out of G1.3. | — |
| G1.5 | **Annex undo restores a whole owner document, and a button press leaves no record.** Each anchored write stores the owner's entire document before and after; a write from an action-family run with no turn has no anchor. Lore uses per-field imprints with splicing, a finer mechanism for the same job. | ✔ `sessions/annexChanges.ts:114-193`; `runtime/host.ts:1972-1983`. ? a press-set key lost when Back passes an earlier turn's delta. | Deltas per key, with the imprints' splice rule. | M, stored deltas |
| G1.6 | **"Session data" shows one home and captions core's bookkeeping as "Legacy".** The panel reads `sessions.annex` only; any stored key with no declaration is listed as "Stored before its owner declared it. Only pipelines can read it." The inspector strips only the old revision-points key. No Clear. Stats, scenes, own-book entries and plugin files are not shown. | ✔ `sessions/annexInspect.ts:82-99`, `:127-135`. ? that the runtime keys reach the list on a played session. | Hide runtime keys; rename to what it is, with links to the other homes; Clear per owner. | S |
| G1.7 | **`scope` means two things.** An annex field: `session / lorebook / user`. An attribute slot: `session / world`. The SDK carries a warning that they differ. | ◦ SDK `sdk/src/annexFields.ts:99-111`; `state/worldScope.ts:2-6`. | One word, one value set. | S–M |
| G1.8 | **The host knows a genre's annex keys by name.** The seat-keys boot pass hardcodes `dungeon-crawler-progress` and rewrites seat ids inside JSON by pattern, with two rules chosen per key; plugin annex documents are left in the old form. | ◦ `sessions/seatKeys.ts:11-40`, `:773-774`. | Per-seat facts are state rows, not annex maps. | M |

### G2. When it reaches the lorebook

| # | What happens | Evidence | Simpler rule | Size |
|---|---|---|---|---|
| G2.1 | **Back does five different things to a lorebook write, chosen by how it was stored.** A field on a real book: reverted only while it still holds exactly what the run wrote, else "kept" with Revert/Keep. Any own-book row: always reverted, even if hand-edited. A stat value on the user's own book: never reverted. A cast member "story write": reverted (the code calls it "the exception to the exception"). A write with `sources`: Back is refused. `docs/sessions.md:243` says "Everything that message or turn changed goes back with it"; `docs/lorebooks.md:216` says a value on your own lorebook "is the book's, and Back doesn't take it". The Full default's stated reason, "the timeline makes every change reversible", is false for stat values. ⚖ 2026-10-24 "The line is by KIND of write": in code "kind" is five storage cases, not the two the ruling names. | ✔ `lorebooks/imprints.ts:16-37`; `state/write.ts:690-720`. | Every un-applied session write is anchored to its turn and Back takes it; a later human edit is the only thing that keeps it. | M, new writes only |
| G2.2 | **A hidden second persistence: every session stat is copied onto the book at each scene close and on session delete.** `recordToTimeline` writes a value row and a config row per storable slot of the world, each bound member and each place, with no scope filter and no message anchor, "best-effort and silent". **The delete path skips the routing rule:** it takes the attached book whenever the mode is not Off, with no ownership check, and under Review it writes directly. | ✔ `state/durable.ts:139-181` (delete branch at 175-178), `:262-290`; callers `sockets/sessions.ts:2401`, `sockets/scenes.ts:494`, `:2556`. ? a member deleting a session on a book they do not own writes onto it. ? a "For the session" stat then reads the recorded row in a new session. | Only "Across sessions" stats live on the book. Delete writes nothing. | M |
| G2.3 | **Off and Review mean something different on each path.** Outlet entry writes are never refused, only rerouted to the own book. Scenes, summaries and compile are refused outright under Off, including starting a scene. Stat values: Review proposes, Off refuses. And the mode falls back to the user's personal mode when the session's lorebook is its own book, so a user who set Off to protect their books cannot start a scene there. `docs/lorebooks.md:216` says the notes are not held back by Review or Off. | ✔ `runtime/host.ts:11181-11188`; `scenes/liveScenes.ts:178-184`; `state/loreWriteMode.ts:56-70`. | One router for every path: what the mode forbids lands in the own book, never refused; the mode never applies to the own book. Scene-first genres (ruled 2026-11-10) keep working under Off. | M |
| G2.4 | **The settle line has about nine triggers, and moves on writes that are not in the lorebook.** A `sources` write, a saved reviewed summary, any scene whose summary is done (including hand-typed), `history.settle: 'on-write'`, own-book stat values, a kept imprint, "Apply to the lorebook", Archive, the branch floor. A `sources` write settles whatever its route, so under Review the entry waits on the "This session only" card while Back already says "This part of the story is in the lorebook now." The Apply and Save modals say nothing about Back. ⚖ 2026-10-24 "Present = generated from the story → committed; line = max(sources)". | ◦ `runtime/host.ts:11418-11431` (✔ the `settleThrough` call; route independence not re-read); `sessions/settle.ts:62-83`, `:147-153`; `sockets/scenes.ts:618-622`. | One sentence a user can say: "Back stops at the newest line you applied to the lorebook." Settle only on a person's Apply or Save, and say so on that button. | S–M |
| G2.5 | **"Review" is three settings feeding six queues, one of them in memory.** Lore write mode, library write mode and each routine's Off/Review/Full. Held work waits as proposals under the reply, the "This session only" card, review-gate cards, Activity reviews, library proposals, and Revert/Keep on a kept entry. A parked review gate "does not survive a process restart". | ✔ `runtime/reviewGate.ts:15-22`. ◦ `routines/run.ts:306-316`; `library/writes.ts:5-9`. | One durable held-changes list per session, shown in one place. A routine is Off or On; whether its writes are held is the lore mode's job. | L |
| G2.6 | **Under Full, the book changes for every session on that line as you play, with no per-session view.** There is no apply moment and no "what this session changed" list on the book; "From this session" is recorded as unbuilt (H-Q1). | ◦ `lorebooks/ownBook.ts:380-428`. | Keep Full, and build the list with one "take back this session's changes". Provenance columns exist. | M |
| G2.7 | **`history.settle: 'on-write'` is used by no shipped genre** and carries its own Back sentence and branches in rewind, settle and routines. ⚖ 2026-10-24 "the ONE preset-proof lock". | ◦ core-catalog `registry/genres.ts:603`. | Remove until a genre needs it. | S |
| G2.8 | **Close-out has four triggers; the docs name two.** The action, Archive, "Catch up" from a different session's header with no confirm, and next-chapter creation. | ◦ `sockets/sessionArchive.ts:96,142`; `sockets/sessions.ts:1522-1535`. | Say all four; Catch up asks. | S |

### G3. How branches cut

| # | What happens | Evidence | Simpler rule | Size |
|---|---|---|---|---|
| G3.1 | **A session branch is cut off from its parent three ways, one per row kind.** Attached-book entries and history: by fork **story date** only. Cast versions and durable values: by **fork message** and write mark. Own notes: a **physical copy** up to the fork message. The line-reading module's own comment says values are not cut by session; the values reader cuts them. | ✔ `shared/lorebooks/lineReading.ts:84-108`; `state/reading.ts:580-600`; `state/entriesOnReading.ts:58-73`. | One cut for a session branch: the fork message, applied to every row an ancestor session wrote. The story-date cut stays for an author's lines. Extends 2026-09-23 rather than reversing it. | L |
| G3.2 | **The parent's later lore reaches the branch.** An undated row is never cut, so any character, place or world entry the parent adds afterwards reads on every branch. A session with no story clock stores no fork date, so its line "keeps following the line it left" and gets the parent's later history too. The leak is one-way. ⚖ 2026-09-23 "A fork made at NOW stores no date and therefore keeps following main": right for an author's fork in the workspace, the opposite of the intent for a what-if session. | ✔ `lineReading.ts:24-28`; `lorebooks/sessionLine.ts:142-165`. | A session-made line always stores a cut. | M, boot pass |
| G3.3 | **A branch session's line outlives it and can become the default.** The first book write of a branch session makes a line named after it. Deleting the session leaves the line; only the lorebook's own delete removes one. A new session on that book starts on the most recently played line. ⚖ "Branch on first write … patron, does not own"; ruling 15 (2026-09-27) "Start at the most recently used branch." | ✔ `sessionLine.ts:22-24`; `sockets/amendments.ts:2207` is the only delete; `state/reading.ts:124-140`. | Deleting the last session on a session-made line offers to delete the line. Revision-made lines never win "most recent". | M |
| G3.4 | **Rule C makes a dateless branch write empty history days onto its parent's line.** A dateless fork owns no dated history, so its compile creates an empty entry on the owning line and amends it. | ◦ `lineReading.ts:314-331`; `scenes/historyEntryOfDate.ts:180`. | Disappears with G3.2. Rule C is sound for dated forks. | — |
| G3.5 | **Pressing Compile on one line moves another session onto a new line.** If those were the only scenes waiting, the press is refused with a sentence that names no line to go to (and is marked "the owner has not seen this sentence"). | ✔ `sockets/scenes.ts:1089-1104`. | Name the new line in the refusal and switch the chip to it. | S |
| G3.6 | **Session branches cannot be managed.** "Branch of X" is a plain label; the parent lists no branches; no jump to the fork; no grouping in the Sessions view. Lines have a chip menu, compare, rename and delete. | ◦ `components/Header.svelte:280-288`; `SessionViewPanel.svelte:258-260`. | Make the marker a link to the parent at the fork message; add a Branches list on the parent. No merge. | S–M |
| G3.7 | **On revision = Branch compounds and cannot be defaulted.** A branch inherits it, so every later regenerate or delete makes another session and, at its first book write, another line. Its defaults are read at create and written by nothing (A10). ⚖ PLAN-rulesets §28 (2026-10-16). | ✔ `sessions/revision.ts:65-81`. ◦ `sessions/branch.ts:186`. | Remove the setting; the regenerate and delete confirmations offer "Branch first". | M, boot pass |
| G3.8 | **"Branch" names five things.** A session branch, a lorebook line, the start-form mode, "Branch off at a point" (which starts a new session on a deferred line), and the original session ("the old branch"). | ◦ `sessions/revision.ts:44`; `StartSessionForm.svelte:208-212`. | Branch = a session. Line = the lorebook. | S, copy |

### G4. The shape underneath (★ recommendation, not ruled)

G1.2, G2.1–G2.6 and G3.1–G3.3 are one problem seen from three sides: a session writes **through** to a shared
lorebook as it plays, by rules that depend on ownership, mode, row kind and whether the write named its sources. Every
exception above exists to make write-through safe after the fact.

**★ One rule instead:** a session writes only to its own book (its overlay), every write anchored to its turn. One
visible **Apply to the lorebook** moves the held changes to the parent book, and that press is the settle line. A
session branch is one cut at the fork message plus a copy of the overlay. Lines stay an author's tool.

- **Gains:** one answer to "which book", "what does Back take", "when is it permanent", "what did this session
  change" and "what does a branch see"; Review and Off stop being three mechanisms; `recordToTimeline`, the kept
  imprint, riding lines and fork-on-first-write go.
- **Costs:** two sessions on one book no longer see each other's changes until one applies; "Across sessions" stats
  need the same press or a narrow exception. L, with stored data.
- **Reverses or narrows:** the Full write-through default (2026-10-16); settle by self-reported `sources` and "by
  kind of write" (2026-10-24); ★M3b-W-1 (2026-11-05); "Branch on first write"; "a fork made at NOW … keeps following
  main" for session-made lines (2026-09-23).
- **If write-through stays:** do G2.2 (delete path and scope), G2.3 (one router), G3.2 (always store a cut), G2.6
  (From this session) and G1.1 (the table). Those five remove the surprises without changing the model.

## Found sound (do not disturb)

Second round: the own book as a real lorebook row from creation · annex declarations with compare-and-set · close-out's idempotence · archive as one reversible flag · the book lock · `sources` checks in one function · mode strictness as one pure function · `historyOwnerStep` as the one owner rule · line membership with one rule and one SQL form · siblings never overwrite each other on the attached book · proposals deliberately not copied to a branch.


Turn firing through one door · Back/Forward's unit declared by `history.back` · rule C forks (`historyOwnerStep`) · core never benches by itself · the registered-vs-resolved split for capability defaults · never-adopt and the watchdog · one resolver for capability targets · literal-only layout names with one parser for both engines · `layoutRowUses` as the one rule · the 0151 upgrade's plan-then-verify shape · one execution road through `runSpec` · ranking's separation of hard gates from scores · `compareDates` as the one ordering key · honour-mode retirement · persona merged into character · the wizard's derived start step · admin nav grouped by task.

## Suggested order

1. **Section A, the S-sized rows** (A1, A2, A4, A5, A6, A9, A10, A11, A12): no rulings needed beyond a go; each removes a lie on screen.
2. **Rule the ⚖ items** (B3, B4, C2, C3, C4, C6, D1, D6, ★C): one line each.
3. **Section D before the RC1 squash**, since most rows need a migration and the squash is the cheap moment.
4. **B1 and B4 as designs**: name the two precedence rules and the two undo cases, then bring features onto them.
