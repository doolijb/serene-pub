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
2. Optionally give the session a **Name**, at the top. Left empty, it's named after its cast, such as *Session with Wren* (the box shows the name it will get).
3. Pick the **Genre**: the kind of session. **Story** is the everyday one, and one is already chosen for you. Each genre is a row with a line saying what it is; the chosen row also says who it takes (_characters · a character you play · lorebook optional_), and **More** unfolds the rest in place. See [Genres](./genres.md). Press the star on a row to make that genre your usual start: it is chosen for you next time.
4. A **Preset** row appears only when the genre has more than one preset to start from (Story, Chat and the Lair do). It shows the genre's default (or the one you starred); press **Change** to see them all. The preset is a starting recipe: each card says what a turn costs (worked out from what it runs), whether anybody is required, and which models it needs and which would make it better (_Needs: a text model · Better with: an image model_); a card whose models the pub lacks says some of it is unavailable here. The default is fine; star one to have it chosen for you. A preset may ask something first, under **Before you start**, such as Story's **Tone**: pick an answer or leave it as it is. One that says *Can't be changed after the session starts.* is settled for good when you press **Start**.
5. Under **Who is in it**, choose who the session voices and who you play:
   - **Characters** lists the ones you've chosen, in cast order: the order they take turns in a group session. Press **Add characters** to open a picker, search it, tick everyone you want, and press **Add**. They join the end of the list in the order you ticked them. Use **↑** and **↓** on a row to change the order, and **×** to take someone out. If the genre takes only so many characters, **Add characters** turns grey once the cast is full and says why.
   - **Who you play as** shows the persona you'll write as. Nobody is chosen for you: with no persona you write under your own name. Press **Choose who you play as** to pick one, or **Change** to pick another; the **×** beside it takes it off. The picker shows your personas first; turn on **Show all characters** to play any character.

   Nobody can be on both sides: the character you play as isn't offered for the cast, and a character in the cast isn't offered to play as.
6. If the genre reads a **Lorebook** (every genre but the Dungeon Crawler does), pick one, or leave **None**: no genre needs one to start, and a session with none keeps its world in [its own notes](./lorebooks.md#your-sessions-own-notes). To make a book now, press **Create a lorebook** on the card, name it and press **Create**: the new book is chosen for you. When the pub has [starter lorebooks](./lorebooks.md#starter-starter lorebooks), the card also offers **Start from a starter lorebook**: pick one and the session starts with the starter lorebook's world, cast and rules in its own notes, ready to play, without making a lorebook. The card says so in one line; to keep that world as a lorebook later, use **Make a lorebook from its notes** in the session's settings.
   **Rules** and **How strict** appear for a genre that plays by rules (Story, Dungeon Crawler, the Lair; Chat and Guide show neither). **Rules** lists the rules the session can play by, grouped by how well each fits the genre: **Great · Perfect** first, then **Ok · Good**, **Poor**, and **Incompatible** greyed with the reason. The genre's recommended ones are starred. With a lorebook chosen that has rules of its own, the session takes them, and the card says *From the lorebook:* and their name instead; with a starter lorebook chosen, it says *From the starter lorebook:* and the starter lorebook's rules. A lorebook (or starter lorebook) on **Freeform**, every new book's rules, brings none of its own: the card lists the rules to choose from, as with no lorebook. **How strict** is **Words only**, **Rules** or **The rules decide**, with the genre's default already chosen. Rules that decide nothing themselves (**Freeform**) play **Words only**, so with Freeform chosen the form doesn't ask, and a preset that sets it (Story's **Rule Based**) doesn't either. The rules themselves can't be changed after the session starts; **How strict** can, in the session's settings, unless the preset locks it.
7. Press **Start**.

:::tip You should see
The session opens. In a Story session, each character's greeting from their card is already there, and the composer at the bottom reads *Write as* followed by your name or your persona's.
:::

:::warning If this didn't work
- **Start stays grey**: a required answer is missing, and the line under **Start** says which, such as *Add at least one character.* or *Choose who you play as.*
- **"No preset is available for this genre"**: an administrator hasn't enabled a preset for it. Pick another genre, or ask them. Administrators get a link straight to **Admin › Play › Presets**.
:::

A **persona** is a character you play: see [Personas](./personas.md). You can play any of your characters, and one you pick becomes one of your personas.

### Send a message

Write in the composer and press **Enter**, or **Send**. Use **Shift+Enter** for a new line. On a phone, or when the conversation is narrow, Enter always adds a new line and you send with **Send**. While a reply is being written, **Send** becomes **Stop**.

:::tip You should see
The character's name shows a small dot and a status, *Wren is thinking*, then *Wren is typing*, while the reply streams in below. A model that reasons first shows *Wren is reasoning* until its reply starts.
:::

Your draft is saved as you type, so it's still there if you reload the page or come back later.

If a message can't be sent — the session can't take it right now, or it waited too long for an answer — a short note says why and your text goes back in the composer, ahead of anything you typed since. Nothing you wrote is lost: the saved draft is only cleared once the message is in the conversation.

