# The Lair

In a Lair session you are the dungeon, and the party of adventurers delving into it is played by the AI.

:::tip What it's for
- Building a dungeon room by room while an AI party explores it.
- Steering a story from behind the screen: you set the scene, spring traps and whisper to the party, and they decide what to do.
:::

## The basics

Nothing you type in a Lair is a line of dialogue. What you send is **direction** from whoever runs this place, such as *the torches gutter as they reach the stair* or *the cleric is more frightened than she lets on*, and the party answer for themselves.

**You are the narrator.** Nothing narrates a turn for you. You don't play a persona either: you are not in the scene, and your lines are labelled **Dungeon Master**.

A Lair needs:

- **at least one character**, who make up the party (the *delvers*);
- **a lorebook**, which is the dungeon: one place entry per room, linked to the rooms it leads to.

The Lair writes rooms into that lorebook as you play, because building rooms is the game.

:::note You'll need
A lorebook you're happy for the Lair to add rooms to. Your **Lorebook writes from sessions** setting (in **Settings › User**) must not be **Off**, or the Lair can't save rooms and says so. See [What a session may write](./lorebooks.md#what-a-session-may-write).
:::

### Your first turn

1. Start a session, pick the **Lair** genre, choose your party and a lorebook, and press **Start**.
2. Read the Castellan's greeting in the **Sanctum** panel on the right. The Castellan is the dungeon's steward and your assistant.
3. In the story, write where the party stand and what they notice, and send it.

:::tip You should see
The Castellan's plan for the turn appears in the Sanctum as a short list. Then each delver it named speaks in the story, one message each.
:::

## What your lines are called

Your messages show the name **Dungeon Master**, and the AI reads them under that name. In a session with guests, the name of whoever wrote the line follows it in muted text: *Dungeon Master · jody*. The composer's placeholder reads *Write as the Dungeon Master…*.

To call yourself something else, such as *Game Master*, open **Edit session › Settings › What your lines are called**. Leave it empty to go back to Dungeon Master. The name isn't saved on the messages themselves, so a rename relabels every line you've already written, both on screen and in the next prompt.

## The Sanctum and the Castellan

The **Castellan** runs each turn. It plans the party's moves, posts the plan in the Sanctum, hands the party their turns, keeps the world's books, and knocks when the party reach a room you haven't built. When you want the dungeon to act without writing it yourself, press **Narrate** and the Castellan narrates what happens next.

The **Sanctum** is a second conversation beside the story: your table, outside the game. The party never hear what is said there. Use it to brainstorm rooms and traps, plan what lies ahead, fix a mistake, or talk the story through with the Castellan.

- **Its greeting.** Every new Lair opens with one message from the Castellan in the Sanctum. It explains the reverse dungeon, names the party and invites you to start. It's written without asking the model, so it appears at once.
- **Talking with it.** Write a line in the Sanctum and the Castellan answers there, out of character. It reads the Sanctum's conversation, the dungeon's rooms, the party's state and the story's last 12 messages. It never writes a line for the party and never narrates from the Sanctum: ask it what should happen next and it tells you what it would play and that **Narrate** will play it.
- **Its panel.** The Sanctum has its own panel on the right (on a phone, one of the side views in the panels menu), with its own composer. What you write there goes to the Sanctum; the story in the middle shows the story alone. Its **Actions** offer **Continue** (answer your newest Sanctum line) and **Narrate** (the narration still lands in the story). The panel is a second Messages widget set to the Sanctum: see [Session layout](./session-layout.md#a-second-messages-widget-for-one-channel). A layout without that panel shows a small switch above the story's composer instead, with **Main** (the story) and **Sanctum**.
- **Seating.** The Castellan is seated in every new Lair. If you unseat it in **Edit session › Participants**, the story still runs, but it no longer answers in the Sanctum: Continue there says *Castellan is not seated in this session*.

### What reaches the story from the Sanctum

The setting **Sanctum talk steers the story** (Edit session › Settings, on by default) decides:

- **On.** When the Castellan plans the next turn, it reads what you and it said in the Sanctum since the story's last reply, as plans rather than facts: it follows what you decided and drops what you didn't take up. Talk from before the story's last reply has already been played and isn't read again. At most the newest 12 messages of talk are read.
- **Off.** The Sanctum is for brainstorming only. The planner doesn't read the talk.

Whichever you choose, three things always reach the story: a **Nudge**, a room you build or file, and **Narrate** pressed in the Sanctum (which plays the talk since the story's last reply once, even with the setting off). The party's own turns never read the Sanctum.

### The Castellan's scratchpad

The Castellan keeps running notes from the Sanctum: rooms you planned together, what you want to happen, corrections you gave it. It rewrites them after each of its Sanctum replies (one short extra request to the model) and reads them when it talks with you and, while Sanctum talk steers the story, when it plans a turn. The party never read them.

To read or correct the notes, open **Edit session › Settings › Session data** and find **Castellan's scratchpad**. Its **Edit** button saves your version, which the Castellan then works from. See [Session data](./sessions.md#session-data).

## How a turn runs

1. **Your direction.** Everything you've sent since the last reply is this turn's direction, oldest first.
2. **The plan.** The Castellan plans **the party only**: what each of them does, who speaks and why, and whether they try a door the dungeon doesn't have (see [The party knocks](#the-party-knocks)). What the *dungeon* does is yours: your lines, a narration you asked for, a trap or a reveal. The planner never invents a dungeon event. While it works, the progress card reads **The Castellan is planning the turn**, and stopping now writes nothing.
3. **The beats, in the Sanctum.** The plan is posted in the Sanctum as one short list, so you can read what the party are about to do.
4. **The party speak**, in the planner's order, the way **How the party speak** says (below).
5. **The books.** The Castellan proposes what changed in the world: the purse, the floor, where the party are, what lies in a room. The change is filed with the beats. Each delver's own stats are kept by whoever wrote their line: their own turn, or the Castellan when it speaks for the party.

A delver's message carries their line, with the model's reasoning folded under **Reasoning** when it gives one. The planner's reasoning never reaches a message; an administrator can read it in the run inspector. None of this is sent back to the model as part of the story.

## How the party speak

Nobody leads the party: the planner's order is the order they speak in. How they speak is the session setting **How the party speak** (Edit session › Settings):

- **Each delver speaks** (the default). Each delver the planner named takes a **character turn** of their own: a message under their own name, in their own voice, streamed as it's written. They may act as they speak (*I kick the door*). Each turn is shown only what that delver knows: their own private lore and whatever you whispered to them, never another delver's. While the turns are under way, the *ready to continue* line names the next delver. **Stop** ends the round, and nobody else speaks until you press **Continue** or write. Writing a line of your own moves the story on: the delvers who hadn't spoken yet don't, and the Castellan plans afresh.
- **Castellan speaks for the party.** One request writes the whole turn: the Castellan writes each named delver's words and actions, each on its own line under their name, in one message under the Castellan's name. It's cheaper (one request a turn instead of one per delver), and it knows only what the whole party could know: no private lore, nothing whispered.

**What each sees of the rooms.** A delver taking their turn is told what lies in the room they stand in and nothing about other rooms. The Castellan speaking for the party is told what lies in the party's room and in the rooms one way on from it. Everyone knows every room's name. The Castellan's planner knows what lies everywhere.

**Who keeps which books.** Whoever writes a delver's line keeps that delver's stats: their health, stamina, mood, trust and inventory. The Castellan always keeps the world's: the purse, the floor, where the party are, and what lies in each room.

- With **Each delver speaks**, each character turn keeps its own delver's stats, filed with their own line.
- With **Castellan speaks for the party**, the Castellan also keeps the stats of the delvers it wrote lines for that turn. A delver who didn't speak that turn keeps theirs untouched: a change the Castellan reports for them is refused. A line written by **Pick who speaks** in this mode changes no stats, since nothing is planned and no books are kept on a pick.

In the session's pipeline settings, the party's model calls are listed as **Character turn** (one prompt, model and sampling for every delver) and **Castellan speaks for the party**.

## Continue, Pick who speaks and Narrate

- **Continue** moves the story on: the Castellan takes a turn. When nothing is waiting, for example because you deleted the last reply, your Continue still gives the Castellan a turn with no new direction: the party simply carry on. Nothing continues by itself in a loop.
- **Narrate** (`/narrator`, or the first row of **Pick who speaks**, *Castellan*) asks the Castellan to narrate what happens next, in the third person. The narration lands in the story whichever composer you pressed it in. The party answer on the next turn.
- **Pick who speaks** gives one delver the turn alone, with no planning and no beats. With **Each delver speaks** it is that delver's own character turn; with **Castellan speaks for the party** the Castellan writes that delver's line into the delver's own message.
- **Regenerate and swipe** on a delver's message re-voice that delver and keep the other versions as swipes. Regenerating a narration narrates again. Your own lines are never regenerated or swiped: edit them instead.
- **No Extend.** A Lair reply is planned in one piece, so the message menu offers no **Extend**.

## Regenerate the last turn

A Lair turn writes several messages: the beats in the Sanctum, then one per delver who spoke. The composer's **Regenerate** (`/retake`) takes that whole turn again rather than rewriting only its last message:

1. A dialog, **Regenerate the last turn?**, names what goes: *This deletes and rewrites: Castellan (sanctum), Brannoc, and Vell.*
2. **Regenerate** deletes every message that turn wrote, on both conversations, along with any stat change or proposal they made. Your own lines are never deleted, and nor is anything you did after the turn: a Nudge, a Whisper, or a change you accepted or made yourself stays.
3. The same turn runs again from the same point.

Tick **Don't ask again for this session** to skip the dialog. To be asked again, turn **Ask before regenerating a turn** back on in Edit session › Settings.

Only the session's owner can do this, and only while nothing is being written. It's refused, with a reason, when your own line is the newest (press **Continue** instead) or when the newest message came from **Trigger trap** or **Reveal** (regenerate that from its own message menu).

A message's own **Regenerate** still rewrites one message: a delver's line, a narration, a picked delver, or a Castellan reply in the Sanctum. On the beats message, it takes the whole turn again, like the composer's. On a knock, it's refused with a pointer to the composer's **Regenerate**, which deletes the knock and takes the turn again.

## The party knocks

When the planner sends the party through a way out to a room nothing describes yet, the turn stops. Instead of playing a room nobody built, the Castellan asks you to describe it, in the story. Nothing else is written: no beats, nobody speaks.

The question has one button, **Describe *the room*…**, which opens a small window:

- **Write the room.** What you write is saved to the lorebook exactly as you wrote it, with no review: they're your own words. You don't need to write the way back. Other ways out can go in an *Exits:* line, such as *Exits: north → the Old Well*, until you link them.
- **Leave it empty.** The Castellan drafts the room, and the draft waits for your review: rename it and edit the text before it's saved.

The room is named after the door the party knocked at. Once saved, it's **linked to the room the party stand in**, both ways (*leads to*), so the next turn's planner sees the way through. If the party's **Location** doesn't name a room yet, the room the planner named as it knocked is used; if neither does, the room is saved without a link and you can link it yourself on the lorebook's Places lens. Then a line of yours, *The party go on into …*, is added and the story carries on by itself.

If you reject the Castellan's draft, nothing is saved and the knock opens again.

**Answer the door** (`/room`) appears in the composer's actions only while a knock is waiting. It opens the same window. `/room <text>` answers straight away with your description.

### When the party don't knock

Only a place nothing describes yet knocks. The party walk through a way out, without knocking, when:

- a lorebook entry of any kind has that name or a key with it; or
- among the last 40 messages in the story and the Sanctum, a paragraph you or the Castellan wrote names it and has at least 12 other words. A delver's line doesn't count, nor do the Castellan's beats or greeting.

So you can describe a room in the story, or tell the Castellan about it in the Sanctum. A room described only in a message, not in the lorebook, is shown to the party as they walk in.

Names match ignoring case, punctuation and a leading *the*, *a* or *an*, and only whole names count: *the vault* is not *the sunken vault*.

## Rooms

Rooms are the lorebook's place entries, and they're yours to approve, never the model's to file on its own.

- **Build room** in the composer writes one without waiting for a door: give the room's name, then edit what the model drafts before it's saved.
- **File as a room**, in a message's **⋮** menu, turns a message into a room (below).
- The party's current room is the world's **Location**, which the Castellan moves as the party walk. It finds a room by the same name rules as the knock. A name two rooms answer to alike is refused rather than guessed, and so is a room the session can't see (switched off or archived).

The ways between rooms are **links**: one per way, with its words from each end (*leads north to* / *leads south to*), drawn on the lorebook's Places lens or in a room's own links. The planner, the party and the Castellan read the room they stand in with its ways out listed under it:

```
The Guardroom
A bare room with a brazier.
From here:
- The rusted iron door leads north to The Drowned Hall.
- Is inside The Rusty Flagon.
```

Only links that stand are listed: a secret link, one that has ended, or one to a room the session can't see is left out. A room is read into every delver's prompt, so it names only what all of them may know.

Every room the Castellan drafts is given the names of the rooms the dungeon already has, so its *Exits:* line points at rooms that exist. A draft reads only the public part of the lorebook, never anyone's character lore. **Build room** and **File as a room** write no links themselves: open the room in the lorebook and press **Read links from the Exits line** in its Links section to turn that line into links you confirm (see [Lorebooks](./lorebooks.md#the-entry)).

### File as a room

A room is often written in prose first: you narrate the party into it, plan it with the Castellan, or the Castellan describes it in a narration. **File as a room** turns that message into a room:

1. Choose **File as a room** in the message's **⋮** menu and give the room's name. The name is required, because a message can describe more than one room.
2. The Castellan drafts a place entry from that one message, with an *Exits:* line for every way out the message names. It invents none.
3. The draft waits for your review. It's saved only when you approve it.

It's offered on your own messages and the Castellan's, in the story and in the Sanctum. On a delver's line it's greyed: *a delver's line is theirs, not the dungeon's plan*. Only the session's owner can file a room. If the lorebook already has an entry by that name, nothing new is filed and the Castellan says so in the Sanctum.

## Steering from the composer

An action that needs words from you asks for them when you press it: a small window opens with a box for your text. **Enter** sends, **Shift+Enter** starts a new line, **Cancel** sends nothing. What you were writing in the composer stays put.

- **Nudge** sets a standing direction the Castellan's planner reads every turn until you nudge again. It writes no message.
- **Whisper** gives the delvers you pick a standing private note. Its window asks **Who hears it** and **What do you whisper?**, and spells out who will hear it: *Brannoc and Vell will hear this. Isolde will not, and nor will the Castellan.*
  - Each delver you pick gets the same note, replacing the one they held. Delvers you don't pick keep theirs.
  - Only that delver's own turns read it: no other delver, and none of the Castellan's work. To let a whispered delver act on it now, use **Pick who speaks**. See [Heard by its holder alone](./stats-and-states.md#heard-by-its-holder-alone-earshot).
  - Only you see whispers. A guest sees none, and can't change or clear one.
  - No model is asked: the note is saved exactly as you typed it.
- **Build room**, above.
- **Trigger trap** and **Reveal**, below.

With text after the name, a slash command runs at once: `/nudge the ceiling drips`. `/whisper <text>` opens Whisper's window with the text filled in, to ask who hears it. See [Slash commands](./sessions.md#slash-commands).

## Trigger trap and Reveal

Two buttons for moments you want to happen *now*:

- **Trigger trap** springs a trap in the party's room, and the Castellan tells what it caught and what it cost.
- **Reveal** uncovers something hidden in that room that was there all along, such as a seam in the floor or a name cut into a doorframe.

Say what it is in the window that opens (*the floor tilts into a pit of spikes*) and the Castellan writes exactly that. Leave the box empty and the room decides, from its lore and the party's state. Either way you get one Castellan message in the story. The party react on the next turn. Neither changes any stats by itself.

## Lair settings

Under **Edit session › Settings**:

| Setting | What it does |
| --- | --- |
| **Tone** | Grounded, pulpy, grim or whimsical. |
| **How the party speak** | **Each delver speaks** (default) or **Castellan speaks for the party**. See [How the party speak](#how-the-party-speak). |
| **Apply the Castellan's stat changes without asking** | Off by default: each change waits for you to accept it. |
| **Sanctum talk steers the story** | On by default. See [What reaches the story](#what-reaches-the-story-from-the-sanctum). |
| **What your lines are called** | Your lines' name, *Dungeon Master* when empty. |
| **Ask before regenerating a turn** | Brings back the dialog you turned off with *Don't ask again*. |

## Stats, inventory and supply

- **Each delver** carries **Health**, **Stamina**, **Mood** and **Trust**, an **Inventory**, and any whisper you gave them.
- **The world** carries its **Location**, the **Floor**, the party's **Gold**, the **Direction** you set with Nudge, and its own **Inventory**.
- **Each room** can hold an **Inventory** of its own: what lies there.

Changes proposed after a turn wait under the turn for you to **Accept** or **Reject**, unless **Apply the Castellan's stat changes without asking** is on. A world change can be accepted while its turn is still the newest. The Lair checks an item's supply: a one-of-a-kind relic someone already holds, or more of a limited item than is left, is refused rather than offered to you. See [Stats and states](./stats-and-states.md).

## What it doesn't do yet

- There's no map of the rooms you've built; the right-hand column shows the world's state.
- An *Exits:* line in a room's text isn't turned into links when the room is saved. Only answering a knock links a room by itself. For the rest, use **Read links from the Exits line** or link them yourself.
- A link the Lair writes isn't dated at the session's story clock: it stands at every moment of the lorebook's line.
- A room described in prose isn't filed for you. Use **File as a room**.

## Related

- [Genres](./genres.md): how the Lair compares with the other kinds of session.
- [Adventure](./genre-adventure.md): the same world, with you in it.
- [Lorebooks](./lorebooks.md) and [Places](./stats-and-states.md#places): where the rooms live.
- [Group sessions](./group-sessions.md): turn order, Continue and auto-advance.
