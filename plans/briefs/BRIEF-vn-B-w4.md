# BRIEF — vn-B-w4: docs and canon for the Visual novel layout

Lane vn-B (supervisor), plan `plans/PLAN-visual-novel-layout-2026-11-11.md` rev 2 — read **all** of it (§0 the owner's words, §1, §2 the new names, §5–§7). Then read `plans/REPORT-vn-A-2026-11-11.md` and `plans/REPORT-vn-C-2026-11-11.md` (the SDK shapes, copy and internal names). App repo `/home/jody/github/serene-pub`. You edit **only** the five documents below; another worker is editing code at the same time. Docs and canon only: no code, no tests.

## What was built (the facts you document)
- **Layout settings** gain **Behind the panels**: *Your background* (default, today's look) · *The session's backdrop*; help *What shows through behind the panels.* **Dim**, 0–100%, shown only for the backdrop; help *Darkens the picture so the panels over it are easier to read.* The picture fills the layout behind every zone, cover-fit, decoration only; it's drawn only when the session has a backdrop (else nothing). Panels keep their own **Backing**. Edits go through Undo and Cancel. Stored keys `behind` (`'background' | 'backdrop'`, absent = background) and `behindDim` (0–100, absent = 0) on `PanelLayoutV2` / `PanelLook`; a value equal to the default is dropped. App: `LookPatch`, `lookOf`, `setLook`, `LayoutLookSection`, `LayoutBackdrop.svelte`, `sessionBackdropSrc` (`components/host/backdropSrc.ts`, shared with `RemoteWidget`).
- **Dialogue box** (widget `dialogue-box`, title **Dialogue box**, one per layout, core only, view-only like Messages · Composer · Turn line): reads the story one line at a time — one row of the main channel (narration included), drawn with the same row as Messages (its menu, edit, pictures, spoken line), but no **Select for summary**. Opening a session starts at the newest line; each viewer has their own **reading place**, kept in the browser, never stored. Later replies of a round wait behind the line; the **reading bar** says who is waiting (*Osk has replied* · *Osk and Bren have replied* · *3 more lines* · *Osk is writing…* · *Writing…*) and holds **Next line** (the whole bar is its target). Sending catches you up: your own line and lines that aren't a character's or person's (a change line, a marker) are passed. With nothing queued the bar draws nothing; with no lines the widget draws nothing. Settings (only two): **Read on by itself** (`autoRead`, off; help *Moves to the next line by itself: once a line's voice has played, or after a reading time when it has none.*) and **Reading speed** (`readingSpeed`, words per minute 80–600, default 220, shown when Read on by itself is on; help *Words per minute: how long a line with no voice stays before the next one comes in.*). With Read on by itself on: a line whose voice is coming or playing waits until it has played through; otherwise a reading time from the words and the speed, never under 1.5 s, shown as a progress bar (*Time until the next line*) before the next line slides in; **Pause** on the bar stops it until pressed again (not stored). The Composer below the box writes to the main channel and says *Writing to Story*; the full log is the **Log** tab (a Messages widget titled *Log*) beside it. While a layout holds a Dialogue box, the Messages widgets in it don't play a new line's voice by themselves (the box's line is the only one that plays automatically); a line still plays from its play button.
- **Shown line** (`show-line` widget request, core only, `{ messageId: number | null }`): the box tells the page which line its reader is on (null at the newest); the page keeps it as client-only state (`shownLines`, `answerShowLine`, `shownLineOf`, `clearShownLine` in `requests/showLine.ts`), drops it when the session changes or the drawn layout holds no Dialogue box (`holdsDialogueBox` on the layout model). The stage follows it: current sprites and last-spoke times are worked out from the lines at or before it (by message id; a line not loaded is ignored) — `messagesAsOf`, `speakerOf` in `projections/characters.ts`.
- **`speakerRef`** (`SessionCharactersV1.speakerRef`): the `ref` of whoever wrote the shown line, or the newest visible line when none is shown; null when that is nobody in the cast (narration, a person with no persona).
- **`ownNewestMessageId`** (`SessionDossierV1`): the newest loaded line the viewer wrote (a person's line, `role: user`, by their user id), on any channel; app helper `ownNewestMessageIdOf`. The box jumps to it only when it's one of its own (main-channel) rows.
- **Scene Portraits**: setting **Dim whoever isn't speaking** (`speakerFocus`, off; description *Every face but the one whose line is shown is dimmed.*); root attribute `data-speaker-focus` (only while on and a drawn face is speaking), face attribute `data-speaking`; `ScenePortrait.speaking`. Nobody is dimmed when the speaker isn't on the stage. New built-in style **Open stage** (`open-stage`, seeded row slug `scene-portraits:open-stage`, app `SCENE_PORTRAITS_STYLE_PRESETS`): no panel background or border, no 40% height cap, no padding, figures cut by the panel's foot, name and rank hidden. A shipped layout's slug-only style pin is resolved to its seeded row when the layout is copied into a session.
- **Visual novel** layout (`visual-novel`), Story's third after the default and **World**; description *The scene fills the screen and the story reads one line at a time in a box at its foot; the whole log is a tab beside it.* Middle: Scene Portraits (style Open stage; Show *recent*, How many 2, Picture *sprite*, Arrangement *stage*, Dim whoever isn't speaking on) · one panel with tabs **Dialogue box**, **Log** (Messages), **Characters** (Stats) · Turn line · Composer. Sides empty. Look: Backing *Glass*, Behind the panels *The session's backdrop*. Read on by itself stays off. Story's default layout is unchanged.
- CSS parts (STYLE-GUIDE §6.16): `dialogue-box.root` · `.line` (`data-arrive` on every line after the first a mount drew: the slide-in hook, none under reduced motion) · `.bar` · `.queued` (`role="status"`) · `.progress` (`sp-progress`) · `.pause` (`aria-pressed`) · `.next`; the name plate is the default look of the row's `messages.message-name` under `dialogue-box.root`; Next line is stretched over the bar in CSS (`::after`, inset 0), Pause above it.
- Internal names vn-C asked to be recorded (§25): `noSelection` (`ConversationOptions`), `select.offered`, `atReadingPlace` (`SpokenLine` / `SessionMessage` prop), `readingPlace.ts` exports (`ReadingRow`, `isReadLine`, `settlePlace`, `nextLinePlace`, `queuedSummary`, `queuedText`), `readingPace.ts` exports (`LineSpeechPhase`, `HeardPlayback`, `heardAfter`, `lineSpeechPhase`, `readingTimeMs`, `readOnState`, `SETTLE_GRACE_MS`, `STALE_MARKER_MS`, `AUTOPLAY_START_GRACE_MS`), `DialogueBoxSettings`, `readDialogueBoxSettings`, `STORY_VISUAL_NOVEL_LAYOUT`, `coreWidgets.dialogueBox`.

## Goal

### 1. `NOMENCLATURE.md`
Read **§1 Governing rules**, **§24 Naming something new**, the §9 Session rows for **backing**, **backdrop**, **Scene Portraits**, **Composer**, `show-channel`, **the Arrange inspector**, **drawn layout**, and **current sprite** (§18 Media, ~:1107), the speech vocabulary (§10, **Dialogue only** ~:802) and **Auto-advance** (~:441), and the last few §25 entries for the house style. Then:
- **Rows in §9** (each 🚧, each with its charter — purpose, what it owns, what it does not own and who does — and a ⚠ "not" where a neighbour exists), placed beside their neighbours, in the table's own format (`| **name** (code) 🚧 | **Built 2026-11-11 (PLAN-visual-novel-layout; lanes vn-A, vn-C, vn-B).** … |`):
  - **Dialogue box** (`dialogue-box`) with its seven parts and `data-arrive`; ⚠ shows whole lines, narration included — not speech's **Dialogue only**; not a modal *dialog*; not **Messages** (the log). Owns the reading place and the pace of reading; does not own the log (Messages), writing (the Composer), who speaks next (the turn order), speech (the server and `SpokenLine`). Mention **Next line**, **Pause**, the reading bar.
  - **reading place** — ⚠ not the story clock's present (**now**), not a lorebook's moment.
  - `autoRead` (**Read on by itself**) — ⚠ not **Auto-advance** (the turn order's setting, which fires turns). `readingSpeed` (**Reading speed**). One row or two, your call by the table's habit.
  - `behind` / `behindDim` (**Behind the panels**, **Dim**) — ⚠ not **backing** (what each panel sits on); and add a clause to the **backing** row pointing at it. Also add them to the **Arrange inspector** row's list.
  - `ownNewestMessageId`; `show-line` (beside `show-channel`, with its refusals: *show-line needs a session* · *show-line needs a message id (a whole number) or null*); `speakerRef`; `speakerFocus` (**Dim whoever isn't speaking**; add a clause to the **Scene Portraits** row); **Open stage**; the **Visual novel** layout.
  - Amend **current sprite** (§18): it follows the line shown in a Dialogue box when the page has one.
- **§25 Change ledger**: one entry `### the Visual novel layout and the Dialogue box — 2026-11-11 (owner GO; PLAN-visual-novel-layout-2026-11-11, lanes vn-A, vn-C, vn-B)` in the style of the latest entries, listing every name from plan §2 plus the internal names above and the app's (`shownLines`, `answerShowLine`, `shownLineOf`, `clearShownLine`, `holdsDialogueBox`, `messagesAsOf`, `speakerOf`, `ownNewestMessageIdOf`, `sessionBackdropSrc`, `LayoutBackdrop`, `SCENE_PORTRAITS_STYLE_PRESETS`, CSS keyframes `sp-dialogue-arrive`), and the withdrawn revision-1 names (Messages `replyPacing`, `autoRead`, `readingSpeed`, `isShownLine`, `data-msg-shown`, the Messages **Name plate** style — never shipped).
- No §23 retired word reintroduced. It is a **session**, never a *chat*.

### 2. `STYLE-GUIDE.md`
- §2.8 Card and glass: one or two sentences — the layout's **Behind the panels** can draw the session's backdrop behind every panel, with a **Dim** layer (theme surface), and each panel keeps its own backing so "the card over it stays legible on its own" (if that phrase isn't in the guide already, write the rule plainly).
- §6.22 The layout editor's inspector: add **Behind the panels** (a segmented control, *Your background* · *The session's backdrop*) and **Dim** (a 0–100 range, shown only for the backdrop) to the list of Layout settings fields.
- §6.16 Widget parts: the Dialogue box's parts and `data-arrive`; Scene Portraits' `data-speaker-focus` / `data-speaking`; the name plate rule; the bar-wide target (Next line's `::after`, Pause above, the focus ring on the button). Find where §6.16 lists other widgets' parts and follow it (the section is long — `grep -n` inside it, read by range).
- §8 Motion: the Dialogue box's timed bar is `sp-progress` (no transition on the bar), and the slide-in of a new line runs only under `prefers-reduced-motion: no-preference`.

### 3. `docs/session-layout.md` (user-facing: plain words, no internal keys, no file names)
- The widgets table (`## The widgets`, ~:42): a **Dialogue box** row.
- A short section `### The Dialogue box` (after `### The Composer and the Turn line`, ~:121): what it shows (one line at a time, narration included, from the main story), **Next line**, who is waiting, **Read on by itself** and **Reading speed**, **Pause**, that each person reads at their own pace and opening a session starts at the newest line, that the Composer below it says *Writing to Story* and the full log is the **Log** tab, that while it's in a layout the log doesn't play voices by itself (press play), that it shows nothing until there are lines, and that the faces on the stage follow the line it shows.
- `### Scene Portraits` (~:74): the new setting **Dim whoever isn't speaking** and the style **Open stage**.
- `### Layout settings` (~:270): **Behind the panels** and **Dim**; update the "A new layout is …" sentence if it lists defaults.
- `## Layouts` (~:191-224): Story ships a third layout, **Visual novel** — describe it in one or two sentences in the paragraph that describes Story's layouts.
- Keep the doc's voice; check `docs/sessions.md` and `docs/genre-story.md` link anchors you use exist.

### 4. `docs/genre-story.md`
`:36` says "Story ships two layouts": make it three, adding **Visual novel** in a clause.

### 5. `docs/sessions.md`
In `## Sprites` (~:618-629), the line about where faces show (~:627): sprites on the stage follow the line shown in a **Dialogue box** when the layout has one (link to the new section in `session-layout.md`).

## Files owned (edit only these)
`NOMENCLATURE.md`, `STYLE-GUIDE.md`, `docs/session-layout.md`, `docs/genre-story.md`, `docs/sessions.md`.

## Rules you work under (quoted)
- CLAUDE.md: "Every line is paid" applies to CLAUDE.md, not these; but NOMENCLATURE is 14.5k tokens: **read by section** (`grep -n`, then `sed -n` ranges), never whole. Same for STYLE-GUIDE (§6.16 alone is ~100 KB — read by range).
- NOMENCLATURE R1 one word, one meaning · R2 distinctive words for new concepts · R3 qualify, never the bare noun · R4 casual words are not type names · R5 reconcile vocabularies at boundaries · R6 mark ⏳ transitional / 🚧 provisional vocabulary. P6: "Everything that exists states its purpose, why it exists, what it owns and what it does not (and who does) — in its NOMENCLATURE row."
- "When you add or rename a term, record it in §25 Change ledger in the same change."
- Docs are user-facing: plain words, sentence case, no internal keys, never *chat* for a session.
- Do not invent behaviour: only what "What was built" says. Where the plan marks something as asked-not-built (★9: the Composer and Turn line do not follow a Dialogue box), say nothing that implies it was built.
- Never `git commit`, `git stash`, `git checkout`, `git restore`, `git clean`. Never `prettier --write` on a directory.

## Out of scope (write down, never build)
Code and tests; any other doc (e.g. a speech doc that mentions autoplay — note it under Noticed); a Hide control; anything the plan lists as left out.

## Stop and ask when
A fact you need isn't in this brief or the plan/reports and the code can't answer it; a name beyond the plan's seems needed. Report and continue with the rest.

## Done means
The five documents updated; `npx prettier --check` is not required for `.md` here (the repo does not prettier-format these) — instead re-read each edited range once for broken tables (a NOMENCLATURE row is one line; a stray `|` breaks the table). Report the line numbers of every row and section you added.

## Report
Your final message is your report: each file with the line ranges you added or changed; decisions you made (row placement, wording choices); anything you stopped on, with evidence; Noticed, not done.

## Verbatim lane rules
- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You never run `sdk:build` in this lane.)
- Scratch files start with `vn-B-w4-`.
