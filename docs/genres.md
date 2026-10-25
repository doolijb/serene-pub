# Genres

A genre is the kind of session you're playing: it decides who takes part, what happens on each turn, and which buttons the session offers.

:::tip What it's for
- Choosing the right kind of session when you start one: a plain conversation, a narrated adventure, a dungeon you build, or help with the app.
- Understanding why two sessions offer different buttons and settings.
:::

## The basics

You pick a genre on the start screen, and it stays with the session for its whole life. Each genre is one row with a line saying what it is; the chosen row adds who it takes (_characters · a character you play · lorebook optional_) and **More**, which reads who is in the room, who drives, what a turn costs and when to pick a sibling instead. Serene Pub comes with five:

| Genre | What it is | Needs | Model calls per turn |
| --- | --- | --- | --- |
| **[Chat](#chat)** | The model as itself: a plain assistant, no characters, no story. Give it tools to search the web, read your lorebooks and make images. | Nothing. | One, plus the tool calls it asks for |
| **[Story](./genre-story.md)** | Your characters and personas in the room with you, from a quiet conversation to a living world. The everyday genre, and the default. | Nothing on **Minimal**. Characters, a lorebook and rules if you like. | One, or two plus a look back every five turns, by preset |
| **[The Lair](./genre-lair.md)** | You are the dungeon and its game master. An AI party, and any friends who take a seat, explore the rooms you build; the rules decide the risky moments, and you call the checks. | At least one character (the party). A lorebook for the dungeon is up to you. | One, plus one for each delver who speaks, by preset |
| **[Dungeon Crawler](./genre-dungeon-crawler.md)** | The AI is the whole Dungeon Master. Make a character and play your part in a world it generates, alone or with friends. | Nothing. A persona and companions if you like. | Several |
| **[Guide](#guide)** | Ask questions about Serene Pub itself. | Nothing. | One |

More genres come from [plugins](#genres-from-plugins).

Alongside a genre you pick a **preset**: a starting recipe for that genre, which decides what runs on each turn, what runs on its own between turns, and which actions come along. Each genre has its own defaults, and a preset is a set of changes on them (see [Pipelines › What runs, and when](./pipelines.md#what-runs-and-when)). Story, Chat and the Lair show a choice; the other genres have one preset, picked for you. Star a genre on its card to make it your usual start, and star a preset to have it chosen for you; see [Start a session](./sessions.md#start-a-session).

## Chat

Chat is the model as itself: a plain assistant with no characters, no persona and no story. You write, it answers. It has two presets:

- **Basic**: the raw model, one call per turn, no tools. Works with any model.
- **Agentic**: the model may call **tools** mid-reply: search the web and read a page, search and read your lorebooks, **write to a lorebook** (file an entry, keep or take back a note), **make a picture** (posted in the conversation, when an image model is set up), read the clock, do arithmetic, look back through this session. Each tool call is one more model call, up to a few per turn, and every call shows as a line in the session. Pick which tools are on under **Edit session › Settings › Tools**.

Attach a lorebook and Chat reads it (**Read the lorebook**, in the reply's card under **Edit session › Settings**; off, nothing from it reaches the reply). **Remember things** is a routine, Off until you turn it on under **Edit session › Settings › Routines**: then every five turns Chat notes what you told it, and on Agentic it can keep and take back notes when you ask. The notes go into the lorebook you attached when it is yours and its lorebook writes are **Full** (your living memory bank), otherwise into this session's own notes, made the first time. **Full** files them at once; **Review** holds each note for you (a tool's note waits in the session's own notes for you to add to your lorebook). Chat is yours alone: it can't be shared with guests.

## Story

Story is the genre for playing with characters, and the one a new install starts you in: see [Story](./genre-story.md). What used to be the **Chat** genre is Story's **Minimal** preset; sessions from earlier versions moved there by themselves.

## Guide

Guide is a question-and-answer session about the app itself. There are no characters and no story: you ask, and **Serene**, Serene Pub's mascot, answers from this documentation. The Guide is yours alone: it is never shared with guests. She is calm and warm, and she isn't a character: you won't find her in the Characters view, and she never roleplays. You may write as yourself or as one persona.

Start one by picking the **Guide** genre on the start screen, or **Talk to an AI** in the setup wizard, which starts one called *Welcome to Serene Pub*. Every new Guide session opens with Serene's greeting: *Hi, I'm Serene, your guide to Serene Pub. What would you like to talk about? How can I help you?*

**How she knows the docs.** Serene can't browse. Each time you ask, Serene Pub searches this documentation (these pages and the plugin-author guides) for the sections that match your question and hands Serene those excerpts. She's told to answer only from them and to end with the page she used, so every link she gives is a real page. When nothing matches, she says *I couldn't find that in the docs.* rather than guessing. A follow-up like *are you sure?* still finds the pages your earlier question was about.

**Your own notes.** A Guide session can read a lorebook. Entries whose keywords come up in the conversation are handed to Serene beside the docs, as your own reference notes, so you can tell her how your own setup is arranged. She never writes to the lorebook.

:::note Admins only
What Serene is told is part of the Guide's pipeline settings: open **Admin › Pipelines** and edit the **System prompt** on the Guide's reply. The change reaches the next answer.
:::

## Genres from plugins

Every genre beyond the five above comes from a plugin. Once an administrator has installed the plugin and enabled its preset, its genre appears on the start screen beside the built-in ones. Serene Pub's showcase plugins, such as **Whodunit** (a case, a room of suspects and you as the detective) and **Writing Room** (co-writing a manuscript with a companion), each document themselves in their own README.

## Making a genre of your own

**Admin › Session genres › Add genre** makes a genre in the app. You pick an owner slug once (`acme.lab`): every id the genre and its pipelines get lives under it, and it never changes. Then a name, a label, and what to start from: a copy of Chat, Story, Guide or the Lair, either everything that genre runs or just its create pipeline. The copy publishes the pipelines under your slug with the genre rewritten, registers them in the new genre's defaults with a default preset, carries the genre's layout across, and the genre is playable at once.

The genre's page then shows a **readiness** list in the order that works: name, session fields, create pipeline, reply pipeline, default preset, state, layout, other events, export. Gold until set, green when done; only the next line carries a button. The same page edits the genre's name and family, its **session fields** (what a session asks for when it starts, with a live preview of the form), and **events**: which pipeline runs on each. What else its sessions run, and the presets people pick from, are edited in **Admin › Presets**. Pipelines themselves are edited on their own pages' Canvas tab.

A genre Serene Pub or a plugin ships stays as written. Copy it to change it.

### Bundling it

**Export as plugin…** on the genre's page writes a zip in the plugin package layout: the genre, its pipelines as documents, its presets, layouts, and any frames. Another pub installs it from **Admin › Plugins › Install a package…**. Both need plugins switched on (`SP_PLUGINS_ENABLED`). A package cannot be installed on the pub that still has the genre it was exported from: its owner name belongs to your in-app work there, and the install is refused rather than taking those pipelines over. The package carries no code, so it installs its declarations and nothing runs in a sandbox; anything that needs code — a node with storage or network, a custom event, a Svelte widget — is a plugin built with the SDK.

Tick **Include the source** in the export dialog to get that plugin's starting point: the same package plus a `src/` folder, `package.json` and a README, which `npx serene-pub build .` turns back into the same package. The pipelines stay as the documents the pub saved, and the genre and presets as data. What a pub never stores — the code behind a plugin's own node, for one — is listed in the README under *What is left for you to write*, and in the export's warnings.

The package also lists the Serene Pub events its pipelines answer, such as a reply to a message. A pub on an older Serene Pub that lacks one refuses the install and says the package needs a newer Serene Pub.

## Envoys

An **envoy** is a speaker a genre brings with it: someone who takes part in the session but isn't in your character library. The Guide's **Serene** is one, and the Lair's Castellan is another. A plugin's action can bring one too, such as a dice roller that reports as "the Dice Master".

- **Seating.** A new session seats the genre's default envoys automatically. In **Edit session › Participants**, the **Envoys** card lists the genre's envoys, each marked **Replies in turn** or **On action**, with a switch to seat or unseat it. Only the session's owner can change it. An envoy an action brings is seated the moment its action posts. A branch keeps the seats its source had.
- **Turns.** An envoy that **replies in turn** takes turns like a character. One that speaks **on action** only posts when its action runs. If a session has nobody to answer, sending a message tells you so: *This session has no one to answer — seat an envoy in Session settings.*
- **Messages.** An envoy's reply shows the name and picture the genre gave it. It has no character page. Regenerate, Extend and Swipe work on it as on any reply, and only the session's owner can edit it (or delete it, where the genre offers Delete).
- **Everyone has a name.** No line is shown as *Unknown*. A line a pipeline writes without saying who speaks belongs to the genre's main envoy (the Guide's **Serene**, the Lair's **Castellan**), or, in a genre without one, is shown under the narrator's name.

:::note Admins only
An envoy's words are its pipeline's settings: the **System prompt** and **Post-history instructions** of the agent that speaks for it, in **Admin › Pipelines**. Clear a field to go back to what the genre ships.
:::

## Related

- [Sessions](./sessions.md): starting and playing any session.
- [Group sessions](./group-sessions.md): turn order in Chat.
- [Story](./genre-story.md), [The Lair](./genre-lair.md) and [Dungeon Crawler](./genre-dungeon-crawler.md): the genres with a world in them.
- [Pipelines](./pipelines.md): what a preset runs, and routines, for administrators.
