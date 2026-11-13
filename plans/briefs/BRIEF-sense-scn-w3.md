# BRIEF — worker `sense-scn-w3` — the docs, the ledger and the Scenes settings sentence for the scenes routine

Supervisor: lane `sense-scn` (brief `plans/briefs/BRIEF-sense-scn.md`). You type; the supervisor decides. Report back
as your final message (no report file): changed files, every new string of copy verbatim, checks run with results,
anything you could not do, **Noticed, not done**.

Other sessions are editing this repo at the same time (a visual-novel layout build, speech). Edit with small,
exact `Edit` calls on unique text; never rewrite a whole file; if an `Edit` fails because the text moved, re-read
that range and retry. Never touch a line that is not about scenes or routines.

## What was built (the rule you are documenting)

Another worker is building the code now; write the docs from this, not from the code:

- **Core no longer watches each message for scene boundaries.** A genre that wants scenes handled registers the
  routine **Find where scenes begin** (🚧 UI name; id `core:spec/scene-boundaries`): code only, no model. Story
  (its **Living** and **Rule Based** presets), the **Lair** and the **Dungeon Crawler** register it, run **every 2
  rounds** (cadence `core:cadence/every-n-rounds@1`, UI *Every few rounds*), and their scenes begin
  **Automatically** by default (each genre now declares `mode: 'automatic'`). Story's **Minimal** preset drops it,
  as it drops the other routines; **Chat** and the **Guide** never had it.
- **Each run reads only lines at least 2 rounds old.** A round is as the turn order counts it: everyone seated has
  had a turn (in a one-to-one session, your line and the reply). A line's age is how many rounds have begun since its
  own round: after your line and the reply, then another pair, the first pair is 2 rounds old. So a new scene still
  begins **at the line** where the day or the place changed, but it appears a couple of rounds later. A line you
  swipe, retake, delete or take **Back** before then is never read; a line brought **Forward** is read on the next
  run.
- **What it checks.** The moments switched on under **Scenes** (the session's own setting, else its genre's): the
  story's day changes; time passes (**Time passes…** or a person moving the clock marks the next line, and the
  routine begins the scene there when it reaches it); the place changes; and, if ticked, a narrator line, the scene
  reaching a number of lines, a pause in play. When the routine looks, a **place change counts only if the story is
  still somewhere other than where that scene began** (out to the courtyard and back to the hall: no new scene; hall
  to courtyard to the gate: two); a day change always counts; the others count as they fired. Two boundaries found
  in one run are placed in line order.
- **The first scene** (Story): the session's first line begins *Scene 1*, placed by the routine on its first run
  (after the second round). Story's **Minimal** gets no first scene by itself.
- **Under Suggested** the routine offers *New scene? — …* at the line instead of beginning it, one at a time: the
  next waits until you answer (**Yes** or **Not here**), and the routine carries on from there on its next run.
  **Under Manual** it does nothing.
- **A person's own acts stay immediate:** **Start scene here**, **End scene here** (and what follows it under each
  mode, as documented today), **Mark as scene**.
- **Shown, with its cause and its undo:** a scene the routine began says why on its divider, in the trigger's words
  (*the day changed*, *the place changed*, *time passed*, *the story began*); the divider's existing **Remove
  boundary** undoes it. Nothing pops up for it. The routine is listed under **Edit session › Settings › Routines**
  with its name and one sentence of purpose, where it is switched **Off**.
- **In a session that does not run it** (Story Minimal, Chat, the Guide, a genre that doesn't register it, or the
  routine switched Off), the **Scenes** settings say so: scenes there begin only when someone starts one. The mode
  and the moments still show; they are what the routine reads.
