# Lorebooks

A lorebook is the knowledge behind a story: places, people, rules, what happened and when, and how those things connect. A lorebook is created once and can be read into any [session](./sessions.md), where its entries are added to the model's context as the session calls for them.

## One pool, three controls

The workspace shows one pool, the book's entries, through three controls that never nest:

- **Scope** says what is in the set: a kind (World lore, Cast, History, Scenes, Places, Items), a state (read in last turn, pinned, off, archived, machine-written), or a search. Saved scopes sit under the kinds, and as chips over the list: **Needs keywords** (entries with no keywords, so nothing in a message can match them yet), **Loose ends** (entries with no keywords that the newest run of the session reading this book did not read in) and **Pinned**. A search or filter that matches nothing says so and offers **Clear search and filters**.
- **Lens** says how the set is drawn: **List**, **Cards**, **Tree** (what is filed under what), **Graph** (who and what is connected), **Time** (dated entries on the story axis), **Lives** (who is in the world, and when) and **Places** (a map of regions and travel links).
- **Moment** says when you are reading from: now, or any story date on the bar along the bottom.

Any scope can be drawn through any lens at any moment. A facet with nothing in it goes dim and sorts last; nothing is hidden and nothing has to be switched on. Every count leaves archived entries out, as the list does.

Everything about the book rather than in it lives under **Manage** in the book's header, beside its name, entry count and the line you are reading: open another book, new, import, book settings, duplicate, export (paused for now), **Read into this session** or **Stop reading**, delete.

The workspace draws itself from the width it is given. Wide, and the rail stands beside the pool with the editor in a third column. Narrow, or docked beside a session, the rail collapses to the search and the scope chips, the lens row moves to the bottom, and the editor opens as a step in place of the list. Moving between rows, scopes or books with unsaved edits asks once before discarding them.

### Book settings are a readout

Book settings show what the book holds on the line you are reading: how many entries of each kind, how many cast members carry lore of their own and how many relationships stand between them, the earliest and latest dates, how many scenes are captured (and from which session) and how many wait to compile, how deep the nesting goes, its **Lines** (main and each branch, by name), and how many **Places** it has — its Location entries. That is a description, not a set of features to switch on. Every capability is available in every lorebook.

