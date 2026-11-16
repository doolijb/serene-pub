# Time, history and branches

A lorebook can know **when** things happen. You can date what happened, change an entry from a date onwards without losing what it said before, and keep two versions of a story side by side. None of this is required: a book with no dates works exactly as described in [Lorebooks](./lorebooks.md). Read this page when your story has a timeline worth keeping.

:::note By the end of this page
You will know how to date your history, read your book as it stood at any point in the story, file a change that only starts at a date, and fork a second line of the story to try something else.
:::

## A lorebook's timeline

🚧 Everything on this page (dates on entries, dated changes, history entries, the calendar and the story clock) is the lorebook's **timeline**. A lorebook either keeps one or it doesn't. A lorebook with no timeline:

- **is read as it stands now.** Every dated change in force now applies. A story clock already set (the session's, the lorebook's or a line's) is kept but not read.
- **has no story date.** The model isn't told a date, and a session's lines aren't stamped with a story time.
- **writes nothing dated.** A session's new entries and changes are undated. A pipeline's history day isn't written: the run goes on and its notes say *This lorebook has no timeline, so no history is kept.* **Compile**, and filing a scene under a history entry, are refused with the same sentence. Scenes themselves are kept as before.
- **stands still in time.** **Time passes…**, moving a session's **Story clock** by hand and a pipeline's move are refused with *This lorebook has no timeline, so its story time doesn't move.*, and each round's move does nothing.
- **refuses a dated setting.** Setting the lorebook's own story clock is refused with *This lorebook has no timeline, so its story time doesn't move.*, and its calendar with 🚧 *This lorebook has no timeline, so nothing dated is written to it.* **Summarize to Lorebook**'s **New** history day is refused with *This lorebook has no timeline, so no history is kept.*, and a keeper's proposed clock move isn't offered. A pipeline's change to a history entry keeps the entry's date: the date part is dropped and the rest of the change is written.
- **keeps a session's dated changes waiting.** On the session's **This session only** card, a dated change waits, marked 🚧 *This lorebook has no timeline, so nothing dated is written to it.*, with no **Apply to the lorebook**; a history day of the session's notes waits, with *This lorebook has no timeline, so no history is kept.* Nothing is applied undated and nothing is dropped: they apply once the timeline is on again.
- **travels with an export.** A lorebook with no timeline exports with that said, and imports with no timeline; one with a timeline exports as before. Other ways in (the one-file import, the 0.5 upgrade, provided books) arrive with a timeline, and an import that overwrites an existing lorebook keeps its switch.

Having no timeline deletes nothing: dated changes, history entries, the calendar and every clock stay stored, and a lorebook that keeps a timeline again reads them as before. [Branches](#branches) aren't part of the timeline: a branched session still gets its own line.

🚧 An update to Serene Pub once switched the timeline off for lorebooks that held nothing dated and that no story-time session read. Such a lorebook says so on its **Timeline** card in Book settings: *An update switched this off because nothing in this lorebook was dated. Switch it on to keep dates, history and a story clock.* The line goes once you set the switch yourself.

A session follows the timeline of the lorebook it reads. Its [Session notes](./lorebooks.md#your-sessions-own-notes) copy that lorebook's switch, and decide only for a session whose lorebook is its notes. The switch is the lorebook owner's alone.

### Setting the switch

🚧 **Book settings › Timeline** is a card with a switch, for the lorebook's owner (it isn't shown on a shared book or a read-only provided one). Its help line says *Dates, versions over time, history and a story clock. Turn it off for a world where nothing needs a date.* Switching on saves at once. Switching off, a lorebook that holds dated versions, history entries, entries with a beginning, cast presences or a set clock (its own or a line's) asks in place, naming only what it holds: *This lorebook has 3 dated versions, 2 cast presences and a story clock. With the timeline off that is hidden, not deleted, and sessions read the lorebook as it stands now. A timeless copy keeps this one as it is.* With more than one line, the prompt adds *The copy is made from the line ‹name›.* The buttons, in order, are **Cancel**, **Switch off here** and **Make a timeless copy** (the recommended way out, the gold one). A lorebook with none of these switches off at once. A refusal shows in the card. Open sessions on the lorebook read it again when the switch flips.

🚧 **Make a timeless copy** makes a new lorebook named *‹name› (timeless)* that keeps each entry and cast member as it reads now on the line you're reading, every dated change on that line applied, with no dates. Links and stats are as they stand now: a link that changed over time keeps only its latest version. Scenes are kept, not filed under history. It has no history entries, dated changes, presences, other lines, clock or calendar, and its timeline is off. The original is not changed and its switch stays on; the copy opens. If the copy is refused, the card says why and the prompt stays, so **Switch off here** and **Cancel** are still there. A session's notes are offered only **Switch off here** and **Cancel**.

[Session notes](./lorebooks.md#your-sessions-own-notes) over a lorebook show *On: these notes follow their lorebook's timeline.* (or *Off: …*) and no switch.

🚧 **Lorebooks › New**, on the **Blank** way, has a **Keep a timeline** switch, **off** by default: *Dates, history and a story clock. You can turn it on later in Book settings.* **Start from a starter lorebook** and **Make a lorebook from this kit** show no switch. The **New lorebook** window on the start screen, when you start a session, asks the same on its **Blank** way, off by default. A session that starts on its own notes decides their timeline from its preset and genre instead (see [A timeline for a new session](./sessions.md#a-timeline-for-a-new-session)).

🚧 On the first start after this arrived, each lorebook was set once. It **kept** its timeline when it held anything dated (a clock, a line, a calendar of its own, a dated change, any history entry) or when any session that reads it, or whose notes it is, plays a genre that keeps story time (Story, the Lair, Dungeon Crawler) or a genre that is no longer there, archived or not. Otherwise it was switched **off**: a hand-made lorebook read only by Chat or Guide sessions, or by none, with nothing dated. Starter lorebooks are never switched this way, and session notes over a lorebook copy it. It ran once; a switch you make later stands.

### What you won't see

🚧 With the timeline off, nothing is shown in place of these. Switch it on and everything is as before.

- **The moment bar.** When the lorebook has a second line, the line chip stands alone where the bar was (switch line, **Fork**, **Compare**, **Rename**, **Delete** as before); with one line, nothing. The book is read at now, so a date in a link isn't read.
- **The Time and Lives views** in **Show as**. A link to either opens the default view.
- **History.** The **History** view in the scope list (it isn't counted in **Everything**), and history entries in every list and search in the lorebook, hidden, not deleted. A link to the History view or to a history entry opens the lorebook's default view. Also the **History** choice in **New**, **Add the next date in sequence** and every **Compile** (*Not yet compiled*, **Compile to Entry**, the entry's **Scenes** tab).
- **An entry's Beginning.** Its row says the decay and the entry's own fields, with no line and no Beginning (*Decay: Fact · no keywords · top level*); see [Beginning and decay](#beginning-and-decay).
- **Dated saving.** An entry's versions rail, **Save as a new version…** and the entry row's line words (only **Save** is offered, and it saves in place); a cast member's versions rail and its **Save as a new version…**; a history entry's **Save as of** and **Change the base** and its list of dated changes; and **Off for a while…**.
- **Dates on links and presences.** A link's **When**, and a place link starts undated. A cast member's presences: when they arrive, leave, and how old they are while here.
- **"As of ‹date›"** in the line that says what a session reads, and the **Story clock** and **Calendar** editors in Book settings. Where a session's settings or the start screen's **Branch off at a point** read a lorebook with no timeline, they show the **Line** alone, read-only: *The line is which version of the lorebook this session reads; Main is the original.* then *Turn on advanced controls to change it.* or, for a session you don't own, *The session owner chooses it.* (a session whose lorebook is its own notes still shows its clock there for now).
- **The session's clock and history choices.** The session page reads its lorebook's switch and again when it flips. **Summarize**'s scene path asks for no **History entry** and files the scene under none. Each message shows its real time, as nothing stamps a story time.
- **The Chronicle's time.** The session's **Chronicle** widget shows scenes only: no clock, no **Now**, no days and no **Earlier**. It says *This lorebook keeps no timeline, so there are no story dates here.* and lists every scene of the session in the order played (see [Session layout](./session-layout.md#the-widgets)).
- **Still drawn, though refused:** the **Time passes…** clock step on an action. It shows, and pressing it gives the sentence above.
- **Three chores in Loose ends:** **Undated history**, **Two history entries on one date** and **A line's own history before its fork**, neither listed nor counted.
- **Still there:** a cast member's **Timeline** tab, listing the scenes they are in in the order played, with no dates. The roster, who is in the world, at now.

The **Scenes** view lists the lorebook's scenes in the order they were played, with no dates and no compile. With the timeline on, it is as before, plus a **History** row at the end with the number of history entries; press it to open the History view (*Open History*).

## History entries and scenes

A **history entry** is something that happened, anchored to a date: a year, optionally a month and a day. The History list keeps them in date order and refuses a date that would put an entry out of order with its neighbours. History always stands at the top level of the book: it is never filed inside another entry, though other lore can be filed under it.

**A line holds one history entry per date.** Dates compare as the day: a time of day doesn't count. Partial dates are different dates, so *Year 2*, *Year 2, Month 5* and *Year 2, Month 5, Day 3* are three dates. Undated history entries are ignored by this rule. Creating an entry on a taken date, or moving one onto it, is refused: *‹line› already has a history entry for ‹date›. Open it, or choose another date.* The date is checked only when it changes, so an entry that was doubled before this rule can still be edited. Where a date already has two entries, the one made first is the day's entry. Everything that means "the entry of this day" uses that entry instead of making a second one: **Compile**, **Add the next date in sequence**, the **History entry** field's **New** in **Summarize to Lorebook**, and dropping a row on the timeline (below). A date that already has two is listed in [Loose ends](./lorebooks.md#finding-your-way-around-a-book) as **Two history entries on one date**.

A history entry without a year is listed under **Undated history** in the book's [Loose ends](./lorebooks.md#finding-your-way-around-a-book), which opens it with the date ready to fill in. In **Show as › Time** the timeline and the editor sit side by side, split by the same divider as the entry list (drag it, or use the arrow keys; the width is shared).

In **Show as › Time**, entries with no date are listed under **Not on the timeline**. Drag one onto the timeline to date it where you drop it, or press it to date it at the end of the timeline. A history entry opens in the editor with that date filled in, ready to save; saving is refused with the sentence above when the day is taken. Anything else dropped on a day that already has a history entry opens that entry with the row's name added to its text as a new paragraph, ready to save; only a day with no entry starts a new one. If the entry you have open has unsaved changes, you're asked first, and **Cancel** leaves it exactly as you typed it.

**Add the next date in sequence** (the calendar-plus button over the history list) adds an entry one step after the latest: the next day, or the next month or year if the latest entry only has a month or a year. When that next date already has an entry, that entry opens instead of a new one. The Chronicle's **Start new history entry** does the same.

A **scene** is a saved run of consecutive messages from a session, with a name, a summary and a list of who was there. You don't type scenes: you capture them from a session with **Summarize to lorebook**, and each one sits under the history entry it belongs to — in **Show as › Time**'s list, nested beneath it. Deleting the messages, or the whole session, later keeps the scene's name, summary and cast. A message can only be in one scene. A pipeline can leave a day's history entry out of a character's prompt when the character wasn't there for one of the session's scenes compiled into it (see [What a character was there for](./pipelines.md#what-a-character-was-there-for)).

A scene started in a session isn't filed under a history entry straight away, and starting one never makes a history entry: the scene is *not yet compiled* until a history entry of its day is compiled. A day-count clock with no months (*Day 2*) dates by its year. A scene not yet compiled isn't listed under any history entry, but it is kept, copied with the book and exported (nested under its day's history entry, or under an empty history entry of its day when the book has none).

On a history entry with scenes, or whose day has scenes not yet compiled, **Compile to entry** has the model write the entry's content from its scenes, and shows you the changes before anything is saved. Pressing **Compile to entry** also takes in the scenes of the entry's day that aren't compiled yet: they are filed under it when you press **Save to Entry**; discarding leaves them not yet compiled. A scene of another day is left as it is.

At the top of the History list, **Not yet compiled** lists the scenes of the line you're reading that no history entry holds yet, by their day (a scene with no story clock is under **Undated**). Each day has one **Compile**: it compiles that day's scenes into the history entry of that day, and makes an empty one first when the day has none, on the line that owns the day (see [Forking](#forking); for **Undated**, the newest dated history entry, or one dated Year 1, Month 1, Day 1 when there is none). A day's entry made this way stays, even if you discard the review; the next compile of that day fills it. Click a scene's name to open it. A fork lists its own scenes; the scenes it reads from the line it came from are listed, and compiled, on that line. A scene not yet compiled that you open from a graph opens here, marked. See [Summarization](./summarization.md) for capturing scenes, processing them and compiling.

## Beginning and decay

🚧 Every entry except a history entry has two more properties, shown in words in the entry's row under its fields: *Perpetual · Fact* until you change them (the row then goes on with the entry's keywords and where it is filed). Press the row to open it.

- **Beginning**: **Perpetual** (the entry has always been true) or **Began at** a date, typed like a history entry's (a year, optionally a month and a day, checked against the book's calendar). An entry that began at a date isn't read at a moment before it: not in the workspace while you read the book at an earlier date (it is dimmed and listed last, like a later history entry), and not by a session whose story stands earlier. On a branch it reads like any dated row: a branch forked before the date doesn't have it. Two entries may begin on the same day, and an entry may begin on a day a history entry holds. With the timeline off, Beginning isn't shown, a Beginning can be cleared but not set, and no moment is read, so a Beginning hides nothing on its own line (a branch forked before the date still doesn't have it).
- **Decay**: **Fact** or **Living**, with a rate from 0 to 1 on a slider (choosing **Living** starts at 0.25). The rate is stored, shown, copied and exported. Core never ranks by it and never puts it in the prompt; a pipeline can use it to rank the entry lower in recall (see the SDK guide [Make living entries fade in recall](./sdk/guides/time.md#make-living-entries-fade-in-recall)); the row says so.

Example: the Silver Bridge is built in Year 12. Give its entry **Began at** Year 12, and a session at Year 10 doesn't read about a bridge; one at Year 12 does.

A Beginning is part of the entry, like a history entry's date: a dated change can't move it or change the decay (*A dated change can't change an entry's decay: the decay is part of the entry, so changing it means changing the entry itself.*). A dated change can't come before the entry's Beginning (*This entry began at Year 12, so a change can't be dated Year 10, before it. Date the change at or after Year 12.*), and a Beginning can't be moved past the entry's earliest dated change (*This entry has a change dated Year 10, so it can't begin later, at Year 12. Move or delete that change first.*). A rate that isn't a number is refused (*Decay is a number from 0 to 1.*); one outside 0 to 1 is held to the nearest end.

Both travel with the entry: **Duplicate**, a lorebook file (written only when set, so a file without them reads as Perpetual and Fact), a starter lorebook's copy, and the edit history, whose **Restore** puts both back. A **timeless copy** keeps each entry's decay and drops its Beginning. Switching the timeline off counts entries with a Beginning among what it hides (*1 entry with a beginning*).

🚧 **What a session's new entry starts with.** When a session writes a new entry into a lorebook, under any write setting, it gets a Beginning and a Decay once, at creation: the entry type's default, then the writing step's values on top. The model never picks them. World lore, Character lore and Places start *Perpetual · Fact*; an Item starts *Began at* the session's story date · *Fact*. A ruleset's entry type may declare its own two defaults; one that says nothing starts *Perpetual · Fact*. The Beginning is set only when the session reads at a story date on a book with its timeline on; with the timeline off nothing gets a Beginning, but the Decay still applies. History entries keep their own date. A person's later change always wins, and nothing already in a book is changed. Example: a session standing at Year 12 writes a new item, the Brass Key. It starts *Began at Year 12 · Fact*, so a session at Year 10 doesn't read it. A new world lore entry from the same session starts *Perpetual · Fact*.

Cast members have neither: a cast member's presences already say when they are in the story.

## Reading the book at a moment

The **moment bar** along the bottom of the workspace is the book's one place for time (🚧 not drawn with the [timeline off](#what-you-wont-see)). From left to right it holds:

- the **line** chip, naming the line of the story you're reading (see [Branches](#branches));
- the moment in words: **Reading now**, or **Reading as of ‹date›**;
- the story's timeline, with a tick for every dated entry; its **now** end names the story's present;
- **Go to date…** and **Open timeline** (**Show as › Time**, the same timeline drawn large); and, while you read at a date, **Make this the present** and **Return to now**.

To move through the story:

- **Drag the timeline, click a tick, or use the arrow keys** to step between the book's dated moments.
- **Go to date…** stands you at any date, even one nothing happened on. A date the book's calendar doesn't have is refused, never rounded.
- **Return to now**, at the right end of the bar, brings you back.

While you read at a date, the whole bar is tinted, and beside the date it says what saving does there, for entries and cast members alike (*Saving here changes the version this date shows; Save as a new version… adds one.*; see [Versions of an entry](#versions-of-an-entry)) and how many entries the book holds at that moment. The book shows what was true then: dated entries and links appear only once they've happened, and cast members who don't appear in the story yet are listed dimmed. Undated entries always show.

On a narrow screen, or docked beside a session, the bar folds to one line: the line chip, the moment, and **Return to now** while you're away from now. Tap the moment to open the rest of the bar, and tap it again to fold it.

The moment bar is only your view. Moving it never changes what a session reads; sessions have their own clock (see [The story clock](#the-story-clock)).

## Versions of an entry


🚧 An entry can read differently from a date on. Each of those readings is a **version** of the entry: the entry from the beginning, then one version for each date it changes. The entry itself stays one entry; a version holds only what differs from the one before it (behind the scenes it is a dated change, an *amendment*).

Example: the chapel is a stone chapel until Year 7, when it burns, and it is rebuilt in timber in Year 9. That is one entry, the Hill Chapel, with three versions: *From the beginning* (a stone chapel), *Year 7* (a ruin) and *Year 9* (rebuilt). Sessions whose story stands before Year 7 read about a chapel.

In a lorebook that keeps a timeline, an entry's form has two parts:

- **The versions**, on a rail beside the fields, which start with the version's **Name** and **Content**: *From the beginning* (or *Began at ‹date›*), then each version in story order, each with what it changes (*changes name, content*). A version another line made (main's, or the line this one forked from) says *from ‹line›* and opens there with **Open on ‹line›**; you can't change it here. Changes on lines you aren't reading are listed under **Elsewhere** at the end, where you can still move or delete them. On a narrow screen, or docked beside a session, the rail becomes a row of chips above the fields.
- **The entry**, under them: one row that says, closed, the line it lives on, its [Beginning and decay](#beginning-and-decay) and, while no version changes them, its keywords and where it is filed, then *pinned* or *off* when set (*On main · Perpetual · Fact · no keywords · top level*). Press it to open **Beginning**, **Decay**, **Keywords**, **Part of**, **Pinned** and **Off**. These are true at every date: changing one here changes the entry itself.

**Selecting a version moves the moment bar** to its date, and the fields show that version whole: the entry with every version up to it applied. The rail always shows the version in force at the moment bar's date, so moving the bar selects the version in force then; *From the beginning* moves it to the year before the first version. With unsaved changes, a move that would show another version asks first: keep editing, or discard.

- **Save** saves the version you're looking at: *From the beginning* changes the entry itself, a later version changes that version. Only the fields you edited are written. When other lines read the entry, saving the entry itself says so before you save: it reads that way everywhere, on every line and at every moment, until a later version changes it.
- **Save as a new version…** asks for a date (it starts at the moment bar's) and saves what you changed as a new version there; the version you were looking at stays as it was. **+ Add a version here**, between two versions on the rail, does the same with the date kept between them; the new version starts as the one before it, so you then change what differs. An entry has one version per line and date: saving a new version at a date that already has one changes that one, and the dialog says so first.
- **Change its date** moves a version; what it says stays the same. A version can't be dated before the entry's Beginning, or onto a date that already has a version on that line.
- **Delete this version** removes it after asking; from then on the entry reads as the version before it, and the version's edit history goes with it. *From the beginning* has no delete: deleting the entry is the entry's own action.

🚧 **Sessions write versions too.** Under **Full** on your own lorebook, a session that plays at a story date writes its change to an entry as the version at the session's date on its line, at once (see [What a session may write](./lorebooks.md#what-a-session-may-write)); a second change that day, from it or another session, changes that version. Its edits are listed under the version as a routine's. A swipe, a regenerate or **Back** takes the turn's part back (see [Changes from a replaced reply](./lorebooks.md#changes-from-a-replaced-reply)); once you have edited that version yourself, taking the turn back leaves its part, and the entry says it was written by a reply that was since replaced.

**Keywords, Part of, Pinned and Off** belong to the entry until a version changes them. While a version is selected, **Change from this version…** in the open row lists those not changed yet; choosing one moves it into that version's fields, under the name and content, marked *differs by version*; from then on each version on this line has its own. **Make it the same everywhere** puts it back: after saying how many versions change, it takes the field out of each of this line's versions and the entry keeps the value of the version shown. When a version another line made also changes the field, it can't be made the same from here, and the action says why. An entry already switched **Off for a while…** shows Off as *differs by version*.

The entry's **edit history** sits on the rail under the version each edit changed, with **Restore** as usual; **Edits** at the top of the rail hides them all (your browser remembers the choice). On a narrow screen the edits of the version shown are in a fold under the fields, *Edits to this version*.

On a line that doesn't own the entry (a fork reading main's entry), the entry and *From the beginning* are read-only, with **Open on ‹line›**; the fork's own versions are yours to change, and **Save as a new version…** saves on the fork.

A history entry has no versions: it is a date. It keeps the older form: while you read as of a date, **Save as of ‹date›** files the change as a dated change on the line you're reading, **Change the base**, in the menu beside it, changes the entry itself at every moment and on every line (the menu warns you first), and its dated changes are listed under the editor, where a click on a date moves one and **Delete** removes it. A history entry's own date is not something a dated change changes: use **Change the base** to move it. A cast member has versions on the same rail as an entry, not the older form: see [Changing a member over time](./lorebook-cast.md#changing-a-member-over-time).

**Renames are recognised everywhere.** When an amendment renames a cast member or an entry, or gives a member another name, Serene Pub knows both the old name and the new one when it spots who is mentioned in messages and entries, on every line. So a renamed member is never suggested to you as a new cast member. **Search by meaning** works differently: it still compares against the entry's base text, not the amended text.

### Off for a while

**Off for a while…**, in the entry's ⋯ menu (🚧 not with the timeline off), switches an entry off for a period: a date it stops being read, and optionally a date it comes **back**. An entry off from Year 3 until Year 6 is off at Year 5 and on again at Year 6. Leave the second date blank and it stays off from then on.

Behind the scenes this is two amendments, one at each end, so it follows the same rules: on a branch it only affects that branch.

A place that is off at a session's point in the story isn't part of that session's world: nobody can move there or leave things there until it's back. See [Places](./lorebook-places.md#a-place-that-is-off).

## Calendar and clock

Both live in **Book settings** (🚧 not with the timeline off). The calendar editor is there only with [advanced controls](./themes-and-settings.md#show-advanced-controls) on; the story's present is there either way, and a calendar already declared keeps writing every date.

### The calendar

A book starts **free-form**: dates are plain numbers, written `Year 412, Mo. 3, Day 5`. Months can go past 12 and days past 31, and nothing rolls over. That's a real choice, not a missing setting; many books never need more.

To name your months and give them lengths, declare a calendar: start from **Twelve months, 365 days**, **Twelve months of thirty days** or **Start blank**, then set:

- **Months**: a name and a length for each, as many as your world has.
- **Leap day**: one more day in one month, every so many years.
- **Week**: weekday names, and which one Year 1 begins on. Leave it empty for no weekdays.
- **Years**: the word before the year (`Year`, or nothing), and **eras**, each with a name and the year it starts. An era that **counts down** runs toward the next one (300, 299 … 1), which is how a "before" era works.

A live example over the editor shows how a date will be written, such as `Tuesday, 5 March, Year 412`.

**Every date already in the book has to fit before the calendar is saved.** The editor lists any that don't (day 31 of a thirty-day month, say) with the reason, and **Save calendar** stays off until the list is empty. Nothing is re-dated for you: change those dates, or change the calendar so they fit. From then on, dates are checked as they're written.

With a calendar, every date in the workspace and the date the model is told are written through it. A calendar never changes the order of dates, only how they're written and how the next date steps. A history day's distance from now is a numeric date delta (see [Dates in a layout](./context-templates.md#dates-in-a-layout)): a calendar counts it exactly, and in a free-form book, where a part can't be counted without a calendar, the finer parts are left out (Year 7 month 11 to Year 8 month 2 is `-0y`).

**Edit the calendar** changes it later. **Return to free-form** keeps every date's numbers and stops naming and checking them.

### The story clock

The **clock** is where the story stands: its present. With no clock set, the present is the newest history entry. **Set the clock** when the story stands somewhere else: between entries, before the latest one, or at a time of day. Once set, **Next day** (or **Next month**, **Next year**, as precise as the clock's date) steps it on, **Move the clock** changes it, and **Follow the newest entry** clears it. While reading as of a date, **Make this the present** on the moment bar sets the clock there.

**Each session can have its own clock.** A session follows the book's present until you set its **Story clock** in the session's settings, or a pipeline step such as **Advance story clock** moves it (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). Two sessions on one book can stand at different dates, and moving a session's clock never moves the book's. **Next chapter** starts the new session at the followed session's own clock (see [Next chapter](./sessions.md#how-it-starts)). The session's **Chronicle** widget shows its clock and moves it in place: **Next day**, **Move the clock…** and **Follow the line's present** (see [Session layout](./session-layout.md#the-widgets)).

**What moves a session's clock.** Only a person or a fixed tick, never the model on its own:

- **Time passes…**, an action above the composer, moves it by the amount you pick (see [Sessions](./sessions.md#time-passes)).
- In Story, the routine **Note what changed** can suggest how long a scene or a rest took, with its **Move the clock** switch, which ships off on every Story preset. Switched on, the clock moves only when you accept, with the routine on **Review**, or at once on **Full** (see [What runs between turns](./genre-story.md#what-runs-between-turns)). When you move the clock with **Time passes…** first, the routine's own guess for that turn is dropped; it shows on the run's receipt, not in the conversation.
- Each genre has one default owner that moves the clock when a round ends (everyone taking part has had a turn). In Story it is the pipeline **Each round moves the clock**, which runs with no model. 🚧 In the Lair, too, it is **Each round moves the clock**, in every preset, whether or not **Keep the books** is on. The [Dungeon Crawler](./genre-dungeon-crawler.md#rest-and-time-passing) moves its clock by the minutes the Planner says each round took. The Guide and Chat keep real time and have none of this.
- The step both Story and the Lair take is the session's **Minutes each round moves the clock** (5 by default, 0 turns it off). The session's owner changes it under **Edit session › Settings**, in the genre's settings block: Story's under **Turns**, the Lair's under **Lair**; a preset may set or lock it. Any pipeline, a plugin's too, can read it and choose whether to follow it (see [Pipelines](./pipelines.md)).
- A round's move happens only for a story whose clock is set: the session's own, or the clock set on its lorebook's line. A story with no clock set is left alone and no line is written, so it never starts a clock (a lorebook whose present is only its newest history entry counts as no clock here).
- The session's settings and the **Chronicle** widget, by hand.

🚧 **Moving a session's clock back past what it wrote follows its On revision.** When the move would go back before dated things this session has written into the lorebook (an entry's version, a cast member's version, a scene, a dated tie), it asks first and says which mode is in force: under **Overwrite** the clock moves back and nothing is removed, so the later things read again when the story reaches their dates; under **Branch** the session is branched at its newest message and only the branch moves back, getting its own line from that date at its first write. Perpetual entries and undated ties read on both lines. Things other sessions wrote never count. **Time passes…** with **Back** is refused instead of asking, and no pipeline moves the clock back past them by itself (see [On revision](./sessions.md#on-revision)).

A clock with a time of day but no date (a year and an hour, say) can't run past midnight: once a round's move would carry it there, that move and every one after it is refused with *The clock has no date at ‹time›, so it can't run past midnight.*, until you give the clock a date.

**Every move leaves a line, and goes back with its message.** A move made by **Time passes…**, by the reckoning, by an accepted suggestion or by a round's move shows under the message it came with, beside that turn's other changes: *Time passes: 3 hours (…, 14:00 → …, 17:00)*. A round's move shows under the line that ended the round. Delete that message, or regenerate or swipe the reply, and the clock steps back by the same amount, the way a stat goes back with the line that changed it. A move you made by hand since stays where you put it. Two exceptions:

- A round's move stays when the reply is regenerated or swiped, because the new reply doesn't end the round again. Deleting the message takes the move back.
- A session that has gone back to following its line's present has no clock of its own to step back, so nothing moves.

If the calendar can't place the step back (the clock was set somewhere the step would run off the calendar), the delete, regenerate or swipe is refused and says why.

A story with no clock yet (nothing in the lorebook is dated and no clock is set; a session that reads no shared lorebook keeps its clock in its Session notes, unset until a person or a pipeline sets one) starts its clock on the story's first day (Year 1, month 1, day 1) when a move is asked for: **Time passes…** and the **state-keeper's move or suggestion in Story** start it there and move it from there, as a pipeline's move **until** a time does, and the line reads as any other move. A round's move never does: with no clock set it moves nothing and writes no line.

When the clock can't take the step, the line says *not moved* and why. A clock with a time of day but no date can't run past midnight: *Time passes: 3 hours, not moved. The clock has no date at Year 1, 23:00, so it can't run past midnight.* One with no day can't count days: *The clock has no day at Year 1, so it can't count days.*

A move made before the session has any line at all, not even a greeting, shows at the head of the conversation, above the first message. Once there is a line, a move shows under the newest one, a greeting included.

**A branched session starts with the clock as it stood at the message it was branched from.** **Branch from here** gives the copy the original's clock with every move made after that message taken off, and copies the moves up to it under their copied lines. A session following its line's present gives the branch the present. A move you made by hand after that message isn't recorded, so the branch keeps it.

Every line in a session is stamped with the clock as it stood when the line was written, so each line shows that time instead of the real one (hover it for the real time), the conversation can mark each new day, and a session can [suggest a new scene](./sessions.md#when-a-new-scene-begins) when the day changes or time passes. **Time passes…**, a move you make by hand, an accepted suggestion and the state-keeper's move under **Trust the narrator** all count as time passing; a round's move doesn't.

The present, or the session's own clock, is:

- the date the session's model is told it is (🚧 and, with a clock set, how far each history day it reads is from that date, as a number of years, months and days such as `-0y 0m 2d`; with no clock set, nothing of the kind),
- what a character's age is measured against, and
- where the session reads the book from: history dated later, and amendments that haven't happened yet, are left out.

## Branches

A **branch** is another line of the same story: what if the duel had gone the other way? The line chip at the left end of the moment bar says which line you're reading. **main** is the line every book starts with.

### Forking

**Fork ‹line›**, in the chip's menu, makes a new line from the one you're reading, at the moment you're reading (the button says **Fork ‹line› at ‹date›** when you're reading at a date). Name the new line and press **Fork it**.

- **Fork while reading at a date** and the two lines part **at that date**. From then on, a change on one isn't a change on the other. A line forked at Year 3 never reads anything dated Year 4 on main, however long afterwards it's written.
- **Fork at now** stores no date: the new line keeps following the one it left. Move the moment first if the two should really part.

Forking doesn't copy the book. Entries both lines share are one row, so editing a shared entry changes it for both. What a branch keeps to itself:

- the amendments filed while reading it,
- entries written while reading it (history only on dates after its fork date, see below),
- scenes captured from sessions playing on it,
- links drawn on it,
- presences placed on it (see [Cast](./lorebook-cast.md#when-a-cast-member-is-in-the-world)), and
- stats recorded while playing on it, or set on a place while reading it.

**A fork owns history entries only for dates strictly after its fork date.** On or before it, the day's entry belongs to the line it forked from (or further up), and the fork changes that day through an amendment, as compile does for an entry the branch shares (see [Compiling scenes into a history entry](./summarization.md#compiling-scenes-into-a-history-entry)). When compile needs a day's entry on or before the fork and there is none, it makes an empty one on the line that owns the day. Creating or moving a history entry on a fork onto such a date is refused: *‹line› shares everything up to ‹fork date› with ‹owning line›. Change that day here as an amendment, or choose a later date.* A fork with no fork date (made with **Fork at now**) owns no dated history: *‹line› follows ‹owning line› with no fork date, so its dated history is ‹owning line›'s. Change that day here as an amendment.* A history entry a fork already holds on or before its fork date, made before this rule, is listed in [Loose ends](./lorebooks.md#finding-your-way-around-a-book).

Main sees only shared rows. A branch sees its own rows, plus those of the lines it came from up to its fork date, and never a sibling's.

To take a single entry out of one line only, use **Off for a while** while reading that line, rather than deleting it: deleting a shared entry deletes it from every line, and the confirmation says so.

### Moving an entry down the tree

🚧 An entry written on a branch can be moved, for good, to a line that branch was forked from: its parent, the parent's parent, and so on down to **main**. Open the entry while reading its own line and press **Move down the tree…** beside its line at the end of the entry's open row (with the [timeline](#a-lorebooks-timeline) off, it's in the entry's **⋯**). Only the lorebook's owner can. The dialog lists the entry's line (*Here now*) and each line below it, main last.

- **A perpetual entry** can move to any line below. **An entry with a Beginning** moves only as far as its date allows: every fork on the way must come on or after the date it began. A line it can't reach is shown with the reason, *‹entry› began at Year 5; ‹line› left ‹parent› at Year 3.* (with the timeline off, *‹line› left ‹parent› before ‹entry› began.*).
- **Entries filed under one another move together.** Moving an entry also moves the entry it's filed under when that one is on the same line, and every entry filed under it there. The dialog names them (*Also moves …*), and **Cancel** moves nothing.
- The dialog names the lines that **start reading** the entry: the line you move it to, and the lines forked from that one whose fork the entry's date reaches. Sessions playing on them read it from their next reply. The line it leaves, and every line forked from that one, read it exactly as before.
- **From the entries list:** **Could exist here** lists the entries of lines forked from the one you're reading, each with **Move down the tree…** to bring it here, and **Bulk edit** moves several entries of one line in one go, after one confirmation naming how many (see [Finding your way around a book](./lorebooks.md#finding-your-way-around-a-book)).
- **What stays:** its versions and links written on the old line stay on that line and still apply there. The line you move it to reads the entry without them.
- **It can't be moved back**, and the move isn't kept in the entry's [edit history](./lorebooks.md#edit-history). Deleting the old line no longer deletes the entry; deleting the line it moved to does.
- **Refused**, with the reason: History entries (each line keeps one for each date); an entry that a session's turn made or changed and can still take back (*A session's turn made or changed ‹entry› and can still take it back. It can move once that scene settles, or once you keep or revert that change.*); entries in a session's notes; a lorebook that comes with the pub or a plugin. With unsaved changes in the form, the dialog asks you to save or discard them first.

### Comparing, renaming and deleting

**Compare ‹line› with main** shows the two side by side: what this line has that main doesn't, and every shared entry or cast member the two read differently, field by field. It follows the moment bar, so you can compare the stories at any date.

Each line in the menu has **Rename** and **Delete** buttons. Deleting a line removes everything written on it; shared entries stay. Sessions playing on it move to the line it forked from, and lines forked from it now fork straight from that line. The confirmation tells you what will happen before you agree.

Nothing ever merges between lines, by design. [Moving an entry down the tree](#moving-an-entry-down-the-tree) is the one way an entry changes line: it moves that entry toward main, and never copies it to a sibling line, moves it up or merges anything. To take anything else across, read the line it's on and write it on the other.

### Which line a session reads

Each session chooses its **Line** and its **Story clock** in its settings (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). A new session starts on the line played most recently. The session then reads the entries on its line, as amended up to its clock, and whatever it writes to the book lands on that line, dated where its story stands.

A branched session (**Branch off at a point**, or **Branch from here** on a book) gets its own line the first time it **writes to the lorebook**: a version, a value, a summary's save, a pipeline's new entry, room, history day or link, a person's own entry or a scene compile. The fork happens inside the write, so a write that is refused forks nothing. A pipeline's change to an entry of the line it was branched from never forks: it waits in the session's own notes. 🚧 Nor does a link with an end still waiting in the notes, or a history day the notes take (one for a date the notes already hold, or, in a session whose scenes end by themselves, one the line would not own; see [What a session may write](./lorebooks.md#what-a-session-may-write)): both are written in the notes. What waits in the notes (that, and everything under **Review changes** or **Off**) gets the session's line at its **first Apply** (pressed, or by itself as a scene closes), inside the Apply, so an Apply with nothing to apply forks nothing. When it forks, the session's own scenes that aren't compiled yet move onto the new line with it. Starting or ending a scene isn't a lorebook write, so it forks nothing.

**Compiling forks first.** Pressing **Compile** for a day forks any branch session that still rides the line being compiled (reading this book) before it reads the day's scenes, so that session's scenes move to its own line and are compiled there. When the only scenes waiting were such a session's, the press is refused: *The scenes waiting here belong to a branch session, which compiles them on its own line.*

When a session is reading your book, the line under the book's name says so: **Read by** the session, its line and clock when those aren't main at now, and how many entries reached its last turn. If you've moved the moment bar or switched lines, **Read what it reads** puts you back on the session's line at its clock.
