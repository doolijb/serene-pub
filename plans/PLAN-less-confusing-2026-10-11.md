# Less-confusing plan — 2026-10-11

Source: a first-run walk of a fresh instance (wizard → first session → every
rail panel → Admin → the Image action) plus two read-only sweeps, one of UI copy
against NOMENCLATURE §23, one of `docs/*.md` against the UI. Every item below
was either seen in the browser or verified by reading the code path. This is a
plan, not a go: nothing is built until the owner says so.

Fixes are grouped by the files they touch so batches can run in parallel
without colliding. Status marks: ☐ todo · ◐ in progress · ☑ done · ✗ dropped
(reason). Each batch ends with its own targeted test; the full suites
(`npm test`, `npm run check`, `npx tsc --noEmit -p .`) run once at the end.

Rules that apply to every batch: new or renamed user-facing words go through
NOMENCLATURE §1 + §24, then the §25 ledger in the same change; `docs/<area>.md`
and STYLE-GUIDE move in the same change when behaviour or a rule moves;
views never toast (domain contexts do); no em-dashes in new copy.

Open questions for the owner are marked ★. Everything else is a routine call.

**Owner rulings 2026-10-11 (build started):** Existing 0.6 pubs: on a spec version
change, Default-config rows equal to the OLD preset's values are dropped so they
follow the new preset (ruled after D2). A2 = dock closed until the
Character step. B5 = members only; the rail already hides Pipelines, Sampling
AND Connections from members (`Layout.svelte:730-753`), so B5 is ✗ already
true and admins keep their shortcuts. C2/D1 = the Image button stays
clickable and fails with one clear message linking to Defaults; unused
optional jobs read "Off", not red "Needed". D2 = one prompt entry, the plain
dialog; the review gate defaults off. J = document view stays; fix its copy.

---

## Batch A — first run: `src/routes/+page.svelte` (wizard)

- A1 ☑ **The name you type is the name you play as.** Step 1 asks "What
  should we call you? This is the name the characters will see." but only
  sets the account's display name; step 5's quick persona is created as
  `name: "You"` (`+page.svelte:1096`). Fix: the quick-persona card reads
  "Just call me {name}" when step 1 has a name, and creates the persona with
  that name; fall back to "You" only when the field was left empty. Update the
  step-1 helper text to "This is the name the characters will see, and the
  name of the character you play." Test: a dom test that a typed name lands on
  the created persona row.
- A2 ☑ **Keep the dock closed while the wizard runs.** On first load the
  Library panel opens on top of the wizard; "Browse the library"
  (`+page.svelte:2931`) then does nothing visible because the panel is already
  open. Fix: the wizard mounts with the dock closed; "Browse the library"
  opens it; when the wizard ends on "Start the session", close the dock.
  ★ Owner: should the dock stay closed for the whole wizard, or only until
  the Character step?
- A3 ☑ **Say "Pick", not "Import", inside the wizard.** While the Character
  step is active, the library detail's primary button reads "Pick this
  character" and the imported chip reads "Picked". Outside the wizard the
  button stays "Import". Same file, plus the library detail component the
  dock renders (grep `In your characters`).
