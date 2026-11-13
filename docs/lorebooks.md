# Lorebooks

A lorebook is your world written down: places, people, rules, and what has happened. Models forget anything that isn't in front of them, and they can't hold a whole world at once. A lorebook solves both: Serene Pub reads the entries that matter into each reply, as the [session](./sessions.md) calls for them, so characters remember the tavern's name and the king's betrayal without you repeating them.

:::note By the end of this page
You will have a lorebook with a first entry, a session that reads it, and you'll have watched that entry reach the model.
:::

## Your first lorebook

You'll start a session on the book in step 3. A session with a single character is enough.

### 1. Create the book

Open the **Lorebooks** view from the rail and press **New** at the top of the list of books (from inside a book, press the back arrow at the top, **Lorebooks**, first to get back to the list). Give it a name and press **Create**.

When the pub has [starter lorebooks](#starter-lorebooks), the dialog opens with two choices at the top: **Blank**, an empty book, or **Start from a starter lorebook**, a book that starts out with a world and its rules already in it. For your first book, either works.

### 2. Write your first entry

A new book opens on one question: **Write the first thing you don't want to repeat.** Give it a name, write what the model should know, and press **Add entry**. It is filed as **World lore**.

Example: name it _The Gilded Tankard_, and write _A crowded tavern on the river docks, run by a one-eyed dwarf named Hild. Smugglers meet in its cellar._

Now give it **keywords**, the words that make Serene Pub read it in. Select the entry, type _tankard_ in **Keywords** and press **Enter**, add _tavern_ the same way, and **Save**.

### 3. Start a session that reads it

A session keeps the lorebook it started with, so the book is chosen when you start the session. Open **Sessions** and press **New**, pick your book on the **Lorebook** card (**Lorebook and rules** in Story), add a character and press **Start**. See [Start a session](./sessions.md#start-a-session).

### 4. See it work

In the session, send a message that mentions the tavern: _"Let's head to the Tankard."_

:::tip You should see
The reply knows about Hild and the cellar. Back in the Lorebooks view, the line under the book's name says **Read by ‹your session› · 1 entry reached the last turn**, and selecting the entry shows a line such as **Read in · rank 1 of 1 · matched tankard**.
:::

:::warning If this didn't work
- **The line under the book's name says "Not read by a session".** The session was started on another book, or on its own notes: start a new one on this book (step 3).
- **It says "nothing reached the last turn".** Check the keyword appears in your message, and that you pressed **Save** after adding it. Open the entry's **Read in?** tab to ask why it was left out.
- **The entry is marked Off or Archived.** Switch it back on in the entry's editor.
:::

That's the whole loop: write an entry, give it keywords, and it reaches the model when the story needs it.

## The entry

Every piece of lore is an **entry**. Entries come in kinds, chosen from the scope list on the left of the book:

| Kind           | For                                                              | Example                                   |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| **World lore** | Facts anyone in the world might know                             | The Gilded Tankard; the law against magic |
| **Cast**       | The people of your world, and lore private to one of them        | Hild, and the debt only she knows about   |
| **History**    | Things that happened, with a date                                | _Year 412_: the docks burned              |
| **Scenes**     | Summaries of stretches of a session, filed under a history entry | The night the party met Hild              |
| **Places**     | Rooms, towns, roads, joined by ways and drawn on a map           | The cellar, the docks                     |
| **Items**      | Things someone can carry, with how many exist                    | The cellar key (one of a kind)            |

**Everything** shows every kind together, the cast included.

Selecting an entry opens its editor:

- **Name** and **Content**: what the model reads. Above the content, **Cast** inserts a reference to a cast member (it reads as their name in the prompt) and **Macro** inserts a macro.
- **Keywords**: one per chip. Press **Enter**, or type a comma, to add one.
- **Part of**: the entry this one is filed under (see [Filing entries under others](#filing-entries-under-others)).
- **Supply**, on an item: **One of a kind**, **Limited** (then **How many exist**) or **Unlimited**.
- **Category**, **Links** and **Stats**, on a place: see [Places and maps](./lorebook-places.md).
- A fold, **Regex, case, keyword chains, priority, conditions**, with the matching settings (see below). It is there only with [advanced controls](./themes-and-settings.md#show-advanced-controls) on; with them off an entry still reads in exactly as its stored values say.
- The **⋯** beside **Save**: **Pinned** and **Off**, the entry's state, which save with the entry like any field (see below); then, on a saved entry, **Archive** and **Off for a while…**.

Under the editor, the **Read in?**, **References** and **Contains** tabs say whether the entry would be read in, what points at it, and what's filed under it.

## How entries are chosen

Before each reply, Serene Pub picks the entries that fit the story right now and adds them to the prompt, as many as fit the room set aside for lore.

- **Keywords.** An entry is read in when one of its keywords appears in the recent messages. In the fold, **Use regex** treats keywords as patterns, **Case sensitive** stops _Hild_ matching _hild_, condition keywords narrow when an entry fires, and **Priority** breaks ties. An entry imported from SillyTavern may match whole words only; the fold says so, and **Match anywhere** undoes it. **Let other entries pull this one in** lets an entry be found through keywords in other entries' text, but only as deep as the pipeline's **Follow keyword chains this deep** allows. That is 0 until an administrator raises it, and until then the choices do nothing; the fold says so, with a link to **Admin › Pipelines** for administrators.
- **Search by meaning.** With an embedding model set up, entries are also found by what they're about, so _"the dwarf's bar"_ can find the Tankard with no keyword at all. See [Embeddings and search by meaning](./embeddings-and-rag.md).
- **Pinned** entries are always read in, whatever the conversation says. Keep pins for short lore the model must never forget: pinned entries still take room from everything else.
- **Off** keeps an entry in the book but out of every prompt. **Off for a while…**, in the entry's ⋯ menu, switches it off between two story dates (see [Time, history and branches](./lorebook-time.md#off-for-a-while)).
- **Archived**, also in the ⋯ menu, takes an entry out of the list as well as the prompt, until the **Archived** chip shows it again.

Lore that belongs to one character is **Character lore**: that character's own turns read it, and no other character's. If someone in the session plays the character as their persona, every turn of that session reads it. The narrator reads the lore of background members, and lore anchored to nobody. It reaches the prompt where the session's context template places `{{{characterLore}}}`. The built-in templates already do; if you write your own, include it. See [Cast and relationships](./lorebook-cast.md#lore-only-one-character-knows).

:::note Patterns that could hang
A regex keyword that could take unbounded time to check, such as `(a+)+`, is refused when you save, and the chip says why. Every regex keyword also runs under a short time limit, and one that keeps running over is skipped until the app restarts.
:::

### Why was it read in, or not?

Each entry's **Read in?** tab tests it against the newest turn of the session reading the book. It answers whether the entry would be read in, at what rank, which keyword or meaning matched, and whether it fit the budget. Under it, **Teach it** offers **Always read this in** (pins it) and **Never read this in** (switches it off).

When the entry would not be read in, the tab names the first thing that stopped it: it is archived or switched off, it is off for a while at this point in the story, this session does not read it (archived there, off its line, or dated after its clock), it is another speaker's character lore or a secret the speaker doesn't hold, no keyword, name or meaning matched (with how close it came), it is already shown in a slot of its own, or there was no room in the budget. The Read in line under the editor does the same for the last turn.

The test reads the saved entry, so save before you test.

## Finding your way around a book

The workspace shows the book's entries through three controls you can combine freely:

- **Scope**, the list on the left, says which entries. Under **Views**: **Everything** (every kind, the cast included; choosing a member opens the Cast board), **Cast**, **World lore**, **History**, **Scenes**, **Places** and **Items**, each with how many it holds. A view with nothing in it stays, at the bottom, showing 0. Under **Saved**: **Pinned**, every pinned entry in the book (what is always in the prompt). Choosing it lists them in place of a view; choosing a view leaves it. Chips over the list narrow it further by state (**Read in last turn**, **Pinned**, **Off**, **Archived**, **Machine-written**) and by **Needs keywords** (entries in play that nothing can match yet — pinned, off and archived entries, scenes and cast members never need keywords).
- **Show as**, the row of icons at the right of the line over the book's contents (the view's name and count are at its left), says how they're drawn: **List**, **Cards**, **Tree** (what's filed under what), **Graph** (who and what is connected), **Time** (dated entries on a timeline), **Lives** (who is in the world, and when) and **Map** (the book's places). Hover an icon for its name and shortcut: **Alt+Shift+1** to **Alt+Shift+7** (**⌥⇧1**–**⌥⇧7** on a Mac) pick them in that order while you're working in the book (not while typing in a field). Lives and Map draw the same whatever the scope, so the views dim while one of them is open, and choosing a view opens it in List. With [advanced controls](./themes-and-settings.md#show-advanced-controls) off, **Graph** and **Lives** are hidden along with **Alt+Shift+4** and **Alt+Shift+6** (the others keep their numbers), and an address naming either opens **List**.
- **Moment**, the bar along the bottom, says when in the story you're reading from (now, or any date) and on which line of the story. It is the book's one place for time: the line, the date, the timeline and the way back to now all sit on it, and it is tinted while you read at a date. See [Time, history and branches](./lorebook-time.md#reading-the-book-at-a-moment).

**Loose ends** is what is left to finish in the book, one fix at a time. While there are any, a line at the foot of the scope list says how many (**3 loose ends ›**) and opens them. They're listed grouped by what each needs, most recently changed first:

- **Needs keywords**: entries in play that nothing can match yet. Done when it has a keyword, or is pinned or switched off.
- **Undated history**: history entries with no year.
- **Two history entries on one date**: one row for each doubled date on the line you're reading, opening the oldest entry; the row's **Other entry** links (**Other entry 2**, **3** and so on when there are more) open the others. *Give one of them another date, or move what it says into the other and delete it.* Nothing is merged for you (see [History entries and scenes](./lorebook-time.md#history-entries-and-scenes)).
- **A line's own history before its fork**: a history entry a fork holds for a date on or before its fork date (made before that rule), listed while you read that fork. *Give it a date after the fork, or delete it.* (see [Forking](./lorebook-time.md#forking)).
- **Empty content**: entries with nothing written in them.
- **Undescribed places**: places with no content and no link to anywhere.
- **Cast suggestions**: people the story mentions who aren't members yet, and pairs that may be one person, waiting in the cast's **Suggestions**.
- **Orphan cast members**: background members with no lore and no relationship.

Pressing a row opens the entry with the field that fixes it ready to type in (the keywords, the date or the content; the date, for both history chores as for **Undated history**). **Save & next** saves it and opens the next loose end; **Next loose end** moves on without saving. A row leaves the list once it's fixed; there is no way to dismiss one that isn't. The list is taken when you open it and doesn't reorder while you work: anything new shows the next time you open it. **Done**, or choosing a scope or a **Show as** icon, leaves it. A row about the cast opens the Cast board, with a bar to go on or back to the list.

**Search this book**, the box over the scopes, filters the list as you type. **Jump** (**Ctrl K**, **⌘K** on a Mac) searches the open book too, the same way it searches whichever view is open.

Everything about the book itself sits in its header, one row at the top: the book's cover image (when it has one) and name, with the reading line under it (see [Reading a book into a session](#reading-a-book-into-a-session)); and **⋯** for **Book settings**, **Duplicate** and **Delete this lorebook**. The back arrow at the top left, **Lorebooks**, is there at every width and goes back to the list of books, which is where you open another book, make a **New** one or **Import a lorebook** (the upload button beside **New**).

**Book settings** is the book's own page: its name, picture and rules, its calendar and clock, and a readout of what it holds. Open it from **Book settings** at the foot of the views list (on a narrow screen, at the foot of the view picker), from the book's **⋯** menu, or from a book's **⋯** menu in the list of books. It opens in place of the list, with no view chosen and **Show as** set aside. **Back to the entries**, or **Esc** outside a text box, returns to exactly what was open, and choosing a view, a **Show as** icon or an entry leaves it too. It has an address of its own, so reloading the page keeps you on it.

- **About this book** holds the name, description, tags and **cover image**, ready to edit: there is no Edit to press first. The cover is the square picture beside the name: click it (or drop an image on it) to choose one, and a crop editor opens before anything is uploaded; the menu under it has **Adjust crop** and **Remove image**. Nothing changes until you press **Save**; **Discard changes** puts everything back. The cover shows square in the list of books and before the name in the header; a book with none shows the lorebook icon in the list. People you share the book with see its cover too.
- **Rules** are what the book's stories are told by (shown only with [advanced controls](./themes-and-settings.md#show-advanced-controls) on): **Freeform** (words only, no numbers) unless you chose others. Every session you start on the book plays them. Picking other rules asks first, because sessions already reading the book keep the rules they started with; only new sessions take the new ones. Nothing in the book itself changes. Under the list, a line says how each genre that rates rules takes the book's (*Story: Great · Lair: Good · Dungeon Crawler: Poor*); open it for each one's reason. A book on Freeform says *Freeform — the session chooses the rules*: it brings none of its own. See [Rulesets](./rulesets.md).
- **The story's present** and **Calendar** are the book's clock and calendar; see [Time, history and branches](./lorebook-time.md). **Calendar** is shown only with advanced controls on.
- **What this book holds** counts its entries, cast, dates, scenes and lines. There are no features to switch on: every book can do everything.
- **Writes from sessions** is how much sessions may write to this book: **Full** (the default: as your own setting allows), **Review changes** or **Off**. It's saved as soon as you pick it. It can only be stricter than your own **Lorebook writes from sessions** setting; when yours is the stricter one, the card says so, with a button to it. See [What a session may write](#what-a-session-may-write).
- **Reading into a session** names the sessions of yours that read the book.
- **This book** has **Import another lorebook** (which makes a new book from a file), **Export** (paused), **Duplicate** and **Delete**.

On a wide screen the list and the editor sit side by side. Drag the divider between them to give either more room, or focus it and use the arrow keys (**Shift** for bigger steps, **Home**/**End** for the ends); double-click it to reset. The width is remembered on this device, and is the same whatever **Show as** is set to. On a narrow screen, or docked beside a session, the scope list and **Show as** fold into one row: the search box, then a button that picks the view (the views, **Pinned** and the loose ends line, each with its figure), then a button that picks **Show as**. A view other than Everything shows as a chip under the row; its **×** returns to Everything. The editor opens in place of the list. If you move away from an entry with unsaved changes, you're asked first, and reloading or closing the tab warns you too. Moving the moment bar never asks: an open edit keeps the date it was started at.

## Lists from your rules

A book's **Rules** can bring lists of their own: Vis Itineris has **Weapons**, **Armour**, **Gear**, **Consumables**, **Spells**, **Feats**, **Conditions** and **Creatures**; Freeform has **Things** and **Conditions**. Each list is a kind of entry with fields of its own, such as a weapon's damage and range or a spell's level, beside the name, content and keywords every entry has.

A book that holds entries from rules it is not told by lists them under those rules' name in the scope list; you can read and open them, but new entries are added in a book told by those rules.

A list shows in the scope list, in a group named after the rules, under **Views**, whenever it has something in it: when the book holds entries of that kind, or when the rules come with a library of them. So a Vis Itineris book shows its seven library-backed lists from the start, and **Creatures** once it holds one; a Freeform book looks as it always has until it holds a thing or a condition. Each list has its figure. Choosing one opens it in the **Show as** you are using; from **Graph**, **Lives** or **Map** it opens in **List**.

To add an entry to a list, open the list and press **New**, or use **New** in **Everything**, which offers **New entry in Weapons** and so on for each list the book shows. The editor asks for the list's own fields under the usual ones, marks the ones it needs with *, and says under a field what it still needs before it can be saved (_Add damage to save this._). A list entry also has a **Supply**, like an item. Its entries are found by search, listed in **Everything**, and counted in the book's figure like any other.

### Your rules' library

Some rules come with a library of ready-made entries for their lists: Vis Itineris brings the **Vis Itineris library**, with weapons, armour, gear, consumables, spells, feats and conditions ready to use. (Freeform has no library, so a Freeform book has no library chip.)

- **Show it when you want it.** In a list your rules have a library for, and in **Everything**, the chips over the list include one named after it, **Vis Itineris library**, with how many it has for that list. Press it to list the library's entries beside your own; press it again to put them away. It is off each time you open the book, so the list starts with what your book holds. A list with nothing of your own yet offers **Show the Vis Itineris library** in its place.
- **Read any of them.** Each library entry carries a **Vis Itineris library** badge. Open one to read all its fields, with where it comes from (its source document and licence) above them.
- **Edit a copy** to make it yours. The copy is your book's own entry from then on: change anything, give it keywords, file it under another entry. It replaces the library's entry in your lists, and the library keeps its original, so a later version of the library leaves your copy as you made it. Reading at a branch makes the copy on that branch.
- **Your sessions read what your book holds.** Library entries you have not copied stay in the library: they are not counted in the book's figures or **Loose ends**, and sessions find them through the rules rather than as lore. Copy one in when you want the story to use your version of it.
- **A book shared with you** shows its rules' library to read, the same way; copies are made by the book's owner.

## Filing entries under others

**Part of** files an entry inside another: the guild's charter inside the guild, the altar inside the chapel. **Show as › Tree** draws this. Pick the parent in the editor, or drag a row onto another row. Places and history entries are never filed inside anything: places join by links, and history always stands at the top level, placed by its line and its date (other lore may still be filed under a history entry).

Deleting an entry deletes everything filed under it, and its relationships and amendments; the confirmation names the entry and says how many.

Two other kinds of connection exist, and you'll meet them on the topic pages:

- **Relationships** link any two things with words: _Hild owes Marrow_, _the cellar door leads to the docks_. See [Cast and relationships](./lorebook-cast.md#relationships) and [Places and maps](./lorebook-places.md#ways-between-places).
- **References** are worked out from text: an entry that names a cast member, or a scene that mentions an entry. The **References** tab lists them.

## Cast

The **Cast** is everyone your world holds. When a session reads a book, its characters and personas join the cast automatically; you can also add background people nobody plays, like the innkeeper. A cast member is that person in _this_ story: their private lore, their relationships, and how they change over time. Their character card stays shared and untouched. When the card is yours, **Edit the card** on the member's page opens it in [Characters](./characters.md). In a book someone shared with you, a member played with your own card says so in one line at the top of their page (_Bianca lives in Hana's lorebook Porto Alto; your card seeds them._), with **Edit my card**; the page itself is read only.

See [Cast and relationships](./lorebook-cast.md) for private lore, relationships, the graph, and characters who change over a story.

## Reading a book into a session

A session reads the lorebook it was started with, and keeps it: the book is chosen on the start screen (see [Start a session](./sessions.md#start-a-session)) and never switched or taken out afterwards, before the story starts or after. Every session has a lorebook. A session started blank, or from a starter lorebook, reads its own notes (see [Your session's own notes](#your-sessions-own-notes)); one started on a book reads that book, with its notes on top.

The session's settings show its lorebook as a line, not a choice. For a session whose lorebook is its notes: *This session's lorebook is its own notes, and a session keeps the lorebook it started with. Share them as a lorebook to build on them in other sessions.* For a session that reads a book: *This session reads ‹book› and keeps it. Share its notes to ‹book›, or merge ‹book› into its notes to make the story its own.* Asked to move a session onto another book anyway, Serene Pub answers *A session keeps the lorebook it started with.*

To build on a session's world in other sessions, use **Share as a lorebook** (its notes become a lorebook of yours) or **Share to ‹book›** (see [Your session's own notes](#your-sessions-own-notes)), then start a new session from that book. A lorebook shared from a session is read directly by its owner (who may start a new session on it: continue the latest line, or branch off at a point), by that session's branches and its next chapters; anyone else it is shared with starts on a copy (the start screen lists those under *Shared by* and the person's name). Lorebooks shared before this rule, and any whose session has since been deleted, are ordinary lorebooks.

The session's settings also choose where it reads its book: its **Line** and **Story clock** (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)).

The line under the book's name says which session reads it: **Read by ‹session› · 12 entries reached the last turn**, or **Not read by a session**. When the session reads another line than main, or reads as of its story clock, the line names that too (**Read by ‹session› on ‹line› as of ‹date›**). Click the session's name to open it. If you've moved the moment bar or switched lines, **Read what it reads** at the end of the line shows you the book as the session sees it.

### What a session has read

Every turn records what it decided about each entry it judged: read in or left out, why, its rank, its cost, and the keywords that matched. You see this in three places:

- **Marks on each row** in the book: read in, considered and left out, or nothing.
- **The Read in line** in an entry's editor, such as _Read in · rank 2 of 12 · matched umber · 218 of 900 tokens_.
- **The Lore entries widget** in the session (add it from the [layout editor](./session-layout.md)). It lists the book's entries with how often each was read in this session, when last and at what rank, and has **Pin** and **Off** on each row.

These records are the book owner's: guests don't see them. Detailed records are kept for each character's most recent turn; the counts of how often each entry was read are kept for the life of the session.

## What a session may write

Sessions can write back to your lorebook: scenes you capture, stats recorded onto the world, links a genre draws between rooms. Two settings decide how much, and the stricter one wins:

1. **Your own**: **Lorebook writes from sessions**, in **Settings › User**, for every book you own. An administrator sets the default for everyone in **Admin › General**.
2. **The book's**: **Writes from sessions**, in the book's **Book settings**. It starts at **Full**, which leaves your own setting as the answer. Set it to **Review changes** or **Off** to keep one book stricter than the rest. It can never allow more than your own setting.

A session writes at the stricter of the two; it has no setting of its own. Each place says when the other is stricter: Book settings notes it when your own setting is stricter than the book's, and a session's settings show **Lorebook writes** under the lorebook, saying whether the book or your own setting is the one holding it back, with a link to change it. Where a screen can't save because writes are off, its notice says which setting is off and has a button that takes you there.

- **Full** (the default): sessions write to the lorebook as they play. New entries, links, rooms and values apply as you play, and the timeline lets you go back. The exception is a session whose scenes end by themselves (it runs the *Find where scenes begin* routine and its scene mode is **Automatic**, as in Story's Living and Rule Based presets, the Lair and the Dungeon Crawler): its new entries, rooms, history days and links wait in the session's own notes until they are applied (see [Your session's own notes](#your-sessions-own-notes)). A change to an entry that is already in the lorebook is kept with the session until it is applied: in your own session on your own lorebook, by itself as each scene closes (see [Bringing a session's changes into the lorebook](#bringing-a-sessions-changes-into-the-lorebook)).
- **Review changes**: what a session changes on its own is kept in the session's own notes (see below) until you bring it into the lorebook. Value changes a session proposes wait under its reply, for you to **Accept** or **Reject**. Only the lorebook's owner decides them. What you save yourself from a review screen, such as **Summarize to Lorebook**, **Compile to Entry** or **Apply graph**, saves straight away: that screen is the review.
- **Off**: nothing a session does writes to the lorebook. What it would have written is kept in the session's own notes instead. Summarize, compile and the graph build say so and don't start, and so does drafting or saving the summary of a scene a session captured.

A lorebook someone else shared with you can't be read into your sessions (duplicate it first), so none of your sessions writes to it. Seating a character always adds them to the cast, whatever the setting.

What a session writes to the lorebook lands on its line, dated where its story stands. (What a session whose scenes end by themselves adds waits in its notes until applied, then lands the same way.) See [Stats and states](./stats-and-states.md#when-a-session-changes-the-lorebook) for stats, and [Time, history and branches](./lorebook-time.md#which-line-a-session-reads) for lines.

### Changes from a replaced reply

Everything a session writes to your lorebook as it plays is remembered with the reply that caused it: a place's details, the words a tie shows, someone's state on the graph, a room or a way between rooms. Regenerate or swipe that reply, go **Back** past it (or delete it, where the genre offers Delete) and the change goes with it, as long as the lorebook still says exactly what the reply wrote. **Forward** puts it back. What a session whose scenes end by themselves adds waits in its notes and goes with its turn the same way until it is applied. A change to an entry already in your lorebook isn't written to it at all: it is kept in the session's notes, goes with its turn the same way, and never leaves a *replaced* note (see [Bringing a session's changes into the lorebook](#bringing-a-sessions-changes-into-the-lorebook)). Two kinds of write are not remembered this way and stay: a stat value on your own lorebook (see [Your session's own notes](#your-sessions-own-notes)), and the stats recorded onto the lorebook when you capture or end a scene (see [Stats and states](./stats-and-states.md#when-a-session-changes-the-lorebook)).

If someone changed it since (you, by hand, or a later reply), it stays as it is now. The entry's row in the list is marked **replaced**, and the entry says **Written by a reply that was since replaced**, with one line for each thing the reply wrote: what it set, and what was there before.

- **Revert** puts back what was there before the reply. For an entry the reply added, it removes the entry.
- **Keep** leaves it as it is, and the line goes.

Only the lorebook's owner can revert or keep; anyone else reading the book sees the note. What you file or change yourself, such as **File as a room** or an action you press, is yours and never goes with a reply. Under **Review changes** and **Off**, and under every setting for a session whose scenes end by themselves, a session writes new entries, rooms, history days and links to its own notes instead, and a change to an entry already in the lorebook goes to the notes under every setting; those always go back with the reply, and so do the links (between the two books too) and history days it wrote in the notes.

## Your session's own notes

Every session owns a lorebook of its own, its **Session notes**, from the moment it is made, even when the notes are its whole lorebook. It is born with the Gregorian calendar and no clock set. A session whose lorebook is its notes keeps its world there: its clock, its scenes, its summaries, and the rooms, people and facts it writes. A session that reads a lorebook but isn't allowed to write to it (**Review changes**, **Off**, or a book shared with you), or whose scenes end by themselves, writes its rooms, people and facts there too, on top of the book it reads. In a session that reads a lorebook you don't own (a pub-wide or shared one), or whose lorebook is its own notes, the values that live on the world, such as a character's age, are kept in the notes: for your own character and for the lorebook's own people alike. The session reads its notes' value before the lorebook's, and the lorebook itself never changes. Like a session's own stats, such a value goes with its turn: **Back** takes it and **Forward** brings it back. A value that lives on your own lorebook is the book's: **Back** doesn't take it, and neither does a swipe or a regenerate. Because the notes are the session's own, **Review changes** and **Off** don't hold these values back. Scenes and summaries are not exempt: under **Off**, starting or ending a scene and summarizing are refused even in the notes, and a session whose notes are its whole lorebook follows your own **Lorebook writes from sessions** setting for them. On your own lorebook they go onto the book, under its **Writes from sessions** setting, and every session reading it shares them. A world attribute of someone your own lorebook doesn't hold is kept in the notes too, on that character's place in the notes' cast. That value goes with its turn too, as every value the notes keep does. A place of the lorebook works the same way: in a session that reads a lorebook you don't own, a value that lives on the world for one of its places, such as how many lamps burn in a hall, is kept in the notes beside the place, never as a copy of it. The session reads the notes' value first, then the lorebook's; **Back** takes it with its turn, and **Apply to the lorebook** doesn't move it into the book.

When a session reads a lorebook but can't write to it, its notes are read together with the lorebook, the notes first, and the session's writes land in the notes either way. When a session adds a person or a place it first looks in the notes for one of that name, and only when the notes hold none, in the lorebook: finding one there keeps the session's change to it in the notes as a change to that entry (see below), never a second copy. Two entries of one book answering to a name is still refused, but the notes and the lorebook never refuse each other. A person the session files an entry under can be one of the notes' or one of the lorebook's cast. A link the session draws may join the two books: an entry of the notes, an entry of the lorebook, or a person of the lorebook's cast, at either end. The link is kept in the notes, so the lorebook's own pages don't show it, and only this session (and a branch made after it) sees it. A link the lorebook or the notes already hold isn't drawn again. A history day the session writes is always the notes' own, one for each date, dated by the lorebook's calendar; it never changes the lorebook's day for that date until you apply it. The session reads its notes where it reads the lorebook: their names are known to it, their links appear in its graph with the ends named as it reads them, and its notes' history days count toward the story date it works from. Under **Full** this changes nothing for a session whose scenes don't end by themselves, nor for one whose lorebook is its notes alone; a session whose scenes end by themselves keeps its new entries, rooms, history days and links in the notes under **Full** too, and reads them at once: in its places list, the map, retrieval, keyword matching, the names list and the Lair's room flows. Nobody else sees them until they are applied.

- You don't manage them: the session makes them, and they are deleted with the session.
- They are never in a picker. The Lorebooks view lists them in their own section, **Session notes**, for your sessions only. A row opens like any other book, but its menu holds only its share verbs and **Book settings**. The session reads them alongside its lorebook, and what comes from them is marked **this session only**.
- Only the session's owner and guests can see them.
- Each note remembers the turn that wrote it. Deleting, regenerating or swiping a turn takes back the notes it wrote, with the links and history days and paragraphs it wrote in them, and the changes it kept in them to entries of the lorebook, even ones you edited since (until you apply them); [branching](./sessions.md#on-revision) a session copies its notes up to the branch point.
- Places in the notes work like any other: the session's places list shows them with the ways between them, and their stats stay in the notes with them. A value on one goes with its turn, as the notes' other values do.

### Bringing a session's changes into the lorebook

When a session changes an entry that is already in your lorebook, the lorebook itself isn't changed, whatever its write setting: the change is kept in the session's own notes until you apply it. Only that session (and a branch made after the turn that changed it) sees it; other sessions and the lorebook's own pages show the entry as it was. A regenerate, a swipe, **Back** or deleting the turn takes the change back with its turn, and **Forward** puts it back. When a session reads your lorebook but keeps its changes in its own notes (this, **Review changes**, **Off**, or scenes that end by themselves), select the session in **Sessions**: its panel has a **This session only** card listing what it added and, for each changed entry, each field as *before → after*. Choose **Apply to the lorebook** beside one to move it into the lorebook, or **Apply all to the lorebook**. Applying a changed entry updates the lorebook's entry; when the session reads the story at a date, it becomes a dated change at that date instead, and the entry's earlier text stays true before it. Applying keeps a record of each field it changed, with what it read before and after. A field the lorebook has changed since the session changed it is marked *‹Label› has changed in the lorebook since this session changed it.* and has no **Apply to the lorebook** button; it stays with the session. A change with no date that a dated change in the lorebook would hide is marked *A dated change in the lorebook decides ‹label› here, so this change would not show.* A change the lorebook already reads (because you made the same change by hand, say, or the session this one was branched from applied it) leaves the card by itself: there is nothing left to apply. When the session changed the same field twice, the later change waits for the earlier one and says *An earlier change from this session to ‹label› is still waiting; apply it first.*; **Apply all to the lorebook** applies both, in order. After you apply a change it is the lorebook's: **Back**, a swipe or deleting the turn no longer takes it, and every session reading the lorebook sees it. Applying settles the session's story up to the newest turn whose change was applied, never past a turn whose change still waits, so **Back** stops there with *This part of the story is in the lorebook now.* Applying also ends **Forward**: turns you went **Back** past can't be brought forward again. An applied entry keeps the turn that wrote it, the links between applied entries come with them, and the item leaves the card. A link whose two ends are both the lorebook's (two of its entries, or an entry and a person of its cast) is its own item on the card, and **Apply to the lorebook** moves it to the lorebook on the session's line; a link with an end in the notes moves with that entry, and a link the lorebook already holds leaves the card without being applied. A history day of the session's notes for a date the lorebook already holds is listed as a change to the lorebook's day, a paragraph. Applying it adds the paragraph after what the lorebook's day holds and never makes a second entry for one date, and everything the session dated by its own day is dated by the lorebook's day from then on. If that would make a link say the same thing twice on the lorebook's day, the paragraph stays with the session and the card says why. An applied place's values become the lorebook's, so **Back** no longer takes them. Everyone in the session sees the card; only the lorebook's owner can apply changes to it or take them back.

**By itself, as scenes close.** When the session is yours, reads your own lorebook, and the lorebook's write setting in force is **Full** (the stricter of your own **Lorebook writes from sessions** and the book's **Writes from sessions**), you don't have to press anything: when a scene closes (you end it, a new scene starts, or the session starts one by itself), what the session changed up to the end of that scene is applied. If that scene's summary is being written or is waiting for your review, the changes wait and apply when you save it; if you discard the review, or the summary stops or fails, they apply then. A scene whose summary waits holds back everything from its start on. **Close out** (and so archiving a session, and starting its next chapter) applies whatever is left, except what the stretch it is closing wrote: that waits for the summaries Close out starts, like any scene's. While you have gone **Back** and could still go **Forward**, nothing applies by itself, because applying ends **Forward**; it applies at the next scene close or Close out after that. A change marked as changed in the lorebook since stays on the card for you. A branch session is applied the same way, and its first Apply gives it its own line (see [Time, history and branches](./lorebook-time.md#which-line-a-session-reads)). A member's session on someone else's lorebook keeps its changes until the lorebook's owner applies them. The card says *The lorebook takes this session's changes by itself as each scene closes.* and links to **Writes from sessions to this book**: set it to **Review changes** or **Off** to keep changes waiting for you instead (that setting also decides what sessions write elsewhere; see above).

**Taking an Apply back.** The card's **Applied to the lorebook** list has one row for each Apply, newest first: how many changes, why (*by* who pressed it, *as a scene closed*, *when a scene's summary was saved* or *at Close out*) and when. Open a row to see what it applied. **Take back** undoes the whole Apply: new entries go back into the session's notes where they were, with their links, changed fields get back what they read before, and every change waits on the card again. It takes back all of it or nothing, and it refuses, with a sentence saying why, when something now stands on what was applied: an entry was edited in the lorebook since, has a change of its own there, has an entry filed under it, is linked to from elsewhere in the lorebook, is named by a history day or by another session's story, or another session keeps values on it; a field the lorebook changed since; a turn that is no longer in the session. A link goes back to the session's notes with the rest, and refuses when it is no longer in the lorebook. A merged day goes back only while its paragraph is still the last on the day; if something was written after it, it says *Something was written after this session's paragraph on ‹Day›, so this can't be taken back.* An applied place can't be taken back yet. Taking back doesn't move the settled line back: **Back** still stops where it did.

Three verbs carry a session's notes further. They are in the **Session notes** row's menu and in the **⋯** menu of the session's details, and each asks first. Only the session's owner has them.

- **Share as a lorebook**, when the notes are the session's whole lorebook. It asks *Share this session's notes as a lorebook? They become a lorebook of your own in Lorebooks, the session reads it from now on, and its notes start again empty.* The notes move to the main list as a lorebook of yours, the session reads it, and the session gets fresh notes. A note says *Shared as a lorebook:* and the new name. The session's edit form has the same button. The lorebook stays that session's story: the session, its branches and its next chapters read it; any other new session starts on a copy of it, and the session keeps the original.
- When the notes sit on top of a book the session reads, the row says *Kept on top of ‹book›*, and the menu offers two verbs instead, named by that book:
  - **Share to ‹book›** carries every change in the notes into that book, all at once. It asks *Share this session's notes to ‹book›? Every change in them is written into ‹book› at once.* With nothing waiting in the notes, it says *Nothing to share*.
  - **Merge ‹book› into these notes** makes the story the session's own. It asks *‹book›'s entries, cast, lines and dates are copied in, your changes stay on top, and from then on the session reads only its notes. ‹book› is not changed.* Everything in ‹book› (every line, its dates, calendar and clock, entries, cast, places and values) is copied into the session's notes, the session's own changes stay on top, and from then on the session reads only its notes, on the same line and at the same date it was reading. What the session writes afterwards (its lore, its people's changes, the values it records) lands on that same line, dated at its clock, and a **Branch from here** of it keeps that line, with its entries, values and the links between its entries, in the branch's notes, and reads its people as the session did. ‹book› itself is not changed; only this session's captured scenes move with it. Merging ends **Forward**: turns you went **Back** past can't be brought forward again. A session merges once, and if it would read anything differently afterwards, nothing is merged and it says so. To build on the merged story in other sessions, **Share as a lorebook** afterwards.

**Share** here carries a session's notes into a book. It is not the **Share…** in a book's menu, which shares a book with the people on the pub (see [Sharing a lorebook](#sharing-a-lorebook)); a session-notes row never offers that one.

## Starter lorebooks

A **starter lorebook** is a ready-made world to start from: entries, places, often a cast, and the rules its stories are told by. Starting from one copies the whole starter lorebook, so what you make is yours to change, and the starter lorebook stays as it was for the next person.

Serene Pub comes with two. **The Ninth Mile** is listed first: a coaching inn where three roads meet, on the night a storm closes all three. It holds four entries about the inn, its roads and its household, one lead to start from (_The night the roads close_), and the Freeform rules: no dice and nothing to learn. It has no cast of its own, because its keeper, Nell Haverly, is the character the setup wizard offers first (see [Pick a character](./getting-started.md#4-pick-a-character)): add her to a session that reads the book and there's one Nell, not two. **Brackenvale** is a river vale with a market town, ten places, seven people and five leads, played by the Vis Itineris rules with their library.

Each starter lorebook in a list shows its name, *Rules:* and the rules it plays, a line about it, what it holds (*Holds 12 entries, 3 places and 2 cast members*) and where it comes from: *Comes with Serene Pub*, *Comes with a plugin*, or *Made by* the admin who made it.

- **A lorebook from a starter lorebook.** In **Lorebooks**, press **New**, choose **Start from a starter lorebook** and pick one. The name fills in with the starter lorebook's (change it if you like), and in place of the Rules list the dialog says which rules the book plays. Press **Create**: the new book opens, with the starter lorebook's cast as cast members of the new book. No character cards are made. To keep one as a character of your own, open the member and choose **Copy to my characters** (see [Copy a cast member to your characters](./characters.md#copy-a-cast-member-to-your-characters)).
- **A session from a starter lorebook.** On the start screen, a genre with a lorebook step offers **Start from a starter lorebook** on the same card as your books (and, for a genre that plays by rules, beside **Start blank**, each row with the fit of its rules). The session plays the starter lorebook's rules and keeps the starter lorebook in its [own notes](#your-sessions-own-notes), ready to play, and nothing appears in the main list of **Lorebooks** (its notes sit under **Session notes**). Because the story starts with notes already in them, the session keeps those notes as its world; when you want to keep them as a lorebook and build on them, use **Share as a lorebook** in the session's settings (or in the **⋯** menu of its details).

### Making and managing starter lorebooks (admins)

Starter lorebooks come with Serene Pub and with plugins, and administrators can make their own for everyone on the pub.

- **Save as starter lorebook.** Open one of your lorebooks and choose **Save as starter lorebook** from **⋯** or from **This book** in Book settings. The starter lorebook is a copy of the book as it is now; later changes to the book stay in the book. A note names the new starter lorebook and where to find it.
- **Your starter lorebooks.** The starter lorebooks you made are listed under your books in **Lorebooks**, in a group of their own, each with a *Starter lorebook* badge. Open one to edit it like any lorebook. Sessions start from a starter lorebook and never read it, so its Book settings leave out **Writes from sessions** and **Reading into a session**. Its **This starter lorebook** card offers **Make a lorebook from this starter lorebook** and **Delete starter lorebook**. Each lorebook or session started from a starter lorebook gets its own copy, so what you change reaches the ones started next.
- **Starter lorebooks that come with Serene Pub or a plugin.** These are listed there too, for the administrator who holds them, and they open read only. To change one, **Clone** it (from its **⋯** menu, from the line under its name, or from Book settings) and edit the copy, which is a starter lorebook of your own.
- **Admin › Play › Starter lorebooks** lists every starter lorebook on the pub. Starter lorebooks that come with Serene Pub or a plugin stay as they are and have no Delete: **Clone** makes a copy of one that you can edit. Each has an **Enabled** switch; turn it off to hide that starter lorebook everywhere without deleting it, and on again to bring it back. A starter lorebook an admin made offers **Clone** and **Delete** (which names the starter lorebook and asks first), and **Open in Lorebooks** for the admin who made it. Clone asks for the new starter lorebook's name.

A lorebook a plugin provides is the same: no Delete, and an administrator turns it off with its switch on the plugin's page (see [Plugins](./plugins.md#pictures-sound-and-data-that-come-with-a-package)). Starting from any of these makes your own copy, which you can delete.

Deleting a starter lorebook an admin made takes it off every list. Lorebooks and sessions already started from it keep everything they copied.

A plugin can also bring lorebooks of its own, which are added to the administrator's library once the plugin is approved; see [Plugins](./plugins.md#pictures-sound-and-data-that-come-with-a-package). Everyone on the pub can read them: on each person's shelf they sit under **Ready-made**, beside the starter lorebooks that come with Serene Pub, and an open one says *Comes with* and the plugin's name.

## Sharing a lorebook

On a pub with [user accounts](./users-and-accounts.md), you can let another person read one of your lorebooks. Choose **Share…** from the book's **⋯** menu and tick the people; untick to take it back.

They get the book read-only: it appears on their shelf under **Shared with you** with your name under it, every lens opens, nothing can be changed (the editors' fields are greyed out, and Book settings and Loose ends aren't offered), and **Duplicate**, the only item in the book's **⋯** menu, makes them a copy of their own to build on: shared with nobody, its tags filed under their own tags of the same name. Your edits reach their open book as you make them. Scenes show no session names, since your sessions stay yours. A shared book can't be read into their sessions as it is, because a session writes into the book it reads from, and that book is yours; they duplicate first. A shared lorebook can also be attached in [Messages](./messages.md#attaching-things) to anyone it is shared with.

## Creating, importing, duplicating and deleting

**New**, over the list of books, asks for a name and the book's **Rules** (**Freeform** unless you pick others; you can change them later in Book settings). Everything else, such as cast, dates and places, appears as you use it. When the pub has starter lorebooks, **Blank** and **Start from a starter lorebook** sit at the top of the dialog: pick a starter lorebook and the book starts as a copy of it, named after it and playing its rules (see [Starter lorebooks](#starter-lorebooks)). A book's **⋯** menu in the list has **Book settings** and **Duplicate** as well (a starter lorebook that comes with the pub has **Clone** instead); a book shared with you has **Duplicate**. Each book's row in the list ends with the same line: how each genre that rates rules takes the book's (*Story: Great · Lair: Good*; point at it for the reasons), or *Freeform — the session chooses the rules*. A genre greys a book whose rules it can't play (**Incompatible**) when you start a session, and refuses to read it into one. With no books yet, the list says what a lorebook is and offers **New lorebook**.

The upload button beside **New** (**Import a lorebook**) reads a SillyTavern lorebook or character book file, a lorebook exported by Serene Pub 0.5, or a book Serene Pub wrote into a character card. It always makes a new book; it never fills the one you have open.

- A SillyTavern file comes in as **World lore**. See [Importing from SillyTavern](./importing-from-sillytavern.md).
- A book whose entries use a ruleset's own kinds of entry (a household, a spell) brings them back as those kinds when a ruleset that declares them is installed here, fields included; if none is, they come in as **World lore**. The entries need not belong to the book's own rules.
- A Serene Pub 0.5 file brings its world lore, character lore with the cast member it belongs to, dated history with its scenes, and its cast with their cards.
- Importing a book you already have is detected and asks whether to overwrite it or import it as new. Before overwriting, it lists what the file can't bring back (such as branches, dated changes and scenes captured from sessions), and those are lost. It also says how many of your characters the file carries an edited copy of: either choice rewrites those characters from the file.
- A lorebook file from Serene Pub names the book's rules. The imported book plays them when this pub has them; when it doesn't, the book comes in on Freeform and the import says which rules were missing. Overwriting a book gives it the file's rules; a file that names none leaves them as they were.
- Files over 32 MB, or far larger than any real book, are refused with the reason.

An imported book is queued for search indexing straight away. If the book was saved but something after it wasn't, the import says **Lorebook imported with warnings** and names what didn't come through.

**Export** is paused while the lorebook format settles: it stays in the menu, greyed out. A [character card](./characters.md) can still carry a book, holding the book's main line without branches or dated changes.

**Duplicate** makes a full copy under a new name: every entry on every line, the cast, branches, links, scenes, dated changes, stats and stat sheets, tags, calendar and clock. Character cards are shared, not copied. Scenes in the copy keep their summaries but not the session messages they were captured from, and the undo of a past merge stays with the original. Values a session's turns wrote come across as they stand but are no longer tied to those turns, so **Back** in that session never changes the copy.

**Delete this lorebook** asks first, naming the book and what goes with it: its entries (and how many are places), its cast, and its history, scenes, relationships and branches. Sessions reading it keep their messages but stop reading lore from it. It can't be undone.

## The lorebook annex

Some extensions and genres keep a little free-form saved state on the lorebook itself, called its **annex**: a town's reputation, the score a campaign's rival has reached, a map seed. It is about the world, not one playthrough, so every session that reads the book sees the same values. It isn't an entry and doesn't show as one; it's something the genre or extension reads and writes.

- **A session's writes land like an entry-field write.** If the session reads a lorebook you can write to, a change goes into that book. If not (the book is someone else's, or its **Writes from sessions** keeps the session out), it goes into the session's own notes instead, as with any other session write (see [What a session may write](#what-a-session-may-write)).
- **Back takes it back.** A write made during a turn goes back with that turn, the way a stat or an entry change does.
- **Each person sees what they're meant to.** The genre or extension says who sees each value (everyone, the owner, a participant), so two people reading the same book can see different parts of it.

Authors: see the SDK guide [Storage](./sdk/guides/storage.md#the-lorebook-annex).

## Going further

- [Cast and relationships](./lorebook-cast.md): private lore, relationships, the graph, characters who change over time.
- [Places and maps](./lorebook-places.md): rooms joined by ways, the map, and what a place holds.
- [Time, history and branches](./lorebook-time.md): dates, amendments, the calendar and clock, and alternate lines of a story.
- [Summarization](./summarization.md): turning sessions into scenes and history.
- [Embeddings and search by meaning](./embeddings-and-rag.md): finding lore without keywords.
- [Stats and states](./stats-and-states.md): health, gold, inventories and where things are.
