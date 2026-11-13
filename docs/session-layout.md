# Session layout

A session's layout is how its screen is arranged: the conversation, plus any other widgets (scene portraits, stats, the lore list, a plugin's board) placed in the zones around it.

:::tip What it's for
- Putting what you want to watch next to the story: who is in the scene, their stats, which lore was read.
- Changing how the conversation looks: message style, composer, line width.
- Saving an arrangement you like and starting other sessions from it, or sharing it.
:::

A **widget** is one piece of the screen with its own settings, such as **Messages** (the conversation) or **Stats**. Widgets sit in **panels**. A panel is a box that holds one widget, or several as **tabs** you switch between. The screen has three **zones**, **Left**, **Middle** and **Right**, each a stack of panels from top to bottom, and any widget can go in any of them. Every panel is always open.

## The basics

### Open the editor

In a session, press **Layout** at the right end of the header (on a narrow window it's just the icon, *Customize layout*; on a phone it's **Customize layout** in the header's **⋯** menu). **Customize layout** in the full-screen corner control is there only with [advanced controls](./themes-and-settings.md#show-advanced-controls) on. On a desktop the header's **Settings**, **Layout** and **Full screen** buttons are muted until you point at one. The editor's toolbar replaces the header, with two tabs:

- **Layouts**: copy in a ready-made layout, or save yours. See [Layouts](#layouts).
- **Arrange**: add, remove and move widgets, and open each one's settings. See [Arrange](#arrange).

Beside them are **Undo**, **Cancel** and **Done**. The session keeps running underneath while you edit. Any open sidebar view steps aside while the editor is open and comes back when you leave.

### Add a widget and keep it

1. Open the **Arrange** tab. Each zone shows its panels as cards, and the tray lists every widget.
2. Drag **Scene Portraits** from the tray into the gap at the top of the **Right** zone (or tap it in the tray, then tap **New panel here**).
3. Press **Done**.

:::tip You should see
Scene Portraits sits in a panel of its own to the right of the conversation, and it's still there after a reload.
:::

**Cancel** instead puts back the layout you opened the editor on, including any widgets you added or removed. It doesn't take back a widget's settings you changed on the way: those apply as you change them (see [Settings](#settings)).

:::warning If this didn't work
- **The conversation is gone**: you removed the **Messages** widget. You can remove any widget, the conversation included. Add **Messages** back from the tray, or press **Reset to genre default layout** on the **Layouts** tab.
- **It says *Put something in the middle first.***: the middle is never left empty. Put another widget in the middle before moving its last panel out.
- **The tray card is greyed out and says *Only one per layout***: that widget is already placed as many times as it allows.
:::

## The widgets

| Widget | What it shows |
| --- | --- |
| **Messages** | The conversation's log: the messages, the [channel tabs](#channel-tabs) above them and, when you select messages, the selection bar at its foot. Every session has at least one. The field you write in (**Composer**) and the row that says who is next (**Turn line**) are widgets of their own. |
| **Composer** | The field you write in, with the persona you write as and the actions beside it. It writes to the Messages above it in its zone (see [The Composer and the Turn line](#the-composer-and-the-turn-line)). Settings: **Composer** (*Classic card*, *Single-line pill*, *Tall editor* or *Page line*), 🚧 **Composer on the other tabs** and **Show the Actions label**. |
| **Turn line** | One row: what the last run did and who is next. It follows the same Messages as the Composer. One setting: **Who is due next** (*Who speaks next*, *Who speaks next and after them*, or *Nothing*; see [Who is due next](./group-sessions.md#who-is-due-next)). |
| **Dialogue box** | The story one line at a time, in a box: one line of the main story (narration too), with a bar that says who has replied and a **Next line** button. One per layout. See [The Dialogue box](#the-dialogue-box). |
| **Scene Portraits** | Faces beside the conversation: everyone in the scene, whoever spoke last, or the people you name; each as their avatar, their current sprite or an image chosen from their gallery; in a row, a grid, a column or a stage of two. See [below](#scene-portraits). |
| **Stats** | Stats you can edit: bars, chips and lines. Settings: **Whose stats** (*Cast*, *World*, *Places*, *All* with a heading for each, or *Pick* by name), **Which cast members** (*Scene* or *All*), **Stats** (*All*, *Bars* for numbers with limits only, or *Pick*), **Arrangement** (*Cards*, a *List* down a column, a *Strip* across the top of the messages, or *Faces*: one character's sheet, with a row of faces to pick from, then their portrait, name and role and the sheet's sections), **Density**, 🚧 **When empty** (what it says when there is nothing to show; empty draws nothing) and 🚧 **Story time format** (how a clock stat reads, e.g. `Day {day}, {hh}:{mm}`; empty spells it through the lorebook's calendar). Place it twice for the world's strip and the party's cards. A **Pick** that names nobody in the session says so. See [Stats and states](./stats-and-states.md). |
| **World State** | Now **Stats** with **Whose stats** *World* and **Arrangement** *Strip*. A layout that already has World State keeps it and draws it the same way, still titled *World State*. The tray offers Stats only. |
| **Lore entries** | The session's lorebook entry by entry: how often each was read, with pin and turn-off. After a search that finds nothing it says *Nothing matches.* See [What a session has read](./lorebooks.md#what-a-session-has-read). |
| **Author's note** | The session's **Scenario** above, then, in Story, its [author's note](./sessions.md#authors-note): edit each, then **Save** (each has its own **Save**, **Discard** and *Unsaved changes*). The note's last line says whether the newest reply carried it. Guests can read both; only the session's owner can change them (anyone else sees the scenario greyed, with *Only the session's owner can change the scenario.*). The Scenario shows even where the note isn't offered. Story's default layout puts it on the left, in the panel with **Stats**. |
| **Turn order** | Whose turn it is and who follows, each with a face and a chip (*Due*, *Then* or *You*), then **Continue**, **Pick who speaks** and the strategy in force. Unlike the Turn line, it stays up while you write. A guest with no character or persona in the session sees the buttons greyed. One per layout. Settings: **Faces**; under **Behaviour**, **Show the strategy**; under **Faces**, **Show benched characters** (lists the [benched](./group-sessions.md#bench-a-seat) characters under the order, marked *Benched*). See [Who is due next](./group-sessions.md#who-is-due-next). |
| **Actions** | The session's actions as buttons, in groups: the turn controls (**Continue**, **Pick who speaks**, **Regenerate** and the like) first, then the genre's own, then any switched on for it from another plugin. A press works as the chip beside the composer does, so an action that asks for text opens the same box first. A greyed button keeps its reason in its tooltip. Unlike the composer's **Actions** row, it stays open while you write. One per layout. Settings: **Show** (every group, or one), **Size** (*Compact* chips, or *Large* tiles that suit a phone) and **Show what waits on you**, which draws nothing yet. See [Session actions](./session-actions.md). |
| **Annex** | One value a pipeline keeps for this session, under its label: text as a paragraph, a number or a choice as one line, a list as chips, a group of values as one line each. It shows only what you're allowed to see: a value kept from you says *You can't see this*, and one not written draws nothing. With no **Key** picked it says *Pick a key in settings*. If you may change a text value, it has an **Edit** button that saves the way [Session data](./sessions.md#session-data) does. Add one copy per value. Settings: **Key** (the value's owner, a dot, then its key, such as `acme.dice.last-roll`; Session data lists them) and **Show the label**. |
| **Chronicle** | Where the story stands and what the lorebook has recorded of this session. At the top, the session's [story clock](./lorebook-time.md#the-story-clock): its date, and whether it is the session's own clock or follows the lorebook's line. The session's owner gets **Next day** (or **Next month**, **Next year**, as precise as the date), **Move the clock…** and, with a clock of its own, **Follow the line's present**; a chip says when the session's own clock stands before the line's present. Under the clock, while a scene is open, the **Open scene** card: its name, the day it began (*since Day 12*), how many lines it holds so far, and who is in it, proposed from who speaks and who the lines name (hover a name for why), with **Close scene** and **Close and summarize** (the latter when [summaries](./sessions.md#when-a-new-scene-begins) are on request). Under **Now**, the history entry the session is in (the newest on its line up to its clock), with **Open in lorebook** and **Start new history entry**, then that entry's scenes from this session, each in the colour the conversation marks it with and with a dot for its summary (hollow: not summarized; pulsing: being summarized; filled in the theme's accent: ready to review; filled green: summarized; red: the summary failed; while it runs, the row also says *Summarizing…*), **Summarize** on a finished scene with none yet, **Ready to review** on one whose summary waits for you (it opens the review), **Summarize all (N)** for every such scene in the session, **Summarize scene** (choose the messages in the conversation) and **Extend graph (N)** when some scenes aren't in the lorebook's relationship graph yet. Below them, **Not yet compiled** lists the session's scenes that no history entry holds yet, by day (scenes with no story date under *Undated*). Each day has a **Compile** for the lorebook's owner, which compiles that day's scenes on the session's line into its history entry and makes the entry if there is none; the run shows in the activity list. The lorebook's History lens has the same Compile. Summaries started here run in the background, each ready for review in the activity list; with the session's summaries set to **Never**, none is offered. **Earlier** folds the entries before it; click one, or a scene, to open it in the lorebook. A scene whose applied summary recorded what it was written from says *Written from the story up to 3 Oct, 14:20*. Guests see the clock only. A session that reads no shared lorebook shows the history and scenes of its **Session notes**. Settings: **Show the story clock** and **Earlier entries shown**. |
| **Album** | Every picture shown in this session, newest first: what people attached and what was generated, as square tiles. A paperclip in a tile's corner marks an attached picture, sparkles a generated one; point at a tile (or tab to it) to see who showed it and when. Click a tile to open it full size, then page through the whole album with the arrow keys. A picture deleted from **Settings → Media** says *File no longer available*. Settings: **Show** (*Everything*, *Attached* or *Generated*), **Tile size**, **Arrangement** (*Grid*, or *Newest large*: the newest picture big with the rest as a strip, to sit beside the conversation while pictures are generated) and **Channel** (*Default (every channel)*, or **One channel** and its slug for that channel's pictures only). |
| **Backdrop** | The session's backdrop: one picture that sets the scene, shown filling the widget. A pipeline can set it, or you can: **Change** opens a picker with each person in the session and the pictures in their gallery, then, under **From this session**, the pictures drawn in this session (newest first); choosing one makes it the backdrop for everyone in the session; **Clear** takes it away; **Illustrate** draws the scene as it stands and makes that the backdrop (it runs the [Scene](./sessions.md#scene) action, so it shows only where Scene is offered). Only the session's owner (or an admin) sees Illustrate, Change and Clear. With none set it draws nothing, only those buttons for the owner. Settings: **Fit** (*Fill*, which crops the edges, or *Whole picture*) and **Dim** (0 to 100: darkens the picture so text over it is easier to read). The backdrop belongs to the session, not to you: it is not your app background and not a picture on a message. |
| **Places** | Where the scene is, what is around it and where it can go: the places of the session's lorebook, as the session reads them (its line, at its [story clock](./lorebook-time.md#the-story-clock); a place switched off or archived by then is left out). As a **List**, each place shows its category in its colour, the faces of the cast standing there, and its ways out as one line (*→ The Guardroom, The Crypt*); the place the scene is at is marked **Here**. Click a place to open it in the lorebook. As a **Map**, the same places are squares joined by arrows (an arrowhead at each end for a way that runs both ways), **Here** ringed; **+** and **−** zoom, and you scroll to move around. Click a square to see its ways, what the lorebook links to it (its keeper, say), who is there and what it holds, with **Open entry**. **Show the map** / **Show the list** switches between them for you. If **Categories** match none of the book's places, it says so. A session that reads no shared lorebook lists the places of its **Session notes**. Settings: **View** (*List* or *Map*), **Pick out** (*Where the scene is*, *Where the cast stand* or *Both*); under **Map**, **Categories** (one per line; empty shows every place) and **Show ways out**. See [Places and maps](./lorebook-places.md). |
| **Who's here** | The people in this session and who has it open right now. Under **Here**, a row for each person with the session open in any tab: their name (*you* on yours), the persona they write as with its face (click it to open them: their cast member if the session's lorebook has them, otherwise their card), or, when their seat has no card, the name they play under with its portrait, *typing…* while they write, and *Owner* or *Guest*. Under **Away**, the session's other people, with when they were last here (*Last here 5m ago*; *Not seen lately* when the app has not seen them since it was last started). With the session to yourself the **Here** group holds only you. One per layout. Settings: **Faces** and **Show who is away**. See [Guests](./sessions.md#guests). |
| **While you were away** | What the session's [routines](./sessions.md#routines) did: each run's name, when it ran, what it wrote, and why one was skipped or paused (_Skipped: already waiting_, _Paused after 12 runs in a row_), a run started by hand marked **Run now**. Runs since you last played are under **While you were away**, older ones under **Earlier**; **Refresh** reads it again. An administrator can open a run in the inspector. No layout adds it for you: add it from the tray. |
| **Runs** | For administrators only: this session's pipeline runs, newest first. Each run shows its pipeline, how it ended (**Finished**, **Stopped**, **Failed** or **Cancelled**, with where it stopped and why), a run that only prepared a prompt marked **Preview**, what started it (_Started by an event_, _Started by a routine_, _Started by you_…), when, how long it took and the tokens it spent. **Steps** lists the run's steps underneath, **Inspect** opens it in the run inspector, and **Prompt** opens the prompt a reply was written from when [context debugging](./system-settings.md#context-debugging) is on and that line is loaded. It reads again when a run you started ends, when the story moves, and on **Refresh**; **Show more** lists up to 100. Anyone else never sees it: it isn't in their tray, and a layout that places it draws nothing for them. |

A plugin can add widgets of its own, and an administrator can write new ones or clone and change these (see [Component authoring](./component-authoring.md)). Once switched on, they appear in the same tray.

Stats is only filled when the session tracks stats (see [What a session tracks](./stats-and-states.md#what-a-session-tracks)). A widget with nothing to show draws nothing, so Stats in a session that tracks none is an empty panel. Messages keeps its line (*Send a message to start*).

:::tip If a widget shows nothing
1. Reload the page. Every widget starts again, and nothing you set is lost.
2. If a widget still says *This widget stopped and can't show anything.*, press **Reload widget** on it. Only that widget starts again; its settings, style and place are kept. Copying a layout in (**Reset to genre default layout** included) starts the conversation again too.
:::

### Scene Portraits

Three settings, each answering one question.

**Show**: who it draws.

- **Everyone in the scene** (the default): every character in the session, in the session's order.
- **Whoever spoke last**: the people who spoke most recently, newest first, each with a number (1 spoke last). **How many** sets how many, from 1 to 20.
- **Members you pick**: the people you name under **Members**, one per line, by the name the session shows. They're drawn in that order.

A [benched](./group-sessions.md#bench-a-seat) seat's character is never drawn: they're out of the scene. **Include your persona** adds the persona you're writing as to **Everyone in the scene** and **Whoever spoke last**; **Members you pick** draws whoever you name. With nobody named, or no name that matches, it says so.

**Who**: which kinds of people **Everyone in the scene** and **Whoever spoke last** draw (**Members you pick** ignores it).

- **Both** (the default): exactly what Scene Portraits drew before: the characters, plus your persona when **Include your persona** is on.
- **Personas**: every visible persona that spoke, any player's.
- **Characters**: no personas.

Two more settings, for **Everyone in the scene** only:

- **Include every player's character**: each player's character after the cast, yours among them, with the picture on their sheet. A character made up in the session without a card shows by their name.
- **Include the people met**: the people the story has met, by name (a person written into the session's notes has no picture), once the story has named them. A Dungeon Crawler session turns both on.

**Picture**: which picture each face shows.

- **Current sprite** (the default): the face that fits the character's newest line (see [Sprites](./sessions.md#sprites)), or their avatar when they have no sprites. On a character with more than one sprite set, the session's owner and the character's owner get a menu on the face to show another set in this session.
- **Avatar**: the character's own picture.
- **Chosen image**: an image chosen from the character's gallery. The **⋯** on a face shows that character's gallery, with the image the face shows marked; click an image to show it on the face, or **Use the avatar** to go back. The choice is yours alone: other people in the session keep their own. A character with nothing chosen shows their avatar.

**Arrangement**: **Row**, **Grid** (the default, wrapping to the width), **Column**, or **Stage**: the first two, large and side by side, standing on the widget's floor.

**Dim whoever isn't speaking** (off by default): every face but the one whose line is shown is dimmed. When the speaker isn't on the stage, nobody is dimmed.

**Open stage** is a built-in [style](#style) for it: no panel background or border, no padding, and no name or rank, with the figures standing on the bottom edge of the panel. It suits a layout whose [session backdrop](#layout-settings) fills the screen.

**Show stat bars** puts each character's bounded stats under their face. **Bars for** picks whose: *Everyone with stats*, or *Players' characters only* (a Dungeon Crawler's choice: its companions keep no sheet).

Pictures you pinned in an earlier version (from the composer's old **Pinned images** panel) move into Scene Portraits the first time you open the session: a widget that showed them becomes a **Stage** of those characters, each showing the picture you'd pinned as its **Chosen image**. They were kept in one browser, so they move on the browser you pinned them in.

### What the Messages widget offers

These are the Messages widget's own settings:

- **Line width**: *Full* (the default) runs the messages across the whole widget. *Column* keeps them to a reading column of about 76 characters of story text, centred; it grows with your story text size and never runs wider than the widget. *Comfortable* is a narrower column, about 640px of prose. The Composer and Turn line that write to this Messages take the same width.
- **Presentation**: *Follow the channel*, *Rows* or *Folio*. *Rows* draws each line with its avatar, name, time and controls. *Folio* reads the lines as one block of prose, the way a manuscript reads: each line is a paragraph, and a thin rule with a name marks where the speaker changes. There are no avatars, times or swipe arrows, and no scene or date markers. A line's menu, Edit and the selection controls appear at its edge when you point at it or tap it, and its Composer draws as the *Page line* unless you picked another. Folio keeps your style's typeface and colours, but not its cards or bubbles. *Follow the channel*, the default, reads a widget showing a manuscript-style channel (the Writing Room's *Manuscript*) as Folio, and any other as Rows.
- **Message order**: *Newest at the bottom* (the default) or *Newest at the top*.
- Under **Channel**: **Channel** (below), **Channel lane**, for a genre that gives each person their own lane of a channel (*Default (main)* for **Channel** shows every channel no other Messages widget shows; *Default (whole channel)* for **Channel lane** shows the whole channel), and 🚧 **Show another channel inline** (*Default (none)*, or **A channel** and its slug; [below](#dice-inline-or-as-a-log)).
- Under **Reading**: **Show avatars**; **Face beside each line** (*Avatar* or *The line's sprite*); **Show times** (the story time a line was written at, when the story has a clock or a dated present; otherwise the real time. Hover a time for the story time in full and the real time it was written); and **Show scenes and dates** (the story's day marks and the scene dividers, their dates in the lorebook's calendar; see [The session's lorebook](./sessions.md#the-sessions-lorebook)). 🚧 **When empty** is what an empty log says (empty: *Send a message to start*). 🚧 **Story time format** spells the times in change lines and beside each line — a clock stat's move, *Time passes…* — with `{year}`, `{month}`, `{monthName}`, `{day}`, `{dayName}`, `{hh}` and `{mm}` (`{dayName}` and `{monthName}` need a calendar that names them); empty spells them through the lorebook's calendar. A genre's layout may set both per copy: the Dungeon Crawler's Story reads `Day 1, 08:30`.

How messages *look* (bubbles, a novel page, compact lines) is the widget's [style](#style), not a setting. What the messages sit on (a card, glass or nothing) is the layout's **Backing**, the same for every panel (see [Layout settings](#layout-settings)).

### The Composer and the Turn line

The **Composer** is the field you write in. The **Turn line** is one row that says what the last run did and who is next. Each is a widget of its own, placed like any other, and each follows one Messages widget.

- **Which Messages.** The nearest panel above it in the same zone whose shown tab is a Messages widget. Failing that, the nearest panel in its zone that holds a Messages tab; failing that, the first Messages panel in the Middle, then Left, then Right. So put the Composer *below* the Messages panel to write at the bottom, or *above* it to write at the top: the order of the panels is the whole rule.
- ***Writing to ‹channel›.*** If that panel is showing another tab (stats, say), the Composer keeps the last channel and says *Writing to* that channel, so what you write still goes where you expect.
- **Its look follows its Messages.** Line width and presentation come from the Messages it follows, and the Composer and Turn line wear that Messages' [style](#style) unless you pinned a style of their own on them.
- **A reading pane.** A zone with Messages and no Composer is a reading pane: nobody writes there. The Dungeon Crawler's Journal and Table talk are that.
- **Priority.** The Composer's panel has a **Priority** of *High*, so when a zone runs short of height it keeps its room longest (see [How the layout fits the window](#how-the-layout-fits-the-window)).

The Composer's settings are **Composer**: *Classic card*, *Single-line pill* (one row: your face, the text, then Preview, More and a round Send), *Tall editor* (for long turns) or *Page line* (no box: you write on the page itself, in the story's own type, above a faint underline; the controls stay faint until you're writing, and Send appears once there's something to send); 🚧 **Composer on the other tabs** (below); and **Show the Actions label**. Send, Preview and More work the same in all four. The Turn line's one setting is **Who is due next**.

### The Dialogue box

The **Dialogue box** reads the story one line at a time, the way a visual novel does. It shows one line of the main story at a time, narration included, drawn like a line in Messages: its menu, editing and pictures are there, and so is its spoken line. The one thing it leaves out is **Select for summary**. You can place one Dialogue box in a layout, and it shows nothing until the story has lines.

- **Next line.** When a character replies after the line you're reading, or several do in a round, their lines wait behind the one on screen. A bar under the line says who is waiting (*Osk has replied*, *Osk and Bren have replied*, *3 more lines*, or *Osk is writing…*), and the whole bar is the **Next line** button. With nothing waiting the bar isn't drawn.
- **Your own place.** Each person reads at their own pace: where you are is kept in your browser, not saved with the session, and opening a session starts at the newest line. When you send a line you're caught up: your own line is passed, and so are lines that aren't a character's or a person's (a change line, a marker), so the first reply shows at once.
- **Read on by itself** (off by default): moves to the next line by itself once a line's voice has played, or, when it has none, after a reading time worked out from its words. A bar fills over that time (*Time until the next line*) before the next line slides in. **Reading speed** (words per minute, 80 to 600, 220 by default; shown when **Read on by itself** is on) sets how long a line with no voice stays. **Pause** on the bar stops it until you press it again; Pause isn't saved.
- **Writing and the log.** The [Composer](#the-composer-and-the-turn-line) below the box writes to the main story and says *Writing to Story*. The whole log is the **Log** tab (a Messages widget) beside the box.
- **Voices.** While a layout has a Dialogue box, the Messages widgets in it don't play a new line's voice by themselves: the box's line is the only one that plays on its own. A line in the log still plays from its play button (see [Spoken lines](#spoken-lines)).
- **The stage follows.** The faces in [Scene Portraits](#scene-portraits) show the picture each character had at the line the box shows, and with **Dim whoever isn't speaking** on, the speaker of that line stands out.

### Spoken lines

When a line has been [read aloud](./sessions.md#read-aloud), the Messages widget draws one quiet row under it, after any pictures:

- A **voice chip** with the voice's name, and the character's face when it is their own voice. Hover it to read how the line was spoken: the voice, the model and the mood.
- The **mood** as a small chip, when the line had one.

While a line plays (and only then), the words being spoken show as a caption under the row. The line's player is hidden: the heading icon plays and stops it, and the ⋮ menu holds the full player.

While a line's audio is being made, whether it came with a reply or you pressed **Read aloud** or **Say it as…** yourself, the **Turn line** says so beside who is typing, for example *Mira is speaking…* (or *Ann is typing… · Mira is speaking…*), and the line's heading icon is its **Stop**. Stopping ends only that line's audio. A line whose audio was cleared reads *Not spoken yet*, and its heading icon reads **Read aloud** again.

A line with spoken audio has **one speech icon** in its heading, first among the quick icons. On a desktop it shows when you hover or focus the line; on a touch screen it is always there:

- **Play the spoken line** (a speaker): press it to play the line, press it again to stop (_Stop_ pauses and goes back to the start). While the line plays the icon pulses softly.
- While the line's audio is being made the icon works instead (a slow ember pulse; still when your system asks for less motion), its tooltip reads **Speaking…**, and it is **Stop speaking this line**: pressing it ends only that line's audio.
- A line with no audio, or whose audio was cleared, shows **Read aloud** (a speaker) in the same place. A pub that has no voice yet greys it out, and its tooltip says why, for example _no voice is set up on this pub yet_. **Read replies aloud** being Off never greys it out. Choosing _No player_ under **Settings › Spoken lines** also shows **Read aloud** (**Say it again** once the line has audio), and no player is drawn for the line.

The line's **⋮** menu lists the speech verbs itself:

- **Read aloud** (**Say it again** once it has audio, for after you edit a line or change a voice).
- **Say it as…** opens a small dialog. Pick a mood from the chips (the common ones first; **More** shows the rest, **Fewer** hides them again), or type your own (_tired_, _angry_). A line under the chips shows the first words with the mood, makes the audio once that way, and changes nothing for later. The last mood you chose is remembered for that session in this browser.
- **Stop speaking this line** while the line is being spoken.
- **Speech**, once the line has audio, opens a small popout beside the menu with the browser's **full player** for the line (play, scrub, volume). Closing the menu does not stop it.

Every message [style](#style) hides the spoken line's own player, its play-state glyph and clock, its ⋯ menu and its **Speaking…** row (a screen reader still hears *Speaking…*); a style of your own can show any of them again.

**One sound at a time.** Starting a line stops the one that was playing (stop means pause and go back to the start), wherever it was started: the heading icon, the ⋮ › Speech player, or **Make and play** when a new line arrives. A voice's **Try this voice** clip pauses a playing line, and a line pauses a playing clip.

Under **Make and play**, the newest line plays by itself as its audio arrives, never older lines, and never when you open the session. When the browser refuses a sound nobody asked for, press the line's speech icon.

### A second Messages widget for one channel

Some sessions have more than one channel. The [Lair](./genre-lair.md) has the story and the **Sanctum**, your talk with the Castellan. A layout can give a channel a widget of its own: a second **Messages** widget with its **Channel** setting on that channel. The Lair's own layout doesn't: it shows the Sanctum as a tab of the story (see [Channel tabs](#channel-tabs)).

To make one, add **Messages** from the tray and set its **Channel** (a new copy starts at *Default (main)*; choose **Another channel** and type its slug), or **Duplicate** one that already has a channel.

- **A copy with a channel** shows only that channel, titled with its name (*Sanctum*). What you write in it goes there, and its turn controls are that channel's own. A copy showing a manuscript-style channel reads as [Folio](#what-the-messages-widget-offers) while its **Presentation** is *Follow the channel*.
- **A copy with no channel** shows every channel no other copy has taken. With just one Messages widget, that's the whole session, with a tab for each channel above the log.
- If every copy has a channel, the first one also shows the channels nobody took, so the story never disappears.

### Channel tabs

🚧 A Messages widget that shows two or more channels draws a **tab** for each one across its top, named by the genre: the Lair's **Story** and **Sanctum**. The log shows the tab you picked, and what you write goes there; the turn controls are that channel's. The arrow keys move between the tabs. When somebody else's line lands on a tab you aren't looking at, such as the Castellan answering in the Sanctum while you read the story, that tab shows a small dot until you open it.

- **Composer on the other tabs** (a [Composer](#the-composer-and-the-turn-line) setting, *Same as the first tab* by default) draws the field differently while a Messages tab other than the first is shown. The Lair's layout sets it to *Single-line pill* for the Sanctum.
- A channel only you may read, such as the Sanctum, is never a tab for anyone else: a guest's story shows no tabs.
- To give a channel its own widget instead, add a second **Messages** and set its **Channel** (above): the channel leaves the first widget's tabs.
- Each copy has its own settings and style.

### Dice inline, or as a log

🚧 Some genres keep their rolls and outcomes on a channel of their own, **Dice** (the slug is `table`): every roll, every check and the clock's reckoning, each tied to the line it belongs to. Those lines never enter the story the AI reads. The [Dungeon Crawler](./genre-dungeon-crawler.md) is the first.

- **Inline**: set a Messages copy's **Show another channel inline** to **A channel** and type `table`, and each of its lines is drawn straight under the line it belongs to, small and with no picture or name. The copy's tabs never offer *Dice* as somewhere to write. The Dungeon Crawler's Story is set up this way.
- **As a log**: a Messages copy with its **Channel** set to **Another channel** and `table` shows its lines on their own, oldest first.

Both read the same lines. Deleting or regenerating a line takes its lines on **Dice** with it.

## Layouts

A **layout** here is a saved arrangement you can copy into a session. The **Layouts** tab shows them as cards in two sections:

- **Ready-made**: the genre default layout first, then the layouts that come with Serene Pub, with this pub, or with a plugin.
- **Yours and shared**: your own layouts, then the ones other people on this pub shared.

Each card has a line saying where it came from: *Genre default*, *Serene Pub*, *This pub*, the plugin's name, *You* (*You · in use here* when this session started from it), or *Shared by* and a name. A section with more than eight cards adds **All**, **Mine** and **Shared** buttons above them to narrow the list.

The **genre default layout** is what this kind of session (its [genre](./genres.md)) starts with. Each genre ships its own, and every one ends its middle the same way: the **Messages**, then the **Turn line**, then the **Composer**, as three panels.

- **Story**'s puts, on the left, **Stats** (*Cast*) and the **Author's note** (*Scenario*) as two tabs of one panel, over a **Scene Portraits** panel for the last character who spoke. In the middle it has **Messages** (*Story*) with **Stats** (*Characters*, one character's sheet) as its second tab, then the Turn line and the Composer. On the right it has **Stats** (*World*) and **Lore entries** (*Lore*) as tabs, over **Scene Portraits** for the last persona who spoke. Story also ships a **World** layout: the **Chronicle** and **Lore entries** down the left, the world's **Stats** as a strip above the conversation, and **Scene Portraits** over **Stats** down the right. Its third, **Visual novel**, fills the screen with the scene (the session's backdrop, with the last two speakers standing on it) and puts the story in a [Dialogue box](#the-dialogue-box) at the foot, with the **Log** and the **Characters** as tabs beside it, then the Turn line and the Composer; it has nothing at the sides.
- **Guide**'s is the conversation on its own: Messages, Turn line and Composer.
- **Lair**'s puts the party's **Stats** (*Party*) on the left over the last character who spoke; the story in the middle with the **Sanctum** as a [tab](#channel-tabs) beside it (the Composer draws as a single-line pill there); and, down the right, **Places** as a list of the dungeon's rooms with the Castellan's scratchpad (an **Annex**) as its second tab, over the last persona who spoke. A genre can also ship a layout for its guests: a guest's first visit to a Lair copies the **Party** layout instead, with **Stats** and the last character on the left, the same middle (no Sanctum), and on the right **Places**, a **Party** panel (the **Turn order** and **Who's here** widgets as its two tabs) and the last persona.
- **Dungeon Crawler**'s opens on the **Planner** as the first of four tabs in the middle (then **Story**, **Planning notes** and **Characters**), so a phone starts on the Planner's questions too, with the Turn line and the Composer under them. The party's **Stats** (with **Turn order**) are on the left, and the goal, the **Journal** and **Table talk** are tabs on the right; the last character and the last persona sit at the foot of each side.
- **Chat** ships no layout of its own, so a Chat session starts from scratch: only what a session needs.

A layout you chose as your own new-session layout still wins. Every other widget waits in the tray.

A line at the top says where this session's layout came from, such as *Started from the genre default layout* or *Started from your layout "Harbour watch"*.

### Copy a layout in

Click a card to copy it into this session. It asks first, then replaces this session's layout straight away; the editor's **Cancel** doesn't undo it. To keep what you have, save it first (below).

After that, the layout is the session's own copy. Changing the layout later doesn't change this session, and changing this session doesn't change the layout.

- **Reset to genre default layout** copies the genre default layout back in and clears your settings and style for the widgets it places, so they look as the genre ships them; widgets it doesn't place keep yours.
- **Start again from "*name*"** copies back the layout this session started from.
- **Start from scratch** leaves only what a session needs (the conversation and the genre's own widgets) with every widget's settings and style back at their defaults.

If the layout a session started from has changed since (a plugin or an update of Serene Pub changed it, or you saved changes into it elsewhere), its card shows **Updated** and the tab a dot. Nothing changes until you choose **Start again from "*name*"** (or **Reset to genre default layout**). For example, when an update gives a genre's default layout a new widget, sessions that started from it keep their layout and show **Updated**. Reset to pick up the new widget, or add it from the tray. A Lair opened before its Sanctum became a tab of the story keeps its Sanctum panel until you reset.

A layout can bring its own widget settings and styles: Story's asks its two Scene Portraits to show whoever spoke last, one the last character and one the last persona. It also carries the layout's own look (see [Layout settings](#layout-settings)). Copying one in replaces your settings only where the layout brings its own.

### Save your own

1. Arrange the session the way you want.
2. On **Layouts**, press **Save as new layout**, give it a name and, if you like, a short description.

It's saved with the arrangement and every setting and style you changed, and it appears in every session of this genre under **Yours and shared**. **Done** on its own only ever saves this session.

When this session started from one of your layouts, **Save changes to "*name*"** writes this session's layout back into it. Other sessions that started from it keep theirs and show it as **Updated**.

### The card menu

Every card has a **⋯** menu:

- **Use for new *genre* sessions**: every session of this genre you open for the first time starts from this layout. Its card wears a star. **Stop using for new sessions** goes back to the genre default layout.
- **Make a copy**: a new layout of yours, named "*name* (copy)", that you can change freely.
- **Share with everyone on this pub** (your own layouts): it appears under **Yours and shared** for everyone else, marked *Shared by* and your name. **Stop sharing** takes it back. Neither changes anyone's session.
- **Rename** and **Delete**. Deleting a layout changes no session's layout. If people use it for their new sessions, it says how many; they get the genre default layout instead.

Built-in layouts offer only the first two. An administrator can also stop sharing, rename or delete a layout someone else has shared.

### New sessions

The first time you open a session, a layout is copied in: the one you chose with **Use for new *genre* sessions**, or else the genre default layout. Your choice is yours alone; other people in the same session start from their own.

## Settings

A widget's settings are in the layout editor, and nowhere else. In the session there is no gear and no pin on a panel: it shows its tabs and nothing to configure.

To change a widget's settings:

1. Press **Layout** in the header and open the **Arrange** tab.
2. Choose the widget's tab on its card, or press the card's gear (*‹Widget› settings*). On the **Layouts** tab, point at a widget and press **Settings**: it switches to **Arrange** with that widget chosen. Choosing a tab only picks it for settings; the session keeps showing the tab it showed.

The **inspector**, the pane beside the canvas, shows it. Its header is the widget's name with its kind and place under it (*Stats · Right, 2nd panel*), then the widget's settings, then its **Style** section. Press empty canvas to choose nothing.

Widget settings apply as you change them, so there's nothing to save, and **Cancel** doesn't take them back. **Reset** beside **Settings** puts that widget's settings back to their defaults and keeps its style; **Reset** beside **Style** goes back to the widget's default style and keeps its settings.

Every widget's own common settings are two:

- **Title**: what it's called on screen. Clear it to go back to the widget's own name.
- **Lane**, on a widget that follows a channel (a phone, a side conversation): a channel can carry several conversations, numbered from 1, and the lane is which one this widget shows.

Below those come the widget's own settings, such as the Messages settings [above](#what-the-messages-widget-offers). A widget can sort them under headings, such as **Channel** and **Reading** on Messages. Nothing is folded away. A widget has no card setting: what it sits on is the layout's.

### Layout settings

With nothing chosen, the inspector is **Layout settings**: how the whole layout looks.

- **Backing**: *Card*, *Glass* or *None*. What every panel sits on. How a card and glass look comes from your theme, so a custom theme can restyle both.
- **Opacity**: 0 to 100%. Lower lets your background show through.
- **Behind the panels**: *Your background* (the default) or *The session's backdrop*. What shows through behind the panels. The backdrop's picture fills the screen behind every zone and is drawn only when the session has one; each panel keeps its own **Backing** over it.
- **Dim**: 0 to 100%, shown only for the backdrop. Darkens the picture so the panels over it are easier to read.
- **Widget gap**: *Tight*, *Comfortable* or *Spacious* (4, 12 and 24px). The space between panels and around the zones.
- **For style authors**: the four names a widget's style can set for its own panel (see [Style](#style)).

A new layout is *Card*, 100%, *Your background*, *Comfortable*. The backing is drawn on the panel, with the tab strip on the card, so one panel with three tabs is one card. These edits go through **Undo** and **Cancel** as an arrangement does. On a phone they are under **Layout settings** at the foot of the editor.

A widget that opens over the session for a moment (a pop-over) is the one case that still has a card of its own, because it floats over the conversation and needs an edge.

### Where settings are kept

Each placed widget's settings and style are kept under its [id](#widget-ids), in three places:

| What | Where it's kept |
|---|---|
| Your settings | With your layout for this session, and only the ones you changed. |
| A layout's settings | In the layout. Copying the layout in copies them into your settings, replacing yours for each widget it brings settings for. |
| A widget's style | With your layout for this session, apart from its settings. |
| The layout's look | In the layout's panels: its backing, opacity and widget gap. It travels with the layout when you save it. |

**Reset to genre default layout** clears your settings and style for the widgets it places first, then copies the layout in.

A widget reads its settings in one order: its own defaults, then what a layout brought, then what you changed. Each wins over the one before it, so a change you make always shows. A style is never mixed into the settings.

### Style

A **style** is how a widget looks, never where it sits. The **Style** section of the inspector shows the current style, a picker, and **New**, **Edit**, **Clone** and **Delete**.

**Messages** comes with five styles: *Stage* (the default typeset column), *Bubbles*, *Novel*, *Compact* and *Dreamlit Cameo* (each line on a soft, borderless glass card, the speaker's portrait in the card's top corner beside the text, shown at its own shape, so a tall picture shows its full height, and fading into the glass toward the text and at its bottom). Pick one to switch. The Composer and the Turn line wear the style of the Messages they follow, unless you pick one for them.

To make your own, press **New** (or **Clone** an existing one, which makes a private copy you can edit). Give it a name, its CSS, any variables, and who may use it: **Just me** or **Everyone** on this pub. The editor applies what you type as you type, with a ring around the widget it's styling. **Save style** keeps it; **Cancel** or Escape puts the saved style back. Built-in styles can be cloned but not edited or deleted.

A few rules for the CSS you write:

- It only reaches this one widget. Every selector is scoped to the widget's own box, so it can't touch the rest of the page, another widget, or the controls for changing it.
- `@import` and images from other websites are refused. `@font-face`, `@property` and `@counter-style` are kept but not applied.
- Variables are CSS custom properties, written `--name`.
- The one thing a style may reach beyond its widget is its panel's own box. The panel carries `--sp-widget-margin` (0), `--sp-widget-background`, `--sp-widget-radius` and `--sp-widget-border`, set from the layout's backing and opacity. Declare any of the four, in your CSS or in your variables (a variable wins over the CSS, and the last declaration wins), and the panel takes your value while your widget's tab is the one showing. A value with `url(`, a backslash, `;`, `{`, `}` or `<`, or one the style filter would change, is ignored. *Dreamlit Cameo* uses this: its background is transparent and it has no border, because each line is already on its own glass card.
- For dark mode only, start the selector with `[data-mode="dark"]`, for example `[data-mode="dark"] .my-card { background: black }`.
- To reach one part of a widget, select its **part**: `[data-widget-part~="messages.message-avatar"] { border-radius: 4px }`. The parts each built-in widget has are listed in [Widgets](./sdk/guides/widgets.md#style-parts).

## Arrange

The **Arrange** tab shows the three zones and the tray of widgets. Each zone is a stack of panels. Each panel is a card with a strip of tabs at the top, one per widget it holds, and its tools underneath. The **inspector** is beside them (see [Settings](#settings)).

- **Add**: drag a widget from the tray onto a panel's tab strip to add it as a tab there, or into a gap between panels (or at either end of a zone) to give it a new panel of its own. On a touch screen, tap the widget in the tray, then tap **Add as a tab** on a panel or **New panel here** in a gap. Adding one that's already placed adds another copy (see [More than one of a widget](#more-than-one-of-a-widget)).
- **Move**: drag a tab onto another panel's tab strip to move it there, or into a gap to give it a panel of its own. Drag a panel by its handle to move the whole panel, into any zone.
- **Remove**: drag a tab back to the tray, or press the **×** on the tab. You can remove any widget, the conversation included. **Reset to genre default layout** on the **Layouts** tab brings the genre's layout back.
- **Duplicate** adds a copy with the same settings and style, as the next tab in the same panel.
- **Split out** (on a panel with two or more tabs) moves the chosen tab into a new panel just below.
- **Fit** and **Fill** set a panel's height. **Fit** is as tall as its content; **Fill** shares the room that's left with the other filling panels. Between two adjacent panels that are both not Fit there's a divider: drag it, or focus it and use the up and down arrow keys, to share the height between them in twelfths.
- **Priority**: *High*, *Normal* or *Low*. It shows the panel's current value: the widget's own unless you set one (the Composer is *High*, the Turn line *Normal*, Messages *Low*, the rest *Normal*). When a zone runs out of height, *Low* gives way first, then *Normal*; *High* keeps its height longest.
- **Name**: a panel with two or more tabs has a box for its name. Leave it empty and it's named after its tabs.
- **Undo** takes back the last change. It goes back one step only.

Under the Middle's panels the editor repeats it: *When a zone runs out of height, Low gives way first, then Normal. High keeps its height longest.*

Choosing a tab on a card opens its settings in the inspector. It doesn't change which tab the session shows.

**Done** saves only if you changed something. Open the editor and press **Done** without changing anything, and the layout stays exactly as it was.

### Panels

In the session, a panel with two or more tabs draws a strip of tabs across its top: click one to show it. Each tab keeps its state when you switch, and the tab you leave showing is saved with your layout. A panel with one widget draws no strip, just the widget. Every panel is open all the time: nothing is tucked away behind an icon.

A widget you haven't shown yet doesn't load until you first do (a tab you haven't opened, or a zone you haven't switched to), so a layout with many widgets costs nothing for the ones you never look at.

**The middle is never left empty.** Put something there before you move its last panel out; otherwise the editor says *Put something in the middle first.*

**Messages** can go in any zone, or nowhere. A phone, and full screen, open on the zone that holds the layout's first Messages, else the Middle (see [Phones and narrow windows](#phones-and-narrow-windows)).

### More than one of a widget

Any widget can be placed more than once: two **Stats** showing different people (or one for the world and one for the cast), a second view of the story.

- **Add** it again from the tray (it starts at its defaults) or **Duplicate** it (it copies the settings and style, **Channel** included).
- A copy is named with a number, *Stats · 2*, until you give it a **Title**. A Messages copy with a channel takes the channel's name.
- Removing a copy removes only that copy.
- A plugin's widget can limit how many times it's placed. At the limit its tray card is greyed out and says *Only one per layout*.

### Previewing other screen sizes

**Screen** shows the layout at other widths without resizing your window: **Compact** (390px, a phone), **Cozy** (640px), **Roomy** (1024px), **Wide** (1440px) and **Ultrawide** (2560px). **Actual** goes back to your window. At **Compact** and **Cozy** you see the phone editor (below).

There is one arrangement for all sizes. If you edit while previewing, the edit is kept, and the editor says so.

## How the layout fits the window

The same layout adapts to the space it has. Resizing never changes what you saved: widen the window again and everything comes back.

- **Panels stack.** Each zone is its panels from top to bottom, at every width. Panels are never side by side.
- **Heights.** A **Fit** panel is as tall as its content, a panel with a share from the divider takes its twelfths of the zone, and the **Fill** panels share what's left equally. When a zone is too short for all of that, each panel's **Priority** decides who gives way: the panels with a height of their own are given it *High* first, then *Normal*, then *Low*, and a panel that is given less than it wants scrolls inside itself. Messages never goes below 160px, and a Fit panel never below its content or 120px, whichever is less. If even those don't fit, the zone scrolls.
- **Widgets fill their space.** Each widget takes the full width of its panel. The Messages widget's text runs the whole width by default; set its **Line width** to *Column* or *Comfortable* for a reading column.
- **A side is one column wide**: 248px, growing in steps on a very wide window (264, 300 and 344px). The Middle takes all the room the window adds, and where the window is narrow the Middle keeps a minimum and the sides shrink together to give it.
- **An empty side keeps its column** while there is room, so adding a widget later doesn't shift the conversation. It's the first thing to go when room is short.
- **The conversation stays centred.** At *Column* or *Comfortable* line width, the text column is centred on the session even when one side is wider than the other.
- **The zone switch.** When the session gets too narrow for its sides and a readable middle (most often because a sidebar view is open beside it), a **Left · Middle · Right** switch turns on in the header and shows one zone at a time. Only zones that hold a panel are offered, and the switch draws only when there are two or more. Widen the session again and all three zones are back exactly as before.

### Phones and narrow windows

Below 1024px the sides take no room beside the Middle, and the zone switch is always on. On a phone it has a row of its own under the header: **Left**, **Middle** and **Right**, one zone at a time. (Its name for a screen reader is *Zone shown*.) Tap a zone to see it; every zone stays loaded, so nothing restarts.

The session opens on the zone that holds the layout's first Messages, else on the Middle. If you moved the conversation into a side, a phone opens on that side.

### Full screen, Dock, Half and Focus

**Full screen** (**Ctrl Shift F**, or **⌘ Shift F** on a Mac, or the header's **Full screen** button) shows the whole zone the session opens on, the one that holds the conversation: its Messages, Turn line, Composer and anything else stacked there, with no zone switch. The bars, the rail and the sidebar step aside too; press it again, or Esc, to bring everything back exactly as it was. It works at every width, is remembered for each session, and doesn't apply while the editor is open. A genre with its own session view may open a session in full screen the first time, with a one-line notice (Press Esc… on a keyboard, Tap the corner… on a touch screen), and after that it remembers your choice. Opening a sidebar view beside the session at **Dock**, **Half** or **Focus** width changes how much room the session has, which can turn the zone switch on. Both are explained in [Getting around](./getting-around.md#widths-dock-half-and-focus).

## Editing on a phone

On a narrow screen the editor is one list in three sections, **Left**, **Middle** and **Right**: one row per panel, in the order they're drawn, with the panel's tabs listed inside it.

- **Reorder panels** with a row's up and down arrows, or press and hold its handle and slide. A row never crosses into another zone.
- **Fit** / **Fill** and **Priority** (*High*, *Normal*, *Low*) are on every row.
- **Each tab** in a row has its own buttons: move it earlier or later among the panel's tabs, **Move into panel above** or **Move into panel below**, **Split out** into a panel of its own, the gear for its settings, the copy button to duplicate it, and **×** to remove it (any tab, the conversation included). The gear opens a settings screen over the list with a **Back** button (Escape goes back too).
- **Add** at a section's head adds a widget there, as a new panel at the end of that zone; the plus on a row adds a tab to that panel.
- The bar at the bottom holds **Layouts** (the same cards and menu as the desktop), **Layout settings** (the layout's [look](#layout-settings)), a reset to the genre default layout, **Cancel** and **Done**. **Done** saves only if you changed something.

It's the same layout, so what you do here is what a desktop opens. To try it from a desktop, pick **Compact** or **Cozy** under **Screen**.

## For power users

### Where layouts are stored

Each person's layout for a session is stored with that session: the arrangement, each widget's settings and each widget's style. Guests have their own. The session also remembers which layout it was last copied from and when, only to label it, offer **Start again from**, and spot an **Updated** layout. It's never used to draw anything.

The arrangement is stored as **panels** (version 2): for each zone, its panels in order, and for each panel its tabs, the tab left showing, its height, its priority and its name; plus the layout's backing, opacity and widget gap. Layouts saved before (panels version 1, or the older slots) are converted once, when the server starts. The pin is dropped, so every panel opens. The middle's above, main and below panels become one stack in that order. Each Messages panel that drew a composer gets a Turn line panel and a Composer panel right after it (before it when its composer was at the top; no Turn line when **Who is due next** was *Nothing*; no Composer when **Show composer** was off), with those settings moved onto the new widgets and any style you pinned copied. Your own and shared layouts convert the same way, the built-in ones are written again from the catalogue, and a plugin's layout is converted when it's drawn or copied.

Only settings you change are stored. A widget whose default changes in a later version follows the new default unless you set it yourself, and a setting a widget stops offering is dropped the next time the server starts.

Your layouts belong to you and are offered in every session of their genre. A shared one is readable by everyone on the pub and still only yours (or an administrator's) to change. Your **new-session layout** is one choice per genre, stored with your account.

### Widget ids

A layout names each placed widget by its id, with `#` and a name for extra copies: `stats#2`, `messages#sanctum`. Settings and styles are stored under that id, so they travel with the layout when you save it or start a session from it. A plugin's widgets are named with the plugin's own prefix, so two plugins that both ship a **Map** never collide. A Messages copy's Composer and Turn line take its name: `messages` gets `composer` and `turn-line`, and `messages#sanctum` gets `composer#sanctum` and `turn-line#sanctum`.

### Plugin layouts and widgets

A plugin can ship layouts for any genre, and a plugin genre ships its own genre default layout (Battleship's board, for example). A plugin layout written in the older panels format, or the column-and-grid format before it, is still read and drawn as panels. One in the format before that is skipped, with the reason in the server log, until the plugin is rebuilt.

A plugin's widget can come with styles of its own. They appear in the **Style** picker beside the built-in ones (and can be cloned, not edited), stay while the plugin is installed, even switched off, and are removed when it's uninstalled. A style you made for a plugin's widget is yours and stays.

Writing a widget, what it receives, and how it runs the session's actions are covered in the plugin guide: [Widgets](./sdk/guides/widgets.md) and [Frames](./sdk/guides/frames.md).

## Related

- [Sessions](./sessions.md): the session screen, the composer and its actions.
- [Getting around](./getting-around.md): the rail, sidebar views, Dock, Half and Focus.
- [Stats and states](./stats-and-states.md): what Stats shows.
- [Themes and settings](./themes-and-settings.md): themes and background images.
- [Component authoring](./component-authoring.md): write or clone a widget.