- A4 ☑ **One Ollama card.** The LLM step shows "Ollama · Recommended ·
  Running on this computer" and "Ollama, managed by Serene Pub" together,
  with "run by" on the KoboldCPP card. Fix: when a running Ollama was found,
  drop the managed card into a one-line link under it ("Let Serene Pub
  download models into it instead"); use one verb on the managed cards.
- A5 ☑ **Step title "Choose an LLM" → "Choose an AI".** The body already
  explains "An LLM (large language model) is the AI that writes the
  replies"; keep that sentence, retitle the step and the progress label.
  Ledger entry.
- A6 ☑ **Docs: getting-started.md** says "change your name later in
  Settings › User"; name the field: "Settings › User › User profile ›
  Display name" (and A1 changes what the name does, so say so).

## Batch B — the rail and the shell: `Layout.svelte`, `Header.svelte`

- B1 ☑ **Drop the grey "open tab" dot on the narrow rail.** After five
  panel clicks most icons carry a dot (`Layout.svelte:2468,2579`); nothing
  explains it. Keep the open-tab mark only on the wide rail (text row), where
  there is room for a subtle marker, or drop it entirely. Gold/red/pulse dots
  stay. STYLE-GUIDE §6.11 gets the rule.
- B2 ☑ **A tooltip for every rail dot.** The accessible name already says
  "Admin, something needs you"; sighted users get nothing. Show the same
  words as the `title`.
- B3 ☑ **A loading state before the shell knows the user.** A deep link to
  `/admin`, `/admin/defaults` or a session renders an empty dark page until
  the user arrives (8 to 14 s in dev, less in prod, but never zero). Fix:
  the shell renders the rail skeleton and a centred "Loading your pub…"
  while `shouldShowApp` is false. Related memory:
  `feedback_shell_must_know_user_before_pages_mount` (keep the gate, add the
  skeleton).
- B4 ☑ **One search placeholder.** The box relabels itself per panel
  ("Search Library", "Jump to anything", "Search Documentation"). Keep
  "Jump to anything" always; the scope chip inside the palette says where it
  is looking.
- B5 ✗ (already true) **Pipelines and Sampling leave the member rail.** Both are admin
  concepts (10-09 ruling: members only pick prompts in session settings) and
  both already exist under Admin › Models / Admin › Pipelines. Fix: remove
  the two rail entries for everyone; the Admin section is the one place.
  Connections stays on the rail (members need the status strip). ★ Owner
  confirmation: this changes the rail for admins too.
  **Superseded 2026-10-11** by `PLAN-models-view-admin-bridge-2026-10-11.md`: Sampling leaves the rail for everyone (merged into Connections, renamed **Models**); Pipelines stays for admins; members get the session readiness strip.
- B6 ☑ **Docs: getting-around.md** rail order and the "Tune" sentence follow
  B5; coming-from-sillytavern.md:99 lists Connections, Sampling, Pipelines
  and Admin as admin-only (until B5 lands) and then just Admin.
  **Superseded 2026-10-11** by `PLAN-models-view-admin-bridge-2026-10-11.md` lane E: Tune is now **Models** and **Pipelines** for admins; the ST page lists Models, Pipelines and Admin.

## Batch C — "Needs you" is one rule: `admin/adminHealth.svelte.ts`, `admin/sections/overview/Page.svelte`, `admin/sections/defaults/Page.svelte`

- C1 ☑ **One source for "needed".** Overview says "Nothing needs you"
  (`overview/Page.svelte:292`, from `adminHealth.attention`) while the Models
  card beside it shows red "2 needed by a pipeline and not set"
  (`overview/Page.svelte:107`, from `m.missing`) and the rail dot is gold.
  Fix: the Models card's "missing" line becomes an attention item (level
  `attention`), so the Needs-you list, the card and the rail agree. Test:
  overview with two missing required jobs lists them under Needs you.
- C2 ☑ **A job nobody asked for is "Off", not "Needed".** On a text-only
  pub, Image generation shows "Needed" in red (`defaults/Page.svelte:245`)
  because the Chat genre ships an Image action. Fix: "Needed" only when a
  pipeline that has actually run (or a session that exists) binds the job;
  otherwise "Off" in surface tone with "Used by the Image action; set a
  connection to turn it on". ★ Owner: alternative is to make the Image
  action hidden until the job has a default (see D1), in which case "Needed"
  can stay strict.
- C3 ☑ **Plain words on the Defaults rows.** Drop the raw capability keys
  (`text->text`, `text+image->text`) from the row subtitle into the "?"
  tooltip; "Used by 13 node definitions" → "Used by 13 pipeline steps";
  "Backend's own default" → "Connection's own default"; "Differs from the
  rest of the group" → "Different from the other text jobs". Ledger.