A genre can **close the composer** on a channel while it waits for something, for everyone or only for you: Dungeon Crawler closes **Story** for each player until their character is made. A closed composer is greyed, with the genre's actions under it, and says what it's waiting on in place of *Write as…*, such as *Waiting: Make your character on the Planner tab first.* (an [archived session's](#archive-and-unarchive) composer reads its sentence alone, without *Waiting:*). If a send gets through anyway, it's refused with the same reason and your text comes back. The turn controls (**Continue**) aren't the composer's and stay as they are. Only the genre opens it again; the owner is closed too.

### Attach images and files

Press **Attach** (the paperclip) in the composer's footer to pick files, drag files onto the composer, or paste a screenshot into it. Each file starts uploading at once and shows as a tile under where you write, with a bar while it uploads. Press a tile's **✕** to take it off. Then write your message (or don't: files alone can be sent) and press **Send**. If a file is still uploading, Send says *Uploading 1 of 2… Sends when done.* and sends by itself when it finishes.

What you can attach depends on the models that would read your message. To see what, open **More** (⋮) in the composer's footer and choose **What can be attached**: it says, for example, **This reply can read: images · text files**, lists every kind with the reason a kind can't be attached, and closes with **Esc**. Hovering **Attach** says the same in short. When more than one model call reads the conversation, it lists each call and what it reads: the reply's (Story's Narrator, for example), then the session's actions that write with a model, by name (**Look**, **Ask**, **Build room**…), and **Form answers** (a character answering a question put to them). A kind can be attached when at least one of them reads it. A call that can't read a kind sees the file's name in its place, such as `[image: cat.png]`. Administrators also see which model each call runs on.

| Kind | Formats | Largest file |
|---|---|---|
| Images | PNG, JPEG, WebP, GIF | 20 MB |
| Text files | .txt, .md | 1 MB |
| PDFs | .pdf | 32 MB |
| Audio | MP3, WAV, OGG, FLAC, M4A | 25 MB |
| Video | MP4, WebM, MOV | 50 MB |

A message can carry up to 10 files. A file that can't be attached (an SVG, a kind nothing in this reply reads, one too big) is never uploaded: a tile says why, and clears itself after a few seconds. Location and camera details are removed from photos when they upload.

Files you haven't sent yet are still there when you reload the page. Unsent files are removed after 24 hours.

A sound you attach shows a player on its tile once it has uploaded, so you can listen to it before you send. Sent sounds and videos play where they were sent, under the message.

Sent files show under the message (see [Images and files on a message](#images-and-files-on-a-message)). To take one off a message you wrote, press **Edit** on the message and then the file's **✕**. To add a file, send a new message.

#### What the model sees

Each file goes to the model with the message it belongs to, not only with the newest one. So in a group session, an image Mara shared three messages ago still sits on Mara's line.

- **Images and PDFs** the model can read are sent to it as files, on their own message's turn. Only the last 10 messages send their images this way. Older ones are sent as their names, such as `[image: cat.png]`, so a long session doesn't resend every picture on every reply.
- **Text files** are put into the prompt as text, under the file's name, for every model. A long file is cut to about 4,000 tokens, and the prompt says it was cut.
- **Audio** goes to a model that can hear it (OpenAI's audio models, for example) as sound, WAV or MP3, within the same last 10 messages. A model that can't hear it is sent what it says instead: when an administrator has filled the **Transcription** loadout, the reply first writes down what the recording says, once, and the model sees `[audio: note.mp3 — "Meet me at noon."]`. With no Transcription model, it sees the name, `[audio: note.mp3]`, and the prompt details say why.
- **Video** can be attached and plays under the message, but no model is sent one yet: every model sees its name.
- **Anything a model can't read** is sent as its name, with the description you gave it, such as `[image: cat.png — a grey cat]`. A model that can't see images still knows one was shared.
- **Files that don't fit.** Pictures and sounds count toward the model's context window like text does. When the prompt with them is too big, the oldest ones are sent as their names first, before any of the conversation is left out, and the prompt details say how many.

An image on a character's line, such as a generated picture, is sent with the next message from you, because models accept images only on your turns. A character's earlier **spoken reply** goes back to the model as the words it said, not as sound.

The same goes for every action that writes with a model and reads the conversation: Story's **Look**, **Ask**, **Rest** and **Time passes**, the Lair's **Build room**, **Trigger trap**, **Reveal** and the rooms the Castellan drafts, the tool loop, and a character answering a form. Each judges by its own model, so a Look on a model that sees images gets the picture even when the reply's model gets its name.

A **summary** reads your files as names: each file is written after its message's text, as `[image: cat.png — a grey cat]` or `[file: notes.txt]`, so a message that is only a picture is summarized as that picture, not skipped. See [Summarization](./summarization.md).

Both numbers are settings of each pipeline that places files: **Media lookback** (how many recent messages send their images) and **Text file budget**, on its **Place attachments** step. A context template written without `{{{attachments}}}` in its message loop sends no files, and the prompt details say so.

### Try another reply

Not happy with a reply? Hover it (or tap it on a touch screen) and press **Regenerate** to have it written again, or use the arrows beside its time to **swipe**: the right arrow on the newest version writes a new one, and the left arrow steps back through earlier versions. See [The message menu](#the-message-menu).

## The session screen

The bar across the top shows the session's name, the faces of its cast (a dot marks whoever is up next), and its genre.

On a phone (or any bar narrower than about 640px) the name comes first and keeps its room: the genre steps out, the faces give way before the name does, and **Back**, **Forward**, **Settings** and **Layout** move into one **⋯** menu (*More actions for* the session) at the right of the bar.

If the session's preset runs a pipeline that is no longer available, one line under the bar says the session is running the genre's default pipeline instead; administrators also get a button that opens the preset to fix it. Its **✕** hides it until you next open the session.

Want the room? The small double arrow at the bar's top right (**Hide the session header**) rolls the bar up, along with any strip your layout has across the top. A small tab at the middle of the top edge (**Show the session header**) brings it back; while the bar is hidden, the Jump search pill steps out too (Ctrl K still opens Jump). This browser remembers your choice.

Below it is the conversation, and at the foot, the **composer** where you write. Its footer holds, left to right:

- **Your persona**: the face and name you're writing as. When more than one of your personas is in the session, click it to switch (see below).
- **Attach** (the paperclip): adds images and files to your message (see [Attach images and files](#attach-images-and-files)).
- **Preview** (the eye): shows your draft formatted as it will appear. Press it again to go back to writing.
- **More** (⋮): the composer's panels: **Lore** and **Statistics** (see [The composer's panels](#the-composers-panels)), and **What can be attached** (see [Attach images and files](#attach-images-and-files)).
- **Send**, or **Stop** while a reply is being written.

The first time you focus the composer on a computer, a hint under it says *Enter sends. Shift Enter for a new line.* once.

Just above the composer runs the **turn line**: one row saying who is next, and what is happening.

- On the left, while something is happening: *Wren is thinking* while a reply is being written, or *Last run failed* with the reason. **Review 2 changes** appears when the AI has proposed changes that wait for you. Once a reply is written the left side stays quiet: the newest reply's **⋮** menu says how long it took (*Replied · 6.2 s*, for replies written while you were watching), and administrators find **Inspect run** there, as on every reply (see [Inspecting a run](./pipelines.md#inspecting-a-run)). On a narrow screen only the status shows: tap it for the rest.
- On the right, who is due next, with **Someone else** and **Continue** (see [Who is due next](./group-sessions.md#who-is-due-next)), and who else is typing. While a reply is being written it offers **Stop**; after one fails, **Try again**. In the Lair, when the plan waits for a seated player it reads *Waiting for Maren*, and the session's owner also gets **Continue**, which moves past them: *Continue moves past Maren: their turn is skipped this round.*

Clicking a message's picture opens a gallery of that character's or persona's images. Clicking their name opens them as this story knows them: if the session's lorebook has them in its [cast](./lorebook-cast.md), their cast member's page opens in the Lorebooks panel; otherwise their card opens in the [Characters](./characters.md) view. Either way you keep your place. A guest, who can't read the host's lorebook, always gets the card.

You can move the conversation and add other widgets around it: see [Session layout](./session-layout.md). Story and Lair sessions start with some placed for you, such as the party's stats and, in a Lair, the dungeon's rooms (see [Layouts](./session-layout.md#layouts)).

Some genres keep more than one channel. A Messages widget shows each channel it holds as a [tab](./session-layout.md#channel-tabs) above its log (the Lair's *Story* and *Sanctum*), and a layout can give a channel its own panel instead: the *Manuscript* of the Writing Room (a genre that comes from a plugin), which reads as one block of prose (the Messages widget's [Folio](./session-layout.md#what-the-messages-widget-offers) presentation) rather than as rows of messages.

A channel can belong to the session's owner alone. The Lair's Sanctum is one: guests never see its messages or its tab, and can't write there. A guest's first visit to a Lair opens its **Party** layout, which has no Sanctum (see [The Lair](./genre-lair.md#whats-on-the-screen)).

### Images and files on a message

Images and files on a message (a generated image, or a file sent with it) show as a row of square tiles below the message, outside its card or bubble. Every image is a square thumbnail, even when there is only one, and past six the rest fold into a count such as **+3**. A file is a tile of the same size with its name and size: click it to download it. If a file was deleted from **Settings → Media**, its place says *File no longer available*.

Click an image to open it full size. With more than one, use the arrow keys, the arrows at its sides, or swipe on a phone to go through the message's images; the counter says which one you are on. **Download** saves the file, **Info** shows what is known about it — for a generated image its prompt, seed and model, for any file its name, type and size — and **Esc** closes it.

To find a picture again without scrolling, add the **Album** widget: it gathers every picture in the session, newest first (see [Session layout](./session-layout.md)).

A session can also have a **backdrop**: one picture that sets the scene, shown by the **Backdrop** widget. The [Scene](#scene) action or you can set it; the session's owner changes or clears it from the widget, and everyone in the session sees the same one (see [Session layout](./session-layout.md)).

### Switch which persona you write as

If more than one of your personas is in the session, the persona in the composer's footer has a chevron. Click it (**Switch persona**) and pick who to write as next.

A guest who has no persona in the session yet sees *Add a persona to this session to send messages.* with an **Add your persona** button instead. A guest whose seat has a name but no card (a genre that names your seat, like Dungeon Crawler) writes as that name instead — no persona needed. In the Lair, a guest's story composer starts as **Take a seat**: name the character you'll play, or press **Play one of your personas instead**. A seated player's lines are their character's turns, never the game master's direction.

If nobody is chosen for you to play as and you press **Send**, the **Choose who you play as** picker opens instead of sending. Your message stays in the box: pick someone, then press **Send** again.

## Actions

In the composer's bottom row, beside who you write as, is **Actions**. Click it to open one row of buttons for this session above the text box, all alike:

- first, the **turn controls**: **Continue**, **Pick who speaks** and, in Story, **Regenerate** for the last reply (see [Group sessions](./group-sessions.md#continue-and-pick-who-speaks)). In the Lair and the Dungeon Crawler, **Regenerate the last turn** is not here: it is the third press in the session header (see [Back and Forward](#back-and-forward));
- then what the genre offers: in Story, **Narrate**, **Side character**, **Image**, **Scene**, **Look**, **Rest**, **Ask**, **Answer** and **Time passes…**; in the Lair, **Nudge**, **Whisper**, **Trigger trap**, **Reveal**, **Roll** and **Build room** (the session's owner's, by preset);
- **Routines**, for the session's owner: the session's [routines](#routines) that aren't Off; pick one to run it now;
- then **More**, which lists every action, including ones without a button of their own.

Hover any button to see what it does. **What do these do?** (the **?** at the end of the row) lists every action the session offers you right now, with a sentence each. A greyed button says why in its tooltip, such as *wait for the reply to finish*.

An action that needs words from you opens a small window asking for them.

### Image

**Image** asks *What should the image show?*, draws what you describe and posts it in the session as a message. It draws with the pub's **Images** [loadout](./connections.md#loadouts) (the model on a connection that pictures run on); while it is empty, the run ends with a sentence saying an administrator has to choose one (see [Images](./images.md#when-it-says-no-model-is-set)).

### Scene

**Scene** draws the scene as it stands, with one press and no window. Story sessions offer it. It reads the last few messages (six by default) and how everyone in the session looks (each character's and persona's likeness, from the **Likeness** tab of their card), asks the model for a picture description, then draws a wide picture. Each person's likeness image, or their avatar when they have none, is sent along so the picture can resemble them, when the image model can take reference pictures.

By default the picture is both posted in the session as a message and set as the session's **backdrop**. An administrator can change that in **Admin › Pipelines**, on the **Illustrate scene** pipeline's **Placement** step: **Post it**, **Backdrop** or **Both**. The **Backdrop** widget's **Illustrate** button runs the same action but only sets the backdrop, and posts nothing.

Scene is offered in Story sessions. Getting pictures working, and giving characters a likeness, is in [Images](./images.md). For administrators: the description runs on the **Scene prompt** [loadout](./connections.md#loadouts) and the picture on the **Scene** loadout; one left unfilled runs on **Reply** or **Images** instead.

### Time passes…

**Time passes…** moves the session's [story clock](./lorebook-time.md#the-story-clock) on, or back, by as much as you choose: a number, a unit (minutes, hours, days, months or years) and **Forward** or **Back**. It opens at one hour forward. Nothing is posted in the conversation and no model is asked; the next line carries the new time. Chat and the Lair offer it, and Story's **Time passes…** does the same after its state-keeper has said what the world does over that span (see [Story](./genre-story.md#actions)). It needs the session to read a lorebook with a date to start from; otherwise nothing moves and a line says so: *Time passes: 1 hour, not on the clock…* (Story's keeps the world's changes all the same). Pressed before the session has any line at all, the move shows at the head of the conversation. The move shows under the message as *Time passes: 1 hour (…)*, and deleting that message takes it back (see [The story clock](./lorebook-time.md#the-story-clock)). Moving the clock this way can [suggest a new scene](#when-a-new-scene-begins) at the next line.

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
| **Hide** / **Unhide** | The message is *hidden from the story*: it stays on screen, dimmed, and the characters no longer read it. What it changed stays. | Any message |
| **Delete** | Removes the message for good, after you confirm. Off unless the session's genre (or an administrator) adds it: see [Deleting a message](#deleting-a-message). | Where the genre offers it |
| **Branch from here** | Starts a copy of the session ending at this message. | Any message (owner only) |
| **Select for summary** | Starts choosing messages to summarize into the lorebook. | When the genre keeps lore |
| **Start scene here** | Starts a scene at this line; an open scene ends at the line before. See [Scenes](#scenes-start-and-end-them). | Sessions you own, where the genre keeps scenes |
| **End scene here** | Ends the open scene at this line; what follows depends on [how scenes begin](#when-a-new-scene-begins). | Lines of the open scene, as above |
| **Change sprite** | Picks the face shown with this line. | Characters with [sprites](#sprites) |
| **Inspect run** | Shows every step of the run that wrote this reply. | Administrators |
| **Prompt details** | Shows the prompt this reply was written from. | With context debugging on |

Genres and plugins can add their own entries, such as the Lair's **File as a room**. Who may use each action on whose message is set out in [Who may change a message](./session-actions.md#who-may-change-a-message): in short, your own persona's lines are yours, and a character's replies are the session owner's or the character's owner's.

Small marks in the name row tell you more: a handshake for a **greeting**, a ghost and *Hidden from the story* for a **hidden** message, a film mark for a message **in a scene** (every line of it but the first, which sits right under the scene's marker), and **Stopped** for a reply you stopped. The time shown is when the message was last written or changed.

### Back and Forward

To take back what just happened, use **Back** (the curved arrow pointing left) in the session's header, at the top right beside **Settings** and **Layout** (on a phone, the first item of the header's **⋯** menu). Back takes the last turn out of the story: your line and every reply that answered it (at a table of several players, the whole round). Everything that turn changed goes back with it: stats, items, a side of a tie, moves of the story clock, what it wrote in your lorebook and in the session's own notes. The characters no longer read it, and the conversation shows the story as it stood before. Press **Back** again to go back another turn.

**Forward** (the arrow beside it) brings the last turn you took back into the story again, with everything it changed. Point at it to see how many turns are ahead (*2 turns ahead*).

While you're back, the composer says so: *2 turns ahead will be replaced if you write now.*, with **Forward** beside it. Writing anything new (a line, **Continue**, **Regenerate**, an action) replaces the turns ahead: they're deleted for good and the story goes on from where you are. That's the one way messages are deleted unless the genre offers **Delete**.

- Only the session's owner presses Back and Forward. Everyone else sees the note in their composer while the owner is back.
- Back and Forward wait while a reply or an action is still running, not only while the reply's text arrives: they stay grey, with *Wait for the reply to finish.*, until the reply has finished filing its notes too.
- They work on the story itself, not on side channels: private messages stay as they are.
- The greetings and the opening stay: Back goes back to your first line, no further.
- In a [branch](#branch-from-here), Back goes back to where the branch began. To go further, open the session it was branched from. A branch is the way to keep both versions of a story.
- The turns ahead are kept when you leave and come back.
- Back refuses to go below what is in the lorebook. A summary you applied, or a scene's applied summary, fixes everything up to the newest line it was written from, and Back there says *This part of the story is in the lorebook now.* In the conversation, a quiet mark after the newest such line reads *In the lorebook up to here*. See [Summarization](./summarization.md#what-an-applied-summary-fixes).
- In a genre that keeps every turn as it is played, Back refuses outright: *This story keeps every turn as it is played, so there is no going back.*
- While the session is [archived](#archive-and-unarchive), Back, Forward and Regenerate the last turn are all greyed with *This session is archived. Its owner can unarchive it to play on.*

#### Regenerate the last turn

In the Lair and the Dungeon Crawler the header has a third press after Back and Forward: **Regenerate the last turn** (the circular arrow; on a phone, the third item of the **⋯** menu). Like Back and Forward it is the session owner's only, and it is shown only where the genre offers it; Story has no such press.

It takes the whole turn after your line, every reply of it, as Back does, and plays the turn again from its start. It asks first with **Regenerate the last turn?** and names what goes, for example *This deletes and rewrites: Narrator.* The box has **Don't ask again for this session**, then **Cancel** and **Regenerate**. Under [**On revision: Branch**](#on-revision) it branches first and plays the turn on the new branch, and the box adds *This will branch here; the old turns stay on the old branch.*

When the press is grey, its tooltip gives the first reason that holds: a reply or an action is still running (*Wait for the reply to finish.*); the reason the session's [action list](./session-actions.md#why-a-button-is-grey) gives; or the reason the session gives, such as *Nothing has been written yet, so there is no turn to regenerate.*, *Your line is the newest. Press Continue.*, or the lorebook and every-turn-kept sentences above.

### Hide or Back?

**Hide** keeps a message in the story's record but stops the characters reading it. It takes nothing back: what that message changed stays changed. **Back** takes the turn out of the story and takes back what it changed, and **Forward** can bring it back until you write something new.

### Deleting a message

Deleting is **off** in every genre Serene Pub ships. Hide a message, or use Back, instead. A genre from a plugin, or an administrator, can turn Delete on by adding a pipeline that carries out the deletion (see [Session actions](./session-actions.md#deleting-a-message-needs-a-pipeline)). Where it's on, **Delete** removes the message after you confirm and takes back everything it changed, like Back does, but for good.

### Regenerate, Extend and Swipe

These work only on the **newest** reply, never on your own lines (edit those instead).

- **Regenerate** replaces the reply with a fresh one.
- **Extend** keeps the reply and writes more onto the end: useful when it was cut off.
- **Swipe** keeps every version. The arrows show *2 / 3* and so on; on the newest version, the right arrow writes a new one.

A regenerate, or a swipe that writes a new version, takes back everything the old reply changed before the new one is written: its stats, its suggestions, its moves of the story clock, what the rules moved for it (who holds what, a side of a tie and the words the tie shows on the lorebook), and what it wrote in your lorebook and in the session's own notes. Every open tab shows it straight away, and the new reply then makes its own changes. If the new version fails, the old reply's changes all come back.

**Back** takes back the same things, a whole turn at a time, and **Forward** puts them back (see [Back and Forward](#back-and-forward)); **Delete**, where the genre offers it, takes them back for good. **Edit** changes only the words: what the reply changed stays as it is.

Your lorebook is never rewritten behind your back. Something the reply wrote there that someone changed since (by hand, or a later reply) stays as it is now, and the entry says *Written by a reply that was since replaced*, with **Revert** to put back what it held before and **Keep** to leave it. See [Changes from a replaced reply](./lorebooks.md#changes-from-a-replaced-reply). The session's own notes always go back.

A **greeting** is a character's opening line from their card, marked with a handshake. Swiping a greeting steps through the greetings written on the card; it never writes a new one.

### Branch from here

**Branch from here** asks for a title, then makes a new session holding every message up to and including this one, and takes you there. The original is left as it was. Leave the title empty to keep the original's name. Only the session's owner can branch. The branch's [story clock](./lorebook-time.md#the-story-clock) stands where it stood at that message. What a branch copies is listed in [Session actions](./session-actions.md#what-a-branch-copies).

### Select messages for a summary

**Select for summary** turns the conversation into a checklist. Tick messages (or use **Select all above** / **Select all below** on a message), then choose where the summary goes: **Scene**, **World lore** or **Character lore**. Messages already in a scene can't be picked again. See [Summarization](./summarization.md).

Where you can start scenes (see [Scenes](#scenes-start-and-end-them)), the bar offers **Mark as scene** first: the lines from the first you ticked to the last become one finished scene, with nothing summarized yet. Any run that's in no scene can be marked, an earlier stretch of the story too; a run that starts after the open scene began ends that scene at the line before. **Scene summary**, beside it, is the older way: the ticked lines become a scene and are summarized at once. Lines inside a scene, the open one included, can't be ticked.

### When a reply goes wrong

- **It's slow to start**: the status reads *waiting for the model* (another reply is ahead of it) or *loading the model* (the model is starting up).
- **It fails**: the message says what went wrong, in its own words, with a **Retry** button.
- **The server restarted mid-reply**: the reply keeps the text that had arrived and says *The server restarted before this reply finished.* Regenerate, Extend and Swipe work again straight away.

**Rolls under the fold.** A genre that keeps a table channel (the Dungeon Crawler's rolls, stakes and rests) draws each table line under the message it belongs to, folded to one line — *⚄ Attack 17 vs AC 14 · hit, 6 slashing* — that opens into the whole trace. A Messages copy's **Interleaved lines read as** setting shows them open instead, and a copy pinned to the table channel itself is the full log.

**Roll forms and outcomes.** In the Lair, the Oracle asks the game master to call a roll with a small form in the story (**Check**, **Difficulty**, then **Roll** or **No check**) and reports each result as a framed outcome line: what was checked, what it came to, what it was set against and how it came out. Lines like these are drawn as the rules speaking, quieter than the party's lines. The Lair's **Show outcomes** setting decides whether the AI party read the numbers or only how things went; the lines stay in the story either way. See [Rolls](./genre-lair.md#rolls).

Some models show their reasoning: it appears folded under **Reasoning** above the reply, filling in while the model reasons, and the reply starts below it once the model starts answering. The status says *Wren is reasoning* during that part. Reasoning is never sent back to the model. If a reply opens with the character's own name, like `Wren:` or `**Wren:**`, the label is taken off.

## Find your sessions

The **Sessions** view lists every session you own or were invited to, grouped under **Your turn** (the last message wasn't yours), **Recent** (the last seven days), **Older** and, last, **Archived**. An [archived session](#archive-and-unarchive) is never under **Your turn**, however it ended. The session you have open sits at the top.

Each row shows up to three faces from the cast (with *+2* and so on when there are more), the session's name, and one line under it: the last line said, then the genre when your install has more than one, then when it last moved. Which sessions wait on you is said by the **Your turn** heading above them. While a reply is being written, the line starts with a small pulsing orange dot and the reply's status (*Jasmine is typing*). **Shared with you** marks a session someone invited you to.

Above the list:

- **New** starts a session.
- The filter box searches by session name, persona, character or tag. **Filter sessions** narrows to one genre or tag.
- **List view** and **Card view** switch between rows and cards. A card shows the lead character's picture, the cast's faces, the session's name and genre, whether it's your turn, and its last line. The view remembers your choice in this browser.
- **All**, **Your turn** and **Favorites** switch between all sessions, those waiting on you, and those you've starred.

Clicking a session opens its details, at any width: its cast, last line, scenario, lorebook and who it's shared with. **Open session** at the top takes you into it, and **Edit** beside it opens its settings. Picking a session in Jump (**Ctrl K**) goes straight into it.

With room for the details beside the list (at Half or in Focus on a wide screen), the view shows the session you have open in the story, with its row marked, until you pick another. With no session open and nothing picked, the list sits in the middle of the view.

Each row's menu offers **View**, **Edit**, **Star** / **Unstar** and **Delete**.

Opening the sessions list from a character's details shows only sessions with that character, with a chip you can dismiss to see all.

### Delete a session

Choose **Delete** in a session's menu and confirm. The session and all its messages are removed for good. Scenes it saved to a lorebook stay there, with their name, summary and cast.

### Archive and Unarchive

The session's owner can **Archive** a session from the **⋯** menu of its details in the Sessions view. It asks first. When the session's genre has a [Close out](#close-out), the box reads *Archive this session? It becomes read-only until you unarchive it. Anything played since its last scene is summarized as a closing scene for you to review.* Otherwise it reads *Archive this session? It becomes read-only until you unarchive it.*

An archived session is read-only, and says so:

- The composer reads *This session is archived. Its owner can unarchive it to play on.*
- **Back**, **Forward** and **Regenerate the last turn** are greyed with *This session is archived. Its owner can unarchive it to play on.*, and so is every [action](./session-actions.md#why-a-button-is-grey).
- Its [routines](#routines) stop.
- The turn line (who is ready to continue) is hidden.
- An **Archived** mark sits beside the genre in the session's header, and the session moves to the **Archived** group in the Sessions view.

**Unarchive**, in the same menu, puts the session back as it was. Nothing was removed: an archived session is a session you have put down, not one you have deleted. An archived session is not an archived lorebook entry; the two have nothing to do with each other.

### Close out

**Close out** is in the same **⋯** menu, for the session's owner, and appears only when the session's genre offers it. It asks *Close out this session? What was played since its last scene becomes a closing scene, summarized for you to review before it goes into the lorebook.* Once it starts, it says how many closing scenes are being summarized for you to review. Nothing goes into the lorebook until you review the summary (see [Summarization](./summarization.md#close-out-and-the-catch-up-offer)). It never runs on its own, with one exception: archiving a session runs it once, when the genre offers it. If everything played is in a scene already, it says so and does nothing.

### Catching up on an older session

When you start a session on the same lorebook line as an older session of yours whose last lines never reached the lorebook, the new session's header says so in one line, such as *Old Keep has 12 lines the lorebook doesn't have yet.*, with a button **Catch up on Old Keep**. Pressing it closes the older session out, held for your review as above. It asks nothing first, and you can dismiss the line instead.

### Every session on the pub

Administrators also have **Admin › Play › Sessions**: every session on the pub, whoever owns it, with its owner, genre, preset, number of messages and members, and when it last changed. Filter by owner, genre, preset or kind (_One character_ or _Group_), or search by name, owner, genre or preset. A session's preset links to that preset's page. The list is read-only: sessions belong to the people who made them, so there is nothing to add, edit or delete there.

## Session settings

Open a session's settings with **Settings** at the top of the session itself (on a phone, in the header's **⋯** menu; it opens straight on the **Settings** tab), or with **Edit** in the Sessions view: in a row's menu, or beside **Open session** in its details. The form has three tabs, and **Save** at the top. A dot on a tab means something there still needs an answer. Closing with unsaved changes asks before throwing them away.

Above the tabs:

- **Session name**: what the session is called in the Sessions view. It waits for **Save**.
- **Genre**, with **Upgrade to version 2** (or whichever version is newer), shown only when a newer version of the session's genre is installed. A session keeps its genre for life; upgrading moves it to the newer version and keeps the session and its settings. It happens at once.

### Participants

Everything on this tab waits for **Save**: adding, removing and reordering people, and the characters' and envoys' switches. Someone added but not saved yet shows **Ready to add**; closing without saving drops it all. The one exception is **Reassign…** under **Removed**, which happens at once.

- **Personas**: who people write as. A seat with a name but no card (Dungeon Crawler) is listed by its name: rename it in the box or remove it. A guest can change only their own.
- **Personas**: who people write as.
- **Envoys**: characters this genre brings along, such as a narrator or the Lair's Castellan. Switch one on to include it. See [Envoys](./genres.md#envoys).
- **Removed**: characters and personas you took out, with **Reassign…** to hand their messages to someone else.
- **Guests**: other people invited to the session (see [Guests](#guests)). Only the owner can add or remove them. A genre that is yours alone (the Guide, Chat) has no Guests card.

### Settings

The story, what your lines are called and the tags wait for **Save**. Everything marked **Applies at once** (the genre's settings, each pipeline's and the routines, the stats, **Preset**, **Actions**, **Pipelines**, **Rules options**) changes the session as you set it.

From the top:

- **The story**: the **Scenario** and the **Lorebook**. The scenario is a few lines describing the setting or situation; the model reads it on every reply. Once a lorebook is chosen, **Scenes**: where a new scene begins while you play, and when its summary is written (see [When a new scene begins](#when-a-new-scene-begins)).
- **Line** (which version of the lorebook this session reads) and **Story clock** (the in-story date), once a lorebook is chosen (see [The session's lorebook](#the-sessions-lorebook)).
- The session's stats, when the genre has them. These save as you change them.
- **Actions**: which actions the session offers, each with a line on what it does. Untick one to switch it off in this session. Actions the genre offers but the preset leaves out are listed under **Not in this preset**; an administrator can add one to this session.
- **Preset**, when the genre has more than one (Story, Chat, the Lair): which preset the session runs, with what a turn costs. Pick another and it applies at once. In Chat, change the **Tools** the preset picked and it reads **Custom**, with **Back to** the preset beside it.
- **The genre's settings**, headed by the genre's name (*Story settings*): whatever the genre offers, such as Story's **Auto-advance** and **Author's note**, Chat's **Tools**, and **How strict** where the genre plays by rules. Rarely-touched ones sit under **Advanced**. A setting the preset locked shows its value, read-only, with the reason. See [Settings you can change, and why some are locked](#settings-you-can-change-and-why-some-are-locked).
- **A card for each pipeline the session runs** that offers something to set: the reply (Story's **What the reply reads**, the sprite choice), the turn order (who may take a turn), each routine's own switches (**Note what changed**). Only what your role can change is there.
- **Routines**: what runs on its own between turns, each **Off**, **Review** or **Full** (see [Routines](#routines)).
- **On revision**: what deleting or regenerating the latest turn does (see [On revision](#on-revision)).
- **Rules options**: how the session's rules play, when its rules offer choices (see [Rules options](#rules-options)).
- **Pipelines**: which prompt each model call uses, and for administrators the model and sampling (see [Pipeline settings in a session](#pipeline-settings-in-a-session)).
- **Tags**, which the Sessions view's search reads. See [Tags](./tags.md).
- **Session data** (below).

### Routines

A **routine** is a pipeline that runs on its own between turns: Story's **Note what changed** after each round, **Look back over the story** every five turns, Chat's **Remember things**. The **Routines** card lists the session's routines, each with what it does, **When it runs**, and three modes:

- **Off**: it doesn't run.
- **Review**: it runs, and holds what it would change for you to accept.
- **Full**: it runs and applies what it changes.

Anyone who can open the session's settings picks the mode; it applies at once, and **Reset** goes back to the preset's. A routine the preset leaves Off is listed, so you can turn it on. A line under a routine says when it is doing something: *Waiting to run*, *Running now*, *Needs a story clock* (a story-time routine in a session without one), *Unavailable: needs a model that can draw pictures.* (a routine whose model the pub doesn't have: it never runs until an administrator sets one), or why it has paused.

**When it runs.** A routine that runs after each turn or after each round (Story's **Note what changed**) has a **When it runs** choice on its row: **After each turn** or **After each round**. A **turn** is any line in the story, whoever says it; a **round** ends once everyone taking part has had a turn.

**Run now.** The session's owner can run a routine straight away: **Routines** in the composer's actions lists the ones that aren't Off; pick one and the line under it says *‹name› will run once the story settles.* A run started by hand still waits for the reply and anything else in progress to finish, and while the routine already has a run waiting, its item reads *— already waiting* and is greyed. Running one counts as playing, so it also restarts routines that had paused.

**When routines run.** A routine never runs beside a reply: it waits until every reply, action and event in the session has finished, and people's replies reach the model before any routine does, in every session on the pub. A routine acts as the session's owner.

**Routines on the real clock** (every hour, daily at nine) pause by themselves when nobody has played for a while, or after so many runs in a row, and the routine says why: *Paused: no one has played for 3 days*, *Paused after 12 runs in a row*. The next line, action, form answer or settings change starts them again. Set lower limits for your own sessions under **Settings › User › Background routines** (the pub's limits, shown there, are the most you can set). After Serene Pub restarts, they wait until someone plays in the session again, and nothing missed while it was down is run.

Administrators also get a **Cadence** fold on each routine: its timing's own settings (**Every how many turns**, or **Skip when the clock jumps more than …** for one on the story clock), **Allow stacking** (off: while a run is already waiting, another that comes due is skipped), and a real-time routine's own two limits.

What ran while you were away, what it wrote and what it skipped is in the **While you were away** widget, which you can add from the layout editor (see [Session layout](./session-layout.md#the-widgets)).

### Settings you can change, and why some are locked

A session's owner sees the settings the genre and its pipelines open to them; an administrator sees them all. A setting's value comes from the nearest of: this session, the preset, the genre's defaults, the setting's own default. A preset can **lock** a setting, and then it shows read-only with the reason, such as *How strict is set by the session's preset*. A setting that can't change after the session starts is read-only afterwards. The model, sampling, loadouts and prompts' wording are never a member's setting: only administrators see them. See [Pipelines › Where a value comes from](./pipelines.md#where-a-value-comes-from).

### On revision

Every session has an **On revision** setting, whatever its genre. It decides what happens when you delete or regenerate the latest turn and play resumes from an earlier point:

- **Overwrite** (the default): the old turn is gone. For **Regenerate the last turn** that is exactly what [Back](#back-and-forward) does to it, whole turn and every reply, before the turn is played again. Everything it changed (stats, the story clock, what it wrote in the session's own notes, and what it wrote in your lorebook unless someone has changed that since) is taken back, and play goes on in the same session.
- **Branch**: the session is branched just before that turn. The old turn stays in the original session, untouched, and the screen moves to the branch (for **Regenerate** too: the turn is played again there, and a note says so), named after the session with its number (*Drowned King · branch 2*). The session's own notes are copied into the branch up to that point. In the session list the branch reads *Your turn*: nobody is waiting on the model. The branch's header and its session panel say *Branch of Drowned King*, and its world notes (the planner's notes, a crawl's leads) stand where they stood before the revised turn. The same is true when the turn is overwritten instead.

A branch made this way can be kept or deleted like any other. The delete confirmation says in one sentence which of the two will happen: *This will overwrite the last 3 turns. There is no undo.* or *This will branch here; the old turns stay on the old branch.* The **Regenerate the last turn?** box says *This will branch here; the old turns stay on the old branch.* under Branch, and adds nothing under Overwrite.

[Back and Forward](#back-and-forward) aren't a revision: nothing is lost until you write something new, and then the turns ahead are replaced in this session, whatever On revision says. To keep them, branch first.

### Rules options

When a session's rules offer choices (Vis Itineris does; Story offers none), **Rules options** lists them, each with its choices and a line on what the chosen one does. Vis Itineris's are **Degrees of success**, **Actions a turn**, **Bonuses**, **At zero health**, **Holding a spell** and **Casting** (spell slots or spell points). A row of presets sets them all in one click: **Vis Itineris** (the rules as designed) or **Classic** (the reference rules as printed); a session whose choices match no preset says **Custom**.

A change applies at once, from the next turn, without **Save**. Only the session's owner can change them; everyone else in the session sees them. Each session keeps its own choices, and a session that changes its rules and changes back finds its earlier choices again.

### Author's note

A Story session has an **Author's note**: your own note to the model for this session, such as what is true right now or where you want the story to go. Edit it under **Genre settings**, or in the **Author's note** widget beside the conversation: Chat's default layout puts it in the right column as an icon (on a phone, under **Session panels**). A session whose layout you changed, or one opened before the widget was in the default, can add it from the tray (see [Session layout](./session-layout.md#the-widgets)).

- **Note**: the text. Leave it empty to send nothing. `{{char}}` and `{{user}}` work in it.
- **Messages from the end**: how far back it goes. **0** (the default) puts it at the end, right after the newest message and before the reply; **4** puts it four messages earlier. A session that already had a number saved keeps it, and so does a chat imported from SillyTavern.

  At the end, the rest of the prompt stays the same from one reply to the next, so a model server that reuses its previous work (KoboldCPP, for example) only has to read the newest lines again. A note placed further back moves with every new message, and everything after it is read again.
- **Every how many replies**: **1** adds it to every reply; **3** adds it to every third one, counting the AI's lines so far (greetings included).
- **Sent as** (under **Advanced** in the widget): **System**, **User** or **Assistant**.

It isn't the prompt's **Post-history instructions**. Those come with the pipeline and the character card, say how to reply, and wait until the conversation is long enough. The author's note is yours, and goes in from the first reply. When both land in the same place, the author's note comes first and the post-history instructions stay closest to the reply.

Only the session's owner can change it; guests can read it. Saving the session's settings only changes the genre settings you changed there, so a note you saved from the widget while the settings were open stays. If the note wasn't touched in the settings, they show the newer note, and the widget shows a note saved in the settings or in another tab straight away (if you were editing it there, your edit stays). To check whether a reply carried it, open the widget (its last line says what the newest reply did) or the run in the [run inspector](./pipelines.md).

Chat, the Lair and the Guide don't have an author's note.

### Privacy

What this session shows of your own characters and data, and to whom. It's read-only.

### Session data

At the foot of the Settings tab, for the session's owner and administrators. It lists what pipelines keep for this session: for Serene Pub and each plugin, every value it stores, what it is, who can see and change it, and its current value. Press **Refresh** to read it again after a turn.

A text value you're allowed to change has an **Edit** button. That's how you correct something no widget shows, such as the Lair Castellan's scratchpad. A value marked secret is never shown.

To keep a value on screen beside the story, add an **Annex** widget and set its **Key** to the value's owner and key with a dot between, such as `core.retake-quietly` (see [the widgets](./session-layout.md#the-widgets)). It shows only what the person looking may see.

## The session's lorebook

A session can read one [lorebook](./lorebooks.md): its world lore, character lore and history. Choose it under **The story** in the session's settings, or, for a session you own, use **Read into this session** beside the book's name in the Lorebooks view (the first item under **⋯** on a narrow screen); **Stop reading** takes it out. A session reads one book at a time, so switching asks first. The book can be chosen, switched or removed until the story is underway (anything played beyond the greetings, or anything in the session's notes), and a book chosen before then gives the session its rules, if it has rules of its own (a book on Freeform leaves the session's as they are). After that the session keeps its book, and the setting says so; start a new session to read another. A session started from a [starter lorebook](./lorebooks.md#starter-starter lorebooks) has its world in its notes from the first line, so it keeps them from the start: **Share as a lorebook** turns them into a lorebook of yours to keep and build on. See [Reading a book into a session](./lorebooks.md#reading-a-book-into-a-session). Under the lorebook, **Lorebook writes** says how much the session may write to it: the stricter of your own setting and the book's, and which of the two is holding it back when they differ (see [What a session may write](./lorebooks.md#what-a-session-may-write)).

Every session also owns a lorebook of its own, its **Session notes**, from the moment it is made (also when you import a chat, and when you branch). It is born with the Gregorian calendar and no clock set. A session that reads no shared book keeps its clock, scenes and summaries there; one that does read a book keeps its changes there, on top of that book. You never pick it in a list: the Lorebooks view has a **Session notes** section for these books. See [Your session's own notes](./lorebooks.md#your-sessions-own-notes).

Once the session has a clock and scenes, the conversation shows the story's days and scenes. A date marks the first line of each new day in the story (the [story clock](./lorebook-time.md#the-story-clock) when the line was written); click it to open that day's history entry. Dates are written in the lorebook's [calendar](./lorebook-time.md#calendar-and-clock), with its month names (*5 Bloom, Year 412*); a lorebook without one writes them plainly (*Year 412, Mo. 3, Day 5*). A **scene divider** marks where a scene begins: its colour, its name, the day it began and how many lines it holds; point at the count to see who is in it (its cast; on a guest's screen, who speaks in it). The scene still going reads *since* its day and is marked **open**. Scenes summarized the older way, by picking lines, show their history entry's date above them instead. When such a history entry is finished, the line after it reads *Next: ‹date›* if a later entry exists; if none does, **Start a new entry** is in the **⋯** menu of the entry's last scene, for anyone who can open the lorebook.

On a session you own, click a divider's name to rename it. Its **⋯** menu has:

- **End scene** (the open scene, at its newest line) or **Summarize** (a finished scene, in the same review as below; not offered when the session's summaries are **Never**). While a summary waits for your review it reads **Review summary** and opens that review;
- **Open in lorebook**;
- **Move start up one line** and **Move start down one line**, to nudge where the scene begins. You can also drag the divider by its grip and drop it between two lines: the scene then starts at the line below the drop;
- **Reopen scene**, on a finished scene with nothing after it on its channel: it runs on to the newest line again;
- **Remove boundary**, which asks first. A scene with another before it on its channel **joins** that one: its lines become the earlier scene's, its own summary goes, and the earlier scene's summary is kept but marked out of date. The first scene on a channel has nothing to join: its lines stay in the conversation, outside any scene, and the scene leaves the lorebook with its summary.

A finished summary waits for you: the divider says **Ready to review** until you apply or discard it; click it to open the review (see [Summarization](./summarization.md#processing-a-scene)). When a scene's boundaries move, its summary no longer matches its lines. The summary is kept, and the divider says **Summary out of date** until you summarize it again. A refusal (a scene can't overlap another, say) is said under the divider, not as a pop-up. A guest's click on the name opens the scene in the lorebook. **Show scenes and dates** in the Messages widget's settings hides the dates, dividers and suggestions.

### Scenes: start and end them

A scene runs from the line it starts at to the line it ends at, on one channel. Use **Start scene here** and **End scene here** in a message's menu. Starting a scene while another is open ends that one at the line before. **End scene here** follows **How scenes begin** (below): under **Automatic** the next scene starts at the line after; under **Suggested** a *New scene? — the last scene ended* suggestion waits there; under **Manual** the scene just ends. Ending at the newest line, the next line you write takes its place. They're offered on sessions you own, when the genre keeps scenes, and only where they'd work: not inside a finished scene, and not before the open one. A new scene is filed under the history entry the story is in, in the lorebook the session reads or else its **Session notes** (a new day makes a new entry), named *Scene 3* and so on (with the place, in a genre that keeps one: *Scene 3 · the Crypt*), and its cast is proposed from who speaks in it, and kept up to date as new people speak while it's open; nothing here asks the model. Summarize it from its divider when you like.

### When a new scene begins

Under **The story** in the session's settings, **Scenes** decides what happens when a new scene might begin. Its default is the genre's; change it for one session and **Use the genre's settings** puts it back.

- **How scenes begin**: **Suggested** (the default) puts a quiet *New scene? — the day changed* in the conversation, just above the line, with **Yes** (start a scene there; an open scene ends at the line before) and **Not here** (it isn't offered at that line again). **Automatic** starts the scene there itself; you can move or remove the boundary afterwards. **Manual** leaves every scene to **Start scene here** and **End scene here**.
- **Suggest a new scene when** (or **Begin a new scene when**, under Automatic): **The story's day changes** (the [story clock](./lorebook-time.md#the-story-clock) on a line is a later day than on the line before), **Time passes** (**Time passes…**, you moved the clock, you accepted a suggestion that time passed, or Story's **Note what changed** moved the clock with **Move the clock** on and the routine on **Full** (see [What runs between turns](./genre-story.md#what-runs-between-turns)), since the line before; the reply's own clock tick doesn't count), **The place changes** (only in a genre that keeps a place, as [Story](./genre-story.md) and the [Lair](./genre-lair.md) keep the party's **Location**: where the story was when a line was written differs from the line before and from where the open scene began, however it changed: **Note what changed**, your own edit, an accepted suggestion), and, off unless you tick them, **A narrator line is posted**, **The scene reaches** a number of lines, and **A pause in play of more than** a number of real hours. The first three are on by default. A genre can add moments of its own, listed after these and on by default, such as the Lair's **The party reached a new floor**; the suggestion then says it in the same words.
- **Notice when the scene moves on** is one of Story's **Look back over the story** switches (see [What runs between turns](./genre-story.md#what-runs-between-turns)), on by default. It adds one question to that routine's call, so no model is asked for it alone, and it follows how scenes begin. Under **Suggested** the conversation shows the *New scene?* suggestion at the line where the story moved on, with the model's reason after the dash (*the story moved on* when it gave none). Under **Automatic** the new scene begins there. Under **Manual** nothing happens. When the routine is on **Review**, it always asks, even under **Automatic**. It is asked only when all of these hold: the genre keeps scenes and the session may write to its lorebook; the scene mode isn't **Manual**; the open scene holds at least 6 lines (or, with none open, at least 6 lines have come since the last scene ended); there are lines the routine hasn't looked at yet; none of the other triggers above fired in those lines; no suggestion is already waiting; and you haven't just set aside its last suggestion with **Not here**.
- **Summaries**: **On request** (the default) summarizes a scene when you ask, from its divider or the [Chronicle](./session-layout.md#the-widgets); **On close** writes each scene's summary in the background as the scene ends, ready for review in the activity list; **Never** offers no **Summarize** in this session.

None of these asks the model: each is read off what the story already holds. The one exception is **Notice when the scene moves on**, above. The suggestions only appear for the session's owner.

### Where the session reads its lorebook

A lorebook can have [branches](./lorebook-time.md#branches) (lines of the story that part from the main one) and a [calendar](./lorebook-time.md#calendar-and-clock). Once a lorebook is chosen and saved, two settings appear under it:

- **Line**: which version of the lorebook this session reads. **Main** is the original; the others are the lorebook's branches.
- **Story clock**: the in-story date, where this session's story stands in time. **Follow the line's present** moves with the lorebook; **This session's own clock** gives the session a date of its own (a year, and optionally a month, a day and a time of day).

A new session starts on the lorebook's most recently played line, following its present. It gets a clock of its own when you choose one or step it here, or when a pipeline moves the story's time on.

**The clock is the session's own.** Moving it never moves the lorebook's present or any other session's clock, so two sessions on one lorebook can stand years apart. Under the clock, **Step by** minutes, hours, days, months or years, **Forward** or **Back**. A date the lorebook's calendar can't place is refused with the reason, such as *There is no month 13: this calendar has 12.*

In a Story session you own, **Each reply advances the clock by** sits under the clock: **By** and **Unit** move the story on by a fixed amount after every reply (**By** 0, the default, is off; a regenerated or swiped reply doesn't move it again). It applies at once, unlike the rest of the card, and **Reset** puts back what the session's preset says.

The line and clock decide what the session reads: the lore on its line, history dated up to its clock, the lorebook's dated changes that have happened by then, and the stats recorded so far. On a branch, the lines it came from count only up to where it forked.

If the line a session reads is deleted, the session moves to the line it forked from, and a clock later than the fork goes back to it. Guests see the session's line and clock but can't change them.

## Which connection a session uses

A session never picks a connection or a model itself. Each reply runs on the model its pipeline names, or on its [loadout](./connections.md#loadouts) (the **Reply** loadout, for replies) when it names none. To run sessions on a different model, an administrator changes the pipeline's model in **Admin › Pipelines** (for every session of the genre) or a preset's values (for the sessions on that preset). See [Connections](./connections.md#choosing-a-pair) and [Pipelines](./pipelines.md).

While the **Reply** loadout has no model, a session can't reply, and one line above the composer says so, to everyone in it. A member's line reads _No model is set up to reply. Ask your administrator._; an administrator's reads _The Reply loadout has no model._ with **Fill the Reply loadout**, which opens that loadout's sheet in the **Loadouts** view. The line goes as soon as the Reply loadout has a model.

## Pipeline settings in a session

Every reply and action is run by a [pipeline](./pipelines.md). The **Pipelines** section of the Settings tab has a card for each one the session runs: the reply first (*Reply*), then each action. Changes here apply to this session only and save as you make them.

Each card is grouped by **model call**: a block per call, with its name, a sentence on what it does, and its choices:

- **Prompt**: which prompt it sends. The eye button beside it opens every prompt that call offers, with what each one tells the model; pick one to read it, and **Use** to choose it for this session. A read-only prompt has **Read the wording** instead, which opens the same list without **Use**. You choose among the prompts an administrator offers (one hidden in **Admin › Prompts** isn't listed for you); you never edit a prompt's text here. Story's reply also offers its prompt in the derived **Settings**, as **Prompt** on the reply's card.
- **Model**: which model it runs on. Shown to administrators only, read-only, with **Change in Pipelines**.
- **Sampling**: how the model writes (administrators only). The first entry says what you get with nothing chosen; **Reset** goes back to it. This is the only place a session's own sampling is set; a chat that had its own sampling config in 0.5 has it here.
- An **On/Off** switch, for a call that can be skipped (administrators only).

You only see what your role can change: someone who isn't an administrator sees prompts and nothing else, and a pipeline with nothing for you has no card. A setting you could normally change but that's locked right now stays visible, read-only, with a line saying why.

The last card is the pipeline that created the session. Its settings only mattered while creating it, so it's read-only afterwards: *This session has been created; these settings only applied while creating it.*

Everything else about a pipeline (its context template, budgets and retrieval) is set by administrators through **More settings in Pipelines** at the foot of each card. See [Pipelines › Agents](./pipelines.md#agents).

The settings a pipeline opens to its sessions, whoever owns them, are in that pipeline's own card above **Routines**: Story's reply tick (shown under the [story clock](#where-the-session-reads-its-lorebook)), the sprite choice (**Choose sprites**, **Stickiness**, **Minimum similarity**), and the turn order's own settings: who may take a turn (**Characters**, **Personas**, **Envoys**) and how far back a mention counts (**Messages scanned**). Each applies at once; **Reset** goes back to what the preset says. A model, connection, sampling or loadout never appears there.

## Guests

When accounts are on, a session's owner can invite other people: **Add guests** in **Edit session › Participants**, then **Save**. A guest sees the session, writes as their own persona, and can:

- edit and hide their own persona's lines, and delete them where the genre offers Delete;
- attach images and files to their own lines, and take them off again;
- regenerate, extend or swipe replies from characters they own;
- bench their own characters;
- press **Continue** when someone's turn is lined up, and take a turn lined up for their own character;
- select messages for a summary.

Only the owner can change the session's settings, branch it, ask for a Narrator Response, use **Pick who speaks** out of turn, or open the composer's panels. A guest sees a greyed button with the reason rather than nothing. See [Users and accounts](./users-and-accounts.md) and, for the exact rules, [Session actions](./session-actions.md#who-may-use-it).

To see who else has the session open, and who is typing, add the **Who's here** widget (see [Session layout](./session-layout.md)).

## The composer's panels

The composer's **More** menu opens a panel in place of the text box, with **Back to compose** to return. Guests don't get these.

### Lore

Offered when the session reads a lorebook. Test what the next reply would pull in from the lorebook for the message you're writing, and see which entries have come up in this session so far.

The session's history and scenes are in the **Chronicle** widget (see [Session layout](./session-layout.md#the-widgets)): where the story stands, the history entry the session is in with its scenes, **Start new history entry**, **Summarize scene**, **Extend graph** and the earlier entries.

To show a character's picture beside the conversation, use the **Scene Portraits** widget: its **Picture** setting can show an image chosen from the character's gallery (see [Session layout](./session-layout.md#scene-portraits)). Pictures you pinned in an earlier version move into Scene Portraits the first time you open the session.

### Statistics

Offered when an administrator has turned on context debugging (in [Admin › Pub › Diagnostics](./system-settings.md#diagnostics)). It shows how many tokens your draft's prompt uses and how many messages fit, with **Details** to open **Prompt Details**:

- **Token budget**: the total against the limit, and why anything was cut.
- **Messages**: which messages were included and which left out.
- **Retrieval**: every piece of lore considered, kept or left out, and why.
- **Sources**: which characters, personas and scenario went in.
- **Prompt preview**: the prompt itself.

With context debugging on, a thin bar along the top of the composer fills as the prompt nears the limit. Past it, a line says *This draft pushes the prompt past the context limit. Older turns will be trimmed.*

## Sprites

When a character has [sprites](./characters.md#sprites) (faces for different moods), a session can show the face that fits each line.

- **Chosen automatically.** After a character's reply is saved, Serene Pub compares the reply's text with the character's sprite labels and picks the closest. Every genre's reply does this, the Lair's delvers included; a narrator's line has no face to choose. This uses the model in the **Embeddings** loadout, not the reply's model: on this device for a local model, or one request per reply to an online one. With the Embeddings loadout empty, or when nothing fits, the line keeps the face it had.
- **Settings.** The choice has three settings on the reply pipeline's sprite step: **Choose sprites** turns it off (no embedding request is made then), **Stickiness** sets how much better a new face must fit before it replaces the last one, and **Minimum similarity** how close a line must be to any face. The session's owner changes them for one session under **Step settings** in its settings (they apply at once); an administrator sets them for everyone in **Admin › Pipelines**.
- **Pick one yourself.** **Change sprite** in a message's menu lets anyone who can edit that line pick its face, or none. The automatic choice never overrides yours.
- **Swipes.** Each version of a message keeps its own face.

Faces show in the **Scene Portraits** widget (with **Picture** set to **Current sprite**, its default), beside each line in the **Messages** widget when **Face beside each line** is set to the line's sprite, and in the session's header.

**Another outfit for this session.** On a Scene Portraits face, the sprite-set menu shows the character in another of their card's sets, for this session only. It's there when the card has more than one set, for the session's owner and the character's owner.

## Search by meaning notice

When an [embedding model](./embeddings-and-rag.md) is set up, a quiet line can appear in the composer's bottom row in a longer session, saying the session's lorebook isn't fully indexed for **Search by meaning** yet. It shows as a line the first time you open the session; after that it's a small warning icon beside **Attach** (press it to read the line again), and **×** on the line turns it into the icon at once. An administrator can press **Re-index now** when the entries need re-indexing, or **Prioritize in queue** to move this session to the front; **Hide for this session** hides it for everyone (owner only). It goes by itself once every entry is indexed. See [Understanding indexing notices](./embeddings-and-rag.md#understanding-indexing-notices).

## Troubleshooting

:::warning Nobody replies after I send
- The **Reply** loadout may have no model yet. Then one line sits above the composer: _Sessions can't reply yet. No model is set up to reply. Ask your administrator._ An administrator sees _The Reply loadout has no model._ and **Fill the Reply loadout** there instead, which opens that loadout's sheet in **Loadouts** (see [Connect a model](./connect-a-model.md)).
- In a group session, **Auto-advance** may be **Off**, or the turn-order strategy **Manual**. Press **Continue** or **Pick who speaks**. See [Group sessions](./group-sessions.md#auto-advance).
- The *ready to continue* line hides while you have a draft or are editing a message.
- The session may have no active character: check the switches under **Participants**.
:::

:::warning I can't regenerate, extend or swipe
These work on the newest reply only, never on your own line, and not while anything is being written. As a guest, only on characters you own. A greyed button's tooltip says which.
:::

:::warning I can't attach an image, a PDF or a sound
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
Long sessions load 25 messages at a time for each channel, so a story beside a busy dice log or a Planner channel still opens on its own newest 25. Scroll to the top of a log to load more of the channel it shows.
:::

## Related

- [Group sessions](./group-sessions.md): turn order, Continue and the narrator.
- [Genres](./genres.md): Chat, Story, the Lair, Dungeon Crawler and the Guide.
- [Characters](./characters.md) and [Personas](./personas.md): who takes part.
- [Lorebooks](./lorebooks.md): the world a session reads.
- [Session layout](./session-layout.md): arranging the session screen.
- [Images](./images.md): the Image and Scene actions, and backdrops.
- [Session actions](./session-actions.md): how actions and permissions work, for power users.
