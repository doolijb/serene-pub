# Lorebooks

A lorebook is your world written down: places, people, rules, and what has happened. Models forget anything that isn't in front of them, and they can't hold a whole world at once. A lorebook solves both: Serene Pub reads the entries that matter into each reply, as the [session](./sessions.md) calls for them, so characters remember the tavern's name and the king's betrayal without you repeating them.

:::note By the end of this page
You will have a lorebook with a first entry, read into a session, and you'll have watched that entry reach the model.
:::

## Your first lorebook

You need a session to try it in. Any session works, including one with a single character.

### 1. Create the book

Open the **Lorebooks** view from the rail and press **New** at the top of the list of books (from inside a book, press **Lorebooks** first to get back to the list). Give it a name and press **Create**.

If a session is open, the dialog also offers **Read it into this session**. Leave it on: that's step 3 done for you.

### 2. Write your first entry

A new book opens on one question: **Write the first thing you don't want to repeat.** Give it a name, write what the model should know, and press **Add entry**. It is filed as **World lore**.

Example: name it *The Gilded Tankard*, and write *A crowded tavern on the river docks, run by a one-eyed dwarf named Hild. Smugglers meet in its cellar.*

Now give it **keywords**, the words that make Serene Pub read it in. Select the entry, type *tankard* in **Keywords** and press **Enter**, add *tavern* the same way, and **Save**.

### 3. Read it into the session

Skip this if you left **Read it into this session** on. Otherwise, with your session open, press **Read into this session** beside the book's name.

A session reads one book at a time. If it was reading another, you're asked first; neither book changes.

### 4. See it work

In the session, send a message that mentions the tavern: *"Let's head to the Tankard."*

:::tip You should see
The reply knows about Hild and the cellar. Back in the Lorebooks view, the top of it says **Reading into ‹your session› · 1 entry reached the last turn**, and selecting the entry shows a line such as **Read in · rank 1 of 1 · matched tankard**.
:::

:::warning If this didn't work
- **The top of the Lorebooks view doesn't name your session.** The book isn't read into it yet: do step 3.
- **It says "nothing reached the last turn".** Check the keyword appears in your message, and that you pressed **Save** after adding it. Open the entry's **Read in?** tab to ask why it was left out.
- **The entry is marked Off or Archived.** Switch it back on in the entry's editor.
:::

That's the whole loop: write an entry, give it keywords, and it reaches the model when the story needs it.

## The entry

Every piece of lore is an **entry**. Entries come in kinds, chosen from the scope list on the left of the book:

| Kind | For | Example |
| --- | --- | --- |
| **World lore** | Facts anyone in the world might know | The Gilded Tankard; the law against magic |
| **Cast** | The people of your world, and lore private to one of them | Hild, and the debt only she knows about |
| **History** | Things that happened, with a date | *Year 412*: the docks burned |
| **Scenes** | Summaries of stretches of a session, filed under a history entry | The night the party met Hild |
| **Places** | Rooms, towns, roads, joined by ways and drawn on a map | The cellar, the docks |
| **Items** | Things someone can carry, with how many exist | The cellar key (one of a kind) |

**Everything** shows every kind together, the cast included.

Selecting an entry opens its editor:

