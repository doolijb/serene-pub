# Stats and states

A **stat** is something about a character or the world that changes as the story goes: health, mood, gold, what someone is carrying, where the party is. Serene Pub keeps stats beside the story, shows them while you play, tells the model about them, and lets you approve or reject every change the model wants to make.

Stats come from the session's **rules**. The rules a session plays (Vis Itineris, Wherewithal, rules you built yourself) say which **attributes** its characters, its world and its places carry: health, level, nerve, a mood. A genre never adds any, and neither does a session. Rules that keep no attributes, such as **Freeform**, keep the story in words: the sheet says so, and nothing is counted.

Beside the rules' attributes, Serene Pub keeps a few things itself:

- **Where and when.** Where the scene is (or, in the Dungeon Crawler, where each hero is) and the story's clock. They show in a row of their own on a sheet, never among the attributes, and the model reads them as place and time.
- **What someone carries**, in a Story or Lair session: each character's **Inventory**, and what lies about in the world or in a place. A list under the sheet, where the model hands out the lorebook's items.
- **A genre's own tools.** The Lair's **whisper** and standing **direction**, the Dungeon Crawler's standing orders and who is still standing. The genre's own steps read and write them; they are never one of the rules' attributes.

:::note By the end of this page
You'll know where to see a session's stats, how to change them, how to accept or reject the model's changes, and how your lorebook can set the world up before play. Further down, power users will find how values layer, how they reach a prompt, and how a pipeline reads them.
:::

## What a genre plays best with

A genre doesn't decide what is tracked, but it can say what it **plays best with**, so the start form can recommend rules that fit:

| Genre | Plays best with |
| --- | --- |
| **Chat** | nothing: it keeps no stats. |
| **Story** | a health-like number, a mood word, what ails someone, somewhere to keep what they carry. All optional: Freeform plays it all in words. |
| **Lair** | the party's health, what ails them, somewhere to keep what they carry. All optional. |
| **Dungeon Crawler** | a health and a level to count, weapons, armour, gear, things used up, spells, what training lets someone do, what ails someone. Rules without them play the crawl in words. |

The start form's Rules card lists these as **Plays best with …**, rates each set of rules against them, and says what the rules you picked will tell in words instead, and why. Nothing is locked: any rules can be played.

Nothing has to be filled in when a session starts: a fresh story already has every stat at its starting value, read from the character's card or the stat's own default. See [Story](./genre-story.md) for what Story does with them, and [Rulesets](./rulesets.md) for the attributes a set of rules can declare.

## In a session

The **Stats** widget shows stats while you play. It isn't on by default: open the layout editor and add it (see [Session layout](./session-layout.md)). A genre that wants it from the first message ships a layout with it already placed. Each stat is drawn by its [shape](#stat-shapes): a number with limits as a bar (`14/20`), a choice as a chip, a list as its items, a date as a date line. Its settings choose **whose stats** it shows (the cast, the world, the [places](#places) that hold something, all three under a heading each, or the ones you name), **which cast members** (those with a stat in play, or everyone), **which stats** (all of them, only the bars, or the ones you name) and the **arrangement**: a card for each, a list down a side column, or a strip across the top of the messages. The world's stats are what the model is told. To show the world as a strip and the party as cards, place Stats twice. **World State** is now Stats showing the world as a strip: a layout that has it keeps drawing it the same way.

**Every kind of attribute, as the rules would like it.** The rules say what each attribute is, and may hint how it is drawn: a number as a bar (`14/20`), a count or a badge; a pool as pips (●●●○○) or a bar; a tally as a count; a word as a badge or plain words; a list as its items; free text over several lines. A hint the widget doesn't know is drawn the usual way for that kind. Under the attributes the sheet shows what each character **holds**, place by place the rules keep things in (what someone carries, a hand of cards), and their **ties** to other people. Rules that declare no attributes show _This session's rules declare no attributes._ instead. Rules that keep numbers without deciding anything by them (a sheet you track by hand) still show their numbers.

