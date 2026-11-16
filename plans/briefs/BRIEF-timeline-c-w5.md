# BRIEF — worker `timeline-c-w5` — docs and NOMENCLATURE for the session side of the Timeline switch

Supervisor: lane `timeline-c` (brief `plans/briefs/BRIEF-timeline-c.md`). Report to
`plans/briefs/REPORT-timeline-c-w5.md` (write it last; if the write is refused, put the whole report in your final
message).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Goal

Bring four user-facing docs and NOMENCLATURE up to what lane `timeline-c` built (below). Docs only: no code.

Owner rulings (verbatim, for wording the docs):
- 2026-11-13: "By default, Story Minimal will use an undated book. Messages will just display real time. All other
  Story presets will continue defaulting to timelined storybooks." Minimal on a timelined lorebook advances story
  time "as it does today".
- 2026-11-14: Chat and Guide undated like Minimal; the Lair and Dungeon Crawler timelined as today.
- 2026-11-14: a new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created."
- 2026-11-14: "preset may override the genres default, but not it's mandate".
- Plan §2 (ruled): "The lorebook decides whether story time moves; the preset only picks the default for a new
  session's lorebook."
- 2026-11-05: "There's always a lorebook." **Never write "no lorebook"**; say "a session whose lorebook is its own
  notes".

## What was built (the facts to document; all names and sentences 🚧)

SDK (`../serene-pub-sdk`):
- **A preset's timeline default** — `PresetDefaults.timeline?: boolean`: whether a new session on the preset whose
  lorebook is its own notes starts them with a timeline. Left out = the genre's default.
- **A genre's timeline mandate** — `GenreDecl.timeline?: 'required'` (and `GenreProps.timeline`): the genre's
  sessions' new notes always start with a timeline; `genre()` refuses it without `keepsTime: 'story'`; `preset()`
  refuses `defaults.timeline: false` on such a genre (naming both). The genre's **default** is derived, no name:
  `keepsTime: 'story'` → a timeline; `'real'`, `'none'` or left out → none.
- Catalogue: the Lair and the Dungeon Crawler declare `timeline: 'required'` (★ the lead's choice: the owner ruled
  them "timelined as today", a default); **Story Minimal** declares `defaults: { timeline: false }` and its
  description reads *Just the story: one model call a turn. On a lorebook with a timeline, the clock moves on a few
  minutes each round; nothing else changes unless you change it.* Story Living and Rule Based: timeline by Story's
  `keepsTime`. Chat and Guide: none by `keepsTime: 'real'`.

App server:
- `timelineDefaultFor(genre, preset)` (`src/lib/server/lorebooks/timeline.ts`): a genre that does not resolve → on;
  `timeline: 'required'` → on; else the preset's `defaults.timeline` when it is a boolean; else on when the genre
  keeps story time.
