# PLAN (design ruled 2026-11-14; no lane is a go yet) — when an entry exists, how it fades, who knows it, which lines read it (2026-11-14)

**Nothing here is built and nothing is a go.** Owner rulings are quoted with their date; everything else is the
lead's proposal and carries a ★ number in §8. The discussion in the order it happened, the two scenario walks and
the research lessons are in `plans/NOTES-entry-time-and-lines-2026-11-13.md`. Companion:
`plans/PLAN-edit-history-2026-11-13.md` (lane T3). Held because of this plan: correction 1 of
`plans/briefs/BRIEF-full-direct.md` (lane T5 here). UI options: the page *Lorebook time screens*,
https://claude.ai/code/artifact/8b7a7a46-e8d2-4727-94ec-24b52a3e093d (private to the owner; not in the repo).

## 1. What the owner ruled (2026-11-13 and 14)

- Two properties of an entry: "Decay: Fact | Living" and "Beginning: Perpetual | Began at date"; labels: "Yes on
  labels." The decay rate: "a value between 0 and 1, core by default will use a reasonable multiplier against
  that. Modders can query and calculate against that number how ever they want, or ignore it out-right."
- "Maybe we can update recency to use the new decay rate and switch." A living entry's age in the prompt: "A time
  delta is better I think".
- Defaults: "determine what entry types are created as perpetual vs living by default and also allow overrides in
  the SDK so genres/pipelines etc can override our sensible defaults"; "add the perpetual/living parameter to the
  entry types defined in rulesets".
- Lines: "perpetual entries always sit on the earliest point on their branch … a dropdown and button to
  permanently move the entry down the tree. The dropdown shows the current and parents in descending order"
  ("down" = toward main); an entry dated before the split "could theoritically be pulled down as well"; "When
  moving a child before the parent, prompt an approval to move the parent, don't allow children to be moved down
  without the parent."
- Lists: "a toggle in the entries list to show entries that could theoritically exist in the current branch or
  time. Show the cards muted and full opacity on hover with a control to move them"; "a toggle to show
  checkboxes, toggle multiple entries and perform bulk edits".
- Versions: "show the option to change the effective date of that version. Save edits that version, but also need
  a button to save as a new dated version"; "toggle off undated history edits and then navigate the dated
  versions like a vertical timeline, adding new versions before or after". Cast: "provide a vertical time view
  like i suggested for other entries".
- Timeline off: "hide all the extra time management noise in entries and the lorebook when timelines aren't
  enabled"; "No history entries for undated lorebooks, maybe scenes only. We can surface a list view purely for
  scenes, and add a history divider and link when enabled"; "Switch off, allow, but prompt the user with a
  recommendation to clone as a timeless variant instead. Do not provide SDK api for this yet"; the timeless copy
  as the lead described it: "Sounds good."
- Presets and time: "By default, Story Minimal will use an undated book. Messages will just display real time.
  All other Story presets will continue defaulting to timelined storybooks"; "the time incriment should be a
  property of whether the lorebook has it's own calendar or if the session is following real time"; Minimal on a
  timelined lorebook advances story time "as it does today".