- **Name** and **Content**: what the model reads. Above the content, **Cast** inserts a reference to a cast member (it reads as their name in the prompt) and **Macro** inserts a macro.
- **Keywords**: one per chip. Press **Enter**, or type a comma, to add one.
- **Part of**: the entry this one is filed under (see [Filing entries under others](#filing-entries-under-others)).
- **Supply**, on an item: **One of a kind**, **Limited** (then **How many exist**) or **Unlimited**.
- **Category**, **Links** and **Stats**, on a place: see [Places and maps](./lorebook-places.md).
- A fold, **Regex, case, recursion, priority, conditions**, with the matching settings and the **Pinned** and **Off** switches (see below).

Under the editor, the **Read in?**, **References** and **Contains** tabs say whether the entry would be read in, what points at it, and what's filed under it.

## How entries are chosen

Before each reply, Serene Pub picks the entries that fit the story right now and adds them to the prompt, as many as fit the room set aside for lore.

- **Keywords.** An entry is read in when one of its keywords appears in the recent messages. In the fold, **Use regex** treats keywords as patterns, **Case sensitive** stops *Hild* matching *hild*, condition keywords narrow when an entry fires, and **Priority** breaks ties. An entry imported from SillyTavern may match whole words only; the fold says so, and **Match anywhere** undoes it. **Recursion depth** lets an entry be found through keywords in other entries' text, but only as deep as the pipeline's **Follow keyword chains this deep** allows, and that is 0 until you raise it.
- **Search by meaning.** With an embedding model set up, entries are also found by what they're about, so *"the dwarf's bar"* can find the Tankard with no keyword at all. See [Embeddings and search by meaning](./embeddings-and-rag.md).
- **Pinned** entries are always read in, whatever the conversation says. Keep pins for short lore the model must never forget: pinned entries still take room from everything else.
- **Off** keeps an entry in the book but out of every prompt. **Off for a while…**, in the entry's ⋯ menu, switches it off between two story dates (see [Time, history and branches](./lorebook-time.md#off-for-a-while)).
- **Archived**, also in the ⋯ menu, takes an entry out of the list as well as the prompt, until the **Archived** chip shows it again.

Lore that belongs to one character is **Character lore**: only that character's turns (and the turns of characters you play) read it. It reaches the prompt where the session's context template places `{{{characterLore}}}`. The built-in templates already do; if you write your own, include it. See [Cast and relationships](./lorebook-cast.md#lore-only-one-character-knows).

:::note Patterns that could hang
A regex keyword that could take unbounded time to check, such as `(a+)+`, is refused when you save, and the chip says why. Every regex keyword also runs under a short time limit, and one that keeps running over is skipped until the app restarts.
:::

### Why was it read in, or not?

Each entry's **Read in?** tab tests it against the newest turn of the session reading the book. It answers whether the entry would be read in, at what rank, which keyword or meaning matched, and whether it fit the budget. Under it, **Teach it** offers **Always read this in** (pins it) and **Never read this in** (switches it off).

The test reads the saved entry, so save before you test.

## Finding your way around a book

The workspace shows the book's entries through three controls you can combine freely:

- **Scope**, on the left, says which entries: a kind, a saved filter, or a search. **Everything** is every kind, the cast included (choosing a member opens the Cast board). The saved filter **Pinned** lists what is always in the prompt; its figure counts the list it opens: the scope you're in, or the whole book from Everything and Cast. Chips over the list filter further, including **Archived** and **Needs keywords** (entries in play that nothing can match yet — pinned, off and archived entries, scenes and cast members never need keywords).
- **Lens** says how they're drawn: **List**, **Cards**, **Tree** (what's filed under what), **Graph** (who and what is connected), **Time** (dated entries on a timeline), **Lives** (who is in the world, and when) and **Places** (a map). **Alt+Shift+1** to **Alt+Shift+7** (**⌥⇧1**–**⌥⇧7** on a Mac) pick them in that order while you're working in the book (not while typing in a field). Lives and Places draw the whole book whatever the scope, so choosing a scope while you're in one of them opens that scope in List.
- **Moment**, the bar along the bottom, says when in the story you're reading from: now, or any date. See [Time, history and branches](./lorebook-time.md#reading-the-book-at-a-moment).

**Loose ends**, under the scopes, is what is left to finish in the book, one fix at a time. Its figure counts them all. It lists, grouped by what each needs and most recently changed first:

- **Needs keywords**: entries in play that nothing can match yet. Done when it has a keyword, or is pinned or switched off.
- **Undated history**: history entries with no year.
- **Empty content**: entries with nothing written in them.
- **Undescribed places**: places with no content and no link to anywhere.
- **Cast suggestions**: people the story mentions who aren't members yet, and pairs that may be one person, waiting in the cast's **Suggestions**.
- **Orphan cast members**: background members with no lore and no relationship.

Pressing a row opens the entry with the field that fixes it ready to type in (the keywords, the date or the content). **Save & next** saves it and opens the next loose end; **Next loose end** moves on without saving. A row leaves the list once it's fixed; there is no way to dismiss one that isn't. The list is taken when you open it and doesn't reorder while you work: anything new shows the next time you open it. **Done**, or choosing a scope or lens, leaves it. A row about the cast opens the Cast board, with a bar to go on or back to the list.

**Search this book**, the box over the scopes, filters the list as you type. **Jump** (**Ctrl K**, **⌘K** on a Mac) searches the open book too, the same way it searches whichever view is open.

Everything about the book itself sits beside the book's name: **Settings**, **Read into this session** (when a session you own is open), and **⋯** for **Duplicate** and **Delete this lorebook**. **Lorebooks**, before the name, goes back to the list of books, which is where you open another book, make a **New** one or **Import a lorebook** (the upload button beside **New**).

**Book settings** describes what the book holds (how many entries of each kind, its cast, dates, scenes and lines), and holds the book's calendar and clock. There are no features to switch on: every book can do everything on these pages.

On a wide screen the list and the editor sit side by side. Drag the divider between them to give either more room, or focus it and use the arrow keys (**Shift** for bigger steps, **Home**/**End** for the ends); double-click it to reset. The width is remembered on this device, and is the same for every lens. On a narrow screen, or docked beside a session, the scope list folds into a search and chips (**Loose ends** is the last chip), the lenses move to the bottom, and the editor opens in place of the list. If you move away from an entry with unsaved changes, you're asked first, and reloading or closing the tab warns you too. Moving the moment bar never asks: an open edit keeps the date it was started at.

## Filing entries under others

**Part of** files an entry inside another: the guild's charter inside the guild, the altar inside the chapel. The **Tree** lens draws this. Pick the parent in the editor, or drag a row onto another row. Places and history entries are never filed inside anything: places join by links, and history always stands at the top level, placed by its line and its date (other lore may still be filed under a history entry).

Deleting an entry deletes everything filed under it; the confirmation says how many.

Two other kinds of connection exist, and you'll meet them on the topic pages:

- **Relationships** link any two things with words: *Hild owes Marrow*, *the cellar door leads to the docks*. See [Cast and relationships](./lorebook-cast.md#relationships) and [Places and maps](./lorebook-places.md#ways-between-places).
- **References** are worked out from text: an entry that names a cast member, or a scene that mentions an entry. The **References** tab lists them.

## Cast

The **Cast** is everyone your world holds. When you read a book into a session, its characters and personas join the cast automatically; you can also add background people nobody plays, like the innkeeper. A cast member is that person in *this* story: their private lore, their relationships, and how they change over time. Their character card stays shared and untouched.

See [Cast and relationships](./lorebook-cast.md) for private lore, relationships, the graph, and characters who change over a story.

## Reading a book into a session

**Read into this session**, beside the book's name or in **Settings**, makes the open session read this book. It's offered for sessions you own. A session reads one book at a time; reading this one into a session that reads another asks first. **Stop reading** takes the book out of the session and leaves the book untouched.

You can also choose a session's book in its settings, along with its **Line** and **Story clock** (see [Where the session reads its lorebook](./sessions.md#where-the-session-reads-its-lorebook)).

While a session reads the book, the top of the Lorebooks view names it, says which line it reads and as of when, and how many entries reached its last turn. Click the name to open the session. If you've moved the moment bar or switched lines, **Read what it reads** shows you the book as the session sees it.

### What a session has read

Every turn records what it decided about each entry it judged: read in or left out, why, its rank, its cost, and the keywords that matched. You see this in three places:

- **Marks on each row** in the book: read in, considered and left out, or nothing.
- **The Read in line** in an entry's editor, such as *Read in · rank 2 of 12 · matched umber · 218 of 900 tokens*.
- **The Lore entries widget** in the session (add it from the [layout editor](./session-layout.md)). It lists the book's entries with how often each was read in this session, when last and at what rank, and has **Pin** and **Off** on each row.

These records are the book owner's: guests don't see them. Detailed records are kept for each character's most recent turn; the counts of how often each entry was read are kept for the life of the session.

## What a session may write

Sessions can write back to your lorebook: scenes you capture, stats recorded onto the world, links a genre draws between rooms. Your **Lorebook writes from sessions** setting, in **Settings › User**, decides how much. An administrator sets the default for everyone in **Admin › General**.

- **Full**: sessions write to the lorebook as they play.
- **Review changes** (the default): changes a session makes on its own wait as proposals under its reply, for you to **Accept** or **Reject**. Only the lorebook's owner decides them. What you save yourself from a review screen, such as **Summarize to Lorebook**, **Compile to Entry** or **Apply graph**, saves straight away: that screen is the review.
- **Off**: nothing a session does writes to the lorebook. Summarize, compile and the graph build say so and don't start, and so does drafting or saving the summary of a scene a session captured.

Two writes can't wait for review, so under **Review changes** they behave as under **Full**: a genre linking two rooms, and a genre writing a new entry without its own review step. Under **Off** both are refused. Seating a character always adds them to the cast, whatever the setting.

What a session writes lands on its line, dated where its story stands. See [Stats and states](./stats-and-states.md#when-a-session-changes-the-lorebook) for stats, and [Time, history and branches](./lorebook-time.md#which-line-a-session-reads) for lines.

## Creating, importing, duplicating and deleting

**New lorebook…** asks for a name. Everything else, such as cast, dates and places, appears as you use it.

**Import a lorebook…** reads a SillyTavern lorebook or character book file, a lorebook exported by Serene Pub 0.5, or a book Serene Pub wrote into a character card. It always makes a new book; it never fills the one you have open.

- A SillyTavern file comes in as **World lore**. See [Importing from SillyTavern](./importing-from-sillytavern.md).
- A Serene Pub 0.5 file brings its world lore, character lore with the cast member it belongs to, dated history with its scenes, and its cast with their cards.
- Importing a book you already have is detected and asks whether to overwrite it or import it as new. Before overwriting, it lists what the file can't bring back (such as branches, dated changes and scenes captured from sessions), and those are lost. It also says how many of your characters the file carries an edited copy of: either choice rewrites those characters from the file.
- Files over 32 MB, or far larger than any real book, are refused with the reason.

An imported book is queued for search indexing straight away. If the book was saved but something after it wasn't, the import says **Lorebook imported with warnings** and names what didn't come through.

**Export** is paused while the lorebook format settles: it stays in the menu, greyed out. A [character card](./characters.md) can still carry a book, holding the book's main line without branches or dated changes.

**Duplicate** makes a full copy under a new name: every entry on every line, the cast, branches, links, scenes, dated changes, stats and stat sheets, tags, calendar and clock. Character cards are shared, not copied. Scenes in the copy keep their summaries but not the session messages they were captured from, and the undo of a past merge stays with the original. The copy isn't read into any session until you say so.

**Delete this lorebook** can't be undone.

## Going further

- [Cast and relationships](./lorebook-cast.md): private lore, relationships, the graph, characters who change over time.
- [Places and maps](./lorebook-places.md): rooms joined by ways, the map, and what a place holds.
- [Time, history and branches](./lorebook-time.md): dates, amendments, the calendar and clock, and alternate lines of a story.
- [Summarization](./summarization.md): turning sessions into scenes and history.
- [Embeddings and search by meaning](./embeddings-and-rag.md): finding lore without keywords.
- [Stats and states](./stats-and-states.md): health, gold, inventories and where things are.
