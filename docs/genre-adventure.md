# Adventure

Adventure is a narrated world: a narrator describes each scene, your cast act and speak on their own, and their health, mood and belongings change as you play.

:::tip What it's for
- Playing a character in a world that reacts: places, weather, time of day, items that change hands.
- Stories where you want a narrator as well as characters, with the bookkeeping done for you.
:::

## The basics

Adventure is the opposite trade from [Chat](./genres.md#chat). A Chat turn is one call to the model; an Adventure turn is four model calls in a row, each doing one job, and it asks more of your setup in exchange.

:::note You'll need
- **A lorebook.** The world lives in it: its places, the items people carry, its history. See [Lorebooks](./lorebooks.md).
- **At least one character** and **at least one persona** (who you play).
- A model you're comfortable calling several times a turn. A local model you don't pay per message is a good fit.
:::

### Start an adventure

1. Start a session and pick the **Adventure** genre.
2. Choose your characters, who you play as, and a lorebook, then press **Start**.
3. Each character's greeting from their card is added, but there's no opening narration yet. Press **Look** in the **Actions** row to have the narrator describe where you are.
4. Write what you do and send it.

:::tip You should see
A progress card above the composer names each step as it runs (plan, scene, one per speaking character, keep state). Then one reply appears: the narration, followed by each character who speaks. Any stat changes wait under it with **Accept** and **Reject**.
:::

### What's on the screen

- **Above the story**, a strip titled *World State*: where you are, the time of day and the weather, as one line (the world's stats).
- **Down the right**, open: **Scene Portraits**, everyone in the scene as their sprite with their health bar under it, then **Stats**, the party's cards.
- **Down the left**, as icons until you click one: the **Chronicle** (where the story stands on the lorebook's timeline, its history entries and scenes) and **Lore entries** (what the lorebook holds and how often each entry was read).

**Places**, **Turn order**, the **Album** and **Actions** are in the layout editor's tray when you want them. On a phone, the side panels are in the **Session panels** menu. See [Session layout](./session-layout.md).

## How a turn runs

Each turn, four agents work in order:

- The **planner** reads what you just did, the scene so far and the world's state, and decides what happens next and who has a reason to speak. It writes no prose, so it can run on a small, fast model.
- The **narrator** writes the scene from that plan: what happens, what it looks like, what it costs. It narrates in the third person and never puts words in a character's mouth.
- A **voice** speaks for each cast member the planner named, one per speaker. Each knows only what that character knows.
- The **state-keeper** reads the finished reply and writes down what it made true: a health change, a mood turning, the weather closing in, an item changing hands. When the scene took real time (a journey, a long search, a night's sleep), it also says how long, as a suggestion to move the [story clock](./lorebook-time.md#the-story-clock).

The narrator's prose streams into the reply as it's written. When the last voice has spoken, the reply settles into its final form: the scene, then each character's turn in the planner's order. The state-keeper then runs on that reply, which is why its changes stay attached to the message that caused them. The stop button on the progress card ends the run wherever it has got to.

An administrator can read every step, prompt and refusal afterwards in the [run inspector](./pipelines.md#inspecting-a-run).

### What each agent is told

Every agent is given the same anchor: where the scene is, what time it is, the weather, who is in the cast, and that the player is your persona. The narrator gets the planner's beats as what happens in this scene, and is told to invent no named characters and to leave dialogue to the voices. Each voice gets the same place and cast, so a character can't answer from somewhere the plan never mentioned.

- **Places.** The planner, the narrator and each voice are shown the place the scene is in (its lorebook entry and its ways on, under *From here:*). The planner is also given the name of every place in the lorebook, so when the scene moves it names a place the book holds. Archived or switched-off places are left out (see [Places](./stats-and-states.md#places)).
- **What a place holds.** The narrator and the planner know what lies in every place the session can see. A character's voice knows only what lies in the place the scene is in.
- **How the cast stand with each other.** The planner and the narrator are told every relationship a cast member holds in the lorebook's narrative graph. A relationship only its holder knows is left out, so a secret stays with the character who holds it. The voices are never shown relationships: each character speaks from what they know.
- **What the state-keeper may write.** It's shown each value the session tracks with what it accepts, such as "stamina: a whole number from 0 to 10". A value outside that is refused on the run's record rather than offered to you.

The planner and the state-keeper are asked a *question* rather than given a turn, and they read the conversation as prose only. That keeps a turn from reading like one long reply, and it's why their answers never appear on screen.

## Stats, the world and the ledger

An Adventure session tracks:

- for each cast member: **Health**, **Stamina**, **Mood** and **Trust** (how far they trust you, from hostile to loyal);
- for the world: its **Location**, **Time of day** and **Weather**;
- for everybody, the world included: an **Inventory**, item by item.

Nothing is stored until something changes it: a fresh session reads the defaults, and a character whose card says "Health, maximum 40" keeps that maximum. See [Stats and states](./stats-and-states.md#stat-shapes).

**Nothing the model proposes takes effect on its own.** Each change appears under the reply as a pending line with **Accept** and **Reject**, because a model that could set a number silently could rewrite your character between two messages. Changes are anchored to the message that produced them, so regenerating or swiping a reply takes its changes back with it.

**A change goes stale if the value moves first.** If you edit a bar yourself, or accept an earlier change to the same value, a still-pending proposal for that value is marked **Superseded** and does nothing: *Superseded — Health changed since this was proposed*. With **Trust the narrator** on, the same rule applies as the change is written, and the next turn proposes afresh.

### Time the scene took

The model never moves the [story clock](./lorebook-time.md#the-story-clock) on its own. When a scene takes real time, such as a day's march, a long search or a night's sleep, the state-keeper can suggest how long it took. The suggestion waits under the reply with the other changes, as *Time passes: 3 hours* with **Accept** and **Reject**. Ordinary talk takes no time worth recording, so most turns suggest nothing.

- **Accept** moves the session's clock on by that much. It counts as moving the clock yourself, so it can [suggest a new scene](./sessions.md#when-a-new-scene-begins) at the next line.
- **Reject** leaves the clock where it is.
- A clock suggestion never goes stale. If the clock moved in the meantime, accepting adds the time on from wherever the clock stands now.
- Regenerating or swiping the reply takes its clock move back with it, whether the suggestion was still waiting or you'd accepted it: the clock steps back by that much, and the new reply's keeper says how long its own scene took. Deleting the message does the same. Continuing a reply never moves the clock a second time.

With **Trust the narrator** on, the clock moves by the keeper's amount as soon as the turn ends, the same way **Time passes…** moves it, and it can suggest a new scene at the next line just as an accepted suggestion can. Regenerating, swiping or deleting the reply takes that move back too. The keeper only ever moves the clock forward, and only in a session that reads a lorebook with a date to start from. Otherwise nothing moves and nothing waits to be accepted: a line under the reply says *Time passes: 3 hours, not on the clock* and why, with the reason on the run's record too, and the turn's other changes stand. Continuing that reply doesn't say it twice.

Every move of the clock shows under its message with the turn's other changes, as *Time passes: 3 hours (…, 14:00 → …, 17:00)*, the times written through the lorebook's calendar. See [What moves a session's clock](./lorebook-time.md#the-story-clock).

### Scenes follow the party

In a session that reads a lorebook, the world's **Location** is the scene's place. A new scene is named after it, such as *Scene 3 · the Harbour*, and when the party move somewhere else (the state-keeper's change, or your own) **The place changes** suggests a new scene at the next line. Moving away and back inside one scene suggests nothing. Switch it off under **Scenes** in the session's settings; see [When a new scene begins](./sessions.md#when-a-new-scene-begins).

## Actions

The **Actions** row above the composer has five buttons:

- **Look**: the narrator describes where you are, from the lore and the world's state. It's shown the place the scene is in, with its ways on, and the names of every place your lorebook holds, as the narrator is on a turn. It changes nothing. It's the button to start a new adventure with.
- **Rest**: the party stops. Stamina comes back, health comes back slowly and only somewhere safe, and the state-keeper suggests how long the rest took (a short halt, or a night's sleep) as a move of the story clock to accept or reject. See [Time the scene took](#time-the-scene-took).
- **Time passes…**: asks how much time passes (a number of minutes, hours, days, months or years, forward or back). The state-keeper is told how long you chose and moves the world's time of day on by that much (a few minutes may change nothing, a whole day brings it back round), and the weather may turn over that span. Then the session's [story clock](./lorebook-time.md#the-story-clock) moves by what you chose. The amount is always yours: the state-keeper never suggests one here. If the story has no clock yet (nothing in the lorebook is dated and no clock is set), the world's changes still stand, the clock is left alone, and a line under the message says so: *This story has no clock yet: set one in the lorebook to track time.*
- **Scene**: draws the scene as it stands, from the last few messages and how everyone looks, and makes it the session's backdrop. It's the same action as Chat's; see [Sessions → Scene](./sessions.md#scene).
- **Ask** (`/ask`): the narrator puts one question, with two to four choices, to one member of the cast. If that character is your persona, the buttons are yours; if the AI plays them, they choose for themselves and their answer lands as their line. See [Questions put to the cast](./session-actions.md#questions-put-to-the-cast-forms).

Rest and Time passes… write no message: a clock tick is a change in the ledger, not a paragraph. Press **Look** when you want the paragraph.

## Adventure settings

Under **Edit session › Settings**:

| Setting | What it does |
| --- | --- |
| **Tone** | Grounded, pulpy, grim or whimsical. The narrator's instructions are written with it. |
| **Difficulty** | Story, normal or hard. The planner reads it when it decides what a scene costs you. |
| **Trust the narrator** | Off by default. On, the state-keeper's changes apply as they're made instead of waiting for you, including how long a scene took. |
| **Character detail** | How much the model is told about each character who isn't speaking. See [Character detail](./group-sessions.md#character-detail). |

Adventure has no turn-order or auto-advance setting: the planner decides who speaks, and each message you send gets one turn.

## Running it cheaply

Each step has its own model and sampling settings, set by an administrator in **Admin › Pipelines**. The planner and the state-keeper can run on a small model while the narrator and the voices run on a large one. See [Pipelines](./pipelines.md).

## Related

- [Genres](./genres.md): Adventure next to Chat, the Lair and the Guide.
- [The Lair](./genre-lair.md): the same kind of world, where you are the dungeon instead.
- [Stats and states](./stats-and-states.md): the values Adventure tracks, and how to add your own.
- [Lorebooks](./lorebooks.md): where the world lives.