## Batch D — the Image action and review: `generateImage.ts` (SDK core-catalog), `PipelineReviewModal.svelte`, the composer actions row

- D1 ☑ **No image model, no Image button.** With Image generation unset,
  Actions › Image opens a dialog, then a review, then fails twice (inline
  card and toast) with "(at 'render')". Fix: when the job has no default,
  the action renders disabled with a tooltip "Set up image generation in
  Admin › Models › Defaults" (a link for admins, plain text for members).
  The composer already knows the defaults through the connections context.
- D2 ☑ (SDK 1.1.0, review preset off; Default config follows the preset on version change; hash pin re-keyed) **One prompt entry, not two.** `generateImage.ts:9-24` says the
  review gate *is* the prompt entry, yet the walk showed an "Image" dialog
  ("What should the image show?") followed by "Waiting for your review" with
  the same prompt. Fix: the action takes the prompt as its form, and the
  `review-on` preset defaults to off; or the action has no form and the
  review is the only entry. ★ Owner picks; the first keeps the plain dialog
  the user saw first.
- D3 ☑ **Review modal in plain words.** "Generate image · Chat · step
  'render': This step's write (generate image), before it takes effect."
  → "The AI wants to generate an image. Approve to make it, or change the
  prompt first." Keep the technical line in an expandable "Details".
  Same for CapPauseDialog ("Keep going? These pipelines keep setting each
  other off…") → "The AI is about to make N more requests in a chain.
  Continue lets them run; Stop here keeps what is done." Both are mounted
  globally so members see them.
- D4 ◐ (inline once; off-screen toast not built) **One failure, one place.** A failed run shows the error inline on
  the run card *and* as a toast with identical text. Keep the inline card
  (it has Inspect); the toast only when the session is not on screen. Drop
  "(at 'render')" from user text; it stays in Inspect.
- D5 ☑ (SDK SessionComposer: New chips held until the menu closes) **"More (3 new)" explains itself.** The gold dot on More means three
  actions were added since the user last opened it; the menu should head
  those with "New" chips and clear the dot on open.

## Batch E — start and edit a session: `StartSessionForm.svelte`, `EditSessionForm.svelte`, `createSession.svelte.ts`, `PipelineCards.svelte`, `SessionLorebookReading.svelte`

- E1 ☑ **Why is Start disabled?** The form shows "Who is in it: You" and a
  greyed Start with no reason. Fix: a line under the button that names the
  first unmet rule ("Add at least one character", "This genre needs a
  lorebook"). The rules already exist in `flow.shape`.
- E2 ☑ **Lorebook dead end gets a button.** "This genre needs a lorebook —
  create one in Lorebooks first" (`StartSessionForm.svelte:995`) → inline
  "Create a lorebook" that opens NewLorebookDialog and selects the result.
- E3 ☑ **No-preset dead end links for admins.** `StartSessionForm.svelte:717`
  "An administrator decides which presets…" → for admins, add "Open Admin ›
  Play › Presets".
- E4 ☑ **Preset section hides when there is one choice.** With a single
  preset the section is a heading and the word "Chat". Hide it unless
  `presetOptions.length > 1`; when shown, describe it: "A starting recipe
  for this genre: the settings and actions the session begins with. The
  default is fine." Same sentence on `EditSessionForm.svelte:2184`.
- E5 ☑ **Genre facts in plain words.** `createSession.svelte.ts:205`:
  "no composer" → "you don't type messages"; "narrator voice" → "a narrator
  tells the story"; "personas" → "a character you play" in the genre
  descriptions and the Genre blurb (`StartSessionForm.svelte:647`).
- E6 ☑ **Retired words out of EditSessionForm.** "Session mode" (1085),
  "Session mode upgraded" (1088), "Contributed to this mode" (2269/2273) →
  Genre; "Session functions" (1043) → Actions. "Upgrade to core:genre/chat@2"
  (1523-1531) → "Upgrade to version 2". `{f.specSlug}` under actions
  (2250/2304) → the action's description. Ledger check only (words already
  retired).
- E7 ☑ **Envoys get a sentence** (`EditSessionForm.svelte:1736`): "Characters
  this genre brings along, such as a narrator. Switch one on to include it."
- E8 ☑ **Lorebook line copy** (`SessionLorebookReading.svelte:235-248`,
  `EditSessionForm.svelte:2153`): "Line = which version of the lorebook this
  session reads. Main is the original. Story clock = the in-story date."
- E9 ☑ **PipelineCards** (`:113-143`): heading "How replies are made"; the
  bare "Apply" → "Apply now" with a note that it applies at once, unlike the
  rest of the form.
- E10 ☑ (as picker, not inline notice; inline needs SDK composer) **No persona toast has an action** (`composerFlow.svelte.ts:211`):
  "Choose who you play as" with a button that opens the persona picker
  (`turns.showAddPersonaModal`). "Add Persona to Session"
  (`routes/sessions/[id]/+page.svelte:809`) → sentence case.
- E11 ☑ **Docs: sessions.md** names the Name, Genre and Upgrade controls at
  the top of "Session settings"; drops the "Manage menu" (line 287) for
  "beside the book's name (first item under ⋯ on a narrow screen)"; marks the
  Writing Room example as a plugin or drops it; uses `Admin › Group ›
  Section` with `›` throughout.

## Batch F — characters: `CharactersSidebar.svelte`, `CharacterForm.svelte`, `CharacterListItem.svelte`, strokes components

- F1 ☑ **Card summaries are not raw card text.** Library and character cards
  show "Name: Brix Gender: Female (Designate) Role: …". Fix: the summary
  line prefers the card's `creator_notes`/tagline, then the first sentence
  of the description with leading "Name:/Gender:" key lines stripped.
- F2 ☑ **Delete dialogs name what goes.** `CharactersSidebar.svelte:1619`
  "Delete character?" → "Delete Brix? Her gallery and sprites go too. She
  leaves 2 sessions." Model: `SpritesTab.svelte:755`.
- F3 ☑ **Spelling and case.** `:216` Favorites vs `:1514` favourite → one
  spelling (US, matching the rest of the app); `:1524` "Browse Characters" →
  "Browse characters"; `:1516` persona empty state gets a "Write a persona"
  button.
- F4 ☑ **Nickname vs Aliases hints** (`CharacterForm.svelte:2147`, `:1401`):
  "What others call them in replies" / "Other names that should match lore
  keywords".
- F5 ☑ **Post-history instructions** (`:1938,1950`): hint "Placed after the
  conversation, just before the reply. Good for style reminders."
- F6 ☑ **Blurb hint** (`:1329`): "A one-line blurb for lists and the
  relationship map. The AI doesn't see it."
- F7 ☑ **Strokes are defined where they are offered.** `StrokeField.svelte:74`
  tooltip on "Split into strokes…": "Break the description into pieces you
  can show always, never, or only when a keyword comes up." (Strokes are
  behind `STROKES_ENABLED=false`; do this when they return.)
