# BRIEF — hist-F-w1: app docs for "one history entry per date, scenes first"

Supervisor: lane hist-F. Plan `plans/PLAN-history-one-per-date-2026-11-10.md` (GO 2026-11-10). The code is already built; you describe it. **No code changes.**

## Goal

Update seven pages of `docs/` so they describe what the code does now (facts below, checked against the code by the supervisor). Say each rule **once**, on its home page, and link to it from elsewhere instead of repeating it. Change only the paragraphs named; leave the rest of each page as it is (other sessions' edits are in these files, uncommitted: never rewrite a whole file, use targeted `Edit`s).

## Files owned (the only files you may edit)

`docs/lorebook-time.md`, `docs/summarization.md`, `docs/sessions.md`, `docs/lorebooks.md`, `docs/genre-dungeon-crawler.md`, `docs/lorebook-cast.md`, `docs/pipelines.md`.

## Files readable

Anything. Useful: `src/lib/server/scenes/historyEntryOfDate.ts`, `src/lib/client/lorebooks/looseEnds.ts`, `src/lib/server/pipelines/runtime/host.ts` (search `fileOntoHistoryDay`), `src/lib/server/scenes/liveScenes.ts` (search `appendSceneNote`), `src/lib/server/sockets/scenes.ts` (search `forkRidingSessions`, `BRANCH_SESSION_SCENES`), `src/lib/server/pipelines/prompt/characterLore.ts` (search `deceased`), the SDK's `../serene-pub-sdk/core-catalog/src/genres/dungeon-crawler/` (read only).

## House voice (STYLE-GUIDE §10, quoted)

- "Sentence case everywhere."
- "One name per thing, across the whole flow: the thing you open is a session, never a chat; one installation of Serene Pub is a **pub**."
- "Labels are nouns, hints are sentences, empty states are invitations, errors say what went wrong and what to do."
- "No filler."

And the pages' own style (copy it): second person, present tense, plain words; UI labels in **bold**; quoted app sentences in *italics*; links as `[Text](./page.md#anchor)`. CLAUDE.md: "It is a **session**, never a *chat*." Never call a lorebook's history a "log". A lorebook is always there (a session with no shared book has its **Session notes**): never write "no lorebook" for a session.

## Facts to describe (what the code does now)

**A. One history entry per date, per line**, as each line reads it.
- Dates compare as the day (a time of day doesn't count). Partial dates are different dates: *Year 2*, *Year 2, Month 5* and *Year 2, Month 5, Day 3* are three dates. Undated history entries are ignored by this rule.
- On a date that already has two entries (made before this rule), the **oldest** (lowest id; say "the one made first") is the day's entry.
- A person's **create**, or **re-date** onto a taken date, is refused: *‹line› already has a history entry for ‹date›. Open it, or choose another date.* (A re-date is checked only when the date changes, so a doubled entry can still be edited.)
- **Paths that mean "the entry of this day" reuse it** instead of making a second one:
  - **Compile** (it files under the day's entry, making an empty one only when the day has none);
  - **Add the next date in sequence** (and the Chronicle's **Start new history entry**, which does the same): when the next date already has an entry, that entry opens instead of a new one;
  - **New** in the **Summarize to Lorebook** window's **History entry** field: it uses the history entry of the day where the session's story stands, making a blank one only when that day has none;
  - **Time lens drop**: dropping a non-history row onto a day that already has a history entry opens that entry with the row's name added to its text (a new paragraph), ready to save; only a day with no entry starts a new one. Dropping a *history* entry onto a taken day still fills in the date, and saving is refused with the sentence above.

**B. Forks (rule C).**
- A line owns history entries only for dates **strictly after** its fork date. On or before the fork date, the day's entry belongs to the line it forked from (or further up), and a fork changes that day through **amendments** (compile already does this: "On a branch, for an entry the branch shares with main, it files an amendment on the branch").
- When compile needs a day's entry on or before the fork and there is none, it makes an empty one **on the line that owns the day**.
- A person's create or re-date on a fork, on or before its fork date, is refused: *‹line› shares everything up to ‹fork date› with ‹owning line›. Change that day here as an amendment, or choose a later date.*
- A fork with **no fork date** (made with **Fork at now**) owns no dated history: *‹line› follows ‹owning line› with no fork date, so its dated history is ‹owning line›'s. Change that day here as an amendment.*

**C. Loose ends: two new chores** (in the book's Loose ends list, `docs/lorebooks.md`):
- **Two history entries on one date**: one row per doubled date on the line you're reading, opening the oldest; the row has **Other entry** links (**Other entry 2**, **3**… when there are more) to open the others. Fix line in the app: *Give one of them another date, or move what it says into the other and delete it.* Nothing is merged for you.
- **A line's own history before its fork**: a history entry a fork holds for a date on or before its fork date (made before this rule), while you read that fork. Fix line: *Give it a date after the fork, or delete it.*
- Both open the entry with the date field ready, like **Undated history**.

**D. Sessions and lines.**
- A branched session (**Branch off at a point**, **Branch from here** on a book) gets its own line the first time it **writes to the lorebook** (a version, an entry, a value; a summary's save counts). That fork happens inside the write: a write that is refused forks nothing.
- When it forks, the session's own scenes that aren't compiled yet **move onto the new line** with it.
- **Starting or ending a scene isn't a lorebook write**: it forks nothing.
- **Compiling forks first**: pressing **Compile** for a day forks any branch session that still rides the line being compiled (reading this book) before it reads the day's scenes, so that session's scenes move to its own line and are compiled there. When the only scenes waiting were such a session's, the press is refused: *The scenes waiting here belong to a branch session, which compiles them on its own line.*
- **Next chapter** starts at the followed session's **own** clock. When that session had no clock of its own (it followed its line's present), the new one follows the present too.

**E. Summaries and compile.**
- **Compile always merges through the model**, even for a day with one scene (scene notes become prose, never pasted).
- **Compile stays a person's press**: no pipeline compiles.
- A scene's **notes** (from pipelines, below) are read with it: under *Noted in this scene:* when the scene is processed, and after its summary when it's compiled. A scene with no summary isn't compiled (unchanged: compile reads summaries).
- The default scene-summary prompts now ask for the scene's key beats "deaths, departures and arrivals among them".

**F. Pipelines (scenes first).** Owner direction, 2026-11-10: pipelines put events into scenes first; history is compiled from scenes.
- **Note it in the scene** (`core:outlet/note-scene@1`): adds a note to the session's open scene on the run's channel, or to a named scene. It adds no message and never writes history. Retaking, regenerating or deleting the turn takes the note back; **Forward** puts it back. Refused (each in words): a note with no text (*a note needs text.*), a genre that keeps no scenes (*this genre keeps no scenes.*), lore writes **Off**, a scene that doesn't exist, a scene of another session (*that scene belongs to another session.*), no scene open (*no scene is open to note; open one first (propose-scene-cue@1).*), a run with no session.
- **A pipeline's history write** (`create-lore-entry@1` with entry type history) files onto **the day's entry**, appending its text as a new paragraph; when the day's entry already existed, its receipt says *filed onto ‹date›'s entry*. Retaking the turn takes the paragraph back, and removes the entry if the write made it.
  - With no date in its fields it uses the **session's story day** (its story clock, as it stands).
  - A month or day without a year is refused: *‹step›: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day.*
  - With no date and no story date at all: *‹step›: history needs a date. Give this write a year in its fields, or give the story a dated history entry first.*
  - On a branch session's line, a date on or before the fork is refused with rule C's sentence (B): compile changes that day by amendment instead.
  - `update-lore-entry@1` re-dating a history entry gets the same date, line and one-per-date checks.
- The chat tool **write_entry** refuses history: *History comes from scenes: capture the moment and compile it, or write world lore.*
- **Change a cast member** (`update-cast-member@1`) can now set a member's **Status in world** (`nodeState`: active, deceased, missing, departed) and visibility (`nodeVisibility`: normal, legendary, hidden), dated and taken back with its turn like its other changes.
- For plugin authors: the packager warns `W_WRITES_HISTORY` on a pipeline that writes history directly (a pipeline started by `summarize-request@1` is exempt, because its save is previewed), and conformance law **C40** checks that no pipeline the shipped catalogue holds writes history directly. Link the SDK guide section: `[Story events: scenes first](./sdk/guides/writing-lore-from-a-pipeline.md#story-events-scenes-first)`.

**G. Cast.** A member whose **Status in world** is **deceased** where the session reads (the version of the member in force at its clock) counts as **background** for their private lore, even while seated: the narrator gets it, and their own turns don't. A member a person plays keeps sharing their lore as before. (This will change with a later plan; describe it as it is.)

**H. Dungeon Crawler.**
- It **writes no history**. A death marks the fallen character's cast member **deceased** (in the session's own notes), the Narrator names the death in a sentence of its own, and the death reaches the day's history the way everything does: through the scene and **Compile**.
- **The fallen** (who fell, where, which seat) is a lasting list the Planner reads every turn; a retake or **Back** takes a death back with its turn. The fallen character's own lore isn't offered among the people the party may meet.
- **Scenes are on.** Under the default **Suggested**, a *New scene? — the day changed* suggestion appears only when the crawl crosses into a new day; the time a round takes doesn't suggest one. Scenes are summarized from their dividers like any session's; to compile them, open the session's notes in **Lorebooks › Session notes** (History, *Not yet compiled*). (The Dungeon Crawler layout has no Chronicle widget.)
- **The clock is the session's story clock** (its **Story clock**), not a separate crawl clock. A new crawl starts at 08:00 on its first day; a round and a rest move it on (cause: the action). It is still said as *Day 2, 16:30*.
- **Crawls from before this version** (boot passes being built now by lane hist-D2; describe as planned): each old cairn (a history entry reading *Here lies ‹name›…*) becomes **character lore** on the fallen hero's cast member, which is marked deceased and added to the fallen; when no member matches, it becomes world lore titled *Cairn of ‹name›*. An old crawl's time moves onto the session's story clock. Nothing is deleted.

## Page-by-page work (home of each rule in bold)

1. **`docs/lorebook-time.md`**
   - § History entries and scenes (lines ~9-25): **home of A** (one per date, partial dates, oldest wins, the refusal, the reuse paths). Rewrite the Time-lens paragraph (~line 13) and the **Add the next date in sequence** paragraph (~line 15) for the reuse. Adjust the compile paragraph(s) (~21-25) so "makes that entry first when the line has none" says it makes it on the line that owns the day (link to Forking). Add a pointer to the two chores in [Loose ends](./lorebooks.md#finding-your-way-around-a-book).
   - § The story clock: one clause or sentence that **Next chapter** starts at the old session's own clock, linking to sessions.md (home of the next-chapter rule is sessions.md).
   - § Branches › Forking: **home of B** (rule C, the two refusal sentences, dateless forks). Keep "What a branch keeps to itself"; adjust "entries written while reading it" if it now contradicts rule C for history (history it writes on or before its fork date is an amendment, not its own entry).
   - § Which line a session reads: **home of D** (first-write fork inside the write, scenes move, starting a scene isn't a write, compiling forks first and its refusal sentence).
2. **`docs/summarization.md`**
   - § Summarize to Lorebook, the **Scene** bullet: **New** uses the day's entry (A, reuse) — one clause, link to lorebook-time.
   - § Processing a scene: notes under *Noted in this scene:* (one sentence, link to pipelines.md for what writes them).
   - § Compiling scenes into a history entry: **home of E** (always through the model even for one scene; notes after each summary; compile is a person's press, no pipeline compiles; it files under the day's one entry — link to A). Mention compiling forks a riding branch session with a link to lorebook-time's § Which line a session reads, not restating it.
   - The prompt phrase "deaths, departures and arrivals" goes here if there's a natural place (§ Changing the prompts or Processing); one clause.
3. **`docs/sessions.md`**
   - Line ~26 (**Branch off at a point**): the new line forks at the first lorebook write, carrying its uncompiled scenes; link to lorebook-time § Which line a session reads instead of restating.
   - Lines ~53/59 (**Next chapter**): **home of the next-chapter clock rule** (D, last bullet).
   - § Scenes: start and end them (~507): it already says a scene "makes no history entry"; add that starting one isn't a lorebook write (so it doesn't fork a branch session's line), one clause with the link.
   - Line ~600 (Chronicle compile paragraph): only if something there now contradicts A/D; otherwise leave it.
   - § Branch from here (~293): only if needed, one clause with a link.
4. **`docs/lorebooks.md`** § Loose ends list (~104-115): **home of C**. Add the two chores as list items, in the same style as **Undated history**, and mention **Other entry** in the paragraph after the list (or in the item). Keep "there is no way to dismiss one that isn't [fixed]".
5. **`docs/genre-dungeon-crawler.md`**: **home of H**. Lines that promise a cairn: ~18, ~245, ~246, ~254, ~255. The clock: ~184 (**Time**), ~213, ~229, ~233. Add scenes (where the page fits it best) and a short paragraph for crawls from before this version. Remove every "cairn" promise.
6. **`docs/lorebook-cast.md`** § Lore only one character knows (~75-82): **home of G**, one bullet or sentence.
7. **`docs/pipelines.md`** § Summaries and the lorebook (~83-97): **home of F** (scenes first, note-scene, history writes, write_entry). The **Change a cast member** sentence goes there too or in § The cast a pipeline reads. The W_WRITES_HISTORY / C40 sentence goes in § For plugin authors (~426).

Also run `grep -rn "history entr\|cairn\|crawl" docs/*.md` and fix any **other** page (not release notes, never `docs/release-notes/`) whose sentence now contradicts A–H; list each such page in your report and edit it only for that sentence. If a page outside the seven needs editing, **stop and list it** in your report instead of editing (the supervisor adds it to your scope).

## Out of scope (write down, never build)

Code, tests, the SDK, NOMENCLATURE.md, STYLE-GUIDE.md, release notes, plan and report files. Benched seats (a later plan). Don't add anything the facts above don't say.

## Stop and ask when

The code you read disagrees with a fact above (describe the code, and say so in your report); a sentence needs a new name or a new UI label not given here; a page outside the seven needs a change.

## Verbatim lane rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You need no `sdk:build` in this task: don't run one.)
- Never `git checkout`, `restore` or `clean` in either repo. Never run `prettier --write` on a file (these pages already fail `prettier --check`; that's expected).
- Read large files by line range (`sed -n`, `Read` with offset/limit), never whole.
- Scratch files start with `hist-F-w1-`.

## Done means

- Every fact A–H is on its home page, once, and every other mention is a link.
- `npm run docs:build` succeeds (run it from `/home/jody/github/serene-pub`).
- No test runs needed from you; the supervisor runs the docs tests.

## Report

Write `plans/briefs/REPORT-hist-F-w1.md` (if the harness refuses, put it in your final message): pages and sections changed (one line each), any fact you couldn't place or that the code contradicts, any other page the grep found, `docs:build` result, Noticed-not-done.
