# Stats and states

A stat is a number or a word that belongs to somebody and changes: health, mood, gold, the
weather. Serene Pub calls one of these an **attribute slot**, and this page is about where
slots come from, where their values live, and who is allowed to change one.

Nothing here is switched on by default. The standard **Chat** genre declares no slots at all,
so a chat session shows no bars, offers the AI no way to change anything, and reads exactly as
it always has. Slots arrive with a genre that wants them, an extension, or an administrator.

## What is a slot, and what is not

Most requests for "stats" turn out to be one of four different things, and Serene Pub keeps
them apart on purpose:

| You want to track…                            | It lives as                                   | Example                                                   |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| a named topic with prose worth quoting        | a [lorebook entry](./lorebooks.md)            | Fireball, the Lamplighters' Guild, a sword with a history |
| that one thing relates to another             | an edge — a relationship, or a **possession** | Verity _has_ the sword                                    |
| a typed value about one owner that changes    | an **attribute slot**                         | health 12/20, mood wary, weather storm                    |
| something you could work out from other facts | a **derived slot**, never stored              | age, from a birthdate and today's date                    |

An inventory is the second row, not the third: an item is an entry, with its own text and
keywords, and "Verity is carrying it" is a possession edge pointing at that entry. Rename the
entry and every inventory holding it renames with it.

A slot has one of five kinds, and that list is fixed:

- **Whole number**, with an optional floor and ceiling — drawn as a bar when it has both.
- **One of a set** — drawn as a chip.
- **Text** — one line.
- **On or off**.
- **Derived** — computed whenever it is read, and never written down.

## Where a value comes from

The same slot can be answered in three places, and a read takes the nearest answer:

1. **The session** — this run, live, diverging from the first message.
2. **The lorebook** — what this world says, shared by every session using it.
3. **The character card** — what this character starts as, wherever they turn up.
4. **The declaration's own default**, if none of the above has an answer.

Compressed: **card is the template, lorebook is the world, session is the instance.**

Each layer stores only what it _changes_. A session that has never touched Verity's health
reads the world's; a world that has never touched it reads her card's. That is why a blank is
never a zero — a slot nobody has answered anywhere is **absent**, not nothing. It also means
that if a genre raises a default later, every character nobody overrode picks the new one up.

Clearing a value in a session does not set it to nothing: it goes back to inheriting.

Attaching a slot works the same way. "Health, maximum 20" is what a card says; a world may
raise the cap to 40 for one character; a session may raise it again because she grew during
play. A value is checked against the cap in force for that character, so 35 is refused on one
character and accepted on another.

## Who can change one

Three people write to a stat, and they do not have equal authority.

| Who                                                    | What happens                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **You**                                                | Applied immediately. Editing a bar is the plainest statement of intent there is. |
| **A pipeline the genre ships** — a damage roll, a shop | Applied immediately, recorded as coming from that run.                           |
| **The AI**                                             | **Proposed.** Nothing changes until you accept it.                               |

The third row is the important one. When a genre offers the AI the state tools, the model can
ask to set a value or move an item — and what it produces is a pending line with **Accept** and
**Reject**, not a change. A model that could silently rewrite a character between two messages
would leave you with no way to disagree and nothing to point at afterwards.

Accepting a proposal records it as the model's change that you agreed to, which is a different
sentence from "you set it" — and it is what makes "why is my health 3" answerable.

A proposal is checked against the slot before it is ever held for you. A stat has a type and
bounds, and an option list has exactly the words it has, so a model asking for stamina 90 on a
slot that stops at 10, or for weather "Overcast with Storm Clouds", gets a refusal recorded on
the run's receipt rather than a pending line you could only reject. What reaches you as a
decision is a change that would actually apply.

## Swipes, regenerates and taking things back

Every value and every possession is anchored to the message that changed it. So:

- **Delete a message** and everything it changed goes with it.
- **Regenerate a reply, or swipe to a new one**, and the same thing happens — the reply that
  wounded her is gone, so the wound goes too, and the new reply proposes its own.

This is what keeps a stat sheet honest without you having to reconcile it by hand. It also
means a stat change is only ever as durable as the sentence that justified it.

## In a prompt

