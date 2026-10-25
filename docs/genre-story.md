# Story

Story is the genre for playing with characters: your characters and personas in a room with you, from a quiet conversation with one companion to a living world that keeps itself as you play. It is the everyday genre, and the one a new install starts you in.

:::tip What it's for
- Talking with one or more characters, as yourself or as a persona.
- Stories where the world keeps itself: time passes, places change, stats and belongings move, and the lorebook fills in behind you.
- Games played by rules, with dice or without, when you choose some.
:::

## The basics

Pick **Story** on the start screen, then a **preset**. The preset is the one choice that decides what a turn costs and what runs on its own between turns; everything else is optional.

| Preset | What it does | Model calls per turn |
| --- | --- | --- |
| **Minimal** | One reply per turn. Nothing moves unless you move it. Nobody is required: start with no characters and no persona if you like. | 1 |
| **Living** (the default) | The world keeps itself, in words. After each round one more call reads what happened and writes it down: time, place, health, belongings, conditions. Every five turns a batched call looks back over the story and files summaries, lore and the cast. | 2, plus one look back every five turns |
| **Rule Based** | The session's rules decide, in words where they have nothing to say. The same two calls as Living; the rules resolve what they can for free, and **How strict** stays at **The rules decide**. With no rules chosen it plays as Living, and the form says so. | 2, plus one look back every five turns |

Each card says its number, worked out from what the preset runs. A preset may ask a question or two before you start (**Before you start**), such as the **Tone**. You can switch presets later under **Edit session › Settings › Preset**; it applies at once.

### Who is in it

- **Characters**: none, one or many. With several, the turn order decides who speaks: see [Group sessions](./group-sessions.md).
- **You**: write as yourself, under your own name, or pick a persona. No persona is chosen for you.
- **A lorebook**, if you like: the world's places, people, history and rules live there, and on Living and Rule Based the session writes back into it.
- **Rules**, if you like: **Freeform** (no numbers, words only) is the default. Pick other rules and the form rates how well they fit Story: **Perfect**, **Great**, **Good**, **Ok**, **Poor** or **Incompatible**, with a line saying why. An administrator can open **Why?** beside a choice to see the whole examination.

### What it keeps

