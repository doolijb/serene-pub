# Group sessions

A group session has more than one character, and its turn order decides who speaks after each of your messages.

:::tip What it's for
- Scenes with a whole cast: a tavern, a party, a family dinner.
- Controlling who talks when: let everyone answer in turn, pick the next speaker yourself, or let the model decide.
:::

Group sessions are a feature of the **Chat** genre. In [Adventure](./genre-adventure.md) and [the Lair](./genre-lair.md) a planner decides who speaks, so most of this page doesn't apply there; the parts that do (the *ready to continue* line, **Continue**, **Pick who speaks**) are noted as they come up.

## The basics

Add more than one character when you start a session, or later in **Edit session › Participants**. That's all it takes to make a group session.

After you send a message, the characters answer in turn: by default each active character speaks once, in the order they're listed, and then it's your turn again. Drag the characters in **Participants** to change that order.

:::tip You should see
After the last character has spoken, the line beside the composer reads *Your turn*. If you'd rather have someone speak again, press **Continue** or **Pick who speaks**.
:::

## Who is due next

The line beside the composer shows whose turn it is, as the turn order worked it out:

- *Wren is ready to continue*, with **Continue** to let them speak;
- *Narrator is ready to continue* in a narrated genre (*Castellan* in the Lair), also with **Continue**;
- *Your turn* when it's yours, or *Sable's turn* for someone else's persona. A person's turn is taken by writing, so there's no Continue;
- *Waiting for a message — or pick who speaks next* when nobody is lined up, because the round is over or the strategy is **Manual**.

The line hides while you have a draft, while you're editing a message, or while a reply is being written. **Someone else** (or **Pick**) beside it opens *Who speaks next?*, listing everyone who can speak, with the next one marked.

When it's your turn, you also get a notification in [Activity](./getting-around.md#activity), such as *Your turn in The Guard Room*, so you know even when the session isn't open. It clears once you take your turn.

In the Messages widget's settings, **Who is due next** chooses how much the line shows: **Who speaks next** (the default), **Who speaks next and after them** (adds *Then Mira, Tobin*), or **Nothing**. See [Session layout](./session-layout.md).

## Continue and Pick who speaks

Both live in the **Actions** row above the composer, as turn controls:

- **Continue** (`/advance`) lets whoever is next in the turn order speak. With nothing lined up, it says *Nothing is prepared to take a turn.* In Adventure and the Lair, the session's owner gets a narrator turn instead, which carries the story on with no new direction.
- **Pick who speaks** (`/pick-speaker`) lets you choose who speaks next, whatever the turn order says. Search by name, nickname, description or creator notes. In Chat, the narrator is pinned at the top of the list and opens [Narrator Response](#narrator-response); in Adventure and the Lair, it gives the narrator the turn.

Neither starts anything by itself: each press is one turn.

## Choose how the turn order works

The turn order is set in **Edit session › Settings**, on the card for the Chat turn order's **Strategy**. **Pipeline default (Round robin)** is what you get if you change nothing. Choose another and press **Apply**:

- **Round robin**: after each of your messages, every active character speaks once, in order. The default.
- **Round robin by user**: the characters belonging to whoever sent the last message go first. Only useful with several people in one session; alone, it's the same as round robin.
- **Random**: a random active character speaks.
- **Scripted**: round robin, with scripts in charge. An administrator attaches scripts to the turn order's **Order the turns** step in the Pipelines view; the first script to name someone wins, and if none does, round robin decides.
- **Manual**: nobody replies by themselves. Use **Pick who speaks** or **Continue** each time.
- **Narrator replies**: a narrator answers each of your messages instead of a character.

A plugin can add strategies of its own to this list.

### Let the model decide

Chat's **Who speaks next is decided by** setting (in **Genre settings**) offers **The turn order rules** (the default) or **The model**. With the model, each time the order is worked out, the model reads the recent conversation and orders who speaks next among those who haven't spoken since your last message, so a round still ends. It costs one extra model call each time. If the model's answer names nobody who can speak, round robin decides instead.

### How round robin counts

Round robin is **once per message of yours**. A character who has spoken since your last message isn't due again until you write again; when everyone has spoken, it's your turn. Sending twice in a row starts a fresh round.

It's worked out from the conversation itself each time, so nothing gets stuck: picking a character out of turn simply counts as their turn for the round. Hidden messages and narrator responses don't count. Greetings do: a new session whose characters greeted you starts on your turn.

## Auto-advance

**Auto-advance** (in **Genre settings**) decides what happens after you send:

- **Off**: nothing replies until you press **Continue** or pick someone. That's the point of it: you decide when anyone speaks.
- **Next turn**: the next character in line speaks once.
- **Whole round**: Chat's default. The next character speaks, then the next, until the round is over, it reaches a person's turn, or it has run 12 turns for your one message.

Only your own message starts this. Editing or deleting a message, or changing settings, works out the order again but makes nobody speak. **Stop ends the round**: a reply you stop doesn't hand on to the next character.

Adventure and the Lair have no Auto-advance setting: each message you send gets one turn, and in the Lair each delver the Castellan named follows by themselves.

## Bench a character

Each character in **Edit session › Participants** has a switch. Turn it off to **bench** the character: they stay in the session and keep their messages, but they stop speaking, drop out of the list of character names the model sees, and aren't offered as choices. Turn it on again to bring them back. A guest can bench and unbench their own characters.

Benching is better than removing someone you'll want back, because nothing about them is lost.

## Character detail

**Character detail** (in **Genre settings**, in Chat and Adventure) decides how much the model is told about each character **who isn't the one speaking**:

- **Everything** (the default): name, nickname, description and personality.
- **Name and description**: who they are, not how they behave.
- **Only whoever is speaking**: nobody else's card is sent, and the list of character names is empty.

The speaker's own card is always sent in full. Less detail leaves more room for the conversation in sessions with many characters; it never changes who can speak.

## Narrator Response

A **Narrator Response** is a message from the world itself rather than any character: weather, scenery, a shopkeeper, a monster. You ask for one; it never happens by itself and never counts as anyone's turn. It's offered in Chat.

### Ask for one

Press **Narrate** in the **Actions** row, or the narrator row at the top of **Pick who speaks**. A window titled **Narrate** asks:

1. **Who speaks**: the narrator, or a side character you name (anyone, in the cast or not).
2. For the narrator, **What should happen next?** (for example, *The storm breaks over the harbour.*). Leave it empty and the narrator decides. For a side character, **Extra instructions (optional)**.

Confirm, and the message starts writing straight away. What you typed is kept with the message and shown with it.

**From the composer**, type `/narrate the storm breaks` and the narrator writes it at once, with no window. `/narrate` alone opens the window. The **Side character** action opens the same window on a side character.

Only the session's owner can ask for a Narrator Response. It's refused, with a reason, while another reply is being written, or when the direction is longer than 300 characters. Nothing you typed is lost.

### On the message

A Narrator Response shows an icon and the narrator's name: **Narrator**, unless an administrator gave the narrator another name in the pipeline's prompt settings. Each message keeps the name it was written with.

Edit, Branch, Hide, Delete, Regenerate, Extend and Swipe work on it as on any reply, but only for the session's owner. Regenerating or swiping one you gave a direction to sends that direction again.

## Related

- [Sessions](./sessions.md): the session screen and everything you can do with a message.
- [Genres](./genres.md): Chat and the other kinds of session.
- [Session actions](./session-actions.md): how actions, turn controls and slash commands are declared, for power users.
- [Characters](./characters.md): the cards the model reads.