- Cast memory: the Memory group on a cast version: "That works, make it an advanced fold on the cast member"
  (per character; core's recall honours it). "I think we need to simplify that to one mechanism though we can
  display it in different ways. How-ever relation to entries, i.e. (I've been there) is an exception".
- Familiarity: "We can just make it genre/pipeline logic then, no need to mandate it in core … measuring that
  version of the character against scenes that version of the character has been in."
- Distances: "Measuring how close an entry has been to the character, and measuring how distant an entry is to
  them currently … The x2 distance tracking is cheap, we can derive a time stamp too … Items seen would be
  important too, in inventory, on another character are two other distance measures. Not confident in the
  information sharing though."
- Edit history: agreed in outline, entries then cast then cards, "card edit history should be per version"
  (companion plan).

## 2. The design on one page

**Filters decide what a reading may see; weights decide what it sees first.** Filters are deterministic and
core's. Weights are numbers core exposes and a genre or pipeline uses.

- **An entry is a list of versions on a timeline.** The first version's date is its Beginning: no date =
  *Perpetual*, a date = *Began at ‹date›*. Later versions are today's dated changes. Each version has its edit
  history under it.
- **Decay is one number, 0 to 1.** 0 = *Fact*; above 0 = *Living* at that rate.
- **A character may read as of its own point**: a cast version's **Memory** is a reading (line and date) plus
  one optional date, *nothing before*, that applies to events. Time travel, a mind in a younger body, a time
  loop and amnesia are these two values.
- **Knowing a particular entry is a tie** between the cast member and the entry (*has been there*, *was told*,
  *knows*; *kept from* for the opposite). An entry marked **not common knowledge** is read only by those tied to
  it. The pool on the character and *Known by* on the entry are the two ends of the same ties.
- **What a character saw of the story** is the messages and summaries it was present for. Unknown content is
  left out of the prompt; the model is never told what a character does not know.
- **Two distances**, each with a time: the closest a version has ever been to an entry, and how far it is now.
  Core works them out and shows them; genres weight by them.
- **A lorebook's Timeline switch** turns all of the time controls on or off. The lorebook decides whether story
  time moves; the preset only picks the default for a new session's lorebook.
- **Lines:** an entry reads on its line and the lines forked from it, at every date it exists. A person may move
  one down the tree as far as its date allows.

## 3. Data: what is stored, what exists already, what is derived

| Thing | Stored how | New? |
|---|---|---|
| Timeline on / off | a flag on the lorebook | **new** (migration) |
| Beginning | the entry's own date parts (`year`, `month`, `day`), as history entries carry them today; never set by a dated change (`ENTRY_DATE_PARTS`, `shared/lorebooks/amendments.ts` ~265) | reuse; to verify that `loadEntryDates` (`server/state/reading.ts`) reads them for every entry type |
| Decay rate | one number on the entry | **new** (migration) |
| Not common knowledge | a flag on the entry | **new** (migration) |
| Versions | `entry_amendments`; a dated change may already set name, content, keywords, pinned, off, archived, parent and typed fields, never the entry type or the date parts (`cleanFields`, `sockets/amendments.ts` ~941–1004) | exists |
| Cast Memory | a reading (line, date) and *nothing before* (date) on a `character_versions` row | **new** (migration) |
| Knowledge ties | `narrative_relationships` with a cast end and an entry end, dated by history day or scene (`db/schema.ts` ~5171–5215), with a kind the graph and the prompt's ties leave out | reuse + one kind |
| Who was present for a message | **not derivable today**: seats record no join or bench history (`session_characters`, `session_personas`: `isActive`, `removedAt` only); scenes record their cast as `scene_characters` (participant / mentioned) | **new stored fact** (★5) |
| Been there / has held | ties written by core when a scene closes, from the location stat (`core:slot/location@1`, as of a message via `scenePlaceOf`, `scenes/liveScenes.ts` ~537–597) and inventories; needed because settling compacts the stat ledger (`sessions/settle.ts` ~186–200) | reuse of ties |
| Far now | derived: the location stat now, ways (`narrative_relationships` entry ↔ entry) and parents (`anchor_entry_id`); only one-hop walks exist today (`withinReach`, `pipelines/prompt/adventureContext.ts` ~203), so a step-count walk is **new code** | derived |
| Item distance | derived from `itemSupplyFor` (`server/state/supply.ts` ~73): who holds it, which place it lies in, now | derived |
| Edit history | one table keyed by entry or by `character_versions` row, registered `notCopied` | **new** (companion plan) |
| Time-traveller chip, fade for this reading, familiarity | derived | — |

Not stored anywhere new: the pool, *Known by*, what a clock moved back means (the session's existing **On
revision**).

## 4. The two paths

**Read**, for one prompt: 1 pick the reading: the session's, or the speaking character's own Memory → 2 the line
rule that exists today (`rowReadsOnLine`, `shared/lorebooks/lineReading.ts` ~365: own rows, ancestors' rows up to
each fork cut, undated rows never cut) → 3 entries not common knowledge are left out unless the speaker is tied
to them → 4 messages and summaries the speaker was not present for are left out (only where a character has its
own turn; a narrator voicing everyone reads all, and that limit is stated in the docs) → 5 weights: match, fade,
far now, familiarity. With the Timeline off, dates play no part.

**Write**: an entry's switches come from the entry type's default (core's, or a ruleset repertoire's) ← the
genre's override ← the writing step's value ← a person's setting, never the model's choice. Under **Full** a
session writes straight into the lorebook (built 2026-11-13). With a story date, a change to an existing entry is
a dated version (T5). One version per entry, line and date. The turn's undo is the per-turn record; every write
also lands in the edit history. The story settles when a scene closes (built).

## 5. Rules the abuse walk added

1. One version per entry, line and date: a second write that day updates it. A version cannot be dated before
   the entry's Beginning.
2. The edit history's limit never evicts the newest row a person wrote.
3. Fade takes the fresher of rounds-since-it-came-up and story time; a negative gap is zero; a declared rate
   outside 0–1 is clamped with a validation warning.
4. Presence is per message, never per scene.
5. Knowledge ties are a kind of their own, left out of the relationship graph, tie ranking and the ties in the
   prompt.
6. A filter always shows its cause: *not known by ‹name›*, *begins in ‹date›*, *not present*, in the entry's
   test view and the character's pool. Bulk-marking entries not common knowledge warns with the count.
7. A Memory naming a deleted line falls back to the line it forked from, and says so.
8. Lorebook-wide and permanent actions (Timeline, clear history, move down, bulk edit, not-common-knowledge
   marks) are the lorebook owner's alone.
9. A bulk move asks once, naming the count, the parents taken along and the lines that will start reading them.
10. After the Timeline is switched on, **Loose ends** lists entries written while it was off, to date in bulk.

## 6. Build lanes, in order

Each lane is one brief → cold review → build → verify → scope review, as the programme does. Sizes are guesses.

| Lane | What it delivers | Stored | Depends | Size |
|---|---|---|---|---|
| **T1 Timeline switch** | The flag; a boot pass that switches it on for a lorebook holding anything dated, a set clock or a second line (a second boot changes nothing); with it off: no moment bar, dates, versions timeline, **Off for a while…**, calendar and clock, History type or compiling; a **Scenes** list (with a History divider and link when on); switching off prompts and offers the timeless copy; Story Minimal starts new sessions on an undated lorebook and its messages show real time; the clock step does nothing without a timeline. The line chip shows whenever a second line exists. | flag | — | L |
| **T2 Beginning and Decay** | The two properties on an entry, in one quiet row; no change to recall yet. Bulk set comes in T8. | rate | T1 | M |
| **T3 Edit history** | `PLAN-edit-history-2026-11-13.md`: entries, then card versions, then cast versions; Restore; clear controls; the limit rule (§5.2). | table | — | L |
| **T4 Versions timeline** | The entry form in two zones (the entry; the version) with the vertical timeline; **Save**, **Save as a new version at ‹date›**, change a version's date; edits listed under each version with a toggle; the same on the cast member page. Replaces **Save as of ‹date›**, **Change the base** and the *Amendments* list. Rule §5.1. | — | T2, T3 | L |
| **T5 What sessions write** | A dated session's change lands as a dated version at once, undoable by its turn (the held correction 1: the per-turn record learns dated changes); a new entry takes Beginning and Decay from the layered defaults; SDK: two optional defaults on an entry type and on a ruleset repertoire, a genre override, two optional values on the lore-writing outlet (additive; new published names). Also here: ★FD-9 (Apply's move path and rule C). | — | T2 | L |
| **T6 What a character knows** | Cast Memory (advanced fold); the not-common-knowledge mark and knowledge ties (pool; *Known by*); presence per message and the history filter; the "away for ‹duration›" line when a character returns. **Measured first** (§7). | Memory; mark; presence | T4 | L |
| **T7 Recency reads Decay** | The recall lift moves onto the entry's rate; the time delta for living entries in the prompt. **Measured first.** | — | T2 | M |
| **T8 Lines and lists** | Move down the tree (with the parent rule and the date rule); *could exist here*; bulk edit; owner-only rules (§5.8–9). | — | T2 | M |
| **T9 Distances** | *Been there* and *has held* ties written at scene close; a step-count walk over ways and parents; the two measurements as queries for genres, shown in the pool and the test view; used first by the Lair and Dungeon Crawler. | — | T6 | M |
| **T10 Clock moved back** | A session whose clock moves back past its own writes follows **On revision**. | — | T5 | S |

T1–T4 change no recall and can ship one by one. T3 has no dependency and can run beside T1.

## 7. Measured before it is built (local model, a real session)

1. **The history filter** (T6): one secret told in a scene, one character who was not there; how often it slips
   over 20 replies, with and without leaving the unseen messages out. If the gain is small, T6 keeps Memory and
   the mark and drops the filter.
2. **Recency on Decay** (T7): what a real lorebook recalls over a recorded session, before and after; facts lose
   today's lift, so if recall of facts drops, facts keep the lift.
3. **The time delta line** (T7): whether the model treats a living entry marked *3 years ago* as possibly out of
   date.
4. **Deep lines** (T8): reads on a lorebook with 200 lines chained (no depth limit exists; the chain is walked in
   memory per read, `server/state/reading.ts` ~174).

### Measured 2026-11-15 (lead; scripts and raw results in `plans/measurements/`)

Standalone prompts sent straight to the local model server (no app code), 20 seeded replies per cell, three local
models (two 12B roleplay tunes, one 24B). Judged by keyword, so the numbers are rough.

**1. The history filter (T6).** A secret told in a scene the speaking character was not in (a key sewn into a
mule's saddle blanket: a place that cannot be guessed), then that character asked about it on its own turn.
How often the reply reveals the place:

| The character's prompt | Asked directly where it might be | Asked "do you know what we arranged?" |
|---|---|---|
| The earlier conversation left in | 9 · 16 · 10 of 20 | 7 · 6 · 2 of 20 |
| Left in, plus a note that the character was not there and does not know | 8 · 20 · 11 of 20 | 2 · 0 · 0 of 20 |
| The earlier conversation left out | 2 · 1 · 0 of 20 (keyword false hits: "lining", "sewn into a coat") | 0 · 0 · 0 of 20 |

Leaving the messages out stops the leak; a note does not (it helps only when the question is "do you know",
and on one model it made the direct question worse). **T6 keeps the history filter.** A first version of the test
used a guessable place (under a hearthstone, in an inn described with a great hearth) and was discarded: with the
conversation left out two models still "revealed" it 7 and 10 times of 20 by guessing.

**3. The time delta (T7).** One stale fact (*Mira is furious with Ash over a broken lute*), the present three
years later, Ash walks in. How often Mira acts still furious / the reply mentions time having passed (two models;
the third's server errored on this prompt):

| How the fact is presented | Still furious | Mentions time |
|---|---|---|
| No date | 14 · 12 of 20 | 0 · 3 of 20 |
| *(as of Year 7)*, present Year 10 | 7 · 9 | 6 · 9 |
| *(3 years ago)* | 7 · 3 | 15 · 17 |
| *(3 years ago; may have changed since)* | 14 · 4 | 13 · 18 |

A time delta reads as "old" more reliably than a date; the extra hint adds nothing on one model and hurts on the
other. **T7 uses the plain delta**, as the owner ruled ("A time delta is better").

**3b. The same, in the shape lore really has in a prompt** (a JSON object keyed by entry name; story time only;
two models): still furious / mentions time, of 20:

| How the fact is presented | Still furious | Mentions time |
|---|---|---|
| No date | 16 · 13 | 0 · 3 |
| The value starts *(3 years ago)* | 6 · 5 | 12 · 18 |
| The key ends *(3 years ago)* | 2 · 6 | 12 · 19 |
| The value starts *(as of Year 7)* | 13 · 9 | 8 · 12 |

The delta works in the JSON shape too, in the value or in the key, and again better than a date.

**2. Recall with the Recently referenced lift on and off** (`plans/REPORT-time-t7-measure-2026-11-15.md`): 108
turns of the owner's one qualifying session replayed through the shipped pipeline (no meaning search): no turn's
selection differed and no score moved. The lift exists only for entries with keys and that lorebook's 51 entries
are all keyless; and the budget never left a lore candidate out. So ★8 cannot be answered on this data, and on
it the fade would change nothing either.

**4. Deep lines** (`src/lib/server/state/deepLines.measure.int.test.ts`, `plans/measurements/deep-lines-2026-11-15.json`):
a lorebook with 200 lines chained one from another, 5 entries and 5 dated changes on each, 200 entries on main.
Building the reading takes about 2 ms at any depth; listing the entries a line reads takes 2 ms on main, 9 ms at
depth 50 and 34 ms at depth 200 (1,200 entries read). No depth limit is needed.

## 8. Open ★ for the owner

> **Owner, 2026-11-14, shown this list and the UI options page:** "Lets go with all your recommendations."
> Lead's reading: every ★ below that states a recommendation or a proposal is **ruled as written**: 1, 2, 4, 5,
> 6, 7, 8, 11, 12, 13 (Timeline; Memory behind **Show advanced controls**), 14, 15 (the six recommended screens:
> timeline rail beside the fields folding to a strip when narrow; the entry's own row in words; *could exist
> here* as a group at the end with the action bar at the bottom; move down as a confirming dialog; knowledge as
> one list with a three-way switch; the Timeline switch as a Book settings card), 16's ★FD-1 (a Full session
> with no scenes settles only at Close out or archive) and ★FD-3 (the card sentence), ★FD-9 (the day waits with
> the reason), and the six recommendations of `PLAN-edit-history-2026-11-13.md`. **Still open** because no
> recommendation was stated: 3 (do some entry types default to not common knowledge; lead now recommends: no,
> every type starts as common knowledge), 9 (lead: no way back, as the chosen dialog says), 10 (lead: not
> sibling lines), ★FD-5, ★FD-8. The measurements of §7 still come first. This rules the design; **it is not yet
> a go to build a lane** (asked 2026-11-14).


1. The simplification of 2026-11-14 as a whole: Beginning = the first version's date; Decay = one number;
   Memory = a reading; knowledge = ties.
2. A tie to an entry counts as knowing it (so *has been there* is enough, and nothing is said twice).
3. The mark's name and the default: every entry is common knowledge unless marked; should some types (events,
   rumours) default to marked?
4. Core defaults when a dated session writes a new entry: World lore, Place, Character lore = perpetual fact;
   Item = began, fact; History = its own date, living (slow). (A "lead" is not an entry type.)
5. **Presence per message needs a new stored fact** (who was seated and not benched when a message was written).
   Without it attendance is per scene, which the abuse walk broke (a scene that never closes).
6. The narrator limit: where one model voices everyone, nothing can be left out; the plan offers per-character
   knowledge only where a character has its own turn.
7. Decay with a timeline: story time, with the "fresher of two clocks" rule; without: rounds.
8. Moving recency onto Decay although existing entries (all facts) lose today's lift, pending measurement 2.
9. Move down: softens "Nothing ever merges between lines, by design" (docs); no way back, or a take-back while
   nothing on the target depends on it?
10. *Could exist here*: entries of lines forked from this one and entries that begin later; sibling lines' too?
11. Bulk actions: Beginning, Decay, move down, pinned / off / archive, delete, mark not common knowledge.
12. The clock moved back uses **On revision** (no separate answer for deleting a turn and for moving the clock).
13. Timeline: the name; "advanced fold" for Memory = behind **Show advanced controls**?
14. Chat and Guide undated like Minimal; the Lair and Dungeon Crawler timelined as today.
15. The UI: one option per screen from the *Lorebook time screens* page.
16. Still open from the direct-write lanes: ★FD-1 (a Full session with no scenes settles only at Close out?),
    ★FD-3 (the card sentence), ★FD-5, ★FD-8.

**Owner, 2026-11-14 (later), asked three questions:**
- A new hand-made lorebook's Timeline: "Off with offer at session creation, and ask when created." So: off by
  default; the New lorebook dialog has the switch; starting a session whose preset expects a timeline on an
  undated lorebook offers to switch it on. (Lands with the screens, lane `timeline-b`.)
- How a preset says it expects no timeline: "preset may override the genres default, but not it's mandate". So a
  genre's statement about keeping time has two strengths: a default a preset may override (Story: Minimal
  overrides it), and a mandate it may not. One additive SDK name for the preset's override; how a genre marks a
  mandate is to be designed in that lane (lead: reuse what `fit.ts` already separates as required and optional).
