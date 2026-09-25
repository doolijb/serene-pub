# Lorebooks

A lorebook is the knowledge behind a story: places, people, rules, what happened and when, and how those things connect. A lorebook is created once and can be read into any [session](./sessions.md), where its entries are added to the model's context as the conversation calls for them.

## One pool, three controls

The workspace shows one pool, the book's entries, through three controls that never nest:

- **Scope** says what is in the set: a kind (World lore, Cast, History, Scenes, Places), a state (read in last turn, pinned, off, archived, machine-written), or a search. Saved scopes sit under the kinds: **Needs keywords**, **Loose ends** (entries with no keywords that have never been read in) and **Pinned**.
- **Lens** says how the set is drawn: **List**, **Cards**, **Tree** (what is filed under what), **Graph** (who and what is connected), **Time** (dated entries on the story axis) and **Places** (a map of regions and travel links).
- **Moment** says when you are reading from: now, or any story date on the bar along the bottom.

Any scope can be drawn through any lens at any moment. A facet with nothing in it goes dim and sorts last; nothing is hidden and nothing has to be switched on.

Everything about the book rather than in it lives on the **book chip** at the top of the rail: open another book, new, import, book settings, duplicate, export, which session it is reading into, delete.

The workspace draws itself from the width it is given. Wide, and the rail stands beside the pool with the editor in a third column. Narrow, or docked beside a session, the rail collapses to the search and the scope chips, the lens row moves to the bottom, and the editor opens as a step in place of the list. Moving between rows, scopes or books with unsaved edits asks once before discarding them.

### Book settings are a readout

Book settings show what the book holds: how many entries of each kind, how many cast members carry lore of their own and how many relationships stand between them, the earliest and latest dates, how many scenes are captured and how many wait to compile, how deep the nesting goes, and how many places are mapped. That is a description, not a set of features to switch on. Every capability is available in every lorebook.

What a book chooses is behaviour: which session it reads into, and whether scenes are captured from that session automatically. The token ceiling and the relationship ceiling shown there belong to the session's retrieval configuration and are read from it.

### Creating, importing, duplicating and deleting

**New lorebook** asks for one name. When a session is open, it also offers to read the new book into that session. Everything else, cast, dates, nesting, relationships, appears as you use it. The first thing you see in an empty book is a composer: write the first thing you do not want to repeat, and Serene Pub works out what kind of thing it is.

**Import** accepts a SillyTavern-style lorebook JSON or Serene Pub's own export. A foreign file lands every entry as World lore in a new book, since world entries need no binding. A Serene Pub export round-trips faithfully: entry kinds, scenes under their history entries, cast bindings, the graph, nesting (Part of) and the links between entries. Re-importing a book that already exists is detected by content hash and asks whether to overwrite or import as new. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the foreign format.

**Export** offers whether to include bound characters, bound personas and the narrative graph. A relationship is written with typed endpoints, so an edge between two places survives; an older importer still reads the cast edges.

**Duplicate** copies the book for you under a new name, with entries, nesting, cast, relationships and scenes remapped into the copy. Characters and personas are bound again rather than cloned.

**Delete** cannot be undone. Deleting an entry that has entries filed under it deletes those too, and the confirmation says how many.

## The entry

Selecting a row opens its editor. Top to bottom:

