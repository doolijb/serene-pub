# BRIEF — `timeline-b` worker 6 — Timeline switch: the docs and the NOMENCLATURE rows

Supervisor: lane `timeline-b`. Repo: `/home/jody/github/serene-pub`. Use absolute paths. `NOMENCLATURE.md` (4k+ lines,
14.5k tokens) and the docs are large: read by line range and `grep -n`, never whole. **`NOMENCLATURE.md` is shared:
small edits, re-read the region right before each edit, never reformat, touch only the rows named below and append
one §25 entry.**

- "This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work."
- "Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`." Never `prettier --write` a directory or glob; never `git checkout` or `restore`.
- "Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`."
- "Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'." (You need no `sdk:build`; you run no code at all.)
- You edit prose only. Worker 5 edits code at the same time; you touch no code.

## Files owned (only these)

`docs/lorebook-time.md` · `docs/lorebooks.md` · `NOMENCLATURE.md` (rows ~366 **moment bar**, ~372 **cast member page**,
~393 **Timeline** (a lorebook's switch), and one new §25 entry at the end of the ledger, after the 2026-11-14
timeline-a entry ~4179).

## Rules (quoted from CLAUDE.md, NOMENCLATURE §1/§24, STYLE-GUIDE §10, docs conventions)

- Docs are user-facing behaviour: say what a person sees and does, in the existing voice (second person, short
  sentences, labels in **bold**, quoted sentences in *italics*). It is a **session**, never a chat. No other product's
  name. Provisional words and sentences carry 🚧 as the existing 🚧 lines do.
- NOMENCLATURE R6: "🚧 **Provisional** — designed but not built, so the words may still move" — every new name and
  label below is 🚧. CLAUDE.md: "When you add or rename a term, record it in **§25 Change ledger** in the same
  change." P6 charters: a row states purpose, what it owns, what it does not own (and who does).
- Do not invent behaviour: describe only what is listed below. Where a fact here and the code disagree, the facts here
  are what was built; report anything you can't place.

## What was built (lane timeline-b, 2026-11-14) — the facts to write from

Owner rulings: 2026-11-13 "hide all the extra time management noise in entries and the lorebook when timelines aren't
enabled"; "No history entries for undated lorebooks, maybe scenes only. We can surface a list view purely for scenes,
and add a history divider and link when enabled"; "Switch off, allow, but prompt the user with a recommendation to
clone as a timeless variant instead. Do not provide SDK api for this yet." 2026-11-14 the switch is "a card in Book
settings, with the prompt in place"; a new hand-made lorebook: "Off with offer at session creation, and ask when
created" (this lane built "ask when created" only; the offer at session creation is not built). The timeless copy is
**not** built: write nothing about it.

**Book settings › Timeline card** (owner only; not on a shared book or a provided read-only page). Title 🚧
**Timeline**, help 🚧 *Dates, versions over time, history and a story clock. Turn it off for a world where nothing
needs a date.*, and a switch. Switching on saves at once. Switching off: when the lorebook holds dated versions,
history entries or a set clock (its own or a line's), it asks in place 🚧 *This lorebook has ‹n› dated versions and ‹m›
history entries. With the timeline off they are hidden, not deleted, and sessions read the lorebook as it stands now.*
with **Cancel** and 🚧 **Switch off here**; with none of these it switches off at once. Session notes over a lorebook
show 🚧 *On: these notes follow their lorebook's timeline.* (or *Off: …*) and no switch. With the switch off, the
**Story clock** and **Calendar** editors are not shown in Book settings. A refusal shows in the card.

**New lorebook dialog** (Lorebooks › **New**): on the **Blank** way only, a switch 🚧 **Keep a timeline**, **off** by
default, with 🚧 *Dates, history and a story clock. You can turn it on later in Book settings.* **Start from a starter
lorebook** and **Make a lorebook from this kit** show no switch and make the book as before (say nothing about the
copy's timeline). The start screen's own
**New lorebook** (when starting a session) does not show it yet and still makes a lorebook with a timeline.

**Hidden while the switch is off** (nothing is shown in their place; with it on, everything is as before):
- the **moment bar**; when the lorebook has a second line, the **line chip** stands alone where the bar was (switch
  line, Fork, Compare, Rename, Delete as before); with one line, nothing. The compare view stays. The book is read at
  now: a date in a link is not read.
- the **Time** and **Lives** views in **Show as** (a link to either opens the default view);
- the **History** view in the scope list (and history is not counted in **Everything**); history entries are hidden
  from every list and search in the lorebook, not deleted; a link to the History view or to a history entry opens the
  lorebook's default view; the **History** choice in **New**; **Add the next date in sequence**; every **Compile**
  (*Not yet compiled* and its Compile, **Compile to Entry**, the entry's **Scenes** tab);
- **Save as of** and **Change the base** (an entry's and a cast member's: only **Save** is offered, and saves in
  place), the list of dated changes under an entry and a cast member, **Off for a while…**;
- a link's **When**, and a place link starts undated; a cast member's presences (when they arrive, leave, and how old
  they are while here);
- in the reading line ("what the session reads"), the "as of ‹date›" part;
- the three time chores in **Loose ends**: **Undated history**, **Two history entries on one date**, **A line's own
  history before its fork** (neither listed nor counted).
- Stays: a cast member's **Timeline** tab, listing the scenes they are in, in the order played, with no dates and
  nothing about "later". The roster (who is in the world) stays, at now.

**Scenes**: with the switch off, the **Scenes** view lists the lorebook's scenes in the order they were played, with no
dates and no compile. With it on, as before, plus a **History** row at the end of the Scenes list with the number of
history entries; pressing it opens the History view (its tooltip 🚧 *Open History*).

**Server rule additions** (to the Timeline row and `docs/lorebook-time.md` §"A lorebook's timeline"):
- Setting the lorebook's own clock or calendar is refused: clock with *This lorebook has no timeline, so its story time
  doesn't move.*, calendar with 🚧 *This lorebook has no timeline, so nothing dated is written to it.*
- **Summarize to Lorebook**'s **New** history day is refused with *This lorebook has no timeline, so no history is
  kept.* A keeper's proposed clock move is not offered (refused with the clock sentence).
- A pipeline's change to a history entry keeps the entry's date: the date part is dropped and the rest of the change
  is written.
- **Apply** (the session's **This session only** card): a dated change waits, marked 🚧 *This lorebook has no timeline,
  so nothing dated is written to it.*, with no **Apply to the lorebook**; a history day of the session's notes waits,
  with *This lorebook has no timeline, so no history is kept.* Nothing is applied undated, nothing is dropped; they
  apply once the timeline is on again.
- Open sessions on the lorebook re-read when the switch flips.
- **Export and import** carry the switch: a lorebook with no timeline exports with that said, and imports with no
  timeline; a lorebook with a timeline exports exactly as before (other ways in — the one-file import, the 0.5
  upgrade, provided books — arrive with a timeline as before; the import that overwrites an existing lorebook keeps
  its switch).
- **`lorebooks:create`** takes an optional `timelineEnabled` (absent = on); the New lorebook dialog's Blank way always
  sends it.
- **The one-time pass is registered** (startup task `timeline-switch`, marker `timeline-switch`, after plugins), so on
  the first start after the update each lorebook is set once: it **keeps** its timeline when it holds anything dated
  (a clock, a line, a calendar of its own, a dated change, any history entry, dated or not, …) or when any session —
  archived or not — that reads it, or whose notes it is, plays a genre that keeps story time (Story, the Lair, Dungeon
  Crawler) or a genre that is no longer there; otherwise it is switched **off** (e.g. a hand-made lorebook read only by
  Chat or the Guide sessions, or by none, with nothing dated). Starter lorebooks are never switched by it. Session notes
  over a lorebook copy it. It runs once; a later switch by you stands.

**New names** (record in the Timeline row where they belong, and all in the §25 entry, each 🚧):
`lorebooks:create`'s `timelineEnabled` param; the owner's `lorebooks:get` reply field `timelineCounts`
(`{ datedChanges, historyEntries, clockSet }`, computed by `timelineCountsOf` in `lorebooks/timeline.ts`); the file key
`extensions.serenepub.timelineEnabled` (written only as `false`, no format version change); `TIMELINE_OFF_SENTENCES.dated`;
the startup task `timeline-switch` (now registered; the marker was already recorded); client `BookData.timelineEnabled`
and `bookTimeline()` (`lorebooks/bookData.svelte.ts`, the one value every hide reads); the component `TimelineCard`
(`lorebooks/time/TimelineCard.svelte`); props `NewLorebookDialog.asksTimeline`, `BookSettings.overlaysLorebook` /
`TimelineCard.overlaysLorebook`, `EntryPool.historyCount`; UI labels **Timeline** (the Book settings card), **Keep a
timeline**, **Switch off here**, the Scenes list's **History** row (*Open History*); the sentences quoted above. New
words only; nothing renamed. Use the timeline-a entry (~4179) as the model for the §25 entry's shape.

## Edits

1. `docs/lorebook-time.md` §"A lorebook's timeline" (~9–22): replace the 🚧 "can't be reached from a screen yet"
   paragraph (~22) with how the switch is set (the card and its prompt; the dialog), what the pass did at the update,
   and a "What you won't see" list (the hidden items above, in a person's words), and add the server rule additions to
   the existing bullets. Keep the section's existing bullets true. Elsewhere on the page, add a short "(not with the
   timeline off)" only where a reader would otherwise look for a control that is hidden — at most a few, never a
   rewrite.
2. `docs/lorebooks.md`: the **New** dialog (§"1. Create the book" ~13–17 and §"Creating, importing, duplicating and
   deleting" ~308) gains **Keep a timeline**; §"Finding your way around a book" (~106–142): the History view, Moment
   bar and the three Loose ends chores say they are hidden with the timeline off (link to lorebook-time's section);
   the Book settings list (~130, *"There are no features to switch on: every book can do everything."* is no longer
   true: correct it) gains the Timeline card; the Scenes view's History row; §"Bringing a session's changes into the
   lorebook" (~259) gains the two waiting reasons in one sentence.
3. `NOMENCLATURE.md`: row ~393 **Timeline** — status "built 2026-11-14 (lanes timeline-a, timeline-b)", the pass now
   registered with the corrected rule, the card and the dialog, the hides (one sentence, pointing at
   `docs/lorebook-time.md`), the new names; keep its **Does not own** honest (no timeless copy, no preset or session
   offer yet: lane timeline-c / timeline-d). Row ~366 **moment bar**: one clause, not drawn with the timeline off, the
   line chip alone with a second line. Row ~372 **cast member page**: one clause, the Timeline tab shows its scenes
   without dates with the timeline off. One §25 entry.

## Done means

The three files edited as above; `grep -n "can't be reached from a screen" docs/lorebook-time.md` and
`grep -n "not registered" NOMENCLATURE.md` (for the Timeline row and your entry) find nothing stale about this switch.

## Report — `plans/briefs/REPORT-timeline-b-w6.md` (if the Write tool refuses a report file, put the whole report in your final message)

Changed files with the sections/rows touched; anything in the facts you could not place or that contradicts the
page; **Noticed, not done**.
