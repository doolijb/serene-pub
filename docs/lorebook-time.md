# Time, history and branches

A lorebook can know **when** things happen. You can date what happened, change an entry from a date onwards without losing what it said before, and keep two versions of a story side by side. None of this is required: a book with no dates works exactly as described in [Lorebooks](./lorebooks.md). Read this page when your story has a timeline worth keeping.

:::note By the end of this page
You will know how to date your history, read your book as it stood at any point in the story, file a change that only starts at a date, and fork a second line of the story to try something else.
:::

## History entries and scenes

A **history entry** is something that happened, anchored to a date: a year, optionally a month and a day. The History list keeps them in date order and refuses a date that would put an entry out of order with its neighbours. History always stands at the top level of the book: it is never filed inside another entry, though other lore can be filed under it.

**A line holds one history entry per date.** Dates compare as the day: a time of day doesn't count. Partial dates are different dates, so *Year 2*, *Year 2, Month 5* and *Year 2, Month 5, Day 3* are three dates. Undated history entries are ignored by this rule. Creating an entry on a taken date, or moving one onto it, is refused: *‹line› already has a history entry for ‹date›. Open it, or choose another date.* The date is checked only when it changes, so an entry that was doubled before this rule can still be edited. Where a date already has two entries, the one made first is the day's entry. Everything that means "the entry of this day" uses that entry instead of making a second one: **Compile**, **Add the next date in sequence**, the **History entry** field's **New** in **Summarize to Lorebook**, and dropping a row on the timeline (below). A date that already has two is listed in [Loose ends](./lorebooks.md#finding-your-way-around-a-book) as **Two history entries on one date**.

A history entry without a year is listed under **Undated history** in the book's [Loose ends](./lorebooks.md#finding-your-way-around-a-book), which opens it with the date ready to fill in. In **Show as › Time** the timeline and the editor sit side by side, split by the same divider as the entry list (drag it, or use the arrow keys; the width is shared).

In **Show as › Time**, entries with no date are listed under **Not on the timeline**. Drag one onto the timeline to date it where you drop it, or press it to date it at the end of the timeline. A history entry opens in the editor with that date filled in, ready to save; saving is refused with the sentence above when the day is taken. Anything else dropped on a day that already has a history entry opens that entry with the row's name added to its text as a new paragraph, ready to save; only a day with no entry starts a new one. If the entry you have open has unsaved changes, you're asked first, and **Cancel** leaves it exactly as you typed it.

**Add the next date in sequence** (the calendar-plus button over the history list) adds an entry one step after the latest: the next day, or the next month or year if the latest entry only has a month or a year. When that next date already has an entry, that entry opens instead of a new one. The Chronicle's **Start new history entry** does the same.

A **scene** is a saved run of consecutive messages from a session, with a name, a summary and a list of who was there. You don't type scenes: you capture them from a session with **Summarize to lorebook**, and each one sits under the history entry it belongs to — in **Show as › Time**'s list, nested beneath it. Deleting the messages, or the whole session, later keeps the scene's name, summary and cast. A message can only be in one scene.