- **Name** and **Content**. Above the content, **Cast** inserts a reference to a cast member (`{{char:1}}`, which resolves to that member's current name in the attached session) and **Macro** opens the macro list.
- **Keywords** as chips. When vectorization is on, the hint says entries are also matched semantically, so every phrasing need not be listed.
- **Part of**: the entry this one is filed under, or top level. Pick from the list, or drag a row onto another row in the pool. An entry cannot be filed under itself or under anything filed under it.
- One fold, **Regex, case, recursion, priority, conditions**, holding the retrieval settings, in the same place whether or not any are set.
- **Read in**: what the newest run of the session reading this book decided about this entry, as one line. The book's owner sees whether it fired, its rank among the entries the run judged, the key that matched, and the tokens it cost against the budget; an administrator also sees the run's own sentence about it, from the run's report. When no session is reading the book, it says so.
- **References** and **Contains** as two tabs, with their counts.

### Two retrieval modes change what fields you see

The fold adapts to whether **vectorization** is enabled system-wide. Off, entries are matched on keywords, with **Use regex**, **Case sensitive** and a manual **Priority** used as a tie-breaker. On, entries are also retrieved by embedding similarity against the conversation, and the keyword-only switches are hidden. See [Embeddings and RAG](./embeddings-and-rag.md).

In either mode a **Pinned** entry is always read in, and an entry switched **Off** stays in the book and out of retrieval. **Archived** is different: an archived entry is out of the list as well, until the Archived chip asks for it, and out of retrieval like an entry that is off. Both are marks on the row. Switching an entry off or pinning it never re-embeds it: its text did not change.

### Read in? (Signals)

The Read in? tab runs retrieval for this entry against the newest turn of the session reading the book and answers whether it would be read in, at what rank, on which match, with the lexical and semantic scores, and whether it fits the budget. Under it, **Teach it**: **Always read this in** pins the entry, **Never read this in** switches it off. The test runs on the saved entry, because retrieval reads the database rather than the editor.

### References

What points at this entry, with the sentence it comes from where the text carries one: entries that name it in their content, entries filed under it, scenes that mention it from a session, cast members and entries linked to it by a relationship, and indirect references that arrive through its parent. Deleting the entry would leave these behind, which is why they are listed here.

### Retrieval markers

When the session you have open reads this book, every row carries a mark saying what that session's newest run decided: read in, considered and left out, or nothing at all when no mechanism reported on it. The marks are re-read when a reply finishes.

## Nesting and links

Entries connect in three ways, each stored separately:

1. **Part of** files an entry inside one other entry: the room inside the inn, the inn inside the Low Quarter. One parent, and deleting the parent deletes what is inside it. The Tree lens draws this, and the Places lens uses it for regions.
2. **Relationships** are typed, directed links with a description, between any two things in the book: two cast members, a cast member and an entry, or two entries. A road is an entry with a link to each place it runs past. A tunnel has a link from the room it starts in and a link to wherever it comes out. Each link can be dated by the history entry or scene that made it true, and hidden from characters who would not know it.
3. **References** are derived from the text and never edited.

Part of answers "where is this inside", once. Links answer "how do I get from here to there" and "what stands in relation to what", as many times as needed, with words on each.

When an entry is read into a turn, its links are followed one hop: the room brings the tunnel as a lower-ranked candidate, and not the far end of the tunnel. The run's receipt names what arrived that way.

## Cast

Cast members arrive from the session on their own: reading a book into a session, or adding a character or persona to a session that reads it, creates one member per character or persona, and never a second one for the same card. Removing a member from the session keeps the cast member, since lore may be anchored to them.

Cast is everyone the book's world holds, one row per member, with their aliases, state (active, background, deceased, missing), how many lore entries are anchored to them and how many relationships they have. A member is a **binding**: a name in the book, optionally attached to a character or persona card, which is how `{{char:N}}` in content resolves and how a session knows which participant a member is. The row's read-in mark reports on the member's anchored lore.

A member's page holds their state, aliases, summary, the attached card (with **Change**), their **Relationships** with type, direction, the other end, and where each came from (from lore, from history, from scene, or this session when a graph build just proposed it), **Lore about** them (the entries anchored to them, written where the person is), and the same single fold their lore uses. Suggested members and possible duplicates from the session are listed under the roster, with the existing suggestion and merge panels behind them.

Reading as of a moment, the page shows the relationships that stood at that point and dims the later ones with their date.

## The lenses

**List** and **Cards** draw rows. **Tree** nests each row under whatever it is filed beneath, with scenes under their history entries.

**Graph** draws the current scope as a force layout: cast members as circles, entries with links as squares, and every link as a labelled, directed edge. Click a node to open it. Hold ⌥ (Alt) and drag from one node to another to name a link: the form suggests types for that pairing (connects to, leads to, runs past for two places; keeper of, lives in for a member and a place) and takes any type you write. The panel beside the canvas lists the selected node's links with their provenance, and names scenes that put two members in the same room without a link between them. **Extend from this session** runs the graph build over what has not been graphed yet and lands on the review screen; nothing is applied without you.

**Time** puts dated entries and scenes on the story axis in lanes: the story, one lane per cast member who appears in dated entries, and the world. Gaps between dated entries are marked. Entries with no date are listed beside the axis; drag one onto it to date it. Selecting a dated entry opens its When, Content, the scenes compiled into it, and who was present.

**Lives** draws who is in the world over time: a lane for every placed cast member, a bar for each presence, and a mark where two of them overlap — the same person at two points of her life, both here at once. Members who have never been placed are simply always here and are not drawn.

**Places** draws a map: regions from Part of as nested boxes, travel links as lines between them, and cast members with a `lives in` or `keeper of` link as pins. With nothing linked or nested it says so.

## The session reading this book

When a session has this lorebook, the top of the lorebook sidebar says so: the session's name (click it to open the session), which line it is reading, and how many entries reached the last turn.

A session always reads **as of now, on its own line**. You do not. If you have moved the moment or switched to another line, the block says **Read what it reads** — one click puts you back on the session's line at now, so what is on your screen is what the model is being given.

A book no session is reading keeps a single quiet line at the bottom of the rail instead.

### What a session has read

Every turn records what it decided about each entry it judged: read in or left out, why, its rank (its place among the entries that turn read in — "rank 2 of 5"), what it cost, and the keys that matched exactly (a near-miss spelling can still bring an entry in, but is never reported as a match). The markers, the Read in line, the session's usage panel and the **Lore entries** widget read those records. They are the book owner's: the owner sees them for every turn in their sessions, guests' turns included, and so do administrators. A guest sees none of it. A session keeps these records for one round — each character's most recent turn. The counts of how often each entry was read, and when and in which turn it last went in, are kept for good; the usage panel and the widget show those. All of it goes when the session is deleted.

**Lore entries** is a session widget (add it from the layout editor). It lists the session's book with, for each entry, how often it has been read in this session, when last and at what rank. Search it by title or key, sort it by name, last read, times read or rank, and show only the entries read, pinned or off. **Pin** and **Off** on each row set the entry's marks directly. A guest who opens it is told the entries are the book owner's to manage.

## The moment bar

The bar along the bottom carries a tick for every dated entry and a chip reading **now**. Drag it, click a tick, or use the arrow keys to read the book as of any date: undated entries always show, dated entries and links only once they have happened, and cast members whose first dated mention is later are listed dim as not in the story yet. A banner above the editor names the moment and offers **Return to now**.

## Amendments

An **amendment** is a dated change to an entry. The entry itself — its **base** — stays as it was; the amendment says "from this date, it reads like this". Reading before that date shows the base, reading at or after it shows the change.

While you are reading as of a date, saving offers two things:

- **Save as of ‹date›** files the change as an amendment. The entry is untouched and the change begins at that date.
- **Change the base**, in the menu beside it, changes the entry itself — everywhere, at every moment, including before the date you are reading, where it becomes what was always true. The menu says so before you press it.

At **now** there is no choice and one Save button: every dated amendment already applies at now, so the two would do the same thing.

Only what you actually edited is written. If an entry reads a certain way at this moment because of an _earlier_ amendment, saving does not copy that value into wherever your change lands.

An entry with amendments lists them under the editor, each with its date and what it changes, and a control to remove one. Click a date to change it — an amendment filed at the wrong moment is a change that happens at the wrong time, not a wrong value. While you are reading as of a date, the ones still ahead of you are marked and the list says how many have not happened yet.

An amendment's date is a date the story knows, so the moment bar carries a tick for it: you can stand at the moment something changed even if nothing else is dated there.

### Off for a while

**Off for a while…**, in the entry's ⋯ menu, switches an entry off for a period: a date it stops being read from, and optionally a date it starts again. Leave the second blank and it stays off from then on.

The second date is the day it is **back** — an entry off from Year 3 until Year 6 reads as off at Year 5 and on at Year 6. A window that would come back on before it went off is refused, and says so before you press anything.

Underneath it is two amendments, which is the only thing the book can store: a change at the start and a change back at the end. You never have to work them out yourself.

Amendments are a reading and authoring tool: retrieval always reads the book as of now, so the model sees the current state.

## Amending a cast member

A cast member changes over a story like anything else, and the same **Save as of ‹date›** appears on their page while you are reading as of one. What can be dated: their name, aliases, state, summary — and **which character card represents them**.

That last one is how a character can be drawn differently at different points in their life. Link the young card, and at the year they change, amend the member to the older one. Read before that year and you see the novice; read after and you see the keeper — in the list, on their page, and anywhere the book draws them.

A card is not amended, only which card is used. Cards are shared between books, so changing one would change that person everywhere they appear.

### Sprite set

If the card has more than one sprite set, **Sprite set** on the member's page picks which one they are drawn with. Sets belong to the card; which one this member uses is theirs, and can be dated like anything else here — so she can wear the scarred set from the year she earns it. Choosing nothing means the card's own default. If a card swap moves them to a card that has no set by that name, the name is kept rather than thrown away, they fall back to that card's default, and the page says so.

## When a cast member is in the world

By default a cast member is simply in the world: at every moment, at no particular point of their life. Most members never need more than that.

**Place them**, on the member's page, says more: from what date they are here, until what date, and where in their own life that is. Each one of those is a **presence**. The point in their life is a plain number you choose the meaning of — an age, a chapter, an arc — and it needs no calendar. Leave the departure blank and they never leave.

Placing someone for the first time changes what *no* presence meant. Until then they were here always; from then on they are here during their presences and **nowhere else**. The form says so before you place the first one.

A departure date is the moment they are **gone**, not their last day here. Someone who leaves at Year 6 is still here at Year 5 and not at Year 6.

### Two of them at once

Two presences that overlap are **two of them in the world at the same time** — her at 34 and her at 50, in the same room. That is what presences are for, not a mistake, so the form says which two you are about to have and lets you through once you confirm it. The only thing refused is an exact repeat: the same point of their life over the same span, which is a slip rather than a story.

Where two of them are here, everything that draws the cast draws both. One of them, resolved at one moment, is an **appearance**. Dated changes follow: an amendment saved against one appearance belongs to that point of her life and travels with it, so the 50-year-old can carry what the 34-year-old has not lived yet.

The **World bar** at the top of the book says who is in the world at the moment you are reading, and the **Lives** lens draws it over time: a lane per placed member, a bar per presence, marked where two of them overlap.

A presence belongs to the line it was made on, like an amendment. Make one while reading a branch and it is that branch's; the form says where it will land before you place it.

## Branches

A **branch** is another line of the same story. The chip beside the book's name says which line you are reading; **main** is the line every book starts with.

**Fork** makes a new line, named by you, leaving from the line you are on at the moment you are reading.

Forking while reading as of a date parts the two lines **at that date**: from then on a change on one line is not a change on the other, and the fork stops following what the first line goes on to do. The cut is by story date, not by when a change was written — a line forked at Year 3 never reads a change dated Year 4, however long afterwards you make it.

Forking at **now** stores no date, which is a different thing: that line keeps following the one it left. Move the moment first if the two should genuinely part.

What a branch keeps to itself: its amendments, the entries you write while reading it, the scenes captured from sessions on it, and the relationships drawn on it. Everything else is **shared** — one row both lines read. That is what makes a branch cheap: forking does not copy the book, so an edit to a shared entry is made once and both lines see it.

Main sees only shared rows. A branch sees the shared rows and its own, never a sibling's.

**Rename** and **Delete** are in the same menu. Deleting a line removes what was written on it — its amendments, its own entries, its scenes. Shared entries stay. Sessions played on it fall back to main rather than going with it, and lines forked from it become lines off main.

**Compare ‹line› with main**, in the same menu, draws the two side by side: what this line has that main does not, and every shared entry or cast member the two read differently, field by field. It follows the moment, so you can compare the two stories as they stood at any date.

Nothing merges, by design. To take something across, read the line it is on and write it on the other.

Retrieval reads the book as of now on the session's line.

## History and scenes

A history entry is anchored to a date: a year, optionally a month and a day. Entries are kept in date order by the editor, which refuses a date that would put an entry out of sequence with its neighbours. **Next date** opens a new entry one day after the latest.

A **scene** is a saved reference to a consecutive run of messages in a session, with a name, a generated summary, and who was present or mentioned. Scenes are captured from a session, never typed from nothing, and sit under the history entry they belong to. **Process** has the model write or rewrite the summary from the messages. Once an entry has scenes, **Compile to entry** synthesizes their summaries into the entry's content, showing a word-level diff against what was there.

## From a session to the graph

Turning a conversation into structured lore is four steps, each through the same modal shell: configure, run with live progress, review before anything is written.

1. **Summarize to lorebook**, from a session's selected messages: a scene under a history entry (the messages must be consecutive), a world lore entry with an optional focus, or a character lore entry with a required focus. Drafts stream in batches, then a synthesis pass merges them.
2. **Process scene**, from History or Scenes, derives the summary and the cast lists from the underlying messages. An unfinished review reopens next time; the activity sidebar offers a shortcut to it.
3. **Compile to entry**, from a history entry with scenes, writes the dated content. Saving marks the entry completed; that content is what search, retrieval and prompts use.
4. **Build or extend the graph**, from the Graph lens, extracts cast members and relationships from summarized scenes and compiled entries. It stops at the review screen every time.

Scenes without a summary are skipped by the build, so a low "ready to process" count usually means a scene still waiting on step 2.
