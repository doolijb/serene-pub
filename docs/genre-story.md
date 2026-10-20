# Story

Story is the genre for playing with characters: your characters and personas in a room with you, from a quiet conversation with one companion to a living world that keeps itself as you play. It is the everyday genre, and the one a new install starts you in.

:::tip What it's for
- Talking with one or more characters, as yourself or as a persona.
- Stories where the world keeps itself: time passes, places change, stats and belongings move, and the lorebook fills in behind you.
- Games played by rules, with dice or without, when you choose a ruleset.
:::

## The basics

Pick **Story** on the start screen, then a **preset**. The preset is the one choice that decides what a turn costs and what happens around each reply; everything else is optional.

| Preset | What it does | Model calls per turn |
| --- | --- | --- |
| **Minimal** | One reply per turn. Nothing moves unless you move it. Nobody is required: start with no characters and no persona if you like. | 1 |
| **Living** (the default) | The world keeps itself, in words. After each reply one more call reads what happened and writes it down: time, place, health, belongings, conditions. Every few turns a batched call sweeps the history into summaries, lore and the cast. | 2, plus one sweep every few turns |
| **Rule Based** | The ruleset's rules decide, in words where it has none. The same two calls as Living; the rules resolve what they can for free. With no ruleset chosen it plays as Living, and the form says so. | 2, plus one sweep every few turns |

Each card says its number. You can switch presets later under **Edit session › Settings › Preset**; it applies at once. Change a setting the preset decides and the session reads **Custom**, with **Back to** the preset beside it.

### Who is in it

- **Characters**: none, one or many. With several, the turn order decides who speaks: see [Group sessions](./group-sessions.md).
- **You**: write as yourself, under your own name, or pick a persona. No persona is chosen for you.
- **A lorebook**, if you like: the world's places, people, history and rules live there, and on Living and Rule Based the session writes back into it.
- **Rules**, if you like: **Freeform** (no numbers, words only) is the default. Pick another ruleset and the form rates how well it fits Story: **Perfect**, **Great**, **Good**, **Ok**, **Poor** or **Incompatible**, with a line saying why. An administrator can open **Why?** beside a choice to see the whole examination.

## What happens around a reply

Open **Edit session › Settings › What happens around a reply** to see what the preset switched on. Every task has three modes: **Full** (it runs and its changes apply), **Review** (it runs and its changes wait for you to accept them), **Off**. They are grouped by when they run:

- **In the reply**: read into the reply as context, at no extra cost. **Read the lorebook** (Off: no lorebook entry reaches the reply); **Read the scene** (the place the story is in, what it is like and the ways out, when the world's location names a place in the lorebook).
- **After each turn**: one extra call after the reply, when anything here is on. Stats and belongings, time passing, conditions put on and taken off. On **Review**, every change, belongings and conditions included, waits for you as a proposal. An item the lorebook keeps as one-of-a-kind is never handed out twice. **Wait for everyone's reply** holds it until the whole round has spoken.
- **Every few turns**: one batched call every N turns, or after each scene. Summaries, lore, the cast, the world's state, scenes, goals (a checklist: a goal is ticked when the story reaches it). **Track relationships** files how the characters stand on the lorebook's **Graph** review screen, for you to look over and apply; only characters the graph already knows are linked. Pick how often at the top of the group.
- **When something happens**: **Picture each new scene** fires the Scene action when a scene opens (only when an image model is set up); **Describe new places** files the place the story moved to, with its ways out to places the lorebook knows, as part of the after-turn call; **End what runs out** ends conditions and effects when their time is up (Off: nothing timed counts down; Review: the ending waits for you); **Mark goals reached** says so in the story and tells everyone in the session when a goal in the goals note is ticked.
- **Extra voices**: after everyone has had their turn, **Let others speak up** lets one more character speak (one who did not speak last), and **Narrator asides** lets the narrator add a line. Each adds at most one reply a round, and only with **Auto-advance** on **Round** do they speak by themselves; otherwise their turn waits at the head of the order for a **Continue**.

To run a task less often, set its **How often**: after each turn, with the others every few turns, every N turns, or after each scene. You can also drag it by its handle into a bucket under **Every few turns**, or press **Add a bucket** for a frequency of your own.

On Minimal every task is off except **Read the lorebook**, which costs nothing and keeps a story's lorebook in its replies. On Living and Rule Based the lorebook writes are **Full**; set them to **Review** to see each change before it lands.

## Actions

Story's composer offers **Narrate** (a narrator describes what happens next), **Side character** (someone you name speaks a line), **Image** (a picture, when an image model is set up), **Look**, **Rest**, **Time passes…**, and **Ask** and **Answer** for questions put to a character. A preset may leave some out; see **Edit session › Settings › Actions**.

## Story settings

**Auto-advance**, **Who speaks next is decided by** and **Character detail** are explained in [Group sessions](./group-sessions.md); the **Author's note** in [Sessions](./sessions.md#authors-note). **Tone** and **Difficulty** sit under **Advanced**: the first colours how the narrator writes, the second how hard the world pushes back when the rules resolve a check.

## Running it cheaply

Minimal costs exactly what [Chat](./genres.md#chat) costs: one call per turn. Living adds one. If a model is slow, drag the after-turn tasks into a bucket that runs every few turns, or switch the sweep to **After each scene**.

## Related

- [Genres](./genres.md): the five kinds of session.
- [Group sessions](./group-sessions.md): several characters at once.
- [Stats and states](./stats-and-states.md): the sheet, the ledger and proposals you can accept or refuse.
- [Lorebooks](./lorebooks.md): the world the session reads and writes.