Story keeps no stats of its own: the session's **rules** say what its characters, world and places carry (see [Stats and states](./stats-and-states.md)). Story **plays best with** a health-like number, a mood word, what ails someone and somewhere to keep what they carry; rules without some of them play those in words, and the Rules card says which and why. Under **Freeform** the sheet says _This session's rules declare no attributes_, and the prompt carries no health or mood line at all. Serene Pub itself keeps **where the scene is** and the **story clock**: a **Where and when** row on the sheet, read by the model as place and time. It also keeps **what someone carries** (each character's **Inventory**, what lies about in the world and in each place) as a list under the sheet, where **Note what changed** hands out the lorebook's items; it is never one of the rules' attributes.

## What runs between turns

Besides the reply, Story has four **routines**: pipelines that run on their own between turns. Open **Edit session › Settings › Routines** to see them. Each says what it does and **When it runs**, and has three modes: **Off** (it doesn't run), **Review** (it runs, and what it would change waits for you to accept) and **Full** (it runs and its changes apply).

| Routine | When it runs | On Living and Rule Based | On Minimal |
| --- | --- | --- | --- |
| **Note what changed** | After each round: once everyone has had their turn (in a session with one character, after each reply). Its **When it runs** can be switched to **After each turn**. | Full | not run |
| **Look back over the story** | Every 5 turns | Full | not run |
| **Picture each new scene** | When a scene opens | Off | not run |
| **After a rest** | When the session's rules' own **Rest** is taken | Full | Full |

Each routine waits until the reply and everything it set off have finished, so it never slows the reply down. The session's owner can run one by hand: pick it under **Routines** in the composer's actions. See [Pipelines › Routines](./pipelines.md#routines) for what every routine shares.

What each one does, and the switches it offers in its own card in the same Settings tab:

- **Note what changed** reads the finished reply and notes what it made true, in the session's rules' own terms: a value or a kind of entry the rules keep (a pool, a condition, something carried) goes through the rules, and the place is written in words. It never rolls anything: the reply has already said how things went. Its switches: **Keep the sheets** (whatever the rules keep, belongings and the place), **Track conditions** (hurt, tired, poisoned, inspired), **Move the clock** (by as much time as the story took), **Describe new places** (files the place the story moved to, with its ways out to places the lorebook knows) and **End what runs out** (ends conditions and effects when their time is up; off, nothing timed counts down). On **Review**, every change, belongings and conditions included, waits for you as a proposal. An item the lorebook keeps as one-of-a-kind is never handed out twice.
- **Look back over the story** files what is worth keeping, in one batched call. Its switches: **Summarize the story**, **Add to the lore**, **Note new people**, **Keep the world** and **Notice when the scene moves on** (on; it looks over the lines since the last look for where the story moved on to a new scene, and suggests one there — or starts it, when this session’s scenes are Automatic: see [How scenes begin](./sessions.md#scenes-start-and-end-them)), and **Track relationships** (proposes how the characters stand, on the lorebook's **Graph** review screen, for you to look over; only characters the graph already knows are linked), **File the places**, **Track goals** (a checklist: a goal is ticked when the story reaches it) and **Mark goals reached** (says so in the story and tells everyone in the session), which are off unless you switch them on.
- **After a rest** moves the story clock on by the rest the session's rules say was taken, after their own **Rest** (see [Actions](#actions)). It makes no model call, and does nothing under rules with no **Rest** of their own.
- **Picture each new scene** turns the last few lines into a picture when a scene opens. It needs a model that draws: on a pub without one it never runs, and its row says _Unavailable: needs a model that can draw pictures._ until an administrator sets one.

**When it runs.** **Note what changed** runs after each round unless you pick **After each turn** on its row in **Settings › Routines**: after each round notes a whole exchange at once; after each turn notes every line, which costs a model call per line.

**Turns and rounds.** Every line in the story is a turn, by whoever said it: you, another person, a character or the narrator. A round ends once everyone taking part has had a turn: everyone the turn order seats or has lined up, and every person who spoke. In a session with one person and one character, that is every exchange.

The reply has switches of its own, in its card (**What the reply reads**): **Read the lorebook** (off, no lorebook entry reaches the reply) and **Read the scene** (the place the story is in, what it is like and the ways out, when the world's location names a place in the lorebook). Both cost nothing extra. A session without a lorebook skips everything that writes to one, whatever the mode.

**Replies carry changes** (off) is the reply's third switch. On, the reply answers with its words and, beside them, what the scene changed (a value up or down, something gained or lost, how one person now feels about another on their side of a tie), and the rules apply those changes straight away: the switch is the reply's own, so they no longer wait on how **Note what changed** is set. While it is on, **Note what changed** leaves **Keep the sheets** and **Track conditions** to the reply, so nothing is counted twice (the run's record says _off: replies carry changes_ beside each); **Move the clock**, **Describe new places** and **End what runs out** carry on as set. Only what the session's [rules](./rulesets.md#replies-that-carry-changes) track can change; anything else is refused and named. The reply's words don't stream while it is on: they arrive whole. On or off, the same steps save the reply, choose its sprite and move the clock, so each shows once in the session's settings. Swiping, regenerating or deleting the reply takes its changes back with it (see [Regenerate, Extend and Swipe](./sessions.md#regenerate-extend-and-swipe)).

**Extra voices** are Story settings: after everyone has had their turn, **Let others speak up** lets one more character speak (one who did not speak last), and **Narrator asides** lets the narrator add a line. Each adds at most one reply a round, and only with **Auto-advance** on **Round** do they speak by themselves; otherwise their turn waits at the head of the order for a **Continue**.

An administrator can also change when a routine runs in one session (such as **Every how many turns**, under its **Cadence** fold), or for every session on a preset in **Admin › Presets**.

## Actions

Story's composer offers **Narrate** (a narrator describes what happens next), **Side character** (someone you name speaks a line), **Image** (a picture, when an image model is set up), **Look**, **Rest**, **Time passes…**, and **Ask** and **Answer** for questions put to a character. A preset may leave some out; see **Edit session › Settings › Actions**. What you press is your own decision: **Rest**'s changes apply at once, whatever **Note what changed** is set to. **Rest** asks what resting brings back; when the session's rules say what a rest restores (an **Energy** or a **Nerve** they mark so), it names those. **Image** and **Scene** need a model that draws; without one they are unavailable and say so. Rules with actions of their own (a card game's **Draw**) add them here. When the rules have a **Rest** of their own, the composer offers theirs in place of Story's, so there is never a second **Rest** button; the rules' actions always apply. After the rules' **Rest**, the story clock moves on by the rest they say it takes (a night's sleep, an hour's breather) and the change shows under the message; rules that keep no rest, or one with no length, leave the clock where it is. This is the routine **After a rest**, listed under **Routines**.

**Prompt.** The reply's card in **Settings** lets you choose which prompt the reply writes from, among the ones an administrator offers. You choose the prompt, never edit its text.

## Story settings

**Auto-advance**, **Who speaks next is decided by** and **Character detail** are explained in [Group sessions](./group-sessions.md); the **Author's note** in [Sessions](./sessions.md#authors-note). **Tone** and **Difficulty** sit under **Advanced**: the first colours how the narrator writes, the second how hard the world pushes back when the rules resolve a check. **Let others speak up** and **Narrator asides** are above, under [What runs between turns](#what-runs-between-turns).

## Running it cheaply

Minimal costs exactly what [Chat](./genres.md#chat) costs: one call per turn. Living adds one a round. If a model is slow, set **Note what changed** to **Off** and let **Look back over the story** catch up every few turns, or ask an administrator to run it less often.

## Related

- [Genres](./genres.md): the five kinds of session.
- [Group sessions](./group-sessions.md): several characters at once.
- [Stats and states](./stats-and-states.md): the sheet, the ledger and proposals you can accept or refuse.
- [Lorebooks](./lorebooks.md): the world the session reads and writes.
