# Places and maps

Places are the rooms, towns and roads of your world. In a lorebook, a place is an entry like any other, with a name, content and keywords, but it can also be joined to other places by **ways**, drawn on a **map**, and hold things, like the key lying in the crypt. Genres that move characters around, such as **Adventure** and the **Lair**, use places to know where the scene is and where it can go next.

:::note By the end of this page
You will have a few places joined by ways, see them on the map, and know how a session uses them.
:::

## Making a place

Choose the **Places** lens (the map), then **New place** in its toolbar. You can also find places in the **Places** scope of the book's rail. A place has the same **Name**, **Content** and **Keywords** as any entry, plus:

- **Category**: free text that groups places, such as a floor, a district or a wing. It shows beside the place's name in the list, and colours it on the map.
- **Links**: the place's ways to other places, and anything else linked to it (see below).
- **Stats**: what the place holds before play (see [What a place holds](#what-a-place-holds)).

Places are never filed under anything; they are joined by ways instead. Other lore can still be filed under a place with **Part of** (the altar under the chapel).

## Ways between places

A **way** is a link between two places: a door, a stair, a road. Everything about the way lives on the link:

- **Type**: how it reads, such as *leads to*, *connects to* or *is inside*.
- **Name** (optional): "the rusted iron door", "the King's Road".
- **Both ways**: turn this on and **From there it…** says how it reads from the far end, so one link reads "leads north to the Drowned Hall" from the guardroom and "leads south to the Guardroom" from the hall. Leave it off for a way that only runs one way, like a trapdoor.
- **Description**, **status** (active, resolved, broken or evolved) and **visibility** (public, acknowledged or secret). A secret way is hidden from the characters.
- **When**, once the book has history: the history entry that made the way true. The bridge collapses in Year 7? Date its link, and sessions earlier in the story still cross it.

Picking a suggested type sets **Both ways** for you: *connects to* and *near* read the same from both ends, *is inside* reads back as *holds*, and *leads to* and *runs past* are one way.

:::tip A way or a place?
If you could stand in it, leave something in it, or fight in it, make it a place of its own. A long road with an inn halfway is a place, linked to each town at its ends. A door is a way.
:::

### Linking two places

There are three ways to link places, and they all make the same link:

- In a place's editor, **Link a place** picks another place, or **New place…** creates one by name and links it.
- On the map, hold **Alt** (**⌥** on a Mac) and drag from one place to another.
- On the map or the Graph lens, select a place and use **Link to…**.

Links save on their own, as soon as you save the link; they're never part of the entry's **Save**. Select a link anywhere to edit it, or **Unlink** to remove it (it asks first).

### Reading ways from an Exits line

When a place's content has an **Exits:** line, such as *Exits: north → The Drowned Hall, down → the crypt* (the Lair's room drafts write one), **Read links from the Exits line** offers the ways that line names. Nothing is written until you confirm.

- A way to a room that isn't linked yet is ticked.
- A way that's already linked is marked **Already linked** and not offered again, so reading the line twice never doubles a link.
- A name no place answers to is offered unticked as a **New place**; tick it to create and link it.
- A name two places share is offered unticked, and says so.

Write each way with an arrow (→, ->, =>), or with a colon on a line without arrows (*north: The Hall*). A way written with "to" (*north to The Hall*) isn't read, because prose uses "to" too. The Exits line stays in the text.

## The map

The **Places** lens draws every place on the line you're reading as a square, named and tinted by its category, with every way between them drawn as an arrow (an arrowhead at each end when it reads both ways). Cast members and other lore linked to a place, such as its keeper, are drawn beside it.

- The line above the map counts the places, the ways, and the places with no ways yet. Category chips beside it narrow the map to one category.
- Click a place, or **Tab** to it and press **Enter**, to see its ways, each said from the place. **Open entry** opens its editor.
- Click a way to edit it beside the map.
- **New place** makes a place and selects it.
- Places archived at the moment you're reading are left out, and a place renamed by an amendment is drawn by its name at that moment.

On a phone, the map fills the screen until you pick something.

The **Graph** lens is the same canvas for everything else: cast members, relationships and links between other lore. See [Cast and relationships](./lorebook-cast.md#the-graph).

## What a place holds

A place's **Stats** section sets what it holds before play, in every session on this lorebook: put the key in the crypt, and every session finds it there. It offers the place's **Inventory**, plus any other stat the book already records for places.

- Type an item and press **Enter**, or pick one under **Add from the lorebook** and say how many. Items show as *Rusty key ×2* with **−** and **+** beside them.
- Every change is saved at once, separately from the entry's **Save**.
- A session starts from what you set here and changes its own copy as it plays. Play never changes the book, unless the session is recorded onto the world (see [What a session may write](./lorebooks.md#what-a-session-may-write)).
- **Adventure** and the **Lair** track a place's inventory. **Chat** tracks no stats, so it ignores them.

Only the lorebook's owner can set a place's stats. For dated values, branches and what an inventory may hold, see [Stats and states](./stats-and-states.md#places).

## How a session uses places

A session that tracks **Location** knows which place the scene is in. When the model names a place, the location points at that place's entry, matched by its exact name, then a looser spelling (with "the" aside), then its keywords. A name two places share is refused rather than guessed.

The prompt then carries the current place's content followed by **From here:** and its ways out, each said from the place: *"The rusted iron door leads north to the Drowned Hall."* Only ways that are standing, not secret, and lead somewhere the session can see are listed, and a one-way link into the room isn't a way out. So keep your ways accurate: they are what the model reads as the exits.

The current place is written there once. In Adventure and the Lair it isn't also ranked in as lore, so it takes none of the room set aside for lore. Until the world records where the scene is, a place only the planner has named can still appear in both.

A character's own voice is only told about the place the scene is in, never what's waiting in rooms nobody has reached. The planner and narrator see every place. See [Stats and states](./stats-and-states.md#in-a-prompt).

Other genres, such as **Chat**, don't write a place's ways into the prompt. There, the model knows a room's exits only from what its content says, so describe the important ones in the text too.

### A place that is off

A place switched **Off**, or off for a while at a session's point in the story, or archived, isn't part of that session's world. The session doesn't list it, show it, read its stats or follow a way to it, and anything the model tries to move there is refused with the reason. A **Location** that points at it reads as not set until it's back.

In the lorebook, nothing is lost: the map still draws it and you can still edit its ways and stats, ready for when it comes back.
