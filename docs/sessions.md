# Sessions

A session is one story or conversation: your characters, the persona you play, and every message between you.

:::tip What it's for
- Talking with a character, or playing out a scene with a whole cast.
- Keeping each story separate, with its own setting, lorebook and history.
- Going back: rewriting a reply, trying another version, or branching the story from any message.
:::

## The basics

### Start a session

1. Open **Sessions** on the rail and press **New** (or **New session** on the home screen). The **Start a session** screen opens.
2. **Genre** and **Preset** are usually picked for you. The genre is the kind of session: **Chat** is the everyday one. See [Genres](./genres.md).
3. Under **Who is in it**, pick the characters to talk to, and under **Who you play as**, the persona you'll write as. Your default persona is already picked. Both lists look the same and filter by name or tag. Nobody can be on both sides: the character you play as isn't offered for the cast, and a character in the cast isn't offered to play as.
4. If the genre needs a **Lorebook** (Adventure and the Lair do), pick one.
5. Optionally give the session a **Name** at the top. Left empty, it's named after its cast, such as *Session with Wren*.
6. Press **Start**.

:::tip You should see
The session opens. In a Chat session, each character's greeting from their card is already there, and the composer at the bottom reads *Write as* followed by your persona's name.
:::

:::warning If this didn't work
- **Start stays grey**: a required answer is missing. A card marked with `*` (such as **Lorebook\***) needs a choice. If the genre needs a lorebook and you have none, the card says so: create one in [Lorebooks](./lorebooks.md) first.
- **"No preset is available for this genre"**: an administrator hasn't enabled a preset for it. Pick another genre, or ask them.
:::

A **persona** is a character you play: see [Personas](./personas.md). You can play any of your characters, and one you pick becomes one of your personas.

### Send a message

Write in the composer and press **Enter**, or **Send**. Use **Shift+Enter** for a new line. On a phone, or when the conversation is narrow, Enter always adds a new line and you send with **Send**. While a reply is being written, **Send** becomes **Stop**.

:::tip You should see
The character's name shows a small dot and a status, *Wren is thinking*, then *Wren is typing*, while the reply streams in below. A model that reasons first shows *Wren is reasoning* until its reply starts.
:::

Your draft is saved as you type, so it's still there if you reload the page or come back later.

### Attach images and files

Press **Attach** (the paperclip) in the composer's footer to pick files, drag files onto the composer, or paste a screenshot into it. Each file starts uploading at once and shows as a tile under where you write, with a bar while it uploads. Press a tile's **✕** to take it off. Then write your message (or don't: files alone can be sent) and press **Send**. If a file is still uploading, Send says *Uploading 1 of 2… Sends when done.* and sends by itself when it finishes.

What you can attach depends on the models that would read your message. To see what, open **More** (⋮) in the composer's footer and choose **What can be attached**: it says, for example, **This reply can read: images · text files**, lists every kind with the reason a kind can't be attached, and closes with **Esc**. Hovering **Attach** says the same in short. When more than one model call reads the conversation, it lists each call and what it reads: the reply's (Adventure's Narrator, for example), then the session's actions that write with a model, by name (**Look**, **Ask**, **Build room**…), and **Form answers** (a character answering a question put to them). A kind can be attached when at least one of them reads it. A call that can't read a kind sees the file's name in its place, such as `[image: cat.png]`. Administrators also see which model each call runs on.

| Kind | Formats | Largest file |
|---|---|---|
| Images | PNG, JPEG, WebP, GIF | 20 MB |
| Text files | .txt, .md | 1 MB |
| PDFs | .pdf | 32 MB |

A message can carry up to 10 files. A file that can't be attached (an SVG, a kind nothing in this reply reads, one too big) is never uploaded: a tile says why, and clears itself after a few seconds. Location and camera details are removed from photos when they upload.

Files you haven't sent yet are still there when you reload the page. Unsent files are removed after 24 hours.

