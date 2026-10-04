# Stats and states

A **stat** is something about a character or the world that changes as the story goes: health, mood, gold, the weather, what someone is carrying, where the party is. Serene Pub keeps stats beside the story, shows them while you play, tells the model about them, and lets you approve or reject every change the model wants to make.

Stats come with the session's **genre**. **Adventure** and the **Lair** track them; **Chat** tracks none, so a Chat session looks and reads exactly as if stats didn't exist.

:::note By the end of this page
You'll know where to see a session's stats, how to change them, how to accept or reject the model's changes, and how your lorebook can set the world up before play. Further down, power users will find how values layer, how they reach a prompt, and how a pipeline reads them.
:::

## What each genre tracks

| Genre | On each cast member | On the world | Also |
| --- | --- | --- | --- |
| **Chat** | nothing | nothing | Can't track stats. |
| **Adventure** | Health, Stamina, Mood, Trust | Location, Time of day, Weather | **Inventory** on cast members, the world and places. You can add more (see [What a session tracks](#what-a-session-tracks)). |
| **Lair** | Health, Stamina, Mood, Trust, Whisper | Location, Floor, Gold, Direction | **Inventory** on cast members, the world and places. You can add more. |

Nothing has to be filled in when a session starts: a fresh adventure already has every stat at its starting value, read from the character's card or the stat's own default. See [Adventure](./genre-adventure.md) for what Adventure does with them.

## In a session

Two widgets show stats while you play. Neither is on by default: open the layout editor and add them (see [Session layout](./session-layout.md)). A genre that wants them from the first message ships a layout with them already placed.

- **Stats**: one card per cast member, each stat drawn by its [shape](#stat-shapes): a number with limits as a bar (`14/20`), a choice as a chip, a list as its items, a date as a date line. Its settings choose which members, how dense the cards are, and which stats to show.
- **World State**: the world's own stats as a strip (or a list, down a side column), and under them each [place](#places) that holds something, by name. What you see here is what the model is told.

**Scene Portraits** can also draw small bars under each portrait: turn on **Show stat bars** in its settings. Only numbers with a floor and a ceiling become bars.

### Changing a stat yourself

Click a bar or a line to edit it: **Enter** applies, **Escape** puts the old value back. Click a chip to pick from its options, or **not set** to clear it. Click a list to open it: move items up or down, remove them, or type a new one and press **Enter**. An item that is a lorebook entry shows how many are held (`Rusty key ×2`) with **−** and **+** beside it, and **Add from the lorebook** picks one from the session's lorebook.

Your edits apply at once. Clearing a field doesn't set it to nothing: it goes back to the value the session started from (see [Where a value comes from](#where-a-value-comes-from)).

### Under the messages

A turn that changed something carries a compact line under its message:

> **Verity** hp 20 → 14 · Inventory → rusty key · mood calm → wary

When the model *asks* for a change, the line shows it with **Accept** and **Reject** beside it, and nothing has happened yet. **Review N changes** opens every waiting change in the session, for the ones that have scrolled out of sight.

## Who can change one

| Who | What happens |
| --- | --- |
| **You** | Applied at once. |
| **A pipeline the genre ships** (a damage roll, a shop) | Applied at once, recorded as that run's. |
| **The model** | **Proposed.** Nothing changes until you accept it. |

A model that could silently rewrite a character between two messages would leave you nothing to point at afterwards, so its changes always wait for you. Accepting one records it as the model's change that you agreed to, which is what makes "why is my health 3?" answerable.

A proposal is checked before it reaches you: asking for stamina 90 when the maximum is 10, or for a weather the list doesn't have, is refused on the run's record rather than shown to you. If you change the same stat yourself before deciding, the proposal is marked **Superseded** and can't be applied over your newer value.

In a shared session, guests change the session's own values like anyone playing. Values the lorebook or a character card holds for every session belong to their owner, and guests can't change those.

## Swipes, regenerates and taking things back

Every change is tied to the message that made it. **Delete a message**, **regenerate** a reply or **swipe** to another, and what that message changed goes with it: the reply that wounded her is gone, so the wound is too, and the new reply proposes its own. A stat is only ever as durable as the line that justified it.

## What a session tracks

The genre sets the baseline, and decides whether a session may track anything more. **Chat** doesn't. **Adventure** and **Lair** do, and the session's settings have an **Attributes** section with three parts:

- **From the genre**: the genre's own stats, always tracked.
- **From the world**: the stats the session's lorebook brings, such as stat sheets on the lorebook or its cast, and stats an earlier session recorded onto the world. On by default; switch them all off, or untick any one.
- **This session's own**: any other stat installed on this pub, added for this session alone with **Add an attribute…**.

A change applies from that moment on: values already recorded stay. Only the session's owner can change what it tracks. A stat the session doesn't track can't be changed in it, and the refusal says so.

## Stat shapes

Every stat has a **shape**, so the same kind of value behaves the same way everywhere:

| Shape | Holds | Drawn as |
| --- | --- | --- |
| **Number** | a whole number, with an optional floor and ceiling | a bar (`14/20`) when it has both, otherwise the number |
| **Choice** | one of a fixed set of options | a chip that opens a menu |
| **List** | an ordered list of text or lorebook entries | its items |
| **Story time** | a story date, with an optional time of day | a date line: `Year 412, Mo. 3, Day 5, 22:30` |

A stat can also be a line of **text** (Location, Direction, Whisper) or **on or off**. A card, a lorebook or a session can change a stat's limits, such as raising one character's maximum health, without changing its shape.

### Lists and items

An inventory, the companions travelling with the party, the clues found so far: all lists. **Inventory** is a list stat like any other.

An item in a list is either a line of text or a lorebook entry. An entry always shows its current name, so renaming the entry renames it in every list. A lorebook can hold **Items** as their own kind of entry, each saying how many exist: **One of a kind**, **Limited** or **Unlimited** (see [Lorebooks](./lorebooks.md#the-entry)). An entry appears once in a list with a count: one is written plainly (`Rusty key`), two or more with the count (`Rusty key ×2`).

A list can only hold entries the session can see: from its own lorebook, on its line, not off or archived, and not a character's private lore, because the session's stats are shown to everyone in it.

**Adventure** and **Lair** keep to an item's supply: if the model reports somebody picking up a one-of-a-kind item that someone else already holds, or more of a limited item than is left, the change is refused. Handing something over in the same turn is fine. What lies in a place counts toward the supply, even in a place that's switched off.

:::note Writing your own state-keeper prompt?
The model's state-keeper reports items that changed hands in a list called `inventory`. A prompt of your own has to ask for `inventory` by that name.
:::

### Story time

A story date is written year first: `412`, `412-03`, `412-03-05` or `412-03-05 22:30`. Years can be negative, and months and days can go past 12 and 31, since a story calendar needn't match ours. If the lorebook has a calendar (see [Time, history and branches](./lorebook-time.md#the-calendar)), dates are written through it, such as `Tuesday, 5 March, Year 412, 22:30`, and a date the calendar has no room for is refused.

### Location

**Location** says where the scene is. Adventure and the Lair keep it on the world. It's a line of text, such as *the old mill*, or, when the model names a place in the session's lorebook, a pointer to that place. The place is found by its exact name, then a looser spelling (with *the*, *a* or *an* aside), then its keywords. A name two places share is refused rather than guessed, and so is a place the session can't see. Anything else stays as words.

A location that points at a place reads by the place's name, so a place renamed later in the story reads by its new name everywhere.

## Places

A place in the session's lorebook can hold stats of its own, as the world and each character do. In **Adventure** and the **Lair**, every place can hold an **Inventory**: the key lying in the crypt, the nets on the harbour wall.

**The places a session can see** are its lorebook's places on its line, at its point in the story, except any that are archived or switched off. Everything in the session uses this one rule: the prompt, the rooms the Lair lists, the World State widget, and what a change may name. A place that's switched off keeps its stats in the lorebook; the session just doesn't read them until it's back. If the party's **Location** points at it, the location reads as not set until then.

Moving an item between a place and a character is a removal from one and an addition to the other, both under the same message, so a swipe takes both back.

### Setting a place's stats before play

You can set what a place holds in the lorebook itself, before any session exists: put the key in the crypt, and every session on that lorebook finds it there. Open the place and use its **Stats** section (see [Places and maps](./lorebook-places.md#what-a-place-holds)).

What you set there is the place's starting point. A session reads it until it changes the value itself, and play never changes the book, unless the session is recorded onto the world (see [When a session changes the lorebook](#when-a-session-changes-the-lorebook)). A value set while reading a branch belongs to that branch; one set while reading as of a dated history entry holds from that date on.

Only the lorebook's owner can set a place's stats. An inventory never holds a place (places are linked, not stored inside each other) or a history entry.

Deleting a place deletes its stats, in the lorebook and in every session.

## Where a value comes from

The same stat can be answered in several places, and a session reads the nearest answer:

1. **The session**: this playthrough, changed during play.
2. **The lorebook**: what this world says, shared by every session on it.
3. **The character card**: what this character starts as, wherever they turn up.
4. **The sheet's default**: what the genre's stat sheet says it starts at.
5. **The stat's own default.**

In short: **the card is the template, the lorebook is the world, the session is this run.**

Each layer stores only what it changes. A session that never touched Verity's health reads the world's; a world that never touched it reads her card's. So a blank is never a zero, and a stat nobody answered anywhere is simply **absent**. Limits layer the same way: a card says maximum 20, a world may raise it to 40 for one character, a session may raise it again.

A place has a shorter chain: the session, then the lorebook, then the defaults. There's no card behind a place.

### Which value holds when

The lorebook's own values aren't tied to messages, so which holds is decided by story date: the latest one dated at or before the moment being read, an undated value counting as the earliest. On the same date, the one written last wins. A session's own changes come after everything it inherits.

## When a session changes the lorebook

Most of what a session changes is its own. A few things change the **lorebook**: values on the world, a cast member or a place, set from the session, applied by a pipeline, or **recorded onto the world** when you capture a scene or delete the session. Those land where the session stands:

- **On its line.** A session on a branch writes that branch, never main.
- **Dated where its story stands**: at the latest history entry on its line, up to its story clock. The value holds from that date on, and a session whose clock is earlier doesn't see it.
- **Before the first date, from the beginning.** A change made before the line's first history entry counts from the start of the line.

Whether a session may change the lorebook at all is the lorebook owner's **Lorebook writes from sessions** setting (in **Settings › User**; an administrator sets the default for everyone in **Admin › General**):

| Setting | A pipeline's change to the lorebook | Recording onto the world | Your own edit, or an Accept |
| --- | --- | --- | --- |
| **Full** | Applied. | Written. | Applied. |
| **Review changes** (the default) | Held as a proposal for you. | Each new value becomes a proposal. | Applied: you are the review. |
| **Off** | Skipped; the run's record says why. | Nothing is recorded. | Refused, with a sentence saying where the setting is. **Reject** still works. |

A proposal to change the lorebook remembers the line and date it was made at, and applies there. Only the lorebook's owner decides one. Deleting a session records its values onto the world under **Full** and **Review changes** (a proposal couldn't wait, since it would be deleted with the session), and records nothing under **Off**.

## In a prompt

A genre's prompt template reads the values (`state.world.weather`, `state.cast.verity.hp`) and writes them however it likes, usually as a line the model reads: *Verity: 14/20, wary; carrying a rusty key*. Lists read as their items with counts (`carrying Rusty key ×2, rope`). A place's values are under `state.locations`, by the place's name: `state.locations.the_crypt.inventory`. A template sees only the stats the session tracks; see [Context templates](./context-templates.md#stats-state).

Who is told about which place:

- **A character's own voice** (an Adventure cast member, a Lair delver) is told the stats of **one** place: the one the scene is in. A character never knows what's waiting in a room nobody has reached.
- **The planner, narrator and state-keeper** aren't anybody in the scene, and read every place the session can see.
- **The Lair's Castellan, speaking for the party**, reads the party's place and the places one way on from it.

In the Lair, the Castellan's state-keeper keeps the world's and places' stats, and whoever writes a delver's line keeps that delver's stats: the delver's own turn, or, when the Castellan speaks for the party, the Castellan's state-keeper for the delvers it voiced that turn. A change reported for anybody else is refused. See [How the party speak](./genre-lair.md#how-the-party-speak).

### Heard by its holder alone (earshot)

Most values reach every prompt that reads the state. A stat can instead be **heard by its holder alone**: only the prompt written in the voice of the character who holds it reads it. The Lair's **Whisper** works this way. When the dungeon's master whispers to Brannoc and Vell, each holds the note, and each one's own voice reads it next time they speak. No other delver, none of the Castellan's prompts, and no trap or room build ever sees it.

People see such a value the same way. The session's owner sees every one. A guest sees only the one on the character they play. Only the people who can see a whisper can change it.

A value worked out from a whisper is heard the same way.

## Reading stats in a pipeline

This part is for people building their own pipelines. Five steps work with stats:

- **Session state** reads the session's resolved values, and the state **version** the turn read.
- **Set state** changes them. It asks for review by default, and applies directly only when the genre's author says so. Given the version back as `base`, it refuses a change whose value has moved since.
- **Item supply** answers, for each item in the session's lorebook, how many exist, how many are held and by whom, and how many are left. It only answers; the pipeline decides what to do.
- **Lorebook state** reads what the lorebook holds for its world, each cast member and each place: what you set, and what earlier sessions recorded. Nothing is filled in from cards or defaults. Narrow it to one owner and a list of stats.
- **Stat trail** lists one stat's values over time for one owner: **by message** (this session's changes), **across sessions** (what the lorebook recorded, by story date), or **both** (the default). Each point says its value, where it sits, and who wrote it.

**Lorebook state** and **Stat trail** read the session's own lorebook, from where the session reads it: its line and story clock. A pipeline can ask for another reading with extra inputs: **Line** (`main`, `mostRecent`, `session` or a branch id), **At** (`head` or a story date) and **Fork cut** (`false` reads all of main from a branch). A branch reads main only up to where it forked. A pipeline can't read another lorebook.

## Derived stats

A **derived** stat is worked out every time it's read and never stored, because a stored age is a wrong age the day after. Two kinds:

- **Age**, from a birthdate on the character, read against the story's present (the lorebook's clock, or its newest history entry). Missing either, age is absent, not zero.
- **An expression**, written on the stat, computed from other values.

## What isn't built yet

- **No stat uses the story-time shape yet.** The widget can edit a story date, but nothing ships one, and when something does, the widget won't yet write the date through the lorebook's calendar.
- **Expressions on a place** read as absent; they're worked out for the world and the cast only.
- **Picking a place for Location in the widget.** A location pointing at a place shows its name, but the widget edits it as text: typing replaces the pointer with words.
- **Reading a session's stats as of an earlier message.** A pipeline can list a stat's changes with **Stat trail**, and read the lorebook as of a date, but nothing works out what a session's values were at message 47.
- **Running a pipeline from a lorebook.** **Lorebook state** needs no session, but nothing yet runs a pipeline from a lorebook page.
- **Modifiers** such as poisoned, resistance or proficiency.
- **Editing stats away from a session.** A place's stats can be set in its lorebook, but there's no stats editor yet on a character card, a cast member's page, or the world in the lorebook.
- **A dated value whose history entry is deleted** loses its date and counts as undated.
