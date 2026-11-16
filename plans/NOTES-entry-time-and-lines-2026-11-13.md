# NOTES — the discussion behind `PLAN-entry-time-and-lines-2026-11-14.md`, in the order it happened (2026-11-13 and 14)

A design discussion with the owner on 2026-11-13, written down so it can be ruled on. **Nothing here is built.**
Companion: `plans/PLAN-edit-history-2026-11-13.md` (the edit history; same writes). Held because of this
discussion: correction 1 of `plans/briefs/BRIEF-full-direct.md` (a dated session's change written straight into the
lorebook as a dated change).

## Architecture, consolidated (lead, 2026-11-14) — supersedes the order of the notes below where they differ

The sections after this one are the discussion as it happened. This is the shape it settled into. Lines marked
**ruled** are the owner's; the rest are proposals.

**One sentence.** Filters decide what a reading *may* see; weights decide what it sees *first*. Filters are
deterministic, stored or derived from the story, and core's. Weights are tunable and a genre's.

**Stored (new).**
| Where | What | Status |
|---|---|---|
| Lorebook | **Timeline** on / off | ruled (off for Story Minimal's default book; prompt + timeless copy on switching off; no SDK surface yet) |
| Entry | **Beginning**: Perpetual / Began at ‹date› · **Decay**: Fact / Living + a rate 0–1 | labels and the 0–1 rate ruled |
| Entry | not common knowledge (a secret): read only by those whose Memory says so | proposal |
| Entry version | name, text, typed fields, keywords, from a date (today's dated change, shown as a version) | proposal (keywords per version from scenario 3) |
| Cast version | **Memory**: remembers from / up to (date, line), what it covers, single-entry knows / doesn't know | ruled: advanced fold, per character, core's recall honours it; one mechanism, several displays |
| Entry / cast version / card version | **Edit history** (previous values, who, when; never travels; last 50) | ruled in outline (`PLAN-edit-history-2026-11-13.md`) |
| Session | what a clock moved back past its own writes means (new line / change the past / flashback) | proposal |

**Derived, never stored.** Attendance (the scenes a version was in → which messages and summaries it may see);
encounters (closest a version has ever been to an entry and when, how far now: places, ways, inventories); the
time-traveller chip (a version whose memory is not its body's point); how faded a living entry is for this
reading; familiarity (genre logic, ruled).

**The read path, in order.** 1 line (ancestor chain, fork cuts) → 2 date (the session's, or the speaker's memory
range) → 3 Beginning → 4 Timeline off: skip 2–3 → 5 Memory and secrets (leave out, never "doesn't know" text) →
6 attendance (messages and summaries of scenes the speaker was not in are left out; only where a character has
its own turn) → then weights: match, decay, distance now, familiarity.

**The write path.** Who sets an entry's switches: entry type default (core's or a ruleset's) ← genre ← the
writing step ← a person (ruled). Under Full a session writes straight into the lorebook (built); with a story
date a change is a dated version (held: correction 1 of `BRIEF-full-direct.md`); the turn's undo is the imprint;
every write also lands in the edit history; the story settles when a scene closes (built). The lorebook decides
whether time moves (ruled).

**Lines.** A perpetual entry reads on its line and every line forked from it (true today). A person may move an
entry down the tree as far as its date allows (ruled in outline); a child never moves without its parent
(ruled). Only a branched session must fork.

**Core and genre.** Core stores, shows and applies the filters. A genre or pipeline owns the weights and gets
queries for attendance, encounters and the decay rate. A ruleset's entry types carry the two defaults (ruled).

**Measure before building:** attendance filtering of history (a secret, a character who was not there, with and
without the filter, local model); recency moved onto Decay; the time-delta line for living entries.

**Build order.** 1 Timeline switch, the two entry switches, hide time controls when off · 2 edit history ·
3 versions timeline in the entry and cast forms · 4 what sessions write (dated change, defaults, SDK overrides)
· 5 cast Memory, secrets, attendance filter · 6 recency reads Decay · 7 move down the tree, "could exist here",
bulk edit · 8 encounter queries for genres with places · 9 Scenes list, timeless copy.

**From the research (2026-11-14):** leave unknown content out, never tell the model what a character does not
know; who was present is the rule that lasts; a retrieval cutoff at the character's own point in time is what
stops future knowledge leaking; supersede, never delete; no evidence yet that decay helps; worth copying: a
"they were away for ‹duration›" line on return, ordered learns / never-learns, "out of sync" + repair for
derived data. Benchmarks used one shared context: the message history is the leak, and a narrator that voices
everyone cannot be filtered.

## Simplification pass (lead, 2026-11-14; asked for by the owner: "simplify it without costing anything") — proposals

Checked in code before proposing: the line rule already takes any row's date (`rowReadsOnLine(row, line, date,
moment)` with a `dateOf` callback, `shared/lorebooks/lineReading.ts` ~365–391); a tie already joins a cast member
and an entry and is dated by a history day or scene (`narrative_relationships`: `from_node_id` / `to_node_id` or
`from_entry_id` / `to_entry_id`, `history_entry_id`, `scene_id`; `db/schema.ts` ~5171–5215).

1. **Beginning is not a new field: it is the date of the entry's first version.** No date = perpetual. That is
   the row date history entries already have, opened to every entry type, so "not begun yet" is the date filter
   the line rule already applies. The UI still says *Perpetual / Began at ‹date›* on the first node of the
   timeline. Removes a stored switch and a step of the read path.
2. **Decay is one number.** 0 is a fact; above 0 is living at that rate. The UI still shows *Fact / Living* and a
   rate. Removes the separate switch.
3. **Memory is "this character reads as of": a reading (line + date) of its own**, the same thing a session
   already has. Time travel, a mind in a younger body and a loop are that one value. Amnesia adds one more date:
   *nothing before ‹date›*, applied to events (scenes, history, ties) only. Dropped: the "what it covers" kinds
   (lead's own addition, not asked for). With 1 and 3 the read path is: **pick the reading (the session's or the
   speaker's own), then the rule that already exists.**
4. **Knowing a particular entry is a tie, not a list in Memory.** A cast member's tie to an entry (*has been
   there*, *was told*, plain *knows*) means they know it; a tie of kind *kept from* means they do not. Ties are
   already dated, already on lines, already shown at both ends (the pool on the character and *Known by* on the
   entry are those two ends), already written by sessions with turn undo. A secret is an entry marked not common
   knowledge: read by those tied to it. Removes the knows / doesn't-know store, and "learned it in Year 8" needs
   no new cast version.
5. **Keywords stay on the entry; a version's name is always a trigger at its dates.** That fixes the rename
   leak (scenario 3) without versioned keywords.
6. **The clock moved back past the session's own writes uses the session's existing *On revision*** (overwrite
   or branch). No new setting; "flashback" is the same line, writing at the earlier date. Small cost: no
   separate answer for deleting a turn and for moving the clock.
7. **Out of core, to genres or later:** encounters (distance), familiarity, the "(doesn't know)" hint (dropped
   outright by the research), copy to a sibling line, per-character rewriting of passages.

Not simplified, on purpose: the edit history stays separate from the per-turn undo record (one is the lorebook's
and permanent, the other the session's and deleted on settle; merging them is a large rewrite with real risk);
the Timeline switch stays stored (the owner ruled a book may be switched off while it holds dated things).

What is left to store: the Timeline switch; one date and one number on an entry; a not-common-knowledge mark on
an entry; a reading and one date on a cast version; the edit history. Everything else is derived or already
exists.

## Ten abuses of the simplified design (lead, 2026-11-14; asked for by the owner) — reasoning, nothing run

| # | The abuse | Verdict | What it shows |
|---|---|---|---|
| A1 | A routine rewrites one entry every scene for 500 scenes; several changes land on the same story day; someone dates a version before the entry's beginning | **Breaks** | Versions pile up, several per date. Rule: **one version per entry, line and date** (a second write that day updates it; the edit history keeps the steps). A version cannot be dated before the beginning: refused with a sentence. |
| A2 | Fifty routine rewrites push a person's own text out of the 50-row edit history | **Breaks** | The cap must never evict the newest row a person wrote. |
| A3 | "Next day" pressed 365 times, or a 100-year skip: everything living fades at once, including what was said last round | **Breaks** | Decay takes the fresher of two clocks: rounds since it last came up, or story time. A negative delta (clock moved back) counts as zero. Rates outside 0–1 from a plugin are clamped with a validation warning. |
| A4 | One scene that never closes; a character who joins late "attended" all of it | **Breaks** | Attendance must be per message (who was seated and not benched when it was written), with scenes only as grouping. Benching then doubles as leaving the room. To verify: that seats record when they joined and were benched. |
| A5 | A routine draws a *knows* tie for everything; the relationship graph and the ties in the prompt fill with them | **Breaks the "free" claim of knowledge-as-ties** | Knowledge ties need a kind the graph, the tie ranking and the prompt's ties leave out unless they carry words. Still far less than a new store. |
| A6 | Every entry marked not common knowledge, no ties: characters know nothing | Holds, silently | Deterministic but invisible. The entry's fire test and the pool must say *not known by ‹name›*; bulk-marking warns with the count. |
| A7 | A character's "reads as of" names a line that is then deleted | Holds with a rule | The reading falls back to the line that line forked from, as sessions already do, and the member page says so. |
| A8 | Bulk "move down" on 500 entries, permanently, by mistake | Holds, dangerously | One confirmation naming the count, the parents taken along and the lines that will start reading them; the edit history records where each came from. Whether a move can be taken back while nothing on the target depends on it is a ★. |
| A9 | A session guest clears the edit history, switches the timeline off, moves entries, marks things secret | Holds only with a rule | Permanent and lorebook-wide actions (clear history, Timeline, move down, bulk edit, secret marks) are the lorebook owner's alone; a session's people keep only what they have today. |
| A10 | A loop genre with *On revision: branch*: 200 lines after 200 loops | At risk | The line chain is walked on every read and listed in the dropdown and the "could exist here" toggle. To check: the cost at depth 200 and whether a depth limit exists; lists need search. |

Also from the walk: switching the timeline on after playing with it off leaves entries written meanwhile undated
(they exist at every date); a Loose ends row *written while the timeline was off* (from the edit history) lets
the person date them in bulk.

## The owner's words

- "Maybe we can add a toggle to lorebook entries. Persistant | Evolving (feel free to propose better terms).
  Persistant ignores the timeline and is a fact of the world, no matter how far back the timeline extends, it
  always exists, but evolving changes can still be applied. Evolving has a beginning, and possibly an end."
- "Maybe ending is the wrong term. Perhaps a 'decay' toggle and rate on evolving entries. So maybe something more
  like — Decay: Fact | Living · Beginning: Perpetual | Began at date."
- "Maybe we can update recency to use the new decay rate and switch."
- "We should determine what entry types are created as perpetual vs living by default and also allow overrides in
  the SDK so genres/pipelines etc can override our sensible defaults." · "We can also add the perpetual/living
  parameter to the entry types defined in rulesets."
- "Lets say, perpetual entries always sit on the earliest point on their branch (i.e. superficially on the
  earliest date before the split). Maybe a dropdown and button to permanently move the entry down the tree. The
  dropdown shows the current and parents in descending order." ("Down" = toward main.)
- "We should also have a toggle in the entries list to show entries that could theoritically exist in the current
  branch or time. Show the cards muted and full opacity on hover with a control to move them as well."
- "We also need a toggle to show checkboxes, toggle multiple entries and perform bulk edits."

## What is true today (checked 2026-11-13)

- An entry has no beginning: every non-history entry is undated and exists at every date; dated changes
  (`entry_amendments`) apply on top; **Off for a while…** is two amendments (`docs/lorebook-time.md` ~69).
  `lorebook_entries` deliberately has no validity columns (`db/schema.ts` ~9136–9144 comment).
- The line rule already says what the owner asked for (`src/lib/shared/lorebooks/lineReading.ts` header): a line
  reads its own rows whatever their date, an ancestor's rows dated at or before the fork cut, never a sibling's;
  "An UNDATED row is never cut … it reads on every line whose chain contains its branch." So a perpetual entry on
  a branch is read by that branch and the lines forked from it, at every date; a begun entry on a parent is read
  by a branch only when it began on or before the fork date.
- "Nothing ever merges between lines, by design. To take something across, read the line it's on and write it on
  the other." (`docs/lorebook-time.md` ~172). Moving an entry down softens this.
- Recall has a recency lift per pipeline, counted in messages (`pipelines/ranking/semantic.ts` ~106–116,
  `weights.ts` ~537–565 `recencyBoost` / `recencyDecay`; mention recency `ranking/signals.ts` ~1054).
- The entries list has no multi-select and no bulk action; nothing shows entries of other lines or later dates.
- Entry types: core World lore, Character lore, Place, Item, History, plus types rulesets declare
  (`sdk/src/descriptors.ts`); a genre names entry types it plays best with (`sdk/src/fit.ts`).

## Proposed shape (lead's proposals; every line is an open ★ until the owner rules)

**A. Two switches on every entry.**
- **Beginning:** *Perpetual* (exists at every date; every entry today) · *Began at ‹date›* (not read before it).
- **Decay:** *Fact* (never fades) · *Living* (recalled less as the story moves on without it; three named
  speeds, no number; never deleted, never switched off; a name or keyword still recalls it; pinned ignores it;
  measured in story time when the session has a clock, else in rounds; the entry says *Fading: last came up in
  ‹date›*).
- The hard stop stays **Off for a while…**. Dated changes apply to either kind.

**B. Who sets them (later wins; the model never chooses).** 1 the entry type's default (core's or a ruleset's) →
2 the genre's override for that type → 3 the writing step's own value → 4 a person's setting on the entry, which
nothing overwrites. A hand-made entry is perpetual and a fact. Proposed core defaults when a dated session writes:
World lore, Place, Character lore = perpetual fact; Item = began, fact; History day = its own date, living (slow);
Lead = began, living (not verified how leads are declared). The Story sweep's "what changed" duty would say began +
living at step level. SDK: two optional defaults on an entry type declaration (core and ruleset), a genre override
per type, two optional values on the lore-writing outlet; all additive; new published names need the owner.

**C. What a session's write is.** With a clock: a change to an existing entry is a dated change (this is the held
correction 1); a new entry takes its beginning from B. Without a clock: perpetual, in place. Only a person
changes the base.

**D. Recency reads the switch.** A living entry gets the lift and loses it at its rate; a fact gets no lift and no
fade. Cost: every existing entry becomes a fact and loses today's lift. Measure recall on a real lorebook before
and after; keep today's behaviour for facts if they need it.

**E. Moving a perpetual entry down the tree.** On the entry: a line dropdown (current line, then each parent in
order, ending at main) and **Move**; permanent; a person's action only, never automatic; perpetual entries only;
the entry itself moves, its branch-written dated changes and links stay; a name clash on the target refuses with a
sentence; a confirmation names the lines that will start reading it.
Owner, later: "Something similar can be done on living entries on branches as well. If someone says this exists at
x date that's before the branch, it could theoretically be pulled down as well." So **a begun entry moves down
too, as far as its date allows**: to a parent when it began on or before the fork date from that parent, and
further down only while the same holds at each fork on the way. The dropdown lists every parent; one the date
does not reach is shown disabled with the reason (*Began in Year 5; ‹line› left ‹parent› at Year 3*). After the
move, lines that left the target after the entry's date read it; lines that left before do not. ("Perpetual
only" above is replaced by this.)

**F. Entries list: show what could exist here.** A toggle that also lists entries this line or date does not
read but could: lead's reading = entries of lines forked from this one (movable down to it) and entries that begin
after the date being read. Muted cards, full opacity on hover, each with the move control. (Sibling lines' entries
cannot move here by going down; whether to list them is a ★.)

**G. Entries list: bulk edit.** A toggle that shows checkboxes; select several; act once. Proposed actions:
Beginning, Decay, Move down, Pinned / Off / Archive, Delete. (Which actions is a ★.)

**H. Versions in the entry form.** Owner: "For living entries and when making edits to existing perpetual
entries, we should show the option to change the effective date of that version. Save edits that version, but also
need a button to save as a new dated version. It would be neat to be able to toggle off undated history edits and
then navigate the dated versions like a vertical timeline, adding new versions before or after. Not sure how to
handle that given we also have the global entry settings like keywords, pinned, decay, etc." Lead's proposal:
- One model everywhere in a lorebook: **a thing has versions over story time, and each version has its own edit
  history.** Entry: the first version (from the beginning, or from its *Began at* date) plus each dated change
  shown as a version. Cast member: its versions (already). Card: its numbered versions (already).
- The form has two zones. **The entry** (true of every version, shown once, outside the timeline): entry type,
  line, parent, Beginning, Decay, pinned, off, archive, and whatever a dated change cannot carry today (to
  verify: keywords). **The version** (what it says from a date): name, text, typed fields, and the version's
  date.
- A vertical timeline of versions beside the fields: select one to edit it; **Save** edits that version;
  **Save as a new version at ‹date›** adds one; add before or after; change a version's date in place. Edits
  (the edit history) show as small rows under their version, with a toggle to hide them.
- Storage stays as it is: a dated change holds only the fields that differ; the form shows it as a whole
  version. This replaces today's **Save as of ‹date›** / **Change the base** pair and the *Amendments* list.

**I. No time noise without a timeline.** Owner: "We also need to make sure to hide all the extra time management
noise in entries and the lorebook when timelines aren't enabled in the lorebook." Today there is no such switch:
time is implicit ("None of this is required: a book with no dates works exactly as described",
`docs/lorebook-time.md` ~3) and its controls always show. Lead's proposal: one per-lorebook switch, 🚧
**Timeline**, off for a new lorebook, already on for a book that holds anything dated, a set clock or a second
line (boot pass, second boot changes nothing). Off hides: the moment bar and line chip, Beginning, version dates
and the versions timeline (the edit history stays), **Off for a while…**, calendar and clock, the move-down
control, the "could exist here" toggle. Off also means sessions on the book write undated and Decay counts
rounds. Data is never deleted by switching off. A genre that plays with time says it expects a timeline and the
book offers to switch it on (genres expect, never lock).
**Ruled by the owner (2026-11-13):** "No history entries for undated lorebooks, maybe scenes only. We can surface
a list view purely for scenes, and add a history divider and link when enabled." · "Switch off, allow, but prompt
the user with a recommendation to clone as a timeless variant instead. Do not provide SDK api for this yet."
Lead's reading: with the timeline off there is no History entry type and no compiling into history; the lorebook
has a **Scenes** list of its own; with the timeline on, that list gains a History divider and a link to the
history entries. Switching off a book that holds dated things is allowed after a prompt that recommends making a
timeless copy instead (🚧 a copy that keeps each entry as it reads now on the line being read, without dates,
versions or other lines; scenes kept; history entries left out: **confirmed by the owner, "Sounds good"**, with history entries a switched-off book already holds hidden and kept). No SDK surface for the switch or the
timeless copy yet. Still open: what a switched-off book does with history entries it already holds (hidden and
kept, by the "never deletes" rule above).

**J. Which presets use a timeline (ruled by the owner, 2026-11-13).** "By default, Story Minimal will use an
undated book. Messages will just display real time. All other Story presets will continue defaulting to timelined
storybooks." Lead's reading: a session started on Story Minimal gets notes with the timeline off, sets no story
clock, and its messages show the real time they were written; Story Living and Rule Based start with the timeline
on, as today. **Ruled:** on a lorebook whose timeline is on, Minimal reads it at "now", writes undated and never
switches the book's timeline off ("That works, in that case, minimal won't have to progress time between
rounds"): Minimal never advances a story clock. Open: Chat, Guide, Lair, Dungeon Crawler (proposal: Chat and Guide
undated; Lair and Dungeon Crawler timelined as today).

**Then revised by the owner:** "Actually the time incriment should be a property of whether the lorebook has it's own
calendar or if the session is following real time." Lead's reading (to confirm; it changes the ruling just above):
the lorebook decides, never the preset. A session on a lorebook with a timeline advances story time each round,
whatever its preset, Minimal included, and writes dated; a session on a lorebook without one follows real time,
advances nothing and its messages show real time. The preset only decides which kind of lorebook a new session
gets by default.

## Gaps and improvements the lead sees (2026-11-13; proposals, none ruled)

1. **Lines without a timeline.** A branch session forks a line on its first write (`lineOnFirstWrite`), so an
   undated lorebook can still get lines. Lines cannot be hidden by the Timeline switch; show the line chip once a
   second line exists, whatever the switch says. Fork dates and the date half of "move down" need the timeline.
2. **"Last came up" cannot live on the entry.** Two sessions read one lorebook at different points. Decay is
   derived per reading: the later of the entry's newest version the session reads and that session's last mention
   of it (the ranker already tracks mentions). Nothing stored, nothing shared between sessions.
3. **Tell the model how old a living entry is.** A living entry in the prompt carries *(as of ‹date›)* so a stale
   mood is read as possibly outdated. Measure with the local model before adopting.
4. **Parents and children when moving down.** A child moved below the line its parent sits on would lose its
   parent on the target line: refuse with a sentence, or offer to move the parent with it.
5. **Cast members and stats.** The plan covers entries. Cast members have dated versions and presences, stats
   their own dating: with the timeline off those controls must hide too, and it is undecided whether cast members
   get Beginning (close to a presence) or Decay.
6. **What travels.** Beginning, Decay and the Timeline switch are world data: they travel on duplicate, export,
   starters and the timeless copy (which resets Beginning). The edit history never does.
7. **Decay with no timeline: rounds, not real time.** A story paused for a week should not have faded.
8. **Keep the form quiet.** Beginning and Decay sit in one collapsed row that shows its values in words and opens
   on demand; the defaults should make it rare to open.
9. **A move while a routine may update the entry** is refused with the same earmark sentence as a save.
10. **A deleted entry takes its edit history with it.** No trash is proposed; say so in the delete confirmation.

**Owner on gap 4 (ruled, 2026-11-13):** "When moving a child before the parent, prompt an approval to move the
parent, don't allow children to be moved down without the parent."

**Owner on gap 5:** "That's tough, any ideas? Should we have a global lorebook relationship decay setting?
Preferably, (with default core logic), cast can more easily recall lore about characters they know well."
Lead's idea (unruled; facts to verify: that scenes record their cast and character lore records whom it is
about): no new setting. **Familiarity** is derived per speaker: the speaking character and the person an entry is
about share a tie and/or scenes; the more scenes shared, the better known. Lore about someone the speaker knows
well is recalled more readily and its decay runs slower; lore about a stranger comes up only when named. Cast
members themselves get no Decay (those in the scene are always read) and no second Beginning (a presence already
says when someone is in the world). Ties keep their ruled order (2026-09-10 Q1: presence, then speaker, then
recency as a rank; `pipelines/ranking/relationshipRanking.ts`, which rejected a half-life as "a constant nobody
has an opinion about": named speeds and story time answer that objection, a wall-clock age would not). Stats keep
their dating and hide with the timeline off.

## Ruled by the owner in one message (2026-11-13, later)

Answering the lead's numbered list of gaps and improvements and the open decisions:
- "5: A time delta is better I think" — a living entry in the prompt says how long ago, not a date (*3 years
  ago*, not *as of Year 7*).
- "6. Perhaps a value between 0 and 1, core by default will use a reasonable multiplier against that. Modders can
  query and calculate against that number how ever they want, or ignore it out-right." Lead's reading: the decay
  rate is stored as one number from 0 to 1 on the entry (this replaces "three named speeds"); core turns it into
  a fade with its own multiplier, in story time or rounds; the SDK exposes the number.
- "For minimal and time incriment, yes, as it does today." — the lorebook decides; Minimal on a timelined
  lorebook advances story time.
- "Yes on labels." — *Beginning: Perpetual | Began at ‹date›* and *Decay: Fact | Living*.
- "4. We can just make it genre/pipeline logic then, no need to mandate it in core then. Need to make sure we are
  measuring that version of the character against scenes that version of the character has been in. A character
  that goes back in time may know more about that character than the other that doesn't remember, the tough part
  is how to make the model understand it without overbuilding and complicating the context template." —
  familiarity is not core: it is something a genre or pipeline computes (core offers what it needs to query),
  measured per character **version** against the scenes that version was in. How the model is told is open.

## The plan walked through ten hard uses (lead, 2026-11-13; asked for by the owner before moving forward)

| # | What the person does | Verdict | What it shows |
|---|---|---|---|
| 1 | Time travel: someone leaves Year 9 and arrives in Year 3 | **Breaks** | At Year 3 nothing that began later is read, so the traveller's knowledge of the future never reaches the prompt. Needs a reading date per character (S1). |
| 2 | A prequel session at Year 1 after the story was played to Year 9 | **Breaks quietly** | A new Year 1 version of the inn sits before a Year 7 version that was written as whole text without it: from Year 7 on the Year 1 fact is gone (S2). |
| 3 | Two campaigns on one lorebook, at Year 3 and Year 9, both under Full | Holds | Begun entries stay unseen at Year 3; decay is per session; the earmark covers the same entry at once. A perpetual fact found at Year 9 shows at Year 3 at once: intended, but it can spoil. |
| 4 | Two what-if branches; a discovery on one is wanted on the other | Partly | Moving down covers what predates the split. Something that began after the split cannot reach the sibling (S4). |
| 5 | A 2,000-entry epic; a rumour from 300 rounds ago is called back in other words | At risk | A name recalls it; a paraphrase must beat the fade. Decay needs a floor so a strong meaning match still wins (S5). |
| 6 | A timeless Minimal book is turned into a dated saga | Partly | Switching the timeline on works; every entry is perpetual and every scene undated. Needs a way to date scenes and entries in bulk (S6). |
| 7 | A city is renamed in Year 7 | **Breaks** | A version can change the name, but keywords belong to the entry: the new name fires at Year 3, the old one after Year 7 (S3). |
| 8 | A ruleset's Quest (began, living) is completed, then the player goes Back | Holds, once built | Completion is a dated version; Back must take a dated version written straight in: that is the held correction 1. |
| 9 | A secret: only the traitor knows; others believe a false rumour | Not covered | The plan models when and how long, not who knows what. Familiarity is who knows whom. Same missing piece as 1 (S1). |
| 10 | The chapel burns in Year 7 and is remembered in Year 9 | Holds, with a trap | A version (*a ruin*) is right. **Off for a while…** makes the story forget it ever existed. Sessions must never switch off; the control's sentence should say so. |

**What the walk adds (proposals):**
- **S1 What a character knows.** One concept answers 1 and 9: lore can be *a person's* (filed under them: already
  possible), and a version of a cast member can carry **where they came from** (a date on their line). A genre's
  pipeline may then read lore for that character as of that date as well as the scene's. Core stores and shows
  it; using it is genre logic.
- **S2 Later versions do not inherit an inserted earlier one.** When a version is added before existing ones,
  the timeline marks each later version *written before this was added* and offers to open it; nothing is
  rewritten automatically.
- **S3 Name and keywords belong to the version.** Otherwise a rename leaks across time.
- **S4 Copy to a line.** For what began after a split: a copy onto another line (a second entry, by hand), since
  a move cannot be right.
- **S5 A floor under decay.** Fade lowers a living entry's score but never below what a strong meaning match
  can overcome; measured.
- **S6 Dating in bulk.** Bulk edit gains "set Beginning" (already proposed) and scenes can be dated in bulk when
  a timeline is switched on.
- **S7 The copy on Off for a while…** says what it does to the story's memory.

**Time traveller mark (owner: "maybe we can somehow flag in metadata when a cast member on the timeline/session
is a time traveler").** Already half there: a cast **presence** says "this member, at this point of their life,
is in the world from this date until that one", with a personal position (`cast_presences`, `db/schema.ts`
~9458–9480), and two overlapping presences are "two of somebody". So it can be **derived**: a member is a time
traveller on a line when a presence with a later personal position stands at an earlier date than another of
theirs, or two overlap. Proposal: derive it, show it as a chip on the member and the seat, expose it to
pipelines as a fact on the seated member together with S1's "came from" date; no hand-set flag unless deriving
proves too weak.

**Owner on time travel (2026-11-13):** "time traveling also has two aspects (maybe more if you can think of any).
1. The cast members memory travels, they get a younger body (only possible if they were born by the new date)
2. The cast member travels with their memory and their current body, possible to travel into the future, or
before they were born (really any time)". Lead's proposal (unruled): a seated member has a **body** (which
version of them stands there: looks, age, stats) and a **memory** (up to which point of their life, on which
line, they remember). Normally the two are the same and nothing is stored or shown. Kind 1 = the body is their
own version at the destination date, the memory is from later; one of them in the room; refused with a sentence
when they have no version at that date. Kind 2 = body and memory both from the origin; allowed at any date;
their native self, if alive then, is a second person in the room (overlapping presences already allow this).
Further cases the same two coordinates cover: a time loop (the world resets, one memory keeps growing: the
memory must name a **line** as well as a date, since each loop is a branch); memory loss (memory earlier than
body); foreknowledge without travel (a prophecy, a letter from the future: lore made a person's own, S1).
Not covered and not proposed now: a mind in someone else's body (memory of one member, body of another).
Whether a traveller's changes fork a new line or rewrite the same one stays the person's choice (fork at the
arrival date). Core stores and shows the two coordinates and derives the "time traveller" chip from them; what
recall does with the memory coordinate (S1's reading date, familiarity counted over the scenes that memory
lived) is genre and pipeline logic.

**Owner on branches and dated behaviour (2026-11-13):** "At what point do we have to mandate branches?" Lead's
answer (unruled): only a branched session must fork (already enforced). When a session's story clock moves back
past things that session already wrote, a choice is required, never made silently: a new line from that date;
the same line, changing the past (later versions marked); or a flashback that writes nothing dated there. A
genre may state its default; it is the story-time counterpart of the session's **On revision**.
"Should we have a behavior panel with settings that toggle on/off etc at certain points? I.E. year 16, disable
recall of all previous scenes, history entries, relationships, etc. I.E. year 17 (character gets memory back),
enable them all again." Lead's proposal (unruled): no separate panel. A cast member's versions are already
dated, so the switches live on the version, in one group **Memory**: a window (*remembers from ‹date›*,
*remembers up to ‹date›*, on a line; empty = everything), which is the same thing as the memory coordinate of the
time-travel proposal; optionally what kinds it covers (scenes, history, ties, lore about others) for "knows your
face but not why". Year 16: a version whose memory starts at Year 16. Year 17: a version with the window
cleared. Open: whether the owner meant one character or the whole session; whether core's own recall steps
honour the window (lead: yes, it is a person's explicit setting and plain filtering) or only genres do.

**Ruled by the owner (2026-11-13):** on the Memory group and the two questions (one character; core's recall
honours the window): "That works, make it an advanced fold on the cast member. Also provide a vertical time view
like i suggested for other entries." So: **Memory** is an advanced fold on the cast member's version (lead's
assumption: behind the per-user **Show advanced controls**, off by default, ruled 2026-11-10), per character,
honoured by core's own recall; the cast member page gets the same vertical versions timeline as entries (part H),
with the edit history under each version.
"Maybe the character knowledge could have a 'pool' view where entries can be dragged in and out." Lead's proposal
(unruled): by default a character knows whatever their memory window lets the story read; the pool stores only
exceptions, per version: *always knows* (dragged in: foreknowledge, a letter from the future) and *never knows*
(dragged out: a secret). One store, two views: the pool on the character, and *Known by* on the entry (*everyone*
/ *everyone except…* / *only…*), which is the natural place to mark a secret. Search, the bulk checkboxes and a
button on every row beside drag (keyboard and phones). This is S1 "what a character knows" made concrete, and
answers scenario 7 (the traitor's secret).

**Owner (2026-11-13):** "I think we need to simplify that to one mechanism though we can display it in different
ways. How-ever relation to entries, i.e. (I've been there) is an exception". Lead's reading (to confirm): **one
stored thing, a cast version's Memory**, holds everything about what that version knows: the window (from / up
to, line), what it covers, and the single-entry exceptions (knows / doesn't know). The Memory fold, the pool and
an entry's *Known by* are three displays of that one record; nothing else stores knowledge. Familiarity stays
derived and genre-side. **A character's relation to an entry** (*has been there*, *owns it*) is not part of
Memory: it stays a tie between the cast member and the entry, which the lorebook already has, and the model
reads it as a sentence. Open: whether a tie to an entry also counts as knowing it.

**Owner (2026-11-13), an alternative idea:** "Measuring how close an entry has been to the character, and
measuring how distant an entry is to them currently. The character has been in the parent location. The
character's location is 10 nodes away now. But another challenge... how do we cheaply measure if one character is
sharing information about an entry verbally to another? How does one character know or consider what another
character does or doesn't know?" Lead's proposal (unruled):
- Two different signals. **Been near** (the past: the version was in a scene at the entry's place, its parent or
  a few steps away) is about *knowing*. **Far now** (steps from where they stand to the entry's place) is about
  *relevance*, a recall weight. Both are graph walks over places, parents and ways; only entries that have a
  place get them; genre logic over core queries.
- **Heard it.** No model call: when a message names an entry (the name/keyword mention the ranker already
  detects), every character present in that scene or channel has heard of it.
- **Common knowledge is the default.** An entry is *Known by: everyone* unless it is set to *those who learned
  it*; only then is knowing worked out, as any of: marked by hand, a tie to it, been near, heard it; minus a
  hand "doesn't know"; inside the version's memory range. Each derived reason is shown (*heard in ‹scene›*,
  *was at ‹place›*); nothing derived is stored.
- **Considering what others know.** No simulation: beside a recalled entry that someone present does not know,
  the speaker's prompt says so in a few words (*Nell doesn't know this*), capped, only for entries not common
  knowledge. Measure with the local model before adopting.
- Order if built: by hand + tie + heard first; place distance for genres with a place graph (the Lair, Dungeon
  Crawler) after.

**Owner (2026-11-13), maturing it:** "The x2 distance tracking is cheap, we can derive a time stamp too if we ever
need to add a time delta to the context. Items seen would be important too, in inventory, on another character
are two other distance measures. Not confident in the information sharing though. How granular someones
understanding might be, automatically informing cast members if another cast doesn't know something. How to
handle 'secrets' or where they get stored. What if a cast member doesn't know another cast member knows. etc."
Lead's matured proposal (unruled), in three layers by confidence. It **withdraws** the automatic "heard it at a
mention" rule and any automatic working-out of who knows an entry:
1. **Encounters (derived, cheap).** For a version of a character and an entry: the closest they have ever been
   and when, and how far it is now. Places: steps over parents and ways from the scenes the version attended.
   Items: held (their inventory), on someone they are with, lying in a place they are in or were in. Nothing
   stored; the "when" gives a time delta if the prompt ever needs one. To verify: how an inventory row names an
   item entry (`docs/stats-and-states.md` ~10, ~100; `db/schema.ts` ~10690).
2. **Attended scenes (already recorded).** What a character witnessed or was told is the scenes that version
   was in: scenes record their cast, and scene summaries exist. Told on-page and recent: the model already sees
   the messages. Told long ago: the scene's summary carries it in prose, at whatever granularity the summary
   has. For a model that voices one character, recall gives it the summaries of scenes it attended; for a
   narrator voicing everyone, each recalled summary is prefixed with who was present, and the model can work out
   who knows what, second-order included, from that. No entry-level bookkeeping.
3. **Secrets (explicit only).** An entry set by hand, or by a genre's own step, to *Known by: only…*, stored as
   the exceptions of the one Memory record. The only place a "‹name› doesn't know this" hint is given to the
   model. Second-order knowledge is not modelled: the secret's own text says who believes what.

## Migration and data

New stored facts on `lorebook_entries` (beginning date, decay kind and rate) need a generated migration; defaults
= perpetual + fact, so a second boot changes nothing and existing books read as today (except D). Highest index
was 0159 on 2026-11-13 (another session's): re-read at build time.

## ★ for the owner

1. Terms: the owner's *Decay: Fact | Living*, *Beginning: Perpetual | Began at ‹date›* as the UI labels?
2. Decay = recalled less only (never unread)? Story time or rounds? Named speeds?
3. The defaults table in B, and the layering order.
4. D: move recency onto the entry even though existing facts lose the lift, pending a measurement?
5. E: softening "Nothing ever merges between lines"; perpetual only; no way back.
6. F: what "could theoretically exist" covers (child lines; later dates; siblings?).
7. G: which bulk actions.
8. Build order against the edit history and the held dated change.