- F8 ☑ **Docs: characters.md** tabs are Details, Gallery, Sprites; the
  sprites button is "Upload images" and the standard-set is a link.
  personas.md: say Default persona implies Persona; call the badge the
  "Persona" chip.

## Batch G — lorebooks: `LorebooksWorkspace.svelte`, `LensTrack.svelte`, `LoreRail.svelte`, `TimeLens.svelte`, `lenses/registry.ts`, `LorebookActions.svelte`, `CastWorkspace.svelte`, `GraphsWorkspace.svelte`, `EntryAdvancedFields.svelte`, `LoreWritesOffNotice.svelte`, `SummarizeLoreModal.svelte`

- G1 ☑ **Empty state says what a lorebook is** (`LorebooksWorkspace.svelte:2477`):
  "No lorebooks yet. A lorebook holds the world, the cast and the history a
  session can read from. Create one to get started."
- G2 ☑ **"Lens" → "Show as"** on the track (`LensTrack.svelte:65-119`);
  `DayOne.svelte:182` "views and lenses" → "views and the Show-as track".
  "Places" exists in both Views and Show-as; keep the view, retitle the
  lens "Map". Ledger: lens stays the code word; "Show as" is the label.
- G3 ☑ **"line" means a branch only.** Time and Lives lenses say
  "timeline" (`TimeLens.svelte:421,596,603,738`, `registry.ts` empties).
