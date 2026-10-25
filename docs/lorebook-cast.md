# Cast and relationships

A lorebook's **cast** is everyone its world holds: the characters you play with, the people they talk about, and the figures everybody has heard of. Each cast member can carry private lore that only they know, and relationships to other members, places and lore, which together make the book's **graph**.

:::note By the end of this page
You will know where cast members come from, how to write lore only one character knows, how to draw and build relationships, and how a character can change over the course of a story.
:::

## Where cast members come from

You rarely add cast members by hand. When a book is read into a session, every character and persona in the session becomes a cast member, and so does anyone added to the session later. A character card is only ever one member: seating the same card again finds the member it already has.

You can also add members yourself:

- **New**, over the Cast list, adds a member **From a character** card, or a **Background** member by name. While the cast is empty, the list itself offers the same two: **Add a character** and **Add a background character**.
- **Suggestions**, beside it, opens the book's suggestions in one place: people the story mentions who aren't members yet, and pairs that may be one person, on its **New members** and **Duplicates** tabs. Its figure says how many are waiting. They are also rows of the book's [Loose ends](./lorebooks.md#finding-your-way-around-a-book), beside background members with no lore and no relationship.

The Cast list shows each member's face (their card's picture, or their initial for a background member). **Show as › Cards** draws it as a grid of portraits; **List** as rows.
- **Name one in an entry.** **Cast**, above an entry's content, inserts a reference such as `{{char:1}}`. The editor shows it as a chip with the member's name, and the prompt gets their name. Typing a reference to a number the book hasn't given out yet adds a new member for it.
- **Build the graph** from your scenes (see [Building the graph from your scenes](#building-the-graph-from-your-scenes)), which suggests new members for you to accept.

A member with no character card is a **background** member: a name, a summary and some lore, like the innkeeper everyone mentions but nobody plays. Removing a character from a session keeps their cast member, since lore may be about them.

:::tip Character vs. cast member
A **character card** is a starter: it gives enough to begin, and the same card can appear in many books. A **cast member** is that person in *this* story, with this story's lore, relationships and stats, and anything the story retells about them in its own words. Editing the cast member never changes the card. Editing the card changes every member that still reads that part from the card.
:::

## A member's page

Select a member in the Cast list to open their page. It has four tabs, and the tab you pick stays picked as you move from one member to the next:

- **Member**: who they are in this story.
  - **Status in world**: active, deceased, missing or departed.
  - **Also known as**: other names they answer to. A member with a card takes their name from the card, and the card's names are added to these.
  - **Summary**: a short description used by the graph and the prompt.
  - **Character card**: the card that represents them, with **Change** to swap it, **Unlink card**, or **Link character** for a member with none.
  - **Sprite set**, when the card has more than one: which set of expressions this member is drawn with.
  - **When they are here**: their presences (see [When a cast member is in the world](#when-a-cast-member-is-in-the-world)).
  - **Amendments**, once there are any: the dated changes filed on them (see [Changing a member over time](#changing-a-member-over-time)).
- **Lore**, with a count: their private entries (see below), and **Add lore**. Selecting one opens it for editing in the same tab, and the back arrow returns to the list. The lore editor's **⋯** holds **Pinned** and **Off**, as the entry editor's does.
- **Relationships**, with a count: their ties to other members and lore, with where each came from, and **See in graph**.
- **Timeline**: the scenes they're in on the line you're reading, oldest first, each dated by the history entry it was compiled into. A scene dated after the moment you're reading is dimmed and marked *later*. Selecting one opens it under **Scenes**.

## What the member tells in their own words

A card's description, personality, scenario, greetings and example dialogues were written for every story the card might ever be in. When this story has changed someone, the member can tell those parts in their own words, and the card stays as it was.

On the **Member** tab, after the summary, the **From the card** block has a row for each of these parts. Each row has a toggle:

- **From the card**: the member reads the card's text. This is where every member starts.
- **Retold here**: the member's own text replaces the card's. Switching a row to **Retold here** while its field is empty fills it with the card's text first, so you edit from where the card left off.

**Take from card** copies the card's current text into the member's field, for when the card has moved on and you want to start again from it. Switching a row back to **From the card** keeps what you wrote; it is only set aside, and switching back brings it back.

The member's **face** works the same way. **Change face**, in the header of their page, picks a picture from the card's gallery or from **This book's pictures**. **Upload a picture** adds one to the book's pictures, not to the card, and picks it. **Use the card's picture** goes back to the card's own. Like the text, a new face is kept when you save.

These are part of the member like their name and summary, so while you read as of a date (see [Changing a member over time](#changing-a-member-over-time)), saving them files a dated change: the young keeper can tell her description one way and the old keeper another. A face is dated the same way, whichever picture you picked.

### What a session reads

In a session reading this book, a retold part replaces the card's for that member: in the prompt, wherever the card's text would go, and in the faces the session draws. Retold greetings are what a **new** session on the book opens with; a session already under way keeps the greeting it started with. Parts left **From the card** read the card as it is now, so editing the card still reaches them.

## Lore only one character knows

Lore written on a member's **Lore** tab, or an entry anchored to a member, is **private** to them. When it's read in, it reaches the prompt as **Character lore**, with the member's name beside each entry:

- A character's own turn gets their own private lore, plus that of any character a person plays. Never another character's.
- The narrator gets the lore of background members, and lore anchored to nobody.

Character lore is placed by the session's context template, through `{{{characterLore}}}`. The built-in templates already place it; if you write your own template, include `{{{characterLore}}}` or character lore won't reach the model. See [Context templates](./context-templates.md#the-default-template-and-available-variables).

## Relationships

A **relationship** is a directed, typed link between any two things in the book: two members ("Verity *trusts* Marrow"), a member and an entry ("Verity *keeps* the Crypt"), or two entries. Between two places, a relationship is a way from one to the other; see [Places and maps](./lorebook-places.md#ways-between-places).

Each relationship has:

- a **type**, the words it reads with, such as *trusts* or *owns*,
- an optional **Name** and a **description**,
- a **status**: active, resolved, broken or evolved,
- a **visibility**: public, acknowledged or secret. A secret relationship is known only to the member who holds it,
- **When**, once the book has history: the history entry that made it true. A tie can change over a story, each version dated by its own history entry, and a session reads the version its story has reached.

Unless both ends are cast members, a relationship can read **Both ways**, with **From there it…** saying how it reads from the far end.

On a member's page, the **Relationships** tab lists each tie with who is at the other end — their face and name as they are at the moment you're reading, which opens them — and the tie in words under it.

### Relationships the rules keep

When a session plays rules that keep **ties** (Romance's bonds), each person in a relationship holds their own side of it in the session, with their own numbers: how much Wren likes Mara is Wren's, and how much Mara likes Wren is Mara's. The lorebook keeps the words. A relationship whose type comes from a side is marked **from the rules** and can't be retyped here; its description and name are still yours. Open it to see **each person's side** (its words and its numbers) and **How it changed**, read from the turns that changed it. **Set…** on a number never writes it: it files a change the session reviews, and the relationship follows when the change is kept.

Drawing a relationship between two people in a book a session plays makes their sides in that session. Deleting it lets those sides go; a side let go in play leaves the relationship as it is. A book the session may not write keeps its own relationship, and the session's notes hold the session's version, which the session reads instead. The same goes for a cast member's state the rules set (_missing_, say): the book keeps theirs, and the session reads its own. On a character's sheet, each tie shows its words, your own number, how the other person feels, and **Show my number to ‹name›**; the game master sees both sides.

### How relationships reach the model

Relationships between cast members reach the prompt from the point of view of whoever is speaking: what they think of the others, what the others think of them, and figures the whole world knows of. Secret relationships only reach their holder. By default every such relationship is included; to make them compete for room with lore instead, give relationships a share of the budget in the reply pipeline (see [Embeddings and search by meaning](./embeddings-and-rag.md#relationships-from-the-graph)).

Links between other lore, such as the ways between places, aren't written into the prompt this way. See [How a session uses places](./lorebook-places.md#how-a-session-uses-places).

## The graph

**Show as › Graph** draws the book as a web: cast members as circles, entries with links as squares, and every relationship as a labelled arrow. Zoomed out, the links between two nodes fold into one arrow with a count; zoom in or click a node to see them one by one.

- Click a node, or **Tab** to it and press **Enter**, to select it. The details beside the canvas list its relationships, and **Open entry** opens its editor (**Open cast member** for a member).
- Drag a node to move it. It stays where you drop it, and dragging never selects it.
- Hold **Alt** (**⌥** on a Mac) and drag from one node to another to draw a relationship, or use **Link to…** in the selected node's details. The form suggests types for that pairing and accepts any you type.
- Click a relationship to edit it beside the canvas. Deleting one asks first. If you've changed a relationship (or started a new one) and then pick something else on the canvas, you're asked first. If someone changes the same relationship elsewhere while you edit it, the form says so: **Update** puts yours in its place, **Cancel** keeps theirs.
- The details also name scenes that put two members together with no relationship between them yet: a hint for one you might draw.

Drawing a link never rearranges the canvas.

## Building the graph from your scenes

Instead of drawing every relationship by hand, you can have the model read your story and propose them. It reads **summarized scenes** and **compiled history entries**, so first capture and summarize some scenes (see [Summarization](./summarization.md)).

- **Build**, on a book with no graph yet, reads its scenes and history and proposes the whole web. The empty graph offers the same as **Build a graph**.
- **Extend graph**, in **Show as › Graph**, reads every scene and history entry on the line you're reading that hasn't been read yet.
- **Extend from this session** reads only the scenes of the session you have open. In the session itself, the **Chronicle** widget's **Extend graph** does the same.
- **Rebuild** starts over for ties between cast members: it deletes every link between two members, on every line, and builds them again from main's scenes and history. Hand-drawn ties between members don't come back, and it says how many it will delete before you confirm. Places, their ways, and links to other lore are never touched by a rebuild.

Every build stops at a **review screen**, and nothing is saved until you press **Apply graph**. There you can rename or remove a suggested character, reword a relationship, and set its status and visibility. A build left waiting stays in **Activity** for you to finish later; each book's build has its own card there.

A name in your scenes that is a place or item in the book isn't added as a new character. The review lists every name it skipped, so you can add one by hand.

With [lorebook writes from sessions](./lorebooks.md#what-a-session-may-write) set to **Off**, the graph build says so and doesn't start.

## Changing a member over time

A cast member can change over the story, like an entry. While you read as of a date (see [Time, history and branches](./lorebook-time.md#reading-the-book-at-a-moment)), **Save as of ‹date›** on the member's page files a dated change to their name, aliases, state, summary, visibility, sprite set, or **which character card represents them**.

That last one is how one person can look different at different points of their life. Link the young card, then at the year she changes, amend the member to the older card. Read before that year and you see the novice; after it, the keeper. A session may seat either card and it's the same person, with the same stats, relationships and private lore. Each card belongs to one member only.

Cards themselves are never amended, because a card is shared between books. While reading as of a date, changing, linking or unlinking the member's card is dated too; the save menu also offers **Change the card everywhere** (and the same for linking and unlinking) for every moment at once.

The member's lore isn't dated from their page. To file a dated change to a piece of their lore, open the entry from the list while reading as of the date.

## When a cast member is in the world

By default, a cast member is simply in the world at every moment. Most never need more.

**Place them**, under **When they are here** on the member's **Member** tab, says more: from what date they're here, until what date, and at what point in their own life (a plain number you choose the meaning of: an age, a chapter, an arc). Each of these is a **presence**. Leave the departure blank and they never leave; a departure date is the day they're **gone**, not their last day.

Placing someone for the first time changes what "no presence" means: until then they were always here, and from then on they're here only during their presences. The form warns you before the first one.

Presences change what a session reads. Lore about a member who isn't in the world at the session's story date, such as their private lore or an entry about them, is left out of the prompt, and the retrieval explanation says so, naming them and the date. A member with no presences is never left out.

Two presences that overlap are **two of them at once**: her at 34 and her at 50, in the same room. That's what presences are for, so the form tells you and lets you through.

On the **Cast** view, the button beside the view's name and count says who is in the world at the moment you're reading; press it for the list, and a name to open that member. **Show as › Lives** draws the same over time: a lane per placed member, a bar per presence, marked where two overlap. Like amendments, a presence belongs to the line it was placed on.

## Merging and deleting

When the same person has ended up in the cast twice, merge them. **Suggestions**, over the Cast list, suggests likely pairs (its **Duplicates** tab) ("same person?") with **Yes, absorb** and **No, different people**, and in **Show as › Graph** a selected member offers **Absorb into another member**. One member is kept (a member with a card always is), and everything of the other's moves onto them: relationships, scenes, private lore, and every mention in the book's text. Relationships both had are kept once.

**Recent merges** lists past merges, each with **Undo this merge**, which brings the other member back with their mentions restored in every text nobody has edited since.

**Delete**, on a member's page, says what goes with them: their relationships, dated changes, places in scenes and stats. If they have private lore, it asks whether to **Keep their lore** (it becomes lore anchored to nobody, which the narrator can see) or **Delete their lore too**. Wherever the book mentions them, their name is written in as plain text so the lore still reads. Their character card isn't touched.

Deleting a character card removes it from your lorebooks too: its member keeps their name, lore and relationships, but no longer has a card.