What a book chooses is behaviour: which session it reads into (**Read into this session** or **Stop reading**, the same action as in Manage), its **calendar** and its **clock** (see [Calendar and clock](#calendar-and-clock)).

### Reading a book into a session

**Read into this session**, in Manage or Book settings, makes the session you have open read this book. It is offered only for a session you own. A session reads one book at a time, so reading this one into a session that reads another asks first, and says that nothing in either book changes. **Stop reading** takes the book out of the session; the book itself is untouched.

### Creating, importing, duplicating and deleting

**New lorebook** asks for one name. When a session is open, it also offers to read the new book into that session. Everything else, cast, dates, nesting, relationships, appears as you use it. The first thing you see in an empty book is a composer: write the first thing you do not want to repeat, and it is filed as World lore. Cast, Time, Lives, Graph and Places still open from the rail and the lens row, so you can add a cast member by hand before writing anything.

**Import** reads a SillyTavern-style lorebook JSON, or a lorebook exported by Serene Pub 0.5. It always makes a new book (or overwrites the one it matches); it never fills the book you have open, which is why the empty book's button says **Import as a new lorebook**.

- A SillyTavern file lands every entry as World lore in a new book, since world entries need no binding. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the foreign format.
- A Serene Pub 0.5 export brings its entry kinds (world lore, character lore with the cast member it belongs to, dated history), scenes under their history entries, its cast with their cards, and the links between cast members. Personas come back as characters flagged as personas. A member whose card the file did not carry stays in the cast without a card.

Re-importing a book that already exists is detected by content hash and asks whether to overwrite it or import it as new. Before an overwrite it says what the file cannot bring back — the book's dated changes, presences, branches and scenes captured from a session — and overwriting deletes them.

**Export** is paused while the lorebook format settles. It stays in the menu, greyed, and says so.

**Duplicate** makes an exact copy under a new name: every entry on every line, archived ones included; the cast, with their cards, dated changes, presences and sprite sets; the branches with their fork dates; the links; the scenes and who was in them; the tags; and the story's calendar and clock. Cards are shared, not copied: the copy's cast points at the same character cards. Two things stay with the original: which session's messages each scene was captured from (the copy's scenes keep their summaries and cast), and the undo of a past cast merge. Nothing is read into a session until you say so.

**Delete** cannot be undone. Deleting an entry deletes everything filed under it, however deep, and the confirmation says how many. While you are reading a branch, deleting an entry that every line shares deletes it from every line: the confirmation says so, and points to **Off for a while** for taking it out of this line only.

## The entry

Selecting a row opens its editor. Top to bottom:

- **Name** and **Content**. Above the content, **Cast** inserts a reference to a cast member (`{{char:1}}`, drawn in the editor as a chip with the member's name, and resolved to that member's current name in the session reading the book) and **Macro** opens the macro list.
- **Keywords** as chips, one keyword per chip. Press Enter or type a comma to add one. With **Use regex** on, a comma stays inside the pattern (so `\w{2,4}` is one keyword) and only Enter adds it; without it, a comma inside `/…/` or an open bracket stays too. When vectorization is on, the hint says entries are also matched semantically, so every phrasing need not be listed.
- **Supply**, on an item only: how many of it the world has — **One of a kind**, **Limited** (then **How many exist**, a whole number of 1 or more; the item cannot be saved without it) or **Unlimited**. An item's row shows a bounded supply beside its name (`One of a kind`, `3 exist`). How many each character holds is kept on them, not here; see [Stats and states](./stats-and-states.md#stat-shapes).
- **Part of**: the entry this one is filed under, or top level. Pick from the list, or drag a row onto another row in the pool. An entry cannot be filed under itself or under anything filed under it.
- One fold, **Regex, case, recursion, priority, conditions**, holding the retrieval settings, in the same place whether or not any are set. Condition keywords are chips too, with the same comma rule.
- **Read in**: what the newest run of the session reading this book decided about this entry, as one line. The book's owner sees whether it fired, its rank among the entries the run judged, the key that matched, and the tokens it cost against the budget; an administrator also sees the run's own sentence about it, from the run's report. When no session is reading the book, it says so.
- **References** and **Contains** as two tabs, with their counts.

### Keywords and embeddings

Every entry is matched on its keywords, with **Use regex**, **Case sensitive** and a manual **Priority** used as a tie-breaker. When **vectorization** is enabled system-wide, entries are also retrieved by embedding similarity against the session, and the fold says that Use regex and Case sensitive still govern keyword matching; the three controls are shown either way. See [Embeddings and RAG](./embeddings-and-rag.md).

Either way, a **Pinned** entry is always read in, and an entry switched **Off** stays in the book and out of retrieval. **Archived** is different: an archived entry is out of the list as well, until the Archived chip asks for it, and out of retrieval like an entry that is off. Both are marks on the row. Switching an entry off, pinning it or archiving it never re-embeds it: only a change to its name or content does.

### Read in? (Signals)

The Read in? tab runs retrieval for this entry against the newest turn of the session reading the book and answers whether it would be read in, at what rank, on which match, with the lexical and semantic scores, and whether it fits the budget. Under it, **Teach it**: **Always read this in** pins the entry, **Never read this in** switches it off. The test runs on the saved entry, because retrieval reads the database rather than the editor.

### References

What points at this entry, with the sentence it comes from where the text carries one: entries that name it in their content, entries filed under it, scenes that mention it from a session, cast members and entries linked to it by a relationship, and indirect references that arrive through its parent. Deleting the entry would leave these behind, which is why they are listed here.

### Retrieval markers

When the session you have open reads this book, every row carries a mark saying what that session's newest run decided: read in, considered and left out, or nothing at all when no mechanism reported on it. The marks are re-read when a reply finishes.

## Nesting and links

Entries connect in three ways, each stored separately:

1. **Part of** files an entry inside one other entry: the room inside the inn, the inn inside the Low Quarter. One parent, and deleting the parent deletes what is inside it. The Tree lens draws this, and the Places lens uses it for regions.
2. **Relationships** are typed, directed links with a description, between any two things in the book: two cast members, a cast member and an entry, or two entries. A road is an entry with a link to each place it runs past. A tunnel has a link from the room it starts in and a link to wherever it comes out. Each link can be dated by the history entry that made it true, and hidden from characters who would not know it.
3. **References** are derived from the text and never edited.

Part of answers "where is this inside", once. Links answer "how do I get from here to there" and "what stands in relation to what", as many times as needed, with words on each.

When an entry is read into a turn, its links are followed one hop: the room brings the tunnel link as a lower-ranked candidate, and not the far end of the tunnel. Only links that stand on the session's line, are still active, are not secret, and reach an entry of this book that is neither archived nor off are followed. **What arrives this way does not reach the prompt yet**: it is ranked and counted against the relationships' share of the budget, and the run's receipt lists it, but no part of the prompt writes it out.

## Cast

Cast members arrive from the session on their own: reading a book into a session, or adding a character or persona to a session that reads it, creates one member per character or persona, and never a second one for the same card. Removing a member from the session keeps the cast member, since lore may be anchored to them.

Cast is everyone the book's world holds, one row per member, with their aliases, state (active, deceased, missing, departed), how many lore entries are anchored to them and how many relationships they have. A member is a name in the book, optionally bound to a character card (a persona is a character card too); the binding is how `{{char:N}}` in content resolves and how a session knows which participant a member is. A member with no card is a **background** member. The row's read-in mark reports on the member's anchored lore.

A member's page holds their state, aliases, summary, the attached card (with **Change**), their **Relationships** with type, direction, the other end, and where each came from (from lore, from history, from scene, or this session when a graph build just proposed it), **Lore about** them (the entries anchored to them, written where the person is), and the same single fold their lore uses. Suggested members and possible duplicates from the session are listed under the roster, in the narrow layout as well as the wide one, with the existing suggestion and merge panels behind them.

A member with a card takes their name from it. Their other names are their own either way: the card's names are added to them, and changing or unlinking the card keeps every name they already had.

Lore written on a member's page is saved to the entry itself, at every moment: the page has no **Save as of** for their lore yet. To file a dated change to it, open the entry from the list while reading as of the date.

Reading as of a moment, the page shows the relationships that stood at that point and dims the later ones with their date.

**Delete**, on a member's page, says what goes with them: the relationships they are in, their dated changes and their places in scenes. A linked character card is not touched. When they have lore private to them, it asks what happens to it: **Keep their lore**, which leaves it unassigned — and unassigned lore is visible to the narrator — or **Delete their lore too**. If a past merge names them, it says that deleting them disables that merge's undo.

## The lenses

**List** and **Cards** draw rows. **Tree** nests each row under whatever it is filed beneath, with scenes under their history entries.

**Graph** draws the current scope as a force layout: cast members as circles, entries with links as squares, and every link as a labelled, directed edge. Click a node to open it. Hold ⌥ (Alt) and drag from one node to another to name a link: the form suggests types for that pairing (connects to, leads to, runs past for two places; keeper of, lives in for a member and a place), takes any type you write, and, once the book has history, offers **When** — the history entry that dates the link, starting at the one dated the moment you are reading. The panel beside the canvas lists the selected node's links with their provenance (a broken link is marked **cut**), and names scenes that put two members in the same room without a link between them. Deleting a link asks a second time.

The graph shows the links on the line you are reading. While you read a branch, a link another line owns is shown but cannot be changed from here; it says which line to open to change it. A link you draw belongs to the line you draw it on.

**Extend from this session**, offered when the session you have open reads this book, runs the graph build over that session's scenes that have not been graphed yet; with no such session it is **Extend graph**, over everything in the book not yet graphed. Either lands on the review screen, and nothing is applied without you. **Rebuild** replaces the graph: it deletes every link in the book, and its confirmation says how many first. A rebuild re-creates only links between cast members, from your scenes, so links drawn by hand and links with an entry at either end do not come back; the confirmation counts the ones with an entry at either end.

**Time** puts the current scope's dated entries and scenes on the story axis in lanes: the story, one lane per cast member who appears in dated entries, and the world. Search and the pool's chips narrow the list, not the axis. Gaps between dated entries are marked. Entries with no date are listed beside the axis; drag one onto it to date it. Selecting a dated entry opens its When, Content, the scenes compiled into it, and who was present. Saving there always changes the entry itself: the Time lens has no **Save as of** yet, so to file a dated change, open the entry from the list.

**Lives** draws who is in the world over time: a lane for every placed cast member, a bar for each presence, and a mark where two of them overlap — the same person at two points of her life, both here at once. Members who have never been placed are simply always here and are not drawn.

**Places** draws a map of the book's places — its Location entries on the line you are reading, archived ones left out. Every place is a box, nested inside the place it is Part of; travel links are lines between them; and a cast member with a `lives in` or `keeper of` link is a pin inside that place — one pin per member per place, however many such links they have. Another kind of entry appears only when something joins it or holds it. With no places it says so.

## The session reading this book

When a session reads this lorebook, the top of the lorebook sidebar says so: the session's name (click it to open the session), which line it is reading and as of when, and how many entries reached the last turn.

A session reads the book **on its own line, at its own story clock** — or as of now, when it follows the line's present. The workspace does not have to read from the same place. If you have moved the moment or switched to another line, the block says **Read what it reads** — one click puts you on the session's line at its clock, so what is on your screen is the book as the session reads it.

A book no session is reading keeps a single quiet line at the bottom of the rail instead.

### What a session has read

Every turn records what it decided about each entry it judged: read in or left out, why, its rank (its place among the entries that turn read in — "rank 2 of 5"), what it cost, and the keys that matched exactly (a near-miss spelling can still bring an entry in, but is never reported as a match). The markers, the Read in line, the session's usage panel and the **Lore entries** widget read those records. They are the book owner's: the owner sees them for every turn in their sessions, guests' turns included, and so do administrators. A guest sees none of it. A session keeps these records for one round — each character's most recent turn. The counts of how often each entry was read, and when and in which turn it last went in, are kept for good; the usage panel and the widget show those. All of it goes when the session is deleted.

**Lore entries** is a session widget (add it from the layout editor). It lists the session's book as the session reads it — the entries on its line, as they read at its story clock, archived ones left out — with, for each entry, how often it has been read in this session, when last and at what rank. Search it by title or key, sort it by name, last read, times read or rank, and show only the entries read, pinned or off. **Pin** and **Off** on each row set the entry's marks directly; if a mark cannot be changed, the widget says why on its own line, just above the list, until you change the search, sort, filter or page. It updates itself whenever a turn has written its rankings, so the counts are current the moment a reply lands, and whenever you pin or turn off one of its entries somewhere else (another Lore entries widget, another tab); the refresh button beside the search asks again at any time. A guest who opens it is told the entries are the book owner's to manage.

## The moment bar

The bar along the bottom carries a tick for every dated entry, and names the story's present at its **now** end (a clock icon marks one set on the clock). Drag it, click a tick, or use the arrow keys to step between the book's dated moments; **Go to date…** stands you at any date, whether or not anything happened on it (a date the book's calendar does not have is refused, never rounded). Undated entries always show, dated entries and links only once they have happened, and cast members whose first dated mention is later are listed dim as not in the story yet. A banner above the editor names the moment and offers **Return to now**. While you are reading as of a date, **Make this the present** sets the clock there, on the line you are reading.

## Amendments

An **amendment** is a dated change to an entry. The entry itself — its **base** — stays as it was; the amendment says "from this date, it reads like this". Reading before that date shows the base, reading at or after it shows the change.

While you are reading as of a date, saving offers two things:

- **Save as of ‹date›** files the change as an amendment. The entry is untouched and the change begins at that date. It is filed on the line you are reading.
- **Change the base**, in the menu beside it, changes the entry itself — everywhere, on every line and at every moment, including before the date you are reading, where it becomes what was always true. The menu says so before you press it.

At **now** there is no choice and one Save button, which changes the base. If an amendment already in effect at now sets a field you changed, the save still lands, but the entry reads the same as before: the amendment wins from its date on. The save says so, naming the amendment's date and the field, so you can edit or delete that amendment instead.

Only what you actually edited is written. If an entry reads a certain way at this moment because of an _earlier_ amendment, saving does not copy that value into wherever your change lands.

An entry with amendments lists them under the editor, each with its date and what it changes. The ones the line you are reading reads come first; one on another line says which (`on Exile`, or `on main, after the fork`). **Delete** removes one, after asking. Click a date to change it — an amendment filed at the wrong moment is a change that happens at the wrong time, not a wrong value. While you are reading as of a date, the ones still ahead of you on this line are marked and the list says how many have not happened yet.

An amendment's date is a date the story knows, so the moment bar carries a tick for it: you can stand at the moment something changed even if nothing else is dated there. To file one at a date nothing is dated at yet, use **Go to date…** first.

### Off for a while

**Off for a while…**, in the entry's ⋯ menu, switches an entry off for a period: a date it stops being read from, and optionally a date it starts again. Leave the second blank and it stays off from then on.

The second date is the day it is **back** — an entry off from Year 3 until Year 6 reads as off at Year 5 and on at Year 6. A window that would come back on before it went off is refused, and says so before you press anything.

Underneath it is two amendments, which is the only thing the book can store: a change at the start and a change back at the end. You never have to work them out yourself. Like any amendment, they are filed on the line you are reading, so on a branch it takes the entry out of that line only.

Retrieval reads amendments too: a session reads each entry with the amendments on its line that have happened by its story clock — every one of them, when it follows the line's present.

## Amending a cast member

A cast member changes over a story like anything else, and the same **Save as of ‹date›** appears on their page while you are reading as of one. What can be dated: their name (a member with a card takes their name from it), aliases, state, summary — and **which character card represents them**. At now, the same warning as an entry's says when a dated change still sets a field you saved.

That last one is how a character can be drawn differently at different points in their life. Link the young card, and at the year they change, amend the member to the older one. Read before that year and you see the novice; read after and you see the keeper — in the list, on their page, and anywhere the book draws them.

While you are reading as of a date, **Change**, **Link** and **Unlink** on the card are dated too: before that date the member reads as they do now. The card's menu offers the same actions **everywhere**, which changes the card at every moment instead.

A card is not amended, only which card is used. Cards are shared between books, so changing one would change that person everywhere they appear.

### Sprite set

If the card has more than one sprite set, **Sprite set** on the member's page picks which one they are drawn with. Sets belong to the card; which one this member uses is theirs, and can be dated like anything else here — so she can wear the scarred set from the year she earns it. Choosing nothing means the card's own default. If a card swap moves them to a card that has no set by that name, the name is kept rather than thrown away, they fall back to that card's default, and the page says so.

## When a cast member is in the world

By default a cast member is simply in the world: at every moment, at no particular point of their life. Most members never need more than that.

**Place them**, on the member's page, says more: from what date they are here, until what date, and where in their own life that is. Each one of those is a **presence**. The point in their life is a plain number you choose the meaning of — an age, a chapter, an arc — and it needs no calendar. Leave the departure blank and they never leave.

Placing someone for the first time changes what _no_ presence meant. Until then they were here always; from then on they are here during their presences and **nowhere else**. The form says so before you place the first one.

A departure date is the moment they are **gone**, not their last day here. Someone who leaves at Year 6 is still here at Year 5 and not at Year 6.

### Two of them at once

Two presences that overlap are **two of them in the world at the same time** — her at 34 and her at 50, in the same room. That is what presences are for, not a mistake, so the form says which two you are about to have and lets you through once you confirm it. The only thing refused is an exact repeat: the same point of their life over the same span, which is a slip rather than a story.

Where two of them are here, everything that draws the cast draws both. One of them, resolved at one moment, is an **appearance**. An amendment that carries a point of her life belongs to that appearance and travels with it, so the 50-year-old can carry what the 34-year-old has not lived yet. The member's page does not file one yet: a change saved there carries no point of her life, so it applies to every appearance.

The **World bar** at the top of the book says who is in the world at the moment you are reading, and the **Lives** lens draws it over time: a lane per placed member, a bar per presence, marked where two of them overlap.

A presence belongs to the line it was made on, like an amendment. Make one while reading a branch and it is that branch's; the form says where it will land before you place it.

## Branches

A **branch** is another line of the same story. The chip beside the book's name says which line you are reading; **main** is the line every book starts with.

**Fork** makes a new line, named by you, leaving from the line you are on at the moment you are reading. Fork a branch and the new line reads through it: that branch's own rows up to the new fork's date, and main's up to the earlier of the two fork dates.

Forking while reading as of a date parts the two lines **at that date**: from then on a change on one line is not a change on the other, and the fork stops following what the first line goes on to do. The cut is by story date, not by when a change was written — a line forked at Year 3 never reads a change dated Year 4, however long afterwards you make it. The same goes for dated entries: a history entry on main dated after the fork is not on the fork.

Forking at **now** stores no date, which is a different thing: that line keeps following the one it left. Move the moment first if the two should genuinely part.

What a branch keeps to itself: its amendments, the entries you write while reading it, the scenes captured from sessions on it, the links drawn on it, the presences placed on it, and the stats recorded while playing on it. Everything else is **shared** — one row both lines read. That is what makes a branch cheap: forking does not copy the book, so an edit to a shared entry is made once and both lines see it.

Main sees only shared rows. A branch sees its own rows and the rows of the lines it came from, each up to its fork date — never a sibling's.

**Rename** and **Delete** are in the same menu. Deleting a line removes everything written on it: its amendments, its own entries, its scenes, the links drawn on it, the placements made on it and the stats recorded on it. Shared entries stay. Sessions played on it move to main and keep their story clock, and lines forked from it become lines off main.

**Compare ‹line› with main**, in the same menu, draws the two side by side: what this line has that main does not, and every shared entry or cast member the two read differently, field by field. It follows the moment, so you can compare the two stories as they stood at any date.

Nothing merges, by design. To take something across, read the line it is on and write it on the other.

Each session chooses which line it reads, and its story clock, in its [settings](./sessions.md#where-the-session-reads-its-lorebook). A new session starts on the line played most recently, following that line's present. The stats it inherits from the book follow both: on a branch, the lines it came from count only up to their fork dates; with a clock, only what was recorded by then. Lore retrieval reads the same way: the entries on the session's line, with history dated after its clock left out and the amendments dated by then applied.

## History and scenes

A history entry is anchored to a date: a year, optionally a month and a day. Entries are kept in date order by the editor, which refuses a date that would put an entry out of sequence with its neighbours. **Add the next date in sequence** (the calendar-plus button over the history list) adds a new entry one step after the latest: the next day; for an entry with only a year and month, the next month; for one with only a year, the next year. In a free-form book nothing rolls over (day 31 of month 1 becomes day 32 of month 1); with a calendar, the day after a month's last is the first of the next month, and the month after the year's last is the first of the next year.

A **scene** is a saved reference to a consecutive run of messages in a session, with a name, a generated summary, and who was present or mentioned. Scenes are captured from a session, never typed from nothing, and sit under the history entry they belong to. A message can be in only one scene: a capture that names messages from another session, or messages already in a scene, is refused and nothing is saved. **Process** has the model write or rewrite the summary from the messages. Once an entry has scenes, **Compile to entry** synthesizes their summaries into the entry's content, showing a word-level diff against what was there. Saving a compile writes only what changed: at now it changes the entry; while you are reading as of a date it files an amendment at that date, on the line you are reading.

## Calendar and clock

Both live in **Book settings**.

### The calendar

A book starts **free-form**: dates are numbers that sort, written `Year 412, Mo. 3, Day 5`. Months can go past 12 and days past 31, and nothing rolls over. That is a real choice, not a missing setting, and a book never has to leave it.

**Declare a calendar** to name the months and give them lengths. Start from a preset (twelve months and 365 days, or twelve months of thirty days) or from blank, then set:

- **Months** — a name and a length for each, in order.
- **Leap day** — one more day in one month, every so many years.
- **Week** — weekday names, and which one Year 1 begins on. Leave it empty and dates carry no weekday.
- **Years** — the word before the year (`Year`, or nothing), and **eras**: a name and the year it starts. An era that **counts down** runs toward the next one (300, 299 … 1), which is how a "before" era works. An era only changes how a year is written; it never moves a date.

A live example over the editor shows how a date of this book will be written, and what the next date in sequence would be, as you edit: `Tuesday, 5 March, Year 412`.

**Every date already in the book has to fit before the calendar is saved.** As you edit, the editor checks the book's history entries, amendments, presences, fork dates and clocks against it and lists any that do not land (day 31 of a thirty-day month, month 13 of twelve) with the reason. Save stays off until that list is empty. Nothing is re-dated for you: change those dates where they are, or change the calendar so they land. Once a calendar is saved, dates are checked as they are written, so the list cannot fill up again.

With a calendar, every date in the workspace is written through it: the history list, the moment bar, amendments, presences, the Time and Lives lenses, and the date the model is told. A calendar changes how dates are written and how the next date steps; it never changes their order.

**Return to free-form** is offered from the editor and asks first. Every date keeps the numbers you typed; they stop being named, checked and rolled over.

### The clock

The **clock** is where the story stands: its present. With no clock set, the present is the newest history entry, which is what it always was. Set it when the story stands somewhere else: between entries, before the latest one, or with a time of day. **Next day** steps it on by the calendar, and **Follow the newest entry** clears it.

Each line has its own clock. The clock you set in Book settings, or with **Make this the present** on the moment bar, is the one on the line you are reading. A branch never stands at main's present: with no clock of its own, its present is the newest entry it can see — its own, or main's from before the fork.

**Each session can have its own clock too.** A session reading this book follows the present of the line it reads until its clock is set in its settings or advanced by a pipeline; that first clock starts from the line's present, and from then on it is the session's (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). Moving a session's clock — in its settings, or by a pipeline's **Advance story clock** step — never moves this book's present, and two sessions on one book can stand at different dates. A session told to follow the line's present has no clock of its own and reads the line's present as it moves.

The present — or, for a session with a clock of its own, that clock — is what the session is told the current date is, and what a character's age is measured against. It is also where the session reads the book from: history dated after it and amendments that have not happened by then are not read in. The moment bar is only yours; moving it never changes what a session reads.

## From a session to the graph

Turning a session into structured lore is four steps, each through the same modal shell: configure, run with live progress, review before anything is written.

1. **Summarize to lorebook**, from a session's selected messages: a scene under a history entry (the messages must be consecutive; any already in a scene are dropped from the selection), a world lore entry with an optional focus, or a character lore entry with a required focus. Drafts stream in batches, then a synthesis pass merges them.
2. **Process scene**, from History or Scenes, derives the summary and the cast lists from the underlying messages. An unfinished review reopens next time; the activity sidebar offers a shortcut to it.
3. **Compile to entry**, from a history entry with scenes, writes the dated content. Saving marks the entry completed; that content is what search, retrieval and prompts use.
4. **Build or extend the graph**, from the Graph lens (or **Extend Graph** in a session's workflow tab, which reads that session's scenes only), extracts cast members and relationships from summarized scenes and compiled entries. It stops at the review screen every time.

Scenes without a summary are skipped by the build, so a low "ready to process" count usually means a scene still waiting on step 2.