- G4 ☑ **Buttons in empty states**: Cast (`CastWorkspace.svelte:1271`) gets
  "Add a character"; Graph (`GraphsWorkspace.svelte:1331`) gets "Build a
  graph".
- G5 ☑ **Delete lorebook names it and what goes**
  (`LorebookActions.svelte:599`): entries, cast, places, and the sessions
  reading it. Same for `DeleteLorebookEntryConfirmModal.svelte:19` and
  `DeleteMessageDialog.svelte:31` (mention alternate replies; no undo).
- G6 ☑ **Lore-writes-off notice is a button** that opens Settings › User
  (`loreWriteMode.ts:70`, `LoreWritesOffNotice.svelte`).
- G7 ☑ **Recursion depth options that do nothing are disabled**
  (`EntryAdvancedFields.svelte:123-151`) while the pipeline cap is 0, with
  the cap setting linked for admins; label → "Let this entry pull in related
  entries".
- G8 ☑ **Bind → Link** (`SummarizeLoreModal.svelte:1365`): "Link to character
  (optional)" / "Not linked".
- G9 ☑ **Retrieval explanation** (`RetrievalExplanation.svelte:180,193,268,426`):
  "arms" → "search methods"; "chat wire" → "chat messages"; "binds `event`
  to `slug`" → the action's name. `SessionRetrievalPreview.svelte:159`
  "What would fire now" → "Preview lore for my draft".
- G10 ☑ **Docs: lorebooks.md** uses **New** and "the upload button (Import a
  lorebook)".

## Batch H — one word for embeddings: `RagNotice.svelte`, `EmbeddingStatusIcon.svelte`, `ConnectionIndexView.svelte`, `EntryAdvancedFields.svelte`, `UserSettingsTab.svelte`

- H1 ☑ **"Search by meaning" is the feature, "indexed" is the state,
  "Embeddings" is the connection job.** Replace "vectors up to date / stale",
  "embedded", "RAG", "Smarter lore retrieval" accordingly. Ledger entry
  under §24 with the three words and their homes.
- H2 ☑ **RagNotice offers the action it names** (`:207-226`): "Re-index now"
  when stale; "Set up search by meaning" (link to Admin › Models › Defaults ›
  Embeddings) when nothing is indexed.
- H3 ☑ **UserSettingsTab:453** "Your language also decides which retrieval
  features apply" → "Some search features depend on your language" with the
  Languages doc as a link.

## Batch I — sampling and connections: `SamplingSidebar.svelte`, `connectionForms/*`, `KoboldCppForm.svelte`, `KoboldCppManagedForm.svelte`

- I1 ☑ **Sampling rows in words.** "6 of 34 sent · picked by 2 pipelines" →
  "6 settings on · used by 2 pipelines"; the lock icon gets a tooltip
  "Built-in, copy to edit"; the star "Default for Chat". Delete warns when
  the config is a default. "sampling configuration" → "sampling config"
  (`:907`).
- I2 ☑ **KoboldCPP toggles get one line each** (`KoboldCppForm.svelte:280-399`,
  `KoboldCppManagedForm.svelte:250-407`): Stream, Use Memory, Trim Stop
  Sequences, Render Special Tokens, Bypass EOS Token, Retain Grammar State,
  Replace Instruct Placeholders, Flash Attention. "Prompt format" casing
  made uniform; "Prompt format" and "Token counter" get a description.
- I3 ☑ **Connections panel wording**: "Sessions can reply" card → "Replies:
  Ollama · model name" with "Change"; "Other jobs · all optional" stays.
