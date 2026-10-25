# The Lair

In a Lair session you are the dungeon and its game master. A party of adventurers, the **delvers**, explores what you build: the AI plays some of them, and friends you invite can each play one.

:::tip What it's for
- Running a dungeon from behind the screen: you set the scene, spring traps and call the rolls, and the party decide what to do.
- Building a dungeon room by room while the party explore it.
- Playing a game night with friends, each at their own seat, while you run the dungeon.
:::

## The basics

You never play a character in the scene. Everything you type in the story is **direction**: what the dungeon does, such as *the torches gutter as they reach the stair*, or a note about the party, such as *the cleric is more frightened than she lets on*. Your lines are labelled **Dungeon Master**. The delvers answer for themselves.

Three helpers run the table with you:

- **The Castellan** is your assistant. It plans each turn, keeps the books, drafts rooms and talks the dungeon through with you in the **Sanctum**, a private conversation only you can see.
- **The Oracle** speaks for the rules: what the dice, or whatever the rules decide by, say. When the rules call for a roll, it asks you to call it, then reports how it came out. It never narrates.
- **The delvers** are the party: each one the AI plays speaks and acts on their own turn.

A Lair needs **at least one character**, who join the party as AI delvers.

The dungeon is a **lorebook**: one place entry per room, joined to the rooms it leads to. Choosing one is up to you. With none, the session keeps the rooms you build in [its own notes](./lorebooks.md#your-sessions-own-notes), and you can make a lorebook from them later.

:::note If you choose a lorebook
Choose one you're happy for the Lair to add rooms to. Your **Lorebook writes from sessions** setting (in **Settings › User**) and the book's own **Writes from sessions** (in its Book settings) must not be **Off**, or the Lair can't save rooms there and says so. See [What a session may write](./lorebooks.md#what-a-session-may-write).
:::

### Pick a preset

When you start a Lair, the **Preset** card offers three ways to play. You can change most of it later in the session's settings.

| Preset | What you get |
| --- | --- |
| **Words only** | The party and you, in words. Nothing is rolled and there are no rooms to build: the dungeon lives in what you write. The cheapest: one model call a turn, plus one for each delver who speaks. |
| **Rules** (the default) | Rooms to build, and the Castellan keeps the books after each round. When the session's rules call for a roll, the Oracle asks you to call it. |
| **The rules decide** | Rules, with every risky moment the rules' to decide: you call each check, or let them all be decided at once. It plays the session's rules, your lorebook's or the first recommended rules that decide; under rules that decide nothing, risky moments are told in words. |

Each card says what it needs and what makes it better, such as *Needs: a text model*. See [Rules](./rulesets.md) for what the rules are.

### Your first turn

1. Start a session, pick the **Lair** genre and a preset, choose the party (and a lorebook, if you have one for the dungeon), pick the **Rules** the session plays, and press **Start**. A lorebook with rules of its own gives the session those; one on Freeform, every new book's rules, leaves the choice to you, as with no lorebook.
2. Read the Castellan's greeting on the **Sanctum** tab, above the story beside the **Story** tab.
3. In the story, write where the party stand and what they notice, and send it.

:::tip You should see
The Castellan's plan for the turn appears in the Sanctum as a short list. If the rules call for a roll, the Oracle asks you to call it in the story. Then each delver the plan named speaks, one message each.
:::

### What's on the screen

**Your view.** The party's stats run down the left: you watch them rather than play them. The story is in the middle, with two tabs across its top: **Story** and **Sanctum**, your talk with the Castellan (see [below](#the-sanctum-and-the-castellan)). Down the right:

- **Places**: the dungeon's rooms from your lorebook. The room the party stand in is marked **Here**, and each room's ways out are listed under it. Click a room to open it, or press **Show the map**. See [Places and maps](./lorebook-places.md).
- **Castellan's scratchpad**: the Castellan's running notes (see [below](#the-castellans-scratchpad)).

**A player's view.** A friend who joins sees the **Party** layout: the stats, the story (with no tabs), the rooms, and a **Party** panel where your scratchpad would be. The Party panel has two tabs: **Turn order**, whose turn it is and who the turn waits for, and **Who's here**, who has the session open and which delver each plays. Players never see the Sanctum or the scratchpad.

On a phone, each of these is one of the side views in the **Session panels** menu. To arrange your own, see [Session layout](./session-layout.md).

## How a turn runs

1. **Direction.** Everything you've written in the story since the last reply is this turn's direction, oldest first. A seated player's lines are their delver's own turns, never direction.
2. **The plan.** The Castellan plans **the party only**: who acts, what they try, and which attempts are risky enough for a roll. You wrote because you want the party to answer, so the plan names somebody: if it names nobody, every delver the AI plays takes a turn, in the party's order. What the *dungeon* does is yours: your lines, a narration you asked for, a trap or a reveal. While it works, the progress card reads **The Castellan is planning the turn**, and stopping now writes nothing.
3. **The beats, in the Sanctum.** The plan is posted in the Sanctum as one short list, so you can read what the party are about to do. While you're on the **Story** tab, a dot on the **Sanctum** tab says it has arrived.
4. **The checks.** When the rules call for a roll, the Oracle asks you (see [Rolls](#rolls)). The party wait for your answer.
5. **The voices.** Each delver the plan named takes their own turn, in the plan's order: a message under their own name, in their own voice, streamed as it's written. Each turn is shown only what that delver knows: their own private lore and whatever you whispered to them. A delver speaks for themselves alone: their turn is stopped where a line of yours or the Castellan's would begin, and a label such as *Dungeon Master:* at the start of their message is taken off. A delver a friend plays waits for them (see [Playing with friends](#playing-with-friends)).
6. **The books.** After each round, the Castellan works out what changed: health, what someone picked up, where the party are, what lies in a room. See [Keeping the books](#keeping-the-books).

A delver's message carries their line, with the model's reasoning folded under **Reasoning** when it gives one. The planner's reasoning never reaches a message; an administrator can read it in the run inspector.

**Stop** ends the round, and nobody else speaks until you press **Continue** or write. Writing a line of your own moves the story on: the delvers who hadn't spoken yet don't, and the Castellan plans afresh.

## Rolls

Rolls follow the session's rules, never the Lair. The **Rules** field (Vis Itineris, Wherewithal, Freeform, or rules made on your pub) says how a risky moment is decided, and **How strict** says whether the rules decide it:

- **Words only**: nothing is decided by the rules. A risky moment is told in words.
- **Rules**: when the rules make a check against a difficulty (Vis Itineris's d20, a contest in Wherewithal), the Oracle asks you to call each risky moment. A moment the rules decide with no difficulty to pick (a spend from a pool, a pool of dice) is told in words, and so is every moment under rules that decide nothing themselves, like Freeform.
- **The rules decide**: the same, and you can turn on **Decide checks at once** so each check is decided with no form.

The Lair keeps no list of its own: what a form offers is read from the session's rules each turn, so rules made on your pub play exactly as the ones Serene Pub ships. A way of deciding that has difficulties to pick (a die against a target, a comparison) gives the form its checks and difficulties; a check decided any other way is told in words.

### Calling a roll

When the plan marks an attempt as risky, the Oracle posts a **roll form** in the story, addressed to you: *Brannoc: force the rusted gate. Roll for it?* Each form offers:

- **Check**: what is decided, in the rules' own words and order, with the plan's guess chosen: Vis Itineris offers checks such as *Athletics* or *Strength save*, Wherewithal its one contest, *Mettle against mettle*.
- **Difficulty**: how hard it is, from the rules' own scale, with the number to beat beside each (Vis Itineris runs from *Very easy (5)* to *Nearly impossible (30)*, *Medium (15)* the usual; Wherewithal's contests from *Slight (1)* to *Towering (7)*, *Even (3)* the usual).
- **Roll**: roll it now, by the rules.
- **No check**: no roll at all. The attempt goes as the story says.

Once you answer, the form shows your call, such as *Answered · Athletics — Hard*, and the result appears under the Oracle's name. The delvers wait until every form on the turn is answered: a turn with an open form shows nobody speaking yet. Players see the question with *Awaiting an answer*: only you call rolls.

### The outcome

A result is a framed line in the story: what was checked, what it came to, what it was set against and how it came out, in the rules' own words (*Success*, *It holds, at a cost*), tinted green, amber or red. Under it is how it was reached, such as *d20 14 + str 3 = 17 vs 15*. A contest reads the other side's value instead of a number to beat. The voices that follow must honour it.

**Show outcomes** (on by default) decides what the party read. Off, the results still show in the story for everyone, but the delvers are told only how things went, never the numbers.

### Calling a roll yourself

**Roll** (`/roll`, among the composer's actions) asks for a roll whenever you like. Its window asks **Who rolls** and **What do they attempt?** (`/roll force the gate` fills the second in); the Oracle then puts one roll form to you for each delver you picked, with the rules' usual difficulty proposed. At a table whose rules have no roll to call (they decide nothing themselves, or decide without a difficulty to pick), the Castellan tells you so in the Sanctum instead. **Roll** isn't offered under **Words only**.

### Check settings

Under **Edit session › Settings**:

- **Ask me before each check** (on): the Oracle asks you to call each risky moment. Off, and with **Decide checks at once** off, risky moments are told in words.
- **Decide checks at once** (off): under **The rules decide**, every check the plan calls for is decided at once against the rules' usual difficulty, with no form.
- **Show outcomes** (on): see [The outcome](#the-outcome).

## Playing with friends

Invite friends to the session as guests (see [Group sessions](./group-sessions.md) and [Users and accounts](./users-and-accounts.md)). You stay the game master, always: the session's owner runs the dungeon.

- **Taking a seat.** A guest's story composer starts as **Take a seat**: they name the character they'll play and press **Take a seat**, or press **Play one of your personas instead** to bring a character of their own. From then on their lines are that delver's turns, and their composer reads *Write as Maren…*.
- **The Castellan tells you.** When someone takes a seat, the Castellan says so in the Sanctum, where only you read it.
- **Their turns wait for them.** When the plan names a seated player's delver, the turn waits for that player. The turn line reads *Your turn* to them and *Waiting for Maren* to everyone else.
- **Moving past a waiting player.** As the game master, your turn line also offers **Continue**, with the sentence *Continue moves past Maren: their turn is skipped this round.* Press it and the next delver in the plan goes ahead. Only you can do this.
- **What players never see.** The Sanctum, the Castellan's scratchpad, and any whisper but their own delver's.

## The Sanctum and the Castellan

The **Sanctum** is a second conversation beside the story, on its own tab: your table, outside the game. Nobody else ever sees it, not even a seated player. Use it to brainstorm rooms and traps, plan what lies ahead, fix a mistake, or talk the story through with the Castellan.

- **Its greeting.** Every new Lair opens with one message from the Castellan in the Sanctum. It explains how the Lair works, names the party and invites you to start. It's written without asking the model, so it appears at once.
- **Talking with it.** Write a line in the Sanctum and the Castellan answers there, out of character. It reads the Sanctum's conversation, the dungeon's rooms, the party's state and the story's last 12 messages. It never writes a line for the party and never narrates from the Sanctum: ask it what should happen next and it tells you what it would play and that **Narrate** will play it. That rule comes first in its instructions, and a short reminder of it follows your newest line every time.
- **Its tab.** The Sanctum is a tab above the story, beside **Story**: pick it and the conversation shows the Sanctum, and what you write goes there, in a single-line composer. Its **Actions** offer **Continue** (answer your newest Sanctum line) and **Narrate** (the narration lands in the story). When the Castellan writes there while you're on the story, the **Sanctum** tab shows a dot. See [Channel tabs](./session-layout.md#channel-tabs). To keep the Sanctum in view beside the story instead, give it its own panel: add a second **Messages** widget and set its **Channel** to `sanctum` (see [Session layout](./session-layout.md#a-second-messages-widget-for-one-channel)).
- **Seating.** The Castellan is seated in every new Lair. If you unseat it in **Edit session › Participants**, the story still runs, but it no longer answers in the Sanctum.

### What reaches the story from the Sanctum

The setting **Sanctum talk steers the story** (on by default) decides:

- **On.** When the Castellan plans the next turn, it reads what you and it said in the Sanctum since the story's last reply, as plans rather than facts: it follows what you decided and drops what you didn't take up. At most the newest 12 messages of talk are read.
- **Off.** The Sanctum is for brainstorming only. The planner doesn't read the talk.

Whichever you choose, three things always reach the story: a **Nudge**, a room you build or file, and **Narrate** pressed in the Sanctum (which plays the talk since the story's last reply once, even with the setting off). The delvers' own turns never read the Sanctum.

### The Castellan's scratchpad

The Castellan keeps running notes from the Sanctum: rooms you planned together, what you want to happen, corrections you gave it. The routine **Keep the scratchpad** rewrites them after each of its Sanctum replies (one short extra request to the model). The Castellan reads them when it talks with you and, while Sanctum talk steers the story, when it plans a turn. The party never read them.

The notes sit on the right under **Places**, in an **Annex** widget titled *Castellan's scratchpad*, with an **Edit** button once there are notes. They're also under **Edit session › Settings › Session data**. Only you see them. A layout without the widget can have it back: add an **Annex** from the tray and set its **Key** to `core.castellan-scratchpad` (see [the widgets](./session-layout.md#the-widgets)).

## Keeping the books

The routine **Keep the books** works out what each round changed: a wound, a coin spent, a torch picked up, the party moving to another room, what lies in a room. Under **Rules** and **The rules decide** it works by the session's rules; under **Words only** it keeps the books in words.

Find it under **Edit session › Settings › Routines**. Like every [routine](./sessions.md#routines) it has three modes:

- **Review** (the default under Rules and The rules decide): each change waits under the turn for you to **Accept** or **Reject**.
- **Full**: changes are applied as they come.
- **Off** (the default under Words only): nothing keeps the books unless you change a stat yourself.

Its **When it runs** is **After each round** (once everyone has had their turn) unless you pick **After each turn**, which keeps the books after every line and costs a model call each time.

## Rooms

Rooms are an optional layer: the loop runs without them. The setting **Rooms** (on by default, off and locked under **Words only**) turns them on. Rooms are the lorebook's place entries, and they're yours to approve, never the model's to file on its own.

### The party knocks

When the planner sends the party through a way out to a room nothing describes yet, the turn stops. Instead of playing a room nobody built, the Oracle asks you to describe it, in the story. Nothing else is written: no beats, nobody speaks.

The question has one button, **Describe *the room*…**, which opens a small window:

- **Write the room.** What you write is saved to the lorebook exactly as you wrote it, with no review: they're your own words. You don't need to write the way back. Other ways out can go in an *Exits:* line, such as *Exits: north → the Old Well*.
- **Leave it empty.** The Castellan drafts the room, and the draft waits for your review: rename it and edit the text before it's saved. A draft fills in only what the session's rules describe for a place, and nothing they don't.

The room is named after the door the party knocked at. Once saved, it's **linked to the room the party stand in**, both ways (*leads to*), so the next turn's planner sees the way through. Then a line of yours, *The party go on into …*, is added and the story carries on by itself. If you reject the Castellan's draft, nothing is saved and the knock opens again.

**Answer the door** (`/room`) appears in the composer's actions only while a knock is waiting. It opens the same window. `/room <text>` answers straight away with your description.

### When the party don't knock

Only a place nothing describes yet knocks. The party walk through a way out, without knocking, when:

- a lorebook entry of any kind has that name or a key with it; or
- among the last 40 messages in the story and the Sanctum, a paragraph you or the Castellan wrote names it and has at least 12 other words. A delver's line doesn't count, nor do the Castellan's beats or greeting.

So you can describe a room in the story, or tell the Castellan about it in the Sanctum. Names match ignoring case, punctuation and a leading *the*, *a* or *an*, and only whole names count: *the vault* is not *the sunken vault*.

### Building and filing rooms

- **Build room** in the composer writes one without waiting for a door: give the room's name, then edit what the Castellan drafts before it's saved.
- **File as a room**, in a message's **⋮** menu, turns a message that describes a room into one. Give the room's name (a message can describe more than one room); the Castellan drafts a place entry from that one message, with an *Exits:* line for every way out the message names, and the draft waits for your review. It's offered on your own messages and the Castellan's, in the story and the Sanctum; on a delver's line it's greyed. If the lorebook already has an entry by that name, the Castellan says so in the Sanctum instead.
- **File the current room** is a routine, **Off** to begin with. Turn it on in **Settings › Routines** and, when the party walk into a room the story described only in prose, the Castellan drafts it for your review.

**Exits become links.** A room saved with an *Exits:* line and no links of its own gets one link for each way out that names a room the lorebook already has. A name that matches no room, or more than one, is left for you: open the room and press **Read links from the Exits line** in its Links section, or link it on the lorebook's **Show as › Map** (see [Lorebooks](./lorebooks.md#the-entry)). Links the Lair writes are dated at the session's point in the story.

### What the party read of the rooms

The party's current room is the world's **Location**, which the Castellan moves as the party walk. The planner, the delvers and the Castellan read the room the party stand in with its ways out under it:

```
The Guardroom
A bare room with a brazier.
From here:
- The rusted iron door leads north to The Drowned Hall.
```

A delver is told what lies in their own room and nothing about other rooms; everyone knows every room's name. The planner knows what lies everywhere. Only links that stand are listed: a secret link, one that has ended, or one to a room the session can't see is left out.

## Steering from the composer

An action that needs words from you asks for them when you press it: a small window with a box for your text. **Enter** sends, **Shift+Enter** starts a new line, **Cancel** sends nothing.

- **Nudge** sets a standing direction the Castellan's planner reads every turn until you nudge again. It writes no message.
- **Whisper** gives the delvers you pick a standing private note. Its window asks **Who hears it** and **What do you whisper?**, and spells out who will hear it: *Brannoc and Vell will hear this. Isolde will not, and nor will the Castellan.* Only that delver's own turns read it. Players never see another delver's whisper. No model is asked: the note is saved exactly as you typed it. See [Heard by its holder alone](./stats-and-states.md#heard-by-its-holder-alone-earshot).
- **Roll**, above, and **Build room**.
- **Trigger trap** springs a trap in the party's room, and **Reveal** uncovers something hidden there that was there all along. Say what it is (*the floor tilts into a pit of spikes*), or leave the box empty and the room decides. Either way you get one Castellan message in the story, and the party react on the next turn.

With text after the name, a slash command runs at once: `/nudge the ceiling drips`. `/whisper <text>` opens Whisper's window with the text filled in, to ask who hears it. See [Slash commands](./sessions.md#slash-commands).

## Continue, Pick who speaks and Narrate

- **Continue** moves the story on. With delvers still to speak, the next one takes their turn; with a seated player's turn waiting, your Continue moves past them. When nothing is waiting, the Castellan takes a turn with no new direction: the party simply carry on.
- **Narrate** (`/narrator`, or the first row of **Pick who speaks**, *Castellan*) asks the Castellan to narrate what happens next. The narration lands in the story whichever composer you pressed it in.
- **Pick who speaks** gives one delver the turn alone, with no planning and no beats. Every turn leaves its record in the run inspector, a picked one included.
- **Regenerate and swipe** on a delver's message re-voice that delver and keep the other versions as swipes. Your own lines are never regenerated: edit them instead. A Lair reply is planned in one piece, so the message menu offers no **Extend**.

## Regenerate the last turn

A Lair turn writes several messages: the beats in the Sanctum, the Oracle's roll forms and outcomes, then one per delver who spoke. **Regenerate the last turn** takes that whole turn again. It is the third press in the session's header, after **Back** and **Forward** (on a phone, the third item of the header's **⋯** menu), and not in the composer. See [Regenerate the last turn](./sessions.md#regenerate-the-last-turn).

1. A dialog, **Regenerate the last turn?**, names what goes: *This deletes and rewrites: Brannoc and Vell, and the turn's lines on Sanctum.*
2. **Regenerate** takes the whole turn after your line, every reply of it, as **Back** does, on both conversations, along with any stat change or proposal they made. Your own lines are never taken, and nor is anything you did after the turn.
3. The same turn runs again from its start. Under **On revision: Branch** the session branches first and the turn is played there.

Tick **Don't ask again for this session** to skip the dialog; **Ask before regenerating a turn** in the settings brings it back. Only you can do this, and only while nothing is being written. It's grey, with the reason, when your own line is the newest (*Your line is the newest. Press Continue.*), when nothing has been written yet, or when the newest message came from **Trigger trap** or **Reveal**. In an [archived session](./sessions.md#archive-and-unarchive) it is grey too.

## What your lines are called

Your messages show the name **Dungeon Master**, and the AI reads them under that name. With guests at the table, the name of whoever wrote the line follows it in muted text: *Dungeon Master · jody*. To call yourself something else, such as *Game Master*, open **Edit session › Settings › What your lines are called**. The name isn't saved on the messages, so a rename relabels every line you've already written.

## Lair settings

Under **Edit session › Settings**:

| Setting | What it does |
| --- | --- |
| **Tone** | Grounded, pulpy, grim or whimsical. |
| **Rooms** | On by default. See [Rooms](#rooms). |
| **Sanctum talk steers the story** | On by default. See [What reaches the story](#what-reaches-the-story-from-the-sanctum). |
| **Ask me before each check** · **Decide checks at once** · **Show outcomes** | See [Check settings](#check-settings). |
| **What your lines are called** | Your lines' name, *Dungeon Master* when empty. |
| **Ask before regenerating a turn** | Brings back the dialog you turned off with *Don't ask again*. |

**Rules** and **How strict** are the session's own (see [Rules](./rulesets.md)); **Routines** lists **Keep the books**, **Keep the scratchpad** and **File the current room**. A preset can lock a setting: **Words only** locks How strict and Rooms, and **The rules decide** locks How strict. Neither locks the rules.

## Stats

The Lair declares no stats of its own: what the party carry is the session's **rules'**. Under Vis Itineris, a delver's health, abilities, class and gear; under Freeform, nothing counted, and the sheet says _This session's rules declare no attributes_. The Lair **plays best with** the party's health, what ails them and somewhere to keep what they carry, and the Rules card says which of those your rules tell in words instead.

Serene Pub keeps the rest itself, and none of it is ever one of the rules' attributes:

- **The world's Location**: where the party are, in a **Where and when** row on the sheet.
- **What someone carries**: each delver's **Inventory**, what lies about in the world and what lies in each room, as a list under the sheet. The Castellan hands out the lorebook's items on it, keeping to each item's supply.
- **Your tools**: the **Direction** you set with Nudge, and each delver's **Whisper**. Only the Castellan's planner reads the direction, and only a delver's own voice their whisper.

Changes wait for you as described in [Keeping the books](#keeping-the-books). See [Stats and states](./stats-and-states.md).

## Scenes

A Lair keeps [scenes](./sessions.md#when-a-new-scene-begins) like any session, with one moment of its own: **The place changes** follows the party's **Location**. When the Castellan moves them into another room (or you change it yourself), a new scene is suggested at the next line, named after the room, such as *Scene 4 · the Crypt*. Switch it off under **Scenes** in the session's settings. Talk in the Sanctum never suggests a scene.

## Coming from an older Lair

A Lair session started before this version opens on the **Rules** preset. A Lair started before the Sanctum became a tab keeps its Sanctum panel on the right: press **Reset to genre default layout** on the layout editor's **Layouts** tab to have it as a tab instead. **How the party speak** is gone: each delver always speaks for themselves. **Apply the Castellan's stat changes without asking** became the mode of **Keep the books** (on became **Full**). The world's **Floor** and **Gold**, and each delver's **Stamina** and **Trust**, are kept as the session's own stats, so nothing you tracked is lost; the Lair no longer moves them by itself. Since stats became the rules' alone, a value on one the session's rules don't keep (Health or Mood under Freeform) is written into the session's notes, under **Carried over from before**.

## What it doesn't do yet

- A guest can't take over a delver already in the party: they name a new one or bring a persona.
- **Roll** and **Whisper** offer the AI delvers only: a seated player's delver isn't in **Who rolls** or **Who hears it** yet.
- **Words only** keeps the **Places** panel in its layout, though it builds no rooms. Close it yourself if you like (see [Session layout](./session-layout.md)).
- Nothing in the dungeon happens by itself between turns: no wandering monsters, no traps that spring on their own.

## Related

- [Genres](./genres.md): how the Lair compares with the other kinds of session.
- [Dungeon Crawler](./genre-dungeon-crawler.md): the AI runs the dungeon, and you play a character.
- [Rules](./rulesets.md): how the rules decide, and How strict.
- [Lorebooks](./lorebooks.md) and [Places](./lorebook-places.md): where the rooms live.
- [Group sessions](./group-sessions.md): turn order, Continue and guests.