A genre's prompt template can read the resolved values — `state.world.weather`,
`state.cast.verity.hp` — and render them however it likes, usually as a line of prose the model
reads ("Verity: 14/20, wary; carrying a rusty key"). Only the resolved value is visible to a
template: which layer a number came from is a question for the editing screens, not for a
prompt.

A pipeline reads them through the **Session state** step and changes them through the
**Set state** step. Set state asks by default and applies only when the genre's author says so
— see [Pipelines](./pipelines.md).

## Genres that bring slots

A slot is declared by a genre, and a session gets the vocabulary of the genre it was created
under, not every slot the installation happens to know about. That is why installing a genre
with stats does not put a health bar on your chats: the standard **Chat** genre declares
none, so its sessions have none, whatever else is on the machine.

The **Adventure** genre is the one core ships that does. It brings seven: **Health**,
**Stamina**, **Mood** and **Trust** on each cast member, and **Location**, **Time of day** and
**Weather** on the world. Nothing is written when a session is created: a value is read down
the chain (session, then the world, then the card, then the declaration's own default), so a
fresh adventure already has them and a character whose card raises the health maximum keeps
that maximum. See [Sessions](./sessions.md#adventure) for what the genre does with them.

An extension or an administrator may declare more, under their own names. A genre declaring
none is not a genre that lost a feature; it is a session where no bar is ever drawn.

## In a session

Three panels show stats while you play, and none of them is on by default. Open the layout
editor's **Move** tab and add them from the tray (see
[Session layout](./session-layout.md)); a genre that wants them from the first message ships a
layout preset with them already placed. Each has its own settings on the same hover card every
panel uses.

**Stats** is one card per cast member. A whole number with a floor and a ceiling is drawn as a
bar (`14/20`), one of a set as a chip, text as a line, on-or-off as a toggle, and a derived
value greyed out because there is nothing to write. Click a bar, a chip or a line to edit it;
what you type is applied at once, because you are the one writer whose intent needs no review.
Clearing a field does not set it to nothing, it goes back to inheriting. Its settings choose
**which members** (whoever has a stat in play, everyone in the cast, or names you list), how
**dense** the cards are, and **which stats** to show.

**Inventory** lists what everyone is carrying. An item is a lorebook entry, so clicking one
opens its text, and renaming the entry renames it everywhere. Drag an item onto somebody else
to hand it over, or use the **Give to** buttons inside an opened item, which do the same thing
without a mouse. The **On the table** group holds what nobody is carrying, so dropping
something there is putting it down. Its settings turn that group off and switch the grouping
between owner and item.

**World State** is the session's world stats, editable, meant to sit above the messages as a
strip (or down a side column as a list). These are the values a prompt reads as
`state.world.*`, so what you set here is what the model is told.

**Scene Portraits** can draw a mini bar row under each portrait instead: turn **Show stat
bars** on in its settings. A portrait is a picture rather than a person, so the bars appear
under one pinned from a character's avatar and not under one pinned from their gallery.

### Under the messages

A turn that changed something carries a compact line under the message:

> **Verity** hp 20 → 14 · +rusty key · mood calm → wary

Every part of that line is a real row anchored to that message, which is why deleting the
message or swiping to a different reply takes the changes with it. A message that changed
nothing shows nothing.

When the AI asks for a change, the line reads as a request with **Accept** and **Reject**
beside it, and nothing has happened yet. **Review** opens the same list for the whole session,
for the ones that have scrolled out of sight. Accepting records it as the model's change that
you agreed to; rejecting leaves the world as it was.

## Derived slots

A derived slot is computed every time it is read and is never stored, because a stored age is
a wrong age the day after you store it. Serene Pub ships one derivation, **age**: a birthdate
on the character, read against the story's present date.

If either is missing, age is **absent** rather than zero. A character with no birthdate is not
newborn, and a world with no calendar has not just begun.

## What is not built yet

- **As-of reading.** Values and their configuration both record which message they start from,
  and the resolution above always answers "what is it _now_". Asking what a stat was at message
  47 needs the story/session clock, which is a later piece of work.
- **Modifiers** — poisoned, resistance, proficiency. They need a declared stacking order to
  mean anything, and they are deferred until stored and derived slots have been lived with.
- **Editing screens away from the session.** The session panels above exist; the Stats tab on a
  character card and the cast member's own page, where you can see which layer a number came
  from, are the next piece of work.
