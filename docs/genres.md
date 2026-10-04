# Genres

A genre is the kind of session you're playing: it decides who takes part, what happens on each turn, and which buttons the session offers.

:::tip What it's for
- Choosing the right kind of session when you start one: a plain conversation, a narrated adventure, a dungeon you build, or help with the app.
- Understanding why two sessions offer different buttons and settings.
:::

## The basics

You pick a genre on the start screen, and it stays with the session for its whole life. Serene Pub comes with four:

| Genre | What it is | Needs | Model calls per turn |
| --- | --- | --- | --- |
| **Chat** | Talk with one or more characters. The default. | A character to talk to. A lorebook if you like. | One per reply |
| **[Adventure](./genre-adventure.md)** | A narrated world: a narrator describes each scene, your cast speak for themselves, and stats and items change as you play. | A lorebook, at least one character and a persona. | Several |
| **[The Lair](./genre-lair.md)** | You are the dungeon. An AI party explores the rooms you build. | A lorebook and at least one character (the party). | Several |
| **Guide** | Ask questions about Serene Pub itself. | Nothing. | One |

More genres come from [plugins](#genres-from-plugins).

Alongside a genre you pick a **preset**: a bundle an administrator has set up for that genre, which decides exactly what runs on each turn and which actions come along. Most installs have one preset per genre, picked for you.

## Chat

Chat is the genre a new install starts you in, and it's the frugal one: one call to the model per reply, no setup beyond a character and a persona, and a lorebook only if you want one. Nothing elaborate runs on its own. Anything multi-step is a button you press.

- **Who speaks.** With one character, they reply to every message you send. With several, the turn order decides; see [Group sessions](./group-sessions.md).
- **Actions.** **Narrate** (have a narrator describe what happens next), **Side character** (someone you name speaks a line, whether or not they're in the cast) and **Image** (generate a picture, when an image model is set up). See [Narrator Response](./group-sessions.md#narrator-response).
- **Settings.** **Auto-advance**, **Who speaks next is decided by** and **Character detail**, all explained in [Group sessions](./group-sessions.md), and the **Author's note**, explained in [Sessions](./sessions.md#authors-note).

The one way to make Chat spend more than one call a reply is to let **the model** decide who speaks next, which adds one call per turn.

## Guide

Guide is a question-and-answer session about the app itself. There are no characters and no story: you ask, and **Serene**, Serene Pub's mascot, answers from this documentation. She is calm and warm, and she isn't a character: you won't find her in the Characters view, and she never roleplays. You may write as yourself or as one persona.

Start one by picking the **Guide** genre on the start screen, or **Talk to an AI** in the setup wizard, which starts one called *Welcome to Serene Pub*. Every new Guide session opens with Serene's greeting: *Hi, I'm Serene, your guide to Serene Pub. What would you like to talk about? How can I help you?*

**How she knows the docs.** Serene can't browse. Each time you ask, Serene Pub searches this documentation (these pages and the plugin-author guides) for the sections that match your question and hands Serene those excerpts. She's told to answer only from them and to end with the page she used, so every link she gives is a real page. When nothing matches, she says *I couldn't find that in the docs.* rather than guessing. A follow-up like *are you sure?* still finds the pages your earlier question was about.

**Your own notes.** A Guide session can read a lorebook. Entries whose keywords come up in the conversation are handed to Serene beside the docs, as your own reference notes, so you can tell her how your own setup is arranged. She never writes to the lorebook.

:::note Admins only
What Serene is told is part of the Guide's pipeline settings: open the Pipelines view and edit the **System prompt** on the Guide's reply. The change reaches the next answer.
:::

## Genres from plugins

Every genre beyond the four above comes from a plugin. Once an administrator has installed the plugin and enabled its preset, its genre appears on the start screen beside the built-in ones. Serene Pub's showcase plugins, such as **Whodunit** (a case, a room of suspects and you as the detective) and **Writing Room** (co-writing a manuscript with a companion), each document themselves in their own README.

## Envoys

An **envoy** is a speaker a genre brings with it: someone who takes part in the session but isn't in your character library. The Guide's **Serene** is one, and the Lair's Castellan is another. A plugin's action can bring one too, such as a dice roller that reports as "the Dice Master".

- **Seating.** A new session seats the genre's default envoys automatically. In **Edit session › Participants**, the **Envoys** card lists the genre's envoys, each marked **Replies in turn** or **On action**, with a switch to seat or unseat it. Only the session's owner can change it. An envoy an action brings is seated the moment its action posts. A branch keeps the seats its source had.
- **Turns.** An envoy that **replies in turn** takes turns like a character. One that speaks **on action** only posts when its action runs. If a session has nobody to answer, sending a message tells you so: *This session has no one to answer — seat an envoy in Session settings.*
- **Messages.** An envoy's reply shows the name and picture the genre gave it. It has no character page. Regenerate, Extend and Swipe work on it as on any reply, and only the session's owner can edit or delete it.
- **Everyone has a name.** No line is shown as *Unknown*. A line a pipeline writes without saying who speaks belongs to the genre's main envoy (the Guide's **Serene**, the Lair's **Castellan**), or, in a genre without one, is shown under the narrator's name.

:::note Admins only
An envoy's words are its pipeline's settings: the **System prompt** and **Post-history instructions** of the agent that speaks for it, in the Pipelines view. Clear a field to go back to what the genre ships.
:::

## Related

- [Sessions](./sessions.md): starting and playing any session.
- [Group sessions](./group-sessions.md): turn order in Chat.
- [Adventure](./genre-adventure.md) and [The Lair](./genre-lair.md): the two narrated genres.
- [Pipelines](./pipelines.md): what a preset binds, for administrators.