- Building: "Go: both lanes side by side" — the Timeline switch (server half, `plans/briefs/BRIEF-timeline-a.md`)
  and the edit history for entries (`plans/briefs/BRIEF-edit-history-a.md`). Other lanes are not a go.

**Owner, 2026-11-14 (evening): "Go with your safe suggestions and continue with the feature completion
buildouts".** Lead's reading, stated to the owner and not contradicted: every ★ with a stated recommendation is
ruled, so **★9** (no way back from a move down; the owner's own word was "permanently") and **★10** (not sibling
lines; they have no control "to move them") are ruled. Built that evening: T2, T3's cards and cast, T4 (entry
form and cast page). T6 and T7 stay held for the measurements of §7. Later the same evening, on the versions
rail: "Yes, move the moment bar"; the zones: "A makes sense"; cast Save: "The selected version"; several cast
versions at one date: "Each as its own node".

## 9. Not proposed

A model call to work out who knows what; rewriting passages per character; second-order knowledge as data (who
was present with whom gives it where it matters); "‹name› doesn't know this" text in a prompt; a trash for
deleted entries; merging lines; copying an entry to a sibling line; a mind in another character's body; an SDK
surface for the Timeline switch or the timeless copy (ruled out for now); merging the edit history with the
per-turn undo record.