A scene started in a session isn't filed under a history entry straight away, and starting one never makes a history entry: the scene is *not yet compiled* until a history entry of its day is compiled. A day-count clock with no months (*Day 2*) dates by its year. A scene not yet compiled isn't listed under any history entry, but it is kept, copied with the book and exported (nested under its day's history entry, or under an empty history entry of its day when the book has none).

On a history entry with scenes, or whose day has scenes not yet compiled, **Compile to entry** has the model write the entry's content from its scenes, and shows you the changes before anything is saved. Pressing **Compile to entry** also takes in the scenes of the entry's day that aren't compiled yet: they are filed under it when you press **Save to Entry**; discarding leaves them not yet compiled. A scene of another day is left as it is.

At the top of the History list, **Not yet compiled** lists the scenes of the line you're reading that no history entry holds yet, by their day (a scene with no story clock is under **Undated**). Each day has one **Compile**: it compiles that day's scenes into the history entry of that day, and makes an empty one first when the day has none, on the line that owns the day (see [Forking](#forking); for **Undated**, the newest dated history entry, or one dated Year 1, Month 1, Day 1 when there is none). A day's entry made this way stays, even if you discard the review; the next compile of that day fills it. Click a scene's name to open it. A fork lists its own scenes; the scenes it reads from the line it came from are listed, and compiled, on that line. A scene not yet compiled that you open from a graph opens here, marked. See [Summarization](./summarization.md) for capturing scenes, processing them and compiling.

## Reading the book at a moment

The **moment bar** along the bottom of the workspace is the book's one place for time. From left to right it holds:

- the **line** chip, naming the line of the story you're reading (see [Branches](#branches));
- the moment in words: **Reading now**, or **Reading as of ‹date›**;
- the story's timeline, with a tick for every dated entry; its **now** end names the story's present;
- **Go to date…** and **Open timeline** (**Show as › Time**, the same timeline drawn large); and, while you read at a date, **Make this the present** and **Return to now**.

To move through the story:

- **Drag the timeline, click a tick, or use the arrow keys** to step between the book's dated moments.
- **Go to date…** stands you at any date, even one nothing happened on. A date the book's calendar doesn't have is refused, never rounded.
- **Return to now**, at the right end of the bar, brings you back.

While you read at a date, the whole bar is tinted, and beside the date it says what saving does there (see [Amendments](#amendments-changes-that-start-at-a-date)) and how many entries the book holds at that moment. The book shows what was true then: dated entries and links appear only once they've happened, and cast members who don't appear in the story yet are listed dimmed. Undated entries always show.

On a narrow screen, or docked beside a session, the bar folds to one line: the line chip, the moment, and **Return to now** while you're away from now. Tap the moment to open the rest of the bar, and tap it again to fold it.

The moment bar is only your view. Moving it never changes what a session reads; sessions have their own clock (see [The story clock](#the-story-clock)).

## Amendments: changes that start at a date

An **amendment** is a dated change to an entry. The entry itself, its **base**, stays as it was; the amendment says "from this date on, it reads like this". Read before the date and you see the base; read at or after it and you see the change.

Example: the chapel is a chapel until Year 7, when it burns. Stand at Year 7 on the moment bar, rewrite the chapel's content as a ruin, and save with **Save as of Year 7**. Sessions whose story stands before Year 7 still read about a chapel.

While you read as of a date, saving offers two choices:

- **Save as of ‹date›** files the change as an amendment, starting at that date, on the line you're reading. The date is the one you started typing at: if you move the moment bar while you have unsaved changes, the editor keeps its date, and the button still names it.
- **Change the base**, in the menu beside it, changes the entry itself, at every moment and on every line, including before the date you're reading. The menu warns you first.

At **now** there is one **Save** button, and it changes the base. If an amendment already in effect at now sets a field you changed, the entry still reads the amendment's version from its date on; the save tells you so and names the amendment, so you can edit or delete it instead.

Only the fields you actually edited are written. An entry with amendments lists them under the editor with their dates and what they change. Click a date to move an amendment, or **Delete** to remove it. A cast member's dated changes are listed the same way on their page, and follow a few rules of their own about cards and later changes: see [Changing a member over time](./lorebook-cast.md#changing-a-member-over-time).

A history entry's own date is not something an amendment changes: it's when the entry happened. Use **Change the base** to move it.

**Renames are recognised everywhere.** When an amendment renames a cast member or an entry, or gives a member another name, Serene Pub knows both the old name and the new one when it spots who is mentioned in messages and entries, on every line. So a renamed member is never suggested to you as a new cast member. **Search by meaning** works differently: it still compares against the entry's base text, not the amended text.

### Off for a while

**Off for a while…**, in the entry's ⋯ menu, switches an entry off for a period: a date it stops being read, and optionally a date it comes **back**. An entry off from Year 3 until Year 6 is off at Year 5 and on again at Year 6. Leave the second date blank and it stays off from then on.

Behind the scenes this is two amendments, one at each end, so it follows the same rules: on a branch it only affects that branch.

A place that is off at a session's point in the story isn't part of that session's world: nobody can move there or leave things there until it's back. See [Places](./lorebook-places.md#a-place-that-is-off).

## Calendar and clock

Both live in **Book settings**. The calendar editor is there only with [advanced controls](./themes-and-settings.md#show-advanced-controls) on; the story's present is there either way, and a calendar already declared keeps writing every date.

### The calendar

A book starts **free-form**: dates are plain numbers, written `Year 412, Mo. 3, Day 5`. Months can go past 12 and days past 31, and nothing rolls over. That's a real choice, not a missing setting; many books never need more.

To name your months and give them lengths, declare a calendar: start from **Twelve months, 365 days**, **Twelve months of thirty days** or **Start blank**, then set:

- **Months**: a name and a length for each, as many as your world has.
- **Leap day**: one more day in one month, every so many years.
- **Week**: weekday names, and which one Year 1 begins on. Leave it empty for no weekdays.
- **Years**: the word before the year (`Year`, or nothing), and **eras**, each with a name and the year it starts. An era that **counts down** runs toward the next one (300, 299 … 1), which is how a "before" era works.

A live example over the editor shows how a date will be written, such as `Tuesday, 5 March, Year 412`.

**Every date already in the book has to fit before the calendar is saved.** The editor lists any that don't (day 31 of a thirty-day month, say) with the reason, and **Save calendar** stays off until the list is empty. Nothing is re-dated for you: change those dates, or change the calendar so they fit. From then on, dates are checked as they're written.

With a calendar, every date in the workspace and the date the model is told are written through it. A calendar never changes the order of dates, only how they're written and how the next date steps.

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

- the date the session's model is told it is,
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

### Comparing, renaming and deleting

**Compare ‹line› with main** shows the two side by side: what this line has that main doesn't, and every shared entry or cast member the two read differently, field by field. It follows the moment bar, so you can compare the stories at any date.

Each line in the menu has **Rename** and **Delete** buttons. Deleting a line removes everything written on it; shared entries stay. Sessions playing on it move to the line it forked from, and lines forked from it now fork straight from that line. The confirmation tells you what will happen before you agree.

Nothing ever merges between lines, by design. To take something across, read the line it's on and write it on the other.

### Which line a session reads

Each session chooses its **Line** and its **Story clock** in its settings (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). A new session starts on the line played most recently. The session then reads the entries on its line, as amended up to its clock, and whatever it writes to the book lands on that line, dated where its story stands.

A branched session (**Branch off at a point**, or **Branch from here** on a book) gets its own line the first time it **writes to the lorebook**: a version, a value, a summary's save, a person's own entry or a scene compile. The fork happens inside the write, so a write that is refused forks nothing. A session whose scenes end by themselves keeps a pipeline's new entries, rooms, history days and links in its own notes instead; its line is made by its **first Apply** (pressed, or by itself as a scene closes), inside the Apply, so an Apply with nothing to apply forks nothing. When it forks, the session's own scenes that aren't compiled yet move onto the new line with it. Starting or ending a scene isn't a lorebook write, so it forks nothing.

**Compiling forks first.** Pressing **Compile** for a day forks any branch session that still rides the line being compiled (reading this book) before it reads the day's scenes, so that session's scenes move to its own line and are compiled there. When the only scenes waiting were such a session's, the press is refused: *The scenes waiting here belong to a branch session, which compiles them on its own line.*

When a session is reading your book, the line under the book's name says so: **Read by** the session, its line and clock when those aren't main at now, and how many entries reached its last turn. If you've moved the moment bar or switched lines, **Read what it reads** puts you back on the session's line at its clock.