- Session create: only a session whose lorebook is its own notes is affected — its notes take
  `timelineDefaultFor` (`insertOwnBook`'s new optional `timelineEnabled`). An attached lorebook, the `new-world`
  copy, a starter-kit or primer copy, next chapter and branch: unchanged; the lorebook's own switch stands.
  Nothing about an existing session or lorebook changes.
- Boot: core's preset rows have `defaults` re-forced from the catalogue when they differ (existing behaviour), so
  an existing install's Story Minimal row picks up `defaults.timeline: false` at the next boot; a second boot
  changes nothing. **An administrator's copy of Story Minimal made earlier lacks the value and starts timelined.**
- `sessionPresets:list` rows carry `timelineDefault` (resolved boolean); `sessions:storyClock`'s reply carries
  `timeline` (the attached lorebook's switch, else the notes').

App client:
- Start form: under the chosen lorebook's row, when the chosen preset's default is a timeline and the lorebook keeps
  none, *This lorebook keeps no timeline. ‹Preset name› plays best with one.* then, by case: the person's own
  lorebook attached directly — button **Switch the timeline on** (switches it; the offer goes); copy mode (`new-world`,
  and every shared lorebook) — *You can switch it on in the copy's Book settings.*; a provided or read-only lorebook —
  *Story time won't move in this session.* Starting without switching is always allowed. Nothing is shown the other
  way round (an undated preset on a timelined lorebook plays as today).
- The start form's **New lorebook** dialog asks **Keep a timeline** on its Blank way (off by default).
- The reading (line and story clock) in the start form's branch-off and in Edit Session, for a lorebook with no
  timeline, shows the **Line** alone (read-only: *The line is which version of the lorebook this session reads; Main
  is the original.* then *Turn on advanced controls to change it.* / *The session owner chooses it.*). ⚠ Edit Session's
  reading for a session whose lorebook is its own notes still shows the clock (the form holds no value for the
  notes' switch yet) — do not document it as hidden.
- The session page reads its lorebook's switch with its clock reading and reads again when the switch flips
  (`state:changed`). With it off, **Summarize**'s scene path shows no **History entry** choice and the scene files
  under no history entry.
- Messages: a session whose lorebook keeps no timeline stamps no story time, so each message shows its real time.
- Not hidden on the session page with the timeline off (still drawn; the server refuses the move with its
  sentence): an action's *Time passes…* clock step (`CollectModal`), the Chronicle widget's clock and history days.

## Build

1. **`docs/sessions.md`**, **`docs/genres.md`**, **`docs/genre-story.md`**, **`docs/lorebook-time.md`** (app root): read
   each whole first (they are 1–9k tokens). Add or correct only what the facts above change, in the doc's own voice
   and place: e.g. sessions.md where starting a session and Summarize are described; genres.md where `keepsTime` /
   what a genre expects is described; genre-story.md where Minimal is described (its ~line 17 still has the old
   clause *The clock moves on a few minutes each round*); lorebook-time.md's "Setting the switch" and "What you
   won't see" sections (lane timeline-b wrote them; keep their structure). User-facing words only: no code names
   unless the doc already uses them; no "no lorebook"; "session", never "chat" for a session (Chat the genre is
   fine).
2. **`NOMENCLATURE.md`** (shared file: re-read right before each edit; small edits; never reformat):
   - The **Timeline** row (~393): its *Does not own* still says the preset default and the session-creation offer
     are "not built; lane timeline-c: the start screen's own **New lorebook** still makes a book with a timeline" —
     correct that to what is built (the preset's default and the genre's mandate decide a new session's notes;
     the start form's offer; the start form's dialog asks), naming `timelineDefaultFor`, `insertOwnBook`'s
     `timelineEnabled`, `PresetRow.timelineDefault`, `StoryClock.Reading.timeline`, and the client props
     `SessionLorebookReading.timeline`, `SummarizeLoreModal.timeline`, `sessionPageData` `storyTimeline` /
     `setStoryTimeline`, `coalescedRead`.
   - The **time a genre keeps** (`keepsTime`) row (~1770): add the derived default and the **timeline mandate**
     (`GenreDecl.timeline: 'required'`, R3: never bare "timeline" for it), and the **preset's timeline default**
     (`PresetDefaults.timeline`), each with what it is not (not a lock on a session; not the lorebook's switch, which
     alone decides afterwards).
   - If a row for `PresetDefaults` / a preset's pre-fill exists (grep `PresetDefaults`, `defaults.envoys`,
     `genreFields`), add `timeline` there in one clause.
   - **§25 Change ledger**: one new entry at the end, in the style of the two `2026-11-14 (lane timeline-a …)` /
     `(lane timeline-b …)` entries (~4179–4180): "2026-11-14 (lane timeline-c — owner rulings quoted above)", listing
     every new name above and the UI copy (the offer's sentence, button and two second sentences, the read-only line
     variants, Story Minimal's description). "New words only; nothing renamed."
   - Before adding, grep each new name across `src`, the SDK and the schema for collisions (§24 step 2); report any.

## Files owned (edit only these)

`docs/sessions.md`, `docs/genres.md`, `docs/genre-story.md`, `docs/lorebook-time.md`, `NOMENCLATURE.md`.

## Out of scope

Any code or test; `STYLE-GUIDE.md`; other docs (list any that are now wrong under Noticed, not done); SDK guides.

## Stop and ask (in your report) when

A fact above contradicts what a doc says in a way that needs a decision; a new word seems needed beyond those listed.

## Rules

- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You don't build or test in this task.)
- NOMENCLATURE R1 "One word, one meaning"; R3 "Qualify, never abbreviate to the bare noun"; R6 mark provisional
  vocabulary 🚧. "When you add or rename a term, record it in §25 Change ledger in the same change."
- STYLE-GUIDE §10: sentence case; "One name per thing, across the whole flow: the thing you open is a session, never
  a chat"; one installation is a **pub**.
- No other product's name in any file. Never `prettier --write` a directory or glob. Never `git checkout` / `restore`.

## Report

Changed files with a one-line summary each; collisions found; docs now wrong elsewhere; Noticed, not done.