**Where and when.** The scene's place and the story clock are a row of their own at the top of the world's sheet (and, in the Dungeon Crawler, each hero's place on their own). Click the place to change it.

**The game's own state.** A genre's own tools (the Dungeon Crawler's standing orders, fate and death saves, the Lair's whisper and direction) are drawn under a sheet in a block of their own, never among the attributes. A copy of the widget can hide them: set **The game's own state** to **Hidden**.

**The character sheet.** A sheet shown alone (yours, with **Whose stats: Mine**) fills its box edge to edge — no card inside a card. Plain stats keep their label beside the value; a stat that holds **pieces** (weapons, armour, spells, conditions — anything the session's rules describe) puts its label on its own line with the pieces listed underneath, one row each: the name, **×3** when more than one is held, and a few words of what matters (*1d8 slashing*, *Heavy · AC 16*). Click a row to open its details: every fact, the description, the rules it carries, and — when the sheet is yours to change — **Edit**, **Give to…** and **Remove**. **Give to…** moves a piece to another character in the scene (or drops it in the place); when the other sheet is not yours to change, it becomes an offer they accept or decline on their own sheet. **Add** stays at the end of the list.

**Several characters.** With **Arrangement: Faces**, the widget shows a strip of faces across the top — one per character shown, yours first — and the sheet of the one you pick underneath. A small dot on a face means that sheet changed since you last looked. **Whose stats: Player seats** shows every player's character and no one else (no companion, no character nobody plays), yours first: with Faces, the strip a table of friends reads each other's sheets by. **Give to…** says what moved on the table's log in a genre that keeps one (_Wren gives Potion of healing to Rook._).

**Worked out by the rules.** A value the session's rules work out from the sheet and put on it (Vis Itineris's **Armour class**) shows as a row of its own under the bars, marked with **Σ**. It is never stored, so it has no edit and no history; change what it is worked out from (the armour, Dexterity) instead. A table that counts no numbers (How strict **Words only**) shows none. A stat the rules use only one way of playing is shown only at a table that plays that way: **Spell points** at a table playing spell points, **Spell slots** at one playing slots.

**Portraits.** Click the picture (or the initial) at the top of a sheet to choose a portrait: one of the session's pictures, an upload, or — with an image model connected — **Draw**, from what the sheet says. The portrait shows everywhere that character does: the sheet, the faces strip, Scene Portraits and their replies.

**Locked stats.** A session's rules, or its owner, can lock a stat: a small lock shows beside it and the edit controls go away. *People* locks hand edits only (the rules still write it); *All* locks every write until it is unlocked.

The clock button beside a stat shows how it changed in this session, newest first: what it was, what it became, who changed it (you or another player, the story, or something automatic) and when. Anyone in the session can open it. To hide these buttons, turn off **Show changes** in the widget's settings.

**Scene Portraits** can also draw small bars under each portrait: turn on **Show stat bars** in its settings. Only numbers with a floor and a ceiling become bars.

### Changing a stat yourself

Click a bar or a line to edit it: **Enter** applies, **Escape** puts the old value back. Click a chip to pick from its options, or **none** to clear it. An empty stat reads _none_, whatever kind it is. Click a list to open it: move items up or down, remove them, or type a new one and press **Enter**. An item that is a lorebook entry shows how many are held (`Rusty key ×2`) with **−** and **+** beside it, and **Add from the lorebook** picks one from the session's lorebook. A session with no lorebook doesn't offer it.

Your edits apply at once. Clearing a field doesn't set it to nothing: it goes back to the value the session started from (see [Where a value comes from](#where-a-value-comes-from)).

### Under the messages

A turn that changed something carries a compact line under its message:

> **Verity** hp 20 → 14 · Inventory → rusty key · mood calm → wary

A turn that moved the [story clock](./lorebook-time.md#the-story-clock) says so on the world's line, after its stats: *Time passes: 3 hours (…, 14:00 → …, 17:00)*.

When the model *asks* for a change, the line shows it with **Accept** and **Reject** beside it, and nothing has happened yet. **Review N changes** opens every waiting change in the session, for the ones that have scrolled out of sight. A player's offer of an item waits there too: the player it's offered to gets **Accept** and **Decline**, and the one who made it sees it under **Your offer**, with **Withdraw**.

## Who can change one

| Who | What happens |
| --- | --- |
| **You** | Applied at once. |
| **A pipeline the genre ships** (a check's damage, a shop) | Applied at once, recorded as that run's. |
| **The model** | **Proposed.** Nothing changes until you accept it. |

A model that could silently rewrite a character between two messages would leave you nothing to point at afterwards, so its changes always wait for you. Accepting one records it as the model's change that you agreed to, which is what makes "why is my health 3?" answerable.

A proposal is checked before it reaches you: asking for stamina 90 when the maximum is 10, or for a weather the list doesn't have, is refused on the run's record rather than shown to you. If you change the same stat yourself before deciding, the proposal is marked **Superseded** and can't be applied over your newer value.

In a shared session, guests change the session's own values like anyone playing. Values the lorebook or a character card holds for every session belong to their owner, and guests can't change those.

## Swipes, regenerates and taking things back

Every change is tied to the message that made it. Go **Back** a turn, **regenerate** a reply or **swipe** to another (or delete a message, where the genre offers Delete), and what that message changed goes with it: the reply that wounded her is gone, so the wound is too, and the new reply proposes its own. **Forward** brings the turn back, wound and all. A stat is only ever as durable as the line that justified it.

The story clock follows the same rule: a move that came with the message steps back with it, all but a reply's fixed tick on a regenerate or a swipe. See [What moves a session's clock](./lorebook-time.md#the-story-clock).

## What a session tracks

A session tracks what its rules declare, and nothing more: no genre adds attributes, the lorebook's and the cards' stat sheets don't add any, and the session can't add its own. Change the rules (before play, or with the session's rules settings) and what is tracked changes with them. A value the session held on a stat it no longer tracks is kept: older sessions had theirs carried onto the rules' attribute of the same kind (health onto health), or written into the session's notes as a line under **Carried over from before**.

The session's settings have an **Attributes** section. Under rules that declare none it says _This session's rules declare no attributes._

### Who carries what

When the rules leave an attribute optional, the **Attributes** section lists **Who carries what**: each character (and the world or each place, where the rules put an attribute there), with a **Carries ‹attribute›** switch for each. The same switches are on the Stats widget, under each sheet, for the sheets you may change. Switched off, that attribute isn't shown on their sheet, isn't read into any prompt or by the rules, and can't be changed for them; what it held is kept, and comes back when it's switched on again. Whoever plays a character can switch their own; the session's owner can switch anyone's, and the world's and places'. An attribute the rules mark as required is always carried, so it isn't listed.

## Stat shapes

Every stat has a **shape**, so the same kind of value behaves the same way everywhere:

| Shape | Holds | Drawn as |
| --- | --- | --- |
| **Number** | a whole number, with an optional floor and ceiling | a bar (`14/20`) when it has both, otherwise the number |
| **Choice** | one of a fixed set of options | a chip that opens a menu |
| **List** | an ordered list of text or lorebook entries | its items |
| **Story time** | a story date, with an optional time of day | a date line: `Year 412, Mo. 3, Day 5, 22:30` |

A stat can also be a line of **text** (Location, the Lair's Direction and Whisper) or **on or off**. The rules' attributes are said by kind (a number, a pool, a tally, a word, a list, free text), each drawn as above. A card, a lorebook or a session can change a stat's limits, such as raising one character's maximum health, without changing its shape.

### Lists and items

The companions travelling with the party, the clues found so far: lists, where the rules keep one. What someone carries is the things they hold, kept where the rules keep them (every session has somewhere to keep what someone carries). In a **Story** or **Lair** session, Serene Pub keeps it itself, as each character's **Inventory** (and what lies about in the world or in a place): a list under the sheet, never among the rules' attributes, whatever the rules.

An item in a list is either a line of text or a lorebook entry. An entry always shows its current name, so renaming the entry renames it in every list. A lorebook can hold **Items** as their own kind of entry, each saying how many exist: **One of a kind**, **Limited** or **Unlimited** (see [Lorebooks](./lorebooks.md#the-entry)). An entry appears once in a list with a count: one is written plainly (`Rusty key`), two or more with the count (`Rusty key ×2`).

A list can only hold entries the session can see: from its own lorebook, on its line, not off or archived, and not a character's private lore, because the session's stats are shown to everyone in it.

**Story** and **Lair** keep to an item's supply: if the model reports somebody picking up a one-of-a-kind item that someone else already holds, or more of a limited item than is left, the change is refused. Handing something over in the same turn is fine. What lies in a place counts toward the supply, even in a place that's switched off.

:::note Writing your own state-keeper prompt?
The model's state-keeper reports items that changed hands in a list called `inventory`. A prompt of your own has to ask for `inventory` by that name.
:::

### Story time

A story date is written year first: `412`, `412-03`, `412-03-05` or `412-03-05 22:30`. Years can be negative, and months and days can go past 12 and 31, since a story calendar needn't match ours. If the lorebook has a calendar (see [Time, history and branches](./lorebook-time.md#the-calendar)), dates are written through it, such as `Tuesday, 5 March, Year 412, 22:30`, and a date the calendar has no room for is refused.

### Location

**Location** says where the scene is. It is Serene Pub's own, never one of the rules' attributes: Story and the Lair keep it on the world, and the Dungeon Crawler on each hero, whose party may split. It's a line of text, such as *the old mill*, or, when the model names a place in the session's lorebook, a pointer to that place. The place is found by its exact name, then a looser spelling (with *the*, *a* or *an* aside), then its keywords. A name two places share is refused rather than guessed, and so is a place the session can't see. Anything else stays as words.

A location that points at a place reads by the place's name, so a place renamed later in the story reads by its new name everywhere.

## Places

A place in the session's lorebook can hold stats of its own, as the world and each character do, where the rules put an attribute on places, and what lies there: the key lying in the crypt, the nets on the harbour wall.

**The places a session can see** are its lorebook's places on its line, at its point in the story, except any that are archived or switched off. Everything in the session uses this one rule: the prompt, the rooms the Lair lists, the Stats widget, and what a change may name. A place that's switched off keeps its stats in the lorebook; the session just doesn't read them until it's back. If the party's **Location** points at it, the location reads as _none_ until then.

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
4. **The stat's own default.**

In short: **the card is the template, the lorebook is the world, the session is this run.**

### The character card

A character's card can carry stats of its own: open the character, press **Edit** and switch to the **Stats** tab (see [Stats on a card](./characters.md#stats-on-a-card)). There you pick the card's **sheets** and set where each stat starts, and its limits, for every session the character joins.

- **The sheets don't add stats.** What a session tracks is its rules' (see [What a session tracks](#what-a-session-tracks)); a card's values answer for the stats the rules keep.
- **The card is only the start.** A cast member in a lorebook, or the session itself, can change any value the card sets; the card is never changed by play.
- **They travel with the card.** Exporting the character carries its sheets, values and limits, and any stat you declared yourself, so a Serene Pub import gets them back. See [Exporting a character](./characters.md#exporting-a-character).

Each layer stores only what it changes. A session that never touched Verity's health reads the world's; a world that never touched it reads her card's. So a blank is never a zero, and a stat nobody answered anywhere is simply **absent**. Limits layer the same way: a card says maximum 20, a world may raise it to 40 for one character, a session may raise it again. A pipeline sets a session's limits with **Configure a stat** (`core:outlet/set-stat-config@1`): one owner, one stat, and only the limits that stat's shape has (a number's floor and ceiling, a choice's options, a list's length), anchored like a value so a retake takes it back. Dungeon Crawler sets each character's full health this way.

A place has a shorter chain: the session, then the lorebook, then the defaults. There's no card behind a place.

### Which value holds when

The lorebook's own values aren't tied to messages, so which holds is decided by story date: the latest one dated at or before the moment being read, an undated value counting as the earliest. On the same date, the one written last wins. A session's own changes come after everything it inherits.

## When a session changes the lorebook

Most of what a session changes is its own. A few things change the **lorebook**: values on the world, a cast member or a place, set from the session, applied by a pipeline, or **recorded onto the world** when you capture a scene or delete the session. Those land where the session stands:

- **On its line.** A session on a branch writes that branch, never main.
- **Dated where its story stands**: at the latest history entry on its line, up to its story clock. The value holds from that date on, and a session whose clock is earlier doesn't see it.
- **Before the first date, from the beginning.** A change made before the line's first history entry counts from the start of the line.

Whether a session may change the lorebook at all is the lorebook owner's **Lorebook writes from sessions** setting (in **Settings › User**; an administrator sets the default for everyone in **Admin › General**), made stricter by the book's own **Writes from sessions** in its Book settings when that is stricter (see [What a session may write](./lorebooks.md#what-a-session-may-write)):

| Setting | A pipeline's change to the lorebook | Recording onto the world | Your own edit, or an Accept |
| --- | --- | --- | --- |
| **Full** | Applied. | Written. | Applied. |
| **Review changes** (the default) | Held as a proposal for you. | Each new value becomes a proposal. | Applied: you are the review. |
| **Off** | Skipped; the run's record says why. | Nothing is recorded. | Refused, with a sentence saying where the setting is. **Reject** still works. |

A proposal to change the lorebook remembers the line and date it was made at, and applies there. Only the lorebook's owner decides one. Deleting a session records its values onto the world under **Full** and **Review changes** (a proposal couldn't wait, since it would be deleted with the session), and records nothing under **Off**.

## In a prompt

A genre's prompt template reads the values (`state.world.location`, `state.cast.verity.hp`) and writes them however it likes, usually as a line the model reads: *Verity: 14/20, wary; carrying a rusty key*. Only the rules' attributes reach it, beside the place and the time, which read as place and time (*The scene is at the old mill.*). Under rules that declare no attributes, the prompt carries no health, stamina, mood or trust line at all. Lists read as their items with counts (`carrying Rusty key ×2, rope`). A place's values are under `state.locations`, by the place's name: `state.locations.the_crypt.inventory`. A template sees only the stats the session tracks; see [Context templates](./context-templates.md#stats-state).

Who is told about which place:

- **A character's own voice** (a Story cast member, a Lair delver) is told the stats of **one** place: the one the scene is in. A character never knows what's waiting in a room nobody has reached.
- **The planner, narrator and reckoning** aren't anybody in the scene, and read every place the session can see.
In the Lair, a delver's own turn keeps no books: the routine **Keep the books** reads the round's lines afterwards and keeps the delvers', the world's and the places' stats. See [Keeping the books](./genre-lair.md#keeping-the-books).

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
- **Editing stats away from a session.** A place's stats can be set in its lorebook and a character's on its card, but there's no stats editor yet on a cast member's page or the world in the lorebook.
- **A dated value whose history entry is deleted** loses its date and counts as undated.