- **Notice when the scene moves on** (Story's sweep, model-judged) is **unchanged**.
- **Upgrades:** existing sessions follow their genre. A Story Living/Rule Based, Lair or Dungeon Crawler session
  that never saved its own **Scenes** setting now begins scenes by itself; one that saved its own setting keeps it.
  **Nothing is placed in what was already played:** the routine starts after the session's latest scene boundary or
  scene suggestion; a session with neither looks back only over the last couple of rounds; a branch starts after
  the lines it copied. Suggestions already waiting stay.
- The Lair's scene moment *The party reached a new floor* was **retired 2026-10-21** (NOMENCLATURE §23); the docs
  still cite it: remove it.

## Files owned (edit only these)

App repo `/home/jody/github/serene-pub/`:
- `docs/sessions.md` — the sections **Scenes: start and end them** (~line 505, only the sentence about **End scene
  here** if it needs nothing, leave it) and **When a new scene begins** (~509–520): rewrite the bullets so they say
  the rule above. Keep **Summaries** and **Notice when the scene moves on** as they are except where a sentence
  becomes false. Remove the *new floor* example. Keep the existing link anchors (`#when-a-new-scene-begins`,
  `#scenes-start-and-end-them`) unchanged: other pages link to them.
- `docs/genre-story.md` — ~line 34 ("Story also starts a new session with a scene …": true only for Living and Rule
  Based now, a couple of rounds in); the routines table ~42–48: "four routines" → five, add a row **Find where scenes
  begin** | Every 2 rounds | Full | not run; and one bullet in the list below the table describing it in one or two
  sentences (no model; reads lines 2 rounds old; Automatic unless you change **Scenes**; link to
  `./sessions.md#when-a-new-scene-begins`).
- `docs/genre-lair.md` ~270 (scenes paragraph: "suggested at the next line" is no longer true; now: begins by
  itself, a couple of rounds later, at the line where the party entered the room; switch it off under Scenes or the
  routine; Sanctum talk never begins one) and ~254 (the Routines list sentence: add **Find where scenes begin**).
- `docs/genre-dungeon-crawler.md` ~243 ("Under the default Suggested …": now Automatic, through the routine, every 2
  rounds; only a new day begins one, the time a round takes doesn't).
- `docs/pipelines.md` ~29–31: the Routine row's examples may stay; "Story's **Minimal** preset is Story's defaults
  with the three routines dropped" → four, if that is what the text counts (check against the genre-story table).
- `NOMENCLATURE.md` — see below.
- `src/lib/client/components/sessionForms/SessionSceneSettings.svelte` — see below.

SDK repo `/home/jody/github/serene-pub-sdk/`:
- `guides/genres-presets-and-routines.md`: (a) the cadence table ~150–156: add `everyNRounds({ n })` | every `n`
  rounds; (b) a short subsection under **Routines and cadences** (or beside **When the scene moves on** ~314), titled
  e.g. "### Scenes: a routine, a couple of rounds late": a genre that wants scene boundaries handled registers
  `register(everyNRounds({ n: 2 }), sceneBoundariesSpec())` (from `@serene-pub/core-catalog`); the query
  `core:query/scene-boundaries@1` reads lines at least `depth` rounds old (default 2) and returns `{ at, trigger,
  reason }[]`; each goes through `core:outlet/propose-scene-cue@1` with its `trigger`; the session's scene mode
  decides; core places nothing by itself any more, and a preset drops it like any routine (Story Minimal does). A
  person's Start/End scene stay immediate. Plain, short, accurate; mark names 🚧. Do not touch other sections.

## NOMENCLATURE.md (read §1, §4 ~122–216, §23 ~1457 (the rows on _rounds_ as a settle horizon and the Lair's new floor), §24 ~1684, §25 ~3619–3760 first)

1. **§4, the `cadence` row** (~line 185): add `every-n-rounds` to the list of `core:cadence/<name>@1` and
   `everyNRounds` to the builders (keep the row's style; one short insertion).
2. **§4, a new charter row right after the `round tick` row** (~206), for 🚧 **scenes routine**, in the round tick
   row's format (Purpose · Why · Owns · Does not own · ⚠ not):
   - names: `core:spec/scene-boundaries` (UI _Find where scenes begin_; core-catalog `shared/sceneBoundaries.ts`:
     `SCENE_BOUNDARIES_SPEC_ID` · `SCENE_BOUNDARIES_VERSION` · `sceneBoundariesSpec`), built 2026-11-12 (owner rulings
     2026-11-11 "genre/preset responsibilities, not magic core behavior" and 2026-11-12 "Core does nothing unless
     declared", "Have core genres detect 2 rounds", "Boundary detection probably should be [a routine], maybe one
     that fires every few rounds"; lane sense-scn);
   - **Purpose:** find scene boundaries in lines old enough to stand, and place them (or offer them, under
     Suggested) through the existing scene-cue outlet, with no model (P1);
   - **Why:** the owner asked that scene boundaries be the genre's job, a few messages late, never on the newest
     round;
   - **Owns:** a `maintenance` routine on `core:cadence/every-n-rounds@1` (`everyNRounds`; core genres `n: 2`):
     the query 🚧 `core:query/scene-boundaries@1` (`C.sceneBoundaries`, `SceneBoundary { at, trigger, reason }`, param
     🚧 `depth`, default 2, label _Rounds it waits_; host `sceneBoundariesOf` in `scenes/boundaryWatcher.ts`, binding
     `pipelines/runtime/sceneBoundaries.ts`; a query writes nothing) → a sequential each → `core:outlet/propose-scene-cue@1`
     with its new optional in-port 🚧 `trigger` (absent: `judged`). Where the walk starts is derived, never stored
     (after the channel's latest scene boundary, its latest decided or offered scene cue, or a branch's last copied
     line; with none, only the newest rounds). Registered by Story, the Lair and the Dungeon Crawler in their genre
     defaults; Story Minimal drops it; Chat and the Guide have none;
   - **Does not own:** a person's _Start scene here_ / _End scene here_ / _Mark as scene_ (immediate, the
     per-line hook and the scene sockets); the judged scene check (the sweep's); scene summaries and history
     compile; the open scene's cast refresh; what a scene is;
   - ⚠ Not the round tick (an event pipeline); not a settle horizon (§23 _rounds as a settle horizon_ stays
     retired: `depth` delays boundary finding only); not the old **boundary watcher**'s per-line evaluation, which
     is gone (the per-line hook keeps only _End scene here_'s binding, a time action's marker bound to the next line
     and left `pending`, and the cast refresh).
3. **§9**: find the `scene cue` row(s) and the boundary-watcher / `opening` vocabulary; add one short clause where
   it would otherwise be false: boundary triggers are evaluated by the scenes routine (§4), not on each landed line;
   `opening` is placed by the routine; a time action's marker is bound to the next line and stays `pending` until the
   routine reads it. Keep it minimal.
4. **§25 Change ledger**: a new entry at the end of the dated entries (after the sense-b3 entry ~3747, before
   `## 26. Shell`), headed `### scenes routine: boundaries a couple of rounds late, the genre's job — 2026-11-12
   (owner rulings 2026-11-11, 2026-11-12; DESIGN-e-scenes-2026-11-12; lane sense-scn)`, in the shape of the
   neighbouring entries (a table row: before | after | where/why). Before: the boundary watcher evaluated every
   trigger on each landed line, Suggested by default in every genre that writes scenes, placed at the newest line.
   After: the names in item 2, plus `EVERY_N_ROUNDS` · `everyNRounds` · `coreCadences.everyNRounds` (UI _Every few
   rounds_, option label _Every how many rounds_), the registration key `every-n-rounds→scene-boundaries`, the
   genres' `scenes.mode: 'automatic'`, the host helper `scenesRoutineOn` (does the session have the routine, not
   Off), the Scenes settings sentence (copy below). No new table, column, migration or `scene_cues` state.

## SessionSceneSettings.svelte

Read STYLE-GUIDE.md's copy rules section first (`grep -n "^## " STYLE-GUIDE.md`, then the copy/a11y section only).
Add, minimally:

- An optional prop `sessionId?: number | null` (default `null`), documented in `Props`.
- When `sessionId` is a number, ask the existing socket request for the session's routines exactly as
  `SessionSettingsForm.svelte` lines 69–74 do (`$effect(() => requestWithInterest("sessions:routines", { sessionId }, (res) => { … }))`,
  import from `$lib/client/sockets/interest.svelte`), and derive `scenesRoutineOn` = some routine in `res.routines`
  whose `pipeline === "core:spec/scene-boundaries"` and whose `mode !== "off"`. Keep `null` until the answer arrives.
  Plain `$state`; no `Set`/`Map` (if you need one, `SvelteSet`/`SvelteMap`). No toasts. No `socket.on`/`off`.
  Do not import `@serene-pub/core-catalog` in this browser file: compare to the string id.
- When `scenesRoutineOn === false` and the resolved mode is not Manual, one sentence under the mode's help line
  (same `text-surface-600-400 text-xs` paragraph style, its own id, added to the select's `describedBy` if that is
  how the help is wired), 🚧 copy exactly:
  **"Scenes here begin only when someone starts one: this session runs no Find where scenes begin routine."**
- Update the component's top doc comment: triggers are read by the scenes routine a couple of rounds late, not on
  each line; remove the *new floor* example from it.
- Change nothing else in the component (the mode/trigger choices stay; `MODE_HELP` stays).

The parent (`EditSessionForm.svelte`) is **not** yours: do not edit it. The supervisor queues the one-line change
that passes `sessionId={editSessionId}`. Your component must render correctly without it (no sentence when
`sessionId` is null).

## Rules (verbatim; binding)

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`."
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You have no reason to build: don't.)
- Never `prettier --write` on a directory. Never `git checkout` / `restore` / `stash` in either repo. Never `kill -9`
  anything. It is a **session**, never a *chat* (also in docs). Every session has a lorebook: never write "no
  lorebook". Browser code: no `crypto.randomUUID`, no `navigator.clipboard`.
- **No reference to any other project or product** in docs, code or comments.
- Never write "lane" for a message channel in anything you add (a build lane is not a channel).
- NOMENCLATURE R1 (one word, one meaning), R3 (qualify: "scene cue", "boundary trigger", never the bare noun), R6
  (🚧 on every new name). Docs speak the UI's words (*Find where scenes begin*, *Every few rounds*, **Scenes**, *New
  scene?*), never internal ids, except the SDK guide.
- Do what is asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing.
- Re-read the cited lines before changing anything; line numbers are approximate.

## Checks

- Do not run vitest, svelte-check, tsc or any build: the supervisor runs them after the code lands.
- `npx prettier --check src/lib/client/components/sessionForms/SessionSceneSettings.svelte` (from the app root).
- Re-read each docs paragraph you changed once, against the rule above, and list in your report any sentence you
  were unsure is still true.

## Stop and ask when

A doc sentence you would need to change is in a section that is not about scenes or routines; the routines list in
the docs names the place to switch a routine off differently from **Edit session › Settings › Routines**; you think a
new name is needed beyond those above.

## Done means

The files above edited as described; every string of new UI copy listed verbatim in your report; prettier clean on
the Svelte file.