- I4 ☑ **Docs: connections.md** "Models directory" / "Image models directory"
  casing; coming-from-sillytavern.md:167 "A custom connection" → "Add › A
  connection, then pick the program"; full breadcrumbs.

## Batch J — document view (`src/routes/document-view/**`)

- J1 ☑ **Drop the managed-Ollama / KoboldCPP gate** ("Enable it from System
  settings first"); send users to the connection page. "System settings" →
  "Pub settings". `settings/system/+page.svelte:294-336`, `ollama/+page.svelte:316`,
  `koboldcpp/+page.svelte:520`.
- J2 ☑ **Retired words**: "New session" → "Start a session"
  (`sessions/new/+page.svelte:183`); "personalities you'll session with" →
  "characters the AI plays" (`+page.svelte:84`); "set it as your default" →
  "Use for chat" (`:66`); the RAG step gets an `href` (`:100-102`).
- ✗ candidate: if document view is slated for removal in 0.7, J1–J2 are
  dropped and the route hidden instead. ★ Owner.

## Batch K — docs-only gaps

- K1 ☑ pipelines.md: "Instance default" → "Pub default"; "1 binding
  unavailable" → "Binding unavailable"; plugin Settings lives on the plugin's
  page; add Admin › Pipelines › Configurations, the Library page and Recent
  runs.
- K2 ☑ sessions.md or system-settings.md: Admin › Play › Sessions
  (read-only list of every session).
- K3 ☑ system-settings.md › Diagnostics: the "script chains have no place to
  run" line, linking scripts.md#unplaced.
- K4 ☑ (done under B6) getting-around.md:14: "your account (opens Settings)".
- K5 ☑ `admin/sections/session-presets/Page.svelte:186` empty message
  ("the Chat floor seeds at startup … bootstrap failed") → "No presets yet.
  Restart the pub to restore the built-in ones."

---

## Order and gates

1. A, B, C, D first: they are what a new user hits in the first ten minutes.
   ★ answers needed before A2, B5, C2/D2 and J.
2. E, F, G in parallel (disjoint files).
3. H, I, J, K last; K is docs only and can run alongside anything.
4. One grouped verification at the end: `npm run check`, `npx tsc --noEmit -p .`,
   `npm test`, then a fresh-instance walk on a scratch data dir repeating the
   first-run path (wizard → session → Actions › Image with no model → Admin
   overview) and screenshots of each changed panel.
5. SDK touch: only D2 edits `../serene-pub-sdk/core-catalog`. It needs
   `npm run sdk:test` and `npm run sdk:build` (never under the owner's dev
   server), and a prerelease + pin bump before push.

## Verification 2026-10-11

- `npm run sdk:build` ✓; `npm run sdk:test` 2942/2944, the 2 failures are
  `sdk-tests/vocabulary.test.ts` on two SDK guides untouched by this plan
  (pre-existing, files unmodified in git).
- `npx tsc --noEmit -p .` ✓ · `npm run check` 0 errors (10 pre-existing warnings)
  · `npm run docs:build` 108 pages ✓ · full `npm test`: see the final report.
- Fresh-instance walk (port 5199, scratch data dir): wizard with the dock closed
  until the Character step, "Choose an AI", one Ollama card with the managed
  link, "Pick this character" / "Picked", "Just call me “Jody”", session opens
  with "Write as Jody…", no grey rail dots, Admin dot gone once chat is set;
  Actions › Image with no image model = one dialog, one failure card with the
  Defaults link, no review modal, no toast; Admin Overview's Needs-you list,
  Models card and rail dot agree (gold "needs a model", red "run failed").
- Still open: B3's skeleton shows once the shell mounts, but a dev-mode deep
  link to /admin still shows nothing for the seconds Vite spends compiling the
  route; prod is unaffected by that part. D4's off-screen toast is not built.

## Not in this plan

- Pixel-level restyling (owner ruling 09-28: screenshots + "looks decent").
- Strokes copy beyond F7 (feature paused).
- Any change to what members may do; B5 only moves two admin panels off the
  rail.