## 10. Facts this plan rests on (checked 2026-11-13 and 14; re-verify in each brief)

- The line rule takes any row's date and never cuts an undated row (`shared/lorebooks/lineReading.ts` ~365–391).
  No limit on line depth or count.
- Entries have no validity columns; **Off for a while…** is two dated changes; history holds one entry per date
  per line.
- Seats keep no history; a bench change is only in `session_imprints`, which loses its `before` on settle.
  Scenes have no place; the place is the location stat, readable as of a message until the ledger is compacted.
- Inventories are a list stat whose items may reference item entries; `itemSupplyFor` answers who holds an item
  and what lies in a place, now.
- Ways are ties between two entries, edited in place, not dated; only one-hop walks exist.
- Core entry types are declared with `describeEntryType` (`../serene-pub-sdk/core-catalog/src/registry/
  entries.ts` ~104–560); a ruleset's entry types are derived from repertoires marked `entryable`
  (`sdk/src/repertoires.ts` ~415; `deriveEntryTypes`).
- Recall's recency lift is per pipeline, counted in messages (`pipelines/ranking/semantic.ts` ~106,
  `weights.ts` ~537).
- The entry form today, top to bottom: header and save state; **Save as of ‹date›** with **Change the base**;
  more actions; the type's editor (`EntryCoreFields`: Name, Content, keywords, Part of; `EntryAdvancedFields`);
  `time/AmendmentList`; the inspector tabs. Moment bar: `time/MomentBar.svelte` with `time/BranchChip`. Cast
  tabs: Member, Lore, Relationships, Timeline, Sprites, Gallery. Book settings: name, rules, writes, clock,
  calendar, "What this book holds", "This book".
