# Time, history and branches

A lorebook can know **when** things happen. You can date what happened, change an entry from a date onwards without losing what it said before, and keep two versions of a story side by side. None of this is required: a book with no dates works exactly as described in [Lorebooks](./lorebooks.md). Read this page when your story has a timeline worth keeping.

:::note By the end of this page
You will know how to date your history, read your book as it stood at any point in the story, file a change that only starts at a date, and fork a second line of the story to try something else.
:::

## History entries and scenes

A **history entry** is something that happened, anchored to a date: a year, optionally a month and a day. The History list keeps them in date order and refuses a date that would put an entry out of order with its neighbours. History always stands at the top level of the book: it is never filed inside another entry, though other lore can be filed under it.

A history entry without a year is listed under **Undated history** in the book's [Loose ends](./lorebooks.md#finding-your-way-around-a-book), which opens it with the date ready to fill in. In the **Time** lens the timeline and the editor sit side by side, split by the same divider as the entry list (drag it, or use the arrow keys; the width is shared).

In the Time lens, entries with no date are listed under **Not on the line**. Drag one onto the line to date it where you drop it, or press it to date it at the end of the line. A history entry opens in the editor with that date filled in, ready to save; anything else gets a new dated history entry about it. If the entry you have open has unsaved changes, you're asked first, and **Cancel** leaves it exactly as you typed it.

**Add the next date in sequence** (the calendar-plus button over the history list) adds an entry one step after the latest: the next day, or the next month or year if the latest entry only has a month or a year.

A **scene** is a saved run of consecutive messages from a session, with a name, a summary and a list of who was there. You don't type scenes: you capture them from a session with **Summarize to lorebook**, and each one sits under the history entry it belongs to — in the **Time** lens's list, nested beneath it. Deleting the messages, or the whole session, later keeps the scene's name, summary and cast. A message can only be in one scene.

On a history entry with scenes, **Compile to entry** has the model write the entry's content from its scenes, and shows you the changes before anything is saved. See [Summarization](./summarization.md) for capturing scenes, processing them and compiling.

## Reading the book at a moment

The **moment bar** along the bottom of the workspace is the story's timeline. It has a tick for every dated entry, and its **now** end names the story's present.

- **Drag it, click a tick, or use the arrow keys** to step between the book's dated moments.
- **Go to date…** stands you at any date, even one nothing happened on. A date the book's calendar doesn't have is refused, never rounded.
- **Return to now** (in the banner above the editor) brings you back.

While you read at a moment, the book shows what was true then: dated entries and links appear only once they've happened, and cast members who don't appear in the story yet are listed dimmed. Undated entries always show.

The moment bar is only your view. Moving it never changes what a session reads; sessions have their own clock (see [The story clock](#the-story-clock)).

## Amendments: changes that start at a date

An **amendment** is a dated change to an entry. The entry itself, its **base**, stays as it was; the amendment says "from this date on, it reads like this". Read before the date and you see the base; read at or after it and you see the change.

Example: the chapel is a chapel until Year 7, when it burns. Stand at Year 7 on the moment bar, rewrite the chapel's content as a ruin, and save with **Save as of Year 7**. Sessions whose story stands before Year 7 still read about a chapel.

While you read as of a date, saving offers two choices:

- **Save as of ‹date›** files the change as an amendment, starting at that date, on the line you're reading. The date is the one you started typing at: if you move the moment bar while you have unsaved changes, the editor keeps its date, and the button still names it.
- **Change the base**, in the menu beside it, changes the entry itself, at every moment and on every line, including before the date you're reading. The menu warns you first.

At **now** there is one **Save** button, and it changes the base. If an amendment already in effect at now sets a field you changed, the entry still reads the amendment's version from its date on; the save tells you so and names the amendment, so you can edit or delete it instead.

Only the fields you actually edited are written. An entry with amendments lists them under the editor with their dates and what they change. Click a date to move an amendment, or **Delete** to remove it.

A history entry's own date is not something an amendment changes: it's when the entry happened. Use **Change the base** to move it.

**Renames are recognised everywhere.** When an amendment renames a cast member or an entry, or gives a member another name, Serene Pub knows both the old name and the new one when it spots who is mentioned in messages and entries, on every line. So a renamed member is never suggested to you as a new cast member. **Search by meaning** works differently: it still compares against the entry's base text, not the amended text.

### Off for a while

**Off for a while…**, in the entry's ⋯ menu, switches an entry off for a period: a date it stops being read, and optionally a date it comes **back**. An entry off from Year 3 until Year 6 is off at Year 5 and on again at Year 6. Leave the second date blank and it stays off from then on.

Behind the scenes this is two amendments, one at each end, so it follows the same rules: on a branch it only affects that branch.

A place that is off at a session's point in the story isn't part of that session's world: nobody can move there or leave things there until it's back. See [Places](./lorebook-places.md#a-place-that-is-off).

## Calendar and clock

Both live in **Book settings**.

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

**Each session can have its own clock.** A session follows the book's present until you set its **Story clock** in the session's settings, or a pipeline step such as **Advance story clock** moves it (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). Two sessions on one book can stand at different dates, and moving a session's clock never moves the book's.

The present, or the session's own clock, is:

- the date the session's model is told it is,
- what a character's age is measured against, and
- where the session reads the book from: history dated later, and amendments that haven't happened yet, are left out.

## Branches

A **branch** is another line of the same story: what if the duel had gone the other way? The chip beside the book's name says which line you're reading. **main** is the line every book starts with.

### Forking

**Fork ‹line›**, in the chip's menu, makes a new line from the one you're reading, at the moment you're reading (the button says **Fork ‹line› at ‹date›** when you're reading at a date). Name the new line and press **Fork it**.

- **Fork while reading at a date** and the two lines part **at that date**. From then on, a change on one isn't a change on the other. A line forked at Year 3 never reads anything dated Year 4 on main, however long afterwards it's written.
- **Fork at now** stores no date: the new line keeps following the one it left. Move the moment first if the two should really part.

Forking doesn't copy the book. Entries both lines share are one row, so editing a shared entry changes it for both. What a branch keeps to itself:

- the amendments filed while reading it,
- entries written while reading it,
- scenes captured from sessions playing on it,
- links drawn on it,
- presences placed on it (see [Cast](./lorebook-cast.md#when-a-cast-member-is-in-the-world)), and
- stats recorded while playing on it, or set on a place while reading it.

Main sees only shared rows. A branch sees its own rows, plus those of the lines it came from up to its fork date, and never a sibling's.

To take a single entry out of one line only, use **Off for a while** while reading that line, rather than deleting it: deleting a shared entry deletes it from every line, and the confirmation says so.

### Comparing, renaming and deleting

**Compare ‹line› with main** shows the two side by side: what this line has that main doesn't, and every shared entry or cast member the two read differently, field by field. It follows the moment bar, so you can compare the stories at any date.

Each line in the menu has **Rename** and **Delete** buttons. Deleting a line removes everything written on it; shared entries stay. Sessions playing on it move to the line it forked from, and lines forked from it now fork straight from that line. The confirmation tells you what will happen before you agree.

Nothing ever merges between lines, by design. To take something across, read the line it's on and write it on the other.

### Which line a session reads

Each session chooses its **Line** and its **Story clock** in its settings (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)). A new session starts on the line played most recently. The session then reads the entries on its line, as amended up to its clock, and whatever it writes to the book lands on that line, dated where its story stands.

When a session is reading your book, the top of the Lorebooks view names it with its line and clock. If you've moved the moment bar or switched lines, **Read what it reads** puts you back on the session's line at its clock.