Sent files show under the message (see [Images and files on a message](#images-and-files-on-a-message)). To take one off a message you wrote, press **Edit** on the message and then the file's **✕**. To add a file, send a new message.

#### What the model sees

Each file goes to the model with the message it belongs to, not only with the newest one. So in a group session, an image Mara shared three messages ago still sits on Mara's line.

- **Images and PDFs** the model can read are sent to it as files, on their own message's turn. Only the last 10 messages send their images this way. Older ones are sent as their names, such as `[image: cat.png]`, so a long session doesn't resend every picture on every reply.
- **Text files** are put into the prompt as text, under the file's name, for every model. A long file is cut to about 4,000 tokens, and the prompt says it was cut.
- **Anything a model can't read** is sent as its name, with the description you gave it, such as `[image: cat.png — a grey cat]`. A model that can't see images still knows one was shared.

An image on a character's line, such as a generated picture, is sent with the next message from you, because models accept images only on your turns.

The same goes for every action that writes with a model and reads the conversation: Adventure's **Look**, **Ask**, **Rest** and **Time passes**, the Lair's **Build room**, **Trigger trap**, **Reveal** and the rooms the Castellan drafts, the tool loop, and a character answering a form. Each judges by its own model, so a Look on a model that sees images gets the picture even when the reply's model gets its name.

A **summary** reads your files as names: each file is written after its message's text, as `[image: cat.png — a grey cat]` or `[file: notes.txt]`, so a message that is only a picture is summarized as that picture, not skipped. See [Summarization](./summarization.md).

Both numbers are settings of each pipeline that places files: **Media lookback** (how many recent messages send their images) and **Text file budget**, on its **Place attachments** step. A context template written without `{{{attachments}}}` in its message loop sends no files, and the prompt details say so.

### Try another reply

Not happy with a reply? Hover it (or tap it on a touch screen) and press **Regenerate** to have it written again, or use the arrows beside its time to **swipe**: the right arrow on the newest version writes a new one, and the left arrow steps back through earlier versions. See [The message menu](#the-message-menu).

## The session screen

The bar across the top shows the session's name, the faces of its cast (a dot marks whoever is up next), and its genre.

Want the room? The small double arrow at the bar's top right (**Hide the session header**) rolls the bar up, along with any strip your layout has across the top. A small tab at the middle of the top edge (**Show the session header**) brings it back; while the bar is hidden, the Jump search pill steps out too (Ctrl K still opens Jump). This browser remembers your choice.

Below it is the conversation, and at the foot, the **composer** where you write. Its footer holds, left to right:

- **Your persona**: the face and name you're writing as. When more than one of your personas is in the session, click it to switch (see below).
- **Attach** (the paperclip): adds images and files to your message (see [Attach images and files](#attach-images-and-files)).
- **Preview** (the eye): shows your draft formatted as it will appear. Press it again to go back to writing.
- **More** (⋮): the composer's panels: **Lore**, **Pinned images** and **Statistics** (see [The composer's panels](#the-composers-panels)), and **What can be attached** (see [Attach images and files](#attach-images-and-files)).
- **Send**, or **Stop** while a reply is being written.

The first time you focus the composer on a computer, a hint under it says *Enter sends. Shift Enter for a new line.* once.

Clicking a message's picture opens a gallery of that character's or persona's images. Clicking their name opens them in the [Characters](./characters.md) view, so you can check or edit them without losing your place.

You can move the conversation and add other widgets around it: see [Session layout](./session-layout.md).

### Images and files on a message

Images and files on a message (a generated image, or a file sent with it) show as a row of square tiles below the message, outside its card or bubble. Every image is a square thumbnail, even when there is only one, and past six the rest fold into a count such as **+3**. A file is a tile of the same size with its name and size: click it to download it. If a file was deleted from **Settings → Media**, its place says *File no longer available*.

Click an image to open it full size. With more than one, use the arrow keys, the arrows at its sides, or swipe on a phone to go through the message's images; the counter says which one you are on. **Download** saves the file, **Info** shows what is known about it — for a generated image its prompt, seed and model, for any file its name, type and size — and **Esc** closes it.

### Switch which persona you write as

If more than one of your personas is in the session, the persona in the composer's footer has a chevron. Click it (**Switch persona**) and pick who to write as next.

A guest who has no persona in the session yet sees *Add a persona to this session to send messages.* with an **Add your persona** button instead.

## Actions

Above the composer is the word **Actions**. Click it to open one row of buttons for this session, all alike:

- first, the **turn controls**: **Continue**, **Pick who speaks** and **Regenerate** (see [Group sessions](./group-sessions.md#continue-and-pick-who-speaks));
- then what the genre offers: in Chat, **Narrate**, **Side character** and **Image**; in Adventure, **Look**, **Rest**, **Time passes** and **Ask**;
- then **More**, which lists every action, including ones without a button of their own.

Hover any button to see what it does. **What do these do?** (the **?** at the end of the row) lists every action the session offers you right now, with a sentence each. A greyed button says why in its tooltip, such as *wait for the reply to finish*.

An action that needs words from you opens a small window asking for them.

### Slash commands

Type `/` at the start of an empty draft to open a list of every action, by its slash name. Keep typing to filter it (`/nar` narrows to Narrate and Side character), use **↑** and **↓** to move, **Enter** to run, **Tab** to complete the name, and **Escape** to close the list. A name typed in full, such as `/narrate`, runs when you press Enter. Running a command never sends your draft as a message.

**Add text after the name** for an action that asks for it: `/narrate the storm breaks` runs Narrate with *the storm breaks* as its direction. The list shows what each command takes, such as `/nudge <direction the party should feel>`, with square brackets when the text is optional. A line under the composer says what Enter will do.

- `/nudge` alone opens the action's window, as its button does.
- An action that also asks *who*, such as the Lair's `/whisper hold the line`, opens its window with your text filled in.
- An action that takes no text refuses extra words: *`/advance` takes no text*. Nothing runs, and your draft stays.
- A command that runs clears the composer straight away. If the run is refused or fails, your text comes back (unless you've started typing something else), so you can try again.
- On a phone, press **Send** to run a command.

Serene Pub's own commands have short names (`/narrate`, `/advance`, `/retry`); a plugin's start with the plugin's name (`/acme.roll`), and the list completes them for you.

## The message menu

Each message has a **⋮** menu on the right of its name row. Hovering (or tapping) a message also shows two quick buttons, **Regenerate** and **Edit**, and a **Stop** button while it's being written.

| Action | What it does | Where it works |
| --- | --- | --- |
| **Stop generating** | Stops the reply being written, keeping what arrived. | The message being written |
| **Regenerate** | Writes the reply again, in place. | The newest reply |
| **Extend** | Carries on writing the reply from where it stopped. | The newest reply |
| **Swipe** (the ‹ n / m › arrows) | Steps between versions of the reply, or writes a new one. | The newest reply, and greetings |
| **Edit** | Rewrite the message in place, then **Save** or **Cancel**. | Any message, while nothing is being written |
| **Hide** / **Unhide** | A hidden message stays on screen, dimmed, but the model doesn't see it. | Any message |
| **Delete** | Removes the message, after you confirm. | Any message |
| **Branch from here** | Starts a copy of the session ending at this message. | Any message (owner only) |
| **Select for summary** | Starts choosing messages to summarize into the lorebook. | When the session reads a lorebook |
| **Change sprite** | Picks the face shown with this line. | Characters with [sprites](#sprites) |
| **Inspect run** | Shows every step of the run that wrote this reply. | Administrators |
| **Prompt details** | Shows the prompt this reply was written from. | With context debugging on |

Genres and plugins can add their own entries, such as the Lair's **File as a room**. Who may use each action on whose message is set out in [Who may change a message](./session-actions.md#who-may-change-a-message): in short, your own persona's lines are yours, and a character's replies are the session owner's or the character's owner's.

Small marks in the name row tell you more: a handshake for a **greeting**, a ghost for a **hidden** message, a film mark for a message **in a scene**, and **Stopped** for a reply you stopped. The time shown is when the message was last written or changed.

### Regenerate, Extend and Swipe

These work only on the **newest** reply, never on your own lines (edit those instead).

- **Regenerate** replaces the reply with a fresh one.
- **Extend** keeps the reply and writes more onto the end: useful when it was cut off.
- **Swipe** keeps every version. The arrows show *2 / 3* and so on; on the newest version, the right arrow writes a new one.

A **greeting** is a character's opening line from their card, marked with a handshake. Swiping a greeting steps through the greetings written on the card; it never writes a new one.

### Branch from here

**Branch from here** asks for a title, then makes a new session holding every message up to and including this one, and takes you there. The original is left as it was. Leave the title empty to keep the original's name. Only the session's owner can branch. What a branch copies is listed in [Session actions](./session-actions.md#what-a-branch-copies).

### Select messages for a summary

**Select for summary** turns the conversation into a checklist. Tick messages (or use **Select all above** / **Select all below** on a message), then choose where the summary goes: **Scene**, **World lore** or **Character lore**. Messages already in a scene can't be picked again. See [Summarization](./summarization.md).

### When a reply goes wrong

- **It's slow to start**: the status reads *waiting for the model* (another reply is ahead of it) or *loading the model* (the model is starting up).
- **It fails**: the message says what went wrong, in its own words, with a **Retry** button.
- **The server restarted mid-reply**: the reply keeps the text that had arrived and says *The server restarted before this reply finished.* Regenerate, Extend and Swipe work again straight away.

Some models show their reasoning: it appears folded under **Reasoning** above the reply, filling in while the model reasons, and the reply starts below it once the model starts answering. The status says *Wren is reasoning* during that part. Reasoning is never sent back to the model. If a reply opens with the character's own name, like `Wren:` or `**Wren:**`, the label is taken off.

## Find your sessions

The **Sessions** view lists every session you own or were invited to, grouped under **Your turn** (the last message wasn't yours), **Recent** (the last seven days) and **Older**. The session you have open sits at the top.

Each row shows up to three faces from the cast, the session's name, when it last moved, and its last line. A dot means it's your turn. While a reply is being written, the last line shows its status instead (*Jasmine is typing*). A genre label appears when your install has more than one genre, and **Shared with you** marks a session someone invited you to.

Above the list:

- **New** starts a session.
- The filter box searches by session name, persona, character or tag. **Filter sessions** narrows to one genre or tag.
- **List view** and **Card view** switch between rows and cards. A card shows the lead character's picture, the cast's faces, the session's name and genre, whether it's your turn, and its last line. The view remembers your choice in this browser.
- **All**, **Your turn** and **Favorites** switch between all sessions, those waiting on you, and those you've starred.

Clicking a session opens its details, at any width: its cast, last line, scenario, lorebook and who it's shared with. **Open session** at the top takes you into it, and **Edit** beside it opens its settings. Picking a session in Jump (**Ctrl K**) goes straight into it.

Each row's menu offers **View**, **Edit**, **Star** / **Unstar** and **Delete**.

Opening the sessions list from a character's details shows only sessions with that character, with a chip you can dismiss to see all.

### Delete a session

Choose **Delete** in a session's menu and confirm. The session and all its messages are removed for good. Scenes it saved to a lorebook stay there, with their name, summary and cast.

## Session settings

Open a session's settings with **Edit** in the Sessions view: in a row's menu, or beside **Open session** in its details. The form has three tabs, and **Save** at the top. A dot on a tab means something there still needs an answer. Closing with unsaved changes asks before throwing them away.

### Participants

Everything on this tab waits for **Save**: adding, removing and reordering people, and the characters' and envoys' switches. Someone added but not saved yet shows **Ready to add**; closing without saving drops it all. The one exception is **Reassign…** under **Removed**, which happens at once.

- **Characters**: drag to change their order, use the switch to [bench](./group-sessions.md#bench-a-character) one, or remove one. Add more here too. The character picker leaves out your personas in this session, and the persona picker leaves out the cast.
- **Personas**: who people write as.
- **Envoys**: speakers the genre brings with it, such as the Lair's Castellan. See [Envoys](./genres.md#envoys).
- **Removed**: characters and personas you took out, with **Reassign…** to hand their messages to someone else.
- **Guests**: other people invited to the session (see [Guests](#guests)). Only the owner can add or remove them.

### Settings

The session's own fields (the story, genre settings, what your lines are called, tags) wait for **Save**. The controls marked **Applies at once** (stats, **Preset**, **Actions**, **Pipelines**, **Ask before regenerating a turn**) change the session as you set them, and the pipeline choices have their own **Apply** button.

From the top:

- **The story**: the **Scenario** and the **Lorebook**. The scenario is a few lines describing the setting or situation; the model reads it on every reply.
- **Line** and **Story clock**, once a lorebook is chosen (see [The session's lorebook](#the-sessions-lorebook)).
- The session's stats, when the genre has them. These save as you change them.
- **Preset** and **Actions**: which preset the session runs and which actions it offers.
- Choices for the session's pipelines, such as the Chat turn order's **Strategy** (see [Group sessions](./group-sessions.md#choose-how-the-turn-order-works)).
- **Genre settings**: whatever the genre offers, such as Chat's **Auto-advance** and **Author's note**, or Adventure's **Tone**. See [Genres](./genres.md).
- **Pipelines**: per-session settings for each model call (see [Pipeline settings in a session](#pipeline-settings-in-a-session)).
- **Tags**, which the Sessions view's search reads. See [Tags](./tags.md).
- **Session data** (below).

### Author's note

A Chat session has an **Author's note**: your own note to the model for this session, such as what is true right now or where you want the story to go. Edit it under **Genre settings**, or in the **Author's note** widget beside the conversation: Chat's default layout puts it in the right column as an icon (on a phone, under **Session panels**). A session whose layout you changed, or one opened before the widget was in the default, can add it from the tray (see [Session layout](./session-layout.md#the-widgets)).

- **Note**: the text. Leave it empty to send nothing. `{{char}}` and `{{user}}` work in it.
- **Messages from the end**: how far back it goes. **0** (the default) puts it at the end, right after the newest message and before the reply; **4** puts it four messages earlier. A session that already had a number saved keeps it, and so does a chat imported from SillyTavern.

  At the end, the rest of the prompt stays the same from one reply to the next, so a model server that reuses its previous work (KoboldCPP, for example) only has to read the newest lines again. A note placed further back moves with every new message, and everything after it is read again.
- **Every how many replies**: **1** adds it to every reply; **3** adds it to every third one, counting the AI's lines so far (greetings included).
- **Sent as** (under **Advanced** in the widget): **System**, **User** or **Assistant**.

It isn't the prompt's **Post-history instructions**. Those come with the pipeline and the character card, say how to reply, and wait until the conversation is long enough. The author's note is yours, and goes in from the first reply. When both land in the same place, the author's note comes first and the post-history instructions stay closest to the reply.

Only the session's owner can change it; guests can read it. Saving the session's settings only changes the genre settings you changed there, so a note you saved from the widget while the settings were open stays. If the note wasn't touched in the settings, they show the newer note, and the widget shows a note saved in the settings or in another tab straight away (if you were editing it there, your edit stays). To check whether a reply carried it, open the widget (its last line says what the newest reply did) or the run in the [run inspector](./pipelines.md).

Adventure, the Lair and the Guide don't have an author's note.

### Privacy

What this session shows of your own characters and data, and to whom. It's read-only.

### Session data

At the foot of the Settings tab, for the session's owner and administrators. It lists what pipelines keep for this session: for Serene Pub and each plugin, every value it stores, what it is, who can see and change it, and its current value. Press **Refresh** to read it again after a turn.

A text value you're allowed to change has an **Edit** button. That's how you correct something no widget shows, such as the Lair Castellan's scratchpad. A value marked secret is never shown.

## The session's lorebook

A session can read one [lorebook](./lorebooks.md): its world lore, character lore and history. Choose it under **The story** in the session's settings, or, for a session you own, use **Read into this session** in the lorebook's **Manage** menu in the Lorebooks view (**Stop reading** takes it out). A session reads one book at a time, so switching asks first. See [Reading a book into a session](./lorebooks.md#reading-a-book-into-a-session).

Once it reads a lorebook, the conversation shows the lorebook's history: a date marks where a history entry begins, and a scene begins with its name in the scene's colour. Click either to open it in the lorebook. **Show scenes and dates** in the Messages widget's settings hides them.

### Where the session reads its lorebook

A lorebook can have [branches](./lorebook-time.md#branches) (lines of the story that part from the main one) and a [calendar](./lorebook-time.md#calendar-and-clock). Once a lorebook is chosen and saved, two settings appear under it:

- **Line**: **Main**, or one of the lorebook's branches.
- **Story clock**: where this session's story stands in time. **Follow the line's present** moves with the lorebook; **This session's own clock** gives the session a date of its own (a year, and optionally a month, a day and a time of day).

A new session starts on the lorebook's most recently played line, following its present. It gets a clock of its own when you choose one or step it here, or when a pipeline moves the story's time on.

**The clock is the session's own.** Moving it never moves the lorebook's present or any other session's clock, so two sessions on one lorebook can stand years apart. Under the clock, **Step by** minutes, hours, days, months or years, **Forward** or **Back**. A date the lorebook's calendar can't place is refused with the reason, such as *There is no month 13: this calendar has 12.*

The line and clock decide what the session reads: the lore on its line, history dated up to its clock, the lorebook's dated changes that have happened by then, and the stats recorded so far. On a branch, the lines it came from count only up to where it forked.

If the line a session reads is deleted, the session moves to the line it forked from, and a clock later than the fork goes back to it. Guests see the session's line and clock but can't change them.

## Which connection a session uses

A session never picks a connection or a model itself. Each reply runs on the model its pipeline's configuration names, or on the pub's default from **Admin › Defaults** when it names none. To run one session on a different model, an administrator gives it a different configuration. See [Connections](./connections.md#choosing-a-pair) and [Pipelines](./pipelines.md).

## Pipeline settings in a session

Every reply and action is run by a [pipeline](./pipelines.md). The **Pipelines** section of the Settings tab has a card for each one the session runs: the reply first (*Reply*), then each action. Changes here apply to this session only and save as you make them.

Each card is grouped by **model call**: a block per call, with its name, a sentence on what it does, and its choices:

- **Prompt**: which prompt it sends.
- **Model**: which model it runs on. Shown to administrators only, read-only, with **Change in Pipelines**.
- **Sampling**: how the model writes (administrators only). The first entry says what you get with nothing chosen; **Reset** goes back to it.
- An **On/Off** switch, for a call that can be skipped (administrators only).

You only see what your role can change: someone who isn't an administrator sees prompts and nothing else, and a pipeline with nothing for you has no card. A setting you could normally change but that's locked right now stays visible, read-only, with a line saying why.

The last card is the pipeline that created the session. Its settings only mattered while creating it, so it's read-only afterwards: *This session has been created; these settings only applied while creating it.*

Everything else about a pipeline (its context template, budgets and retrieval) is set by administrators through **More settings in Pipelines** at the foot of each card. See [Pipelines → Agents](./pipelines.md#agents).

## Guests

When accounts are on, a session's owner can invite other people: **Add guests** in **Edit session › Participants**, then **Save**. A guest sees the session, writes as their own persona, and can:

- edit, hide or delete their own persona's lines;
- attach images and files to their own lines, and take them off again;
- regenerate, extend or swipe replies from characters they own;
- bench their own characters;
- press **Continue** when someone's turn is lined up, and take a turn lined up for their own character;
- select messages for a summary.

Only the owner can change the session's settings, branch it, ask for a Narrator Response, use **Pick who speaks** out of turn, or open the composer's panels. A guest sees a greyed button with the reason rather than nothing. See [Users and accounts](./users-and-accounts.md) and, for the exact rules, [Session actions](./session-actions.md#who-may-use-it).

## The composer's panels

The composer's **More** menu opens a panel in place of the text box, with **Back to compose** to return. Guests don't get these.

### Lore

Offered when the session reads a lorebook. It shows the lorebook's current history entry and its scenes, with:

- **Open in lorebook**;
- **Start new history entry**;
- **Summarize Scene**, which starts choosing messages for a scene;
- **Extend Graph (N)**, when this session has scenes not yet added to the lorebook's relationship graph;
- **Recent Entries**, to jump back to earlier history.

Below that, you can test what the next reply would pull in from the lorebook for the message you're writing, and see which entries have come up in this session so far.

### Pinned images

Pin any character's or persona's picture (their avatar or one from their gallery) to a **Left** or **Right** slot. The **Scene Portraits** widget, with **Show** set to **Pinned**, draws them beside the conversation. Your pins are remembered in this browser only.

### Statistics

Offered when an administrator has turned on context debugging (in [Admin › Diagnostics](./system-settings.md#diagnostics)). It shows how many tokens your draft's prompt uses and how many messages fit, with **Details** to open **Prompt Details**:

- **Token budget**: the total against the limit, and why anything was cut.
- **Messages**: which messages were included and which left out.
- **Retrieval**: every piece of lore considered, kept or left out, and why.
- **Sources**: which characters, personas and scenario went in.
- **Prompt preview**: the prompt itself.

With context debugging on, a thin bar along the top of the composer fills as the prompt nears the limit. Past it, a line says *This draft pushes the prompt past the context limit. Older turns will be trimmed.*

## Sprites

When a character has [sprites](./characters.md#sprites) (faces for different moods), a session can show the face that fits each line.

- **Chosen automatically.** After a character's reply is saved, Serene Pub compares the reply's text with the character's sprite labels and picks the closest. Every genre's reply does this, the Lair's delvers included; a narrator's line has no face to choose. This uses your active embedding model, not the reply's model: on this device for a local model, or one request per reply to an online one. With no embedding model set up, or when nothing fits, the line keeps the face it had.
- **Settings.** The choice has three settings on the reply pipeline's sprite step: **Choose sprites** turns it off (no embedding request is made then), **Stickiness** sets how much better a new face must fit before it replaces the last one, and **Minimum similarity** how close a line must be to any face. The session's own settings don't show them yet; an administrator changes them in the Pipelines view.
- **Pick one yourself.** **Change sprite** in a message's menu lets anyone who can edit that line pick its face, or none. The automatic choice never overrides yours.
- **Swipes.** Each version of a message keeps its own face.

Faces show in the **Scene Portraits** widget (set to show the scene), beside each line in the **Messages** widget when **Face beside each line** is set to the line's sprite, and in the session's header.

**Another outfit for this session.** On a Scene Portraits face, the sprite-set menu shows the character in another of their card's sets, for this session only. It's there when the card has more than one set, for the session's owner and the character's owner.

## Search by meaning notice

When an [embedding model](./embeddings-and-rag.md) is set up, a quiet line can appear above the composer in a longer session, saying the session's lorebook isn't fully indexed for **Search by meaning** yet. **Prioritize in queue** moves this session to the front; **Hide for this session** hides the line (owner only). It goes by itself once every entry is indexed. See [Understanding RAG notices](./embeddings-and-rag.md#understanding-rag-notices).

## Troubleshooting

:::warning Nobody replies after I send
- In a group session, **Auto-advance** may be **Off**, or the turn-order strategy **Manual**. Press **Continue** or **Pick who speaks**. See [Group sessions](./group-sessions.md#auto-advance).
- The *ready to continue* line hides while you have a draft or are editing a message.
- The session may have no active character: check the switches under **Participants**.
:::

:::warning I can't regenerate, extend or swipe
These work on the newest reply only, never on your own line, and not while anything is being written. As a guest, only on characters you own. A greyed button's tooltip says which.
:::

:::warning I can't attach an image or a PDF
**More** (⋮) › **What can be attached** in the composer says why, and a file you drop or paste that can't be attached says why on its own tile. Usually the reply's model can't read that kind of file. An administrator can:
- switch on **Vision** for the model, under **Advanced and notes › What this connection can do** in its connection's Settings tab, if the model really can read images. It turns on by itself when the model's host says it can see, or when a KoboldCPP run by Serene Pub has a vision projector set for it (see [Connections](./connections.md#images-and-files));
- switch the connection to **Chat messages**: a text completion carries no images;
- use a connection type that sends files. Some types don't send images to their model yet, and **What can be attached** says so.
:::

:::warning The model ignores an image I sent
Open the reply's prompt details. If the image shows as `[image: …]` instead of a file:
- it may be older than the media lookback (the last 10 messages, by default);
- the model may not read images: see the warning above;
- your context template may not render attachments. It needs `{{{attachments}}}` after `{{{message}}}` in its message loop; the shipped template has it.

A local model also needs its vision part loaded: for llama.cpp, start the server with `--mmproj`; for a KoboldCPP run by Serene Pub, set the model's **Vision projector**; for one you run yourself, load the model's mmproj file. See also [Troubleshooting](./troubleshooting.md#my-model-ignores-images).
:::

:::warning "This session may have been deleted or you don't have access to it."
The session was deleted, or you aren't its owner or a guest. Ask the owner to invite you.
:::

:::warning Older messages are missing
Long sessions load 25 messages at a time. Scroll to the top to load more.
:::

## Related

- [Group sessions](./group-sessions.md): turn order, Continue and the narrator.
- [Genres](./genres.md): Chat, Adventure, the Lair and the Guide.
- [Characters](./characters.md) and [Personas](./personas.md): who takes part.
- [Lorebooks](./lorebooks.md): the world a session reads.
- [Session layout](./session-layout.md): arranging the session screen.
- [Session actions](./session-actions.md): how actions and permissions work, for power users.