- Highest migration index was 0159 on 2026-11-13 (another session's, uncommitted).

## 11. Owner rulings, 2026-11-15 (evening), in his words

1. Story and the Lair use the knowledge filter on a character's own turn: "Yes. It should be cheap enough, i think."
2. Screens (**Known by** on the entry, **Knows** on the cast member, bulk mark): "Yes everyone by default. A modder
   or us in the future can add AI determinism for filtering that stuff later. But for now, we will try to keep
   things cheap. The new expensive experimental story preset will go all out."
3. The three leaks (scene place listing and ways, link-borne names, the triggers scan) closed in one later lane;
   the place a character stands in counts as known: "Yes, add it to the plan." → **lane T6e**, after the screens.
4. A failing filter failing the reply: "Why would it fail once we make the passes? No" (lead's reading: the reply
   is not failed; to confirm).
7. `validate()` warns when a History filter's exclusions are not connected: "Yes".
9. A compiled scene with no live lines: "Stored cast list, when messages are outside the context window, we won't
   be querying them anyway. Scenes/history are what persist."
10. The distance value: "Use the time delta in the same year month day time format, add delta onto the end of the
    slug. Context/variable layouts are what determine how/where it's printed."
11. Which rows carry it: "Lets not bother adding the delta value to the returned results for now, just
    scenes/history entries".
12. The name `relativeDate`: "No, lets try to match the internal variable names as close as possible and make sure
    we standardize."
13. Entry defaults and a genre override: "they are core values and data. It's up to the session's sum
    configuration to save, mutate, query and render it. They shouldn't be something that could get changed or
    fucked up in a way that another session suddenly can't use it properly. However a session can set that it
    accepts timelines mandated, excluded or either/or. The SDK should catch when a pipeline doesn't respect that
    type safety, i.e. timeline mechanics and values are null, available, or nullable, can't be mutated, can be,
    might be (if lorebook has a timeline)." No genre override is built.
14–16. Living-world preset: a per-character place value inside the experimental preset: "Yes"; the name
    **Story: Living world (experimental)**: "Yes"; its next steps after cast Memory and distances: "Yes".

Open after this round: 5 (a tie kept in a session's notes), 6 (the tie kinds), 8 (a character who missed part of a
day).

### Later the same evening (owner's words)

- A link drawn during a session counts as knowing in that session: "Sure".
- A character who missed part of a day gets the summaries of the scenes it attended: "As recommended. Build that
  query behavior as part of the core tooling, so someone can code a different strategy instead".
- Dates: "dates returned via SDK should be something like: type date: {year: {number:int, name:string?}, month:
  {number:int, name:string?}, {day: {number:inst, name:string?}, time: {hour:int, minute:int} So if an scene for
  example might have something like {...., date, dateDelta}, we don't have to rename it for every fucking
  different row type. The variable layouts should be per parent object/array"; "The context template and variable
  layouts decide how to represent the data, nothing should be handed down flat. A custom node could flatten data,
  but it should be highly discouraged in the documentation, and if that new shape is trying to use an existing
  variable layout, it should be flagged as a missmatch, and refused at the configuration layer if an object is
  will cause an exception on execution during template rendering. Lets also make sure the SDK can pass down the
  lorebooks calendar structure in case someone wants to render that in as additional context."; "Break existing
  custom layouts, we are in pre-release, we don't care."
- Open: the filter's time limit and failure ("why the 2 second time limit? that seams arbitrary"); the tie kinds
  the screens offer ("I'm going to need more arguments or examples of this workflow"); whether *variable layout*
  is still the right name.
- Step time limits: "Lets add a global debug off switch in the admin for pipeline step await time so we have a
  safety fallback." (The filter's own failure behaviour stays as built.)
- The tie kinds on the screens (hand: **Knows** and **Kept from**; play's rows show their own reason): "That
  works, lets add SDK api for it as well, though we won't plug it in anywhere. Can add some recipes for how to
  use it."
- Next: "lets move to updating session settings (and maybe underlying system) since we will be touching so much
  of the SDK anyway."
