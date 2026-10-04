# Session layout

A session's layout is how its screen is arranged: the conversation, plus any other widgets (scene portraits, stats, the lore list, a plugin's board) placed in the columns around it.

:::tip What it's for
- Putting what you want to watch next to the story: who is in the scene, their stats, which lore was read.
- Changing how the conversation looks: message style, composer, line width.
- Saving an arrangement you like and starting other sessions from it, or sharing it.
:::

A **widget** is one piece of the screen with its own settings, such as **Messages** (the conversation) or **Stats**. The screen has three columns, **Left**, **Middle** and **Right**, and any widget can go in any of them.

## The basics

### Open the editor

In a session, press **Layout** at the right end of the header (on a narrow window it's just the icon, *Customize layout*). The editor's toolbar replaces the header, with three tabs:

- **Layouts**: copy in a ready-made layout, or save yours. See [Layouts](#layouts).
- **Settings**: change one widget's settings and style. See [Settings](#settings).
- **Move**: add, remove, move and resize widgets. See [Move](#move).

The session keeps running underneath while you edit. Any open sidebar view steps aside while the editor is open and comes back when you leave.

### Add a widget and keep it

1. Open the **Move** tab. The columns show as three grids, and a tray lists every widget.
2. Drag **Scene Portraits** from the tray into the **Right** column (or tap it, then tap the column).
3. Press **Done**.

:::tip You should see
Scene Portraits sits to the right of the conversation, and it's still there after a reload.
:::

**Cancel** instead puts back the layout you opened the editor on, including any widgets you added or removed.

:::warning If this didn't work
- **Done says *Put a widget in the middle, or move one back.***: the Middle column is empty. Move a widget back into it.
- **Done says *A session needs one Messages widget***: you removed the conversation. Add **Messages** back from the tray.
- **The widget snapped back**: the column is full. Adding from the tray makes room; dragging doesn't. See [Move](#move).
:::

## The widgets

| Widget | What it shows |
| --- | --- |
| **Messages** | The conversation: the message log and the composer you write in. Every session has at least one. |
| **Scene Portraits** | Either the cast in the scene, or the two pictures you pinned. |
| **Stats** | One card per cast member, with bars, chips and lines you can edit. See [Stats and states](./stats-and-states.md). |
| **World State** | The world's stats (weather, time, place) as a strip or a list. |
| **Lore entries** | The session's lorebook entry by entry: how often each was read, with pin and turn-off. See [What a session has read](./lorebooks.md#what-a-session-has-read). |
| **Author's note** | Chat only. The session's [author's note](./sessions.md#authors-note): edit it, then **Save**. Its last line says whether the newest reply carried it. Guests can read it; only the session's owner can change it. Chat's default layout puts it in the right column as an icon: click it to open the note. |

A plugin can add widgets of its own, and an administrator can write new ones or clone and change these (see [Component authoring](./component-authoring.md)). Once switched on, they appear in the same tray.

Stats and World State are only filled when the session tracks stats (see [What a session tracks](./stats-and-states.md#what-a-session-tracks)). A Chat session tracks none, so they show a line saying so.

### Scene Portraits

Its **Show** setting picks what it draws:

- **Pinned**: two pictures you pin from the composer's **More › Pinned images** (see [Sessions](./sessions.md#pinned-images)). This is the default. Pins are kept in this browser, and the **×** on a portrait clears its pin.
- **Scene**: every character in the session with their picture (their current sprite when **Show sprites** is on), name and, with **Show stat bars** on, their bars. **Include your persona** adds the persona you're writing as. A genre that places the widget for you usually picks **Scene**.

### What the Messages widget offers

These are the Messages widget's own settings:

- **Composer**: *Classic card*, *Single-line pill* (one row: your face, the text, then Preview, More and a round Send), *Tall editor* (for long turns) or *Page line* (no box: you write on the page itself, in the story's own type, above a faint underline; the controls stay faint until you're writing, and Send appears once there's something to send). Send, Preview and More work the same in all four.
- **Composer position**: *Bottom* or *Top*.
- **Line width**: *Full* (the default) runs the messages across the whole widget. *Comfortable* keeps them to an easy reading width, centred.
- **Message order**: *Newest at the bottom* (the default) or *Newest at the top*.
- **Show messages** / **Show composer**: hide either half. With only the log, it's a reading pane.
- Under **Behaviour**: **Show avatars**; **Face beside each line** (*Avatar* or *The line's sprite*); **Show times**; **Show scenes and dates**; **Who is due next** (*Who speaks next*, *Who speaks next and after them*, or *Nothing*; see [Who is due next](./group-sessions.md#who-is-due-next)); **Show the Actions label**; and **Channel** (below).

How messages *look* (bubbles, a novel page, compact lines) is the widget's [style](#style), not a setting.

**Card** on the Messages widget is *Auto*, *On* or *Off*, and decides whether the messages sit on a backing: a **card** (solid) or **glass** (see-through and blurred) behind the log and the composer.

- **Auto** (the default) does what the message style asks. Most styles ask for nothing, so they get a card when you have a background image set in your theme settings and sit straight on the page when you don't. *Dreamlit Cameo* asks for no backing, because each of its lines is already on its own glass card.
- **On** always adds a backing: glass if the style asks for glass, otherwise a card.
- **Off** never adds one, even over a background image.

How a card and glass look comes from your theme, so a custom theme can restyle both.

### A second Messages widget for one channel

Some sessions have more than one channel. The [Lair](./genre-lair.md) has the story and the **Sanctum**, your talk with the Castellan. A layout can give a channel a widget of its own: a second **Messages** widget with its **Channel** setting on that channel. The Lair's own layout does this.

To make one, add **Messages** from the tray and set its **Channel**, or **Duplicate** one that already has a channel.

- **A copy with a channel** shows only that channel, titled with its name (*Sanctum*). What you write in it goes there, and its turn controls are that channel's own.
- **A copy with no channel** shows every channel no other copy has taken. With just one Messages widget, that's the whole session, and its channel strip switches between channels.
- If every copy has a channel, the first one also shows the channels nobody took, so the story never disappears.
- Each copy has its own settings and style.

## Layouts

A **layout** here is a saved arrangement you can copy into a session. The **Layouts** tab shows them as cards, grouped by where they came from:

- **Genre default layout**: what this kind of session (its [genre](./genres.md)) starts with. Chat's is the conversation, with the **Author's note** as an icon in the right column (not pinned, so the conversation keeps the page on a phone). The Guide's is the conversation on its own. Adventure and the Lair ship theirs.
- **From Serene Pub** and **From *plugin***: other layouts that come with the app or a plugin.
- **Your layouts** and **Shared with you** (layouts other people on this pub shared).

A line at the top says where this session's layout came from, such as *Started from the genre default layout* or *Started from your layout "Harbour watch"*.

### Copy a layout in

Click a card to copy it into this session. It asks first, then replaces this session's layout straight away; the editor's **Cancel** doesn't undo it. To keep what you have, save it first (below).

After that, the layout is the session's own copy. Changing the layout later doesn't change this session, and changing this session doesn't change the layout.

- **Reset to genre default layout** copies the genre default layout back in.
- **Start again from "*name*"** copies back the layout this session started from.
- **Start from scratch** leaves only what a session needs (the conversation and the genre's own widgets) with every widget's settings and style back at their defaults.

If the layout a session started from has changed since (a plugin or an update of Serene Pub changed it, or you saved changes into it elsewhere), its card shows **Updated** and the tab a dot. Nothing changes until you choose **Start again from "*name*"** (or **Reset to genre default layout**). For example, Chat sessions opened before Chat's default layout gained the Author's note keep their layout and show **Updated**. Reset to pick up the note, or add it from the tray.

A layout can bring its own widget settings and styles: Adventure's asks Scene Portraits to show the scene with stat bars. Copying one in replaces your settings only where the layout brings its own.

### Save your own

1. Arrange the session the way you want.
2. On **Layouts**, press **Save as new layout**, give it a name and, if you like, a short description.

It's saved with the arrangement and every setting and style you changed, and it appears in every session of this genre under **Your layouts**. **Done** on its own only ever saves this session.

When this session started from one of your layouts, **Save changes to "*name*"** writes this session's layout back into it. Other sessions that started from it keep theirs and show it as **Updated**.

### The card menu

Every card has a **⋯** menu:

- **Use for new *genre* sessions**: every session of this genre you open for the first time starts from this layout. Its card wears a star. **Stop using for new sessions** goes back to the genre default layout.
- **Make a copy**: a new layout of yours, named "*name* (copy)", that you can change freely.
- **Share with everyone on this pub** (your own layouts): it appears under **Shared with you** for everyone else, with your name. **Stop sharing** takes it back. Neither changes anyone's session.
- **Rename** and **Delete**. Deleting a layout changes no session's layout. If people use it for their new sessions, it says how many; they get the genre default layout instead.

Built-in layouts offer only the first two. An administrator can also stop sharing, rename or delete a layout someone else has shared.

### New sessions

The first time you open a session, a layout is copied in: the one you chose with **Use for new *genre* sessions**, or else the genre default layout. Your choice is yours alone; other people in the same session start from their own.

## Settings

Open **Settings**, then hover a widget (or Tab to it) and press the **Settings** button that appears. The widget's settings open in a window titled with its name, such as *Messages settings*. Changes apply as you make them, so there's nothing to save; **Close** or Escape puts the window away. **Reset** puts that widget back to its defaults.

Every widget has:

- **Title**: what it's called on screen. Clear it to go back to the widget's own name.
- **Card**: draws the widget in a card with a border and title bar. Off by default, so widgets sit flush with the session. A widget that opens over the session always has its card. On the Messages widget, **Card** is *Auto*, *On* or *Off* instead ([above](#what-the-messages-widget-offers)).
- **Lane**, on a widget that follows a channel (a phone, a side conversation): a channel can carry several conversations, numbered from 1, and the lane is which one this widget shows.

Below those come the widget's own settings, such as the Messages settings [above](#what-the-messages-widget-offers). Less-used ones sit under **Behaviour**, folded away.

### Style

A **style** is how a widget looks, never where it sits. The **Style** section of the settings window shows the current style, a picker, and **New**, **Edit**, **Clone** and **Delete**.

**Messages** comes with five styles: *Stage* (the default typeset column), *Bubbles*, *Novel*, *Compact* and *Dreamlit Cameo* (each line on a soft, borderless glass card, the speaker's portrait in the card's top corner beside the text, shown at its own shape, so a tall picture shows its full height, and fading into the glass toward the text and at its bottom). Pick one to switch.

To make your own, press **New** (or **Clone** an existing one, which makes a private copy you can edit). Give it a name, its CSS, any variables, and who may use it: **Just me** or **Everyone** on this pub. The editor applies what you type as you type, with a ring around the widget it's styling. **Save style** keeps it; **Cancel** or Escape puts the saved style back. Built-in styles can be cloned but not edited or deleted.

A few rules for the CSS you write:

- It only reaches this one widget. Every selector is scoped to the widget's own box, so it can't touch the rest of the page, another widget, or the controls for changing it.
- `@import` and images from other websites are refused. `@font-face`, `@property` and `@counter-style` are kept but not applied.
- Variables are CSS custom properties, written `--name`.
- To ask for a backing, declare `--sp-backing: card`, `glass` or `none` anywhere in your CSS, for example `[data-widget-part~="messages.root"] { --sp-backing: glass; }`. The widget's **Card** setting decides whether it's followed; how the card or glass looks is the theme's.
- For dark mode only, start the selector with `[data-mode="dark"]`, for example `[data-mode="dark"] .my-card { background: black }`.
- To reach one part of a widget, select its **part**: `[data-widget-part~="messages.message-avatar"] { border-radius: 4px }`. The parts each built-in widget has are listed in [Widgets](./sdk/guides/widgets.md#style-parts).

## Move

The **Move** tab shows the three columns as grids and the tray of widgets.

- **Add**: drag a widget from the tray into a column, or tap it and then tap where it goes. Adding one that's already placed adds another copy (see [More than one of a widget](#more-than-one-of-a-widget)).
- **Remove**: drag it back to the tray, or use the **×** on its card. The last Messages widget shows a lock instead: a session needs one.
- **Move and resize**: drag a card to move it, drag its edges to resize. Each card also has **Fit width**, **Fit height**, **Dock to top** and **Dock to bottom** buttons.
- **Duplicate** (the copy button on a card, or beside **Settings** on the Settings tab) adds a copy with the same settings and style.
- **Anchors** pin a widget to an edge of its column so it stays put as the window changes size.

A column with no free space says **Full**. A widget you *drag* onto it snaps back, but one you *add from the tray* makes room: the biggest widget there gives up rows from its bottom. If it still can't fit, it says *No room in the middle* (or the column's name) and adds nothing; make something there shorter first.

### Groups and pins

Select two or more widgets and press **Group**: in the session they become one widget with tabs. Each tab keeps its state when you switch.

In a side column, each group (a single widget counts as a group of one) is either:

- **Pinned**: open from the start, keeping its height.
- **Unpinned**: an icon in a slim rail at the column's outer edge. Click the icon to open it, again to put it away.

If there's no room beside the pinned ones, a group you open comes out over the session at full height; click away or press Escape to close it. **Alt+[** opens every group that fits, **Alt+]** puts them all away. Pins are saved with the layout; which groups you happen to have open is not.

A widget you haven't opened yet doesn't load until you first do, so a layout with many widgets costs nothing for the ones you never look at.

### Moving the conversation

**Messages** can go in any column: drag it to the left or right and press **Done**. Put a map, the world state or a plugin's board in the middle instead.

Two rules keep a layout usable:

- **A session needs one Messages widget.** The last one can't be removed.
- **The middle is never left empty.**

Wherever the conversation sits, a phone and Stage only still open on it. A side that holds the conversation always stays docked; it never tucks away to icons.

### More than one of a widget

Any widget can be placed more than once: two **Stats** showing different people, a second **World State**, a second view of the story.

- **Add** it again from the tray (it starts at its defaults) or **Duplicate** it (it copies the settings and style, **Channel** included).
- A copy is named with a number, *World State · 2*, until you give it a **Title**. A Messages copy with a channel takes the channel's name.
- Removing a copy removes only that copy.
- A plugin's widget can limit how many times it's placed. At the limit its tray card is greyed out and says *Only one per layout*.

### Previewing other screen sizes

**Screen** shows the layout at other widths without resizing your window: **Compact** (390px, a phone), **Cozy** (640px), **Roomy** (1024px), **Wide** (1440px) and **Ultrawide** (2560px). **Actual** goes back to your window. A narrower width squeezes the widgets, exactly as that device would.

**Rails** draws the side columns the way a session does (pinned groups docked, the rest as icons) so you can try opening and pinning before you live with it. Nothing you do in Rails is saved. At **Compact** and **Cozy** you see the phone editor (below); **Grid** draws the cell grid at that width instead.

There is one arrangement for all sizes. If you edit while previewing, the edit is kept, and the editor says so.

## How the layout fits the window

The same layout adapts to the space it has. Resizing never changes what you saved: widen the window again and everything comes back.

- **One column.** When widgets placed side by side no longer fit, they stack into a single column, top to bottom then left to right. Top-anchored widgets go first, bottom-anchored last. Each column decides this for itself.
- **Widgets fill their space.** Each widget takes the full width of its place. For a reading width, use the Messages widget's **Line width**.
- **An empty side keeps its column** as a faint strip, so adding a widget later doesn't shift the conversation. On a narrow window it's the first thing to go.
- **The conversation stays centred.** At *Comfortable* line width, the text column is centred on the session even when one side is wider than the other. Extra window width goes to the middle; the sides keep their size.
- **Tucked sides.** When the session gets too narrow for its sides and a full text column (most often because a sidebar view is open beside it), each side tucks down to its column of icons. Click an icon to bring that widget out over the session, one at a time. Widen the session again and they're docked exactly as before.

### Phones and narrow windows

Below 1024px the sides are hidden and the conversation takes the full width. The **Session panels** button in the header lists everything on the sides; tap one to slide it in over the session. Which ones arrive open is what you pinned. Tap outside or press Escape to close.

If you moved the conversation into a side, a phone still opens on the conversation, and the middle's widgets join the panels list.

### Stage only, Dock, Half and Focus

**Stage only** (**Ctrl .**, or **⌘ .** on a Mac) hides everything but the conversation; press it again, or Esc, to bring the layout back exactly as it was. It doesn't apply while the editor is open. Opening a sidebar view beside the session at **Dock**, **Half** or **Focus** width changes how much room the session has, which can tuck its sides. Both are explained in [Getting around](./getting-around.md#widths-dock-half-and-focus).

## Editing on a phone

On a narrow screen the editor is three lists, **Middle**, **Left** and **Right**, one row per widget in the order they're drawn.

- **Reorder** with the up and down arrows, or press and hold a row's handle and slide.
- A row marked **First** or **Last** is anchored to the top or bottom.
- **Pin** is on each side row.
- **Add** opens a picker of every widget. The copy button duplicates a row, and **×** removes it.
- The gear opens that widget's settings.
- The bar at the bottom holds **Layouts** (the same cards and menu as the desktop), a reset to the genre default layout, **Cancel** and **Done**.

It's the same layout, so what you do here is what a desktop opens. To try it from a desktop, pick **Compact** or **Cozy** under **Screen**.

## For power users

### Where layouts are stored

Each person's layout for a session is stored with that session: the arrangement, each widget's settings and each widget's style. Guests have their own. The session also remembers which layout it was last copied from and when, only to label it, offer **Start again from**, and spot an **Updated** layout. It's never used to draw anything.

Only settings you change are stored. A widget whose default changes in a later version follows the new default unless you set it yourself, and a setting a widget stops offering is dropped the next time the server starts.

Your layouts belong to you and are offered in every session of their genre. A shared one is readable by everyone on the pub and still only yours (or an administrator's) to change. Your **new-session layout** is one choice per genre, stored with your account.

### Widget ids

A layout names each placed widget by its id, with `#` and a name for extra copies: `stats#2`, `messages#sanctum`. Settings and styles are stored under that id, so they travel with the layout when you save it or start a session from it. A plugin's widgets are named with the plugin's own prefix, so two plugins that both ship a **Map** never collide.

### Plugin layouts and widgets

A plugin can ship layouts for any genre, and a plugin genre ships its own genre default layout (Battleship's board, for example). A layout a plugin built for an older version of Serene Pub is skipped, with the reason in the server log, until the plugin is rebuilt.

A plugin's widget can come with styles of its own. They appear in the **Style** picker beside the built-in ones (and can be cloned, not edited), stay while the plugin is installed, even switched off, and are removed when it's uninstalled. A style you made for a plugin's widget is yours and stays.

Writing a widget, what it receives, and how it runs the session's actions are covered in the plugin guide: [Widgets](./sdk/guides/widgets.md) and [Frames](./sdk/guides/frames.md).

## Related

- [Sessions](./sessions.md): the session screen, the composer and its actions.
- [Getting around](./getting-around.md): the rail, sidebar views, Dock, Half and Focus.
- [Stats and states](./stats-and-states.md): what Stats and World State show.
- [Themes and settings](./themes-and-settings.md): themes and background images.
- [Component authoring](./component-authoring.md): write or clone a widget.
