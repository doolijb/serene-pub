# Stats and states

A stat is a number or a word that belongs to somebody and changes: health, mood, gold, the
weather. Serene Pub calls one of these an **attribute slot**, and this page is about where
slots come from, where their values live, and who is allowed to change one.

Nothing here is switched on by default. The standard **Chat** genre declares no slots at all,
so a chat session shows no bars, offers the AI no way to change anything, and reads exactly as
it always has. Slots arrive with a genre that wants them — and, where the genre allows it,
from the session's world or the session itself (see [What a session tracks](#what-a-session-tracks)).

## What is a slot, and what is not

Most requests for "stats" turn out to be one of four different things, and Serene Pub keeps
them apart on purpose:

| You want to track…                            | It lives as                                   | Example                                                   |
| --------------------------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| a named topic with prose worth quoting        | a [lorebook entry](./lorebooks.md)            | Fireball, the Lamplighters' Guild, a sword with a history |
| that one thing relates to another             | an edge — a **relationship**                  | Verity _trusts_ Marrow                                    |
| a typed value about one owner that changes    | an **attribute slot**                         | health 12/20, mood wary, weather storm                    |
| something you could work out from other facts | a **derived slot**, never stored              | age, from a birthdate and today's date                    |

What someone carries is the third row: their **Inventory**, a [list](#stat-shapes) stat. An
item is still an entry, with its own text and keywords, and the inventory points at it — so
rename the entry and every inventory holding it renames with it.

### Stat shapes

What a slot holds is its **stat shape**. Serene Pub ships four, and a genre, an extension or
a person making a stat picks one of them, so the same kind of value behaves the same way
everywhere:

| Shape          | Holds                                               | Drawn as                                               |
| -------------- | --------------------------------------------------- | ------------------------------------------------------ |
| **Number**     | a whole number, with an optional floor and ceiling  | a bar (`14/20`) when it has both, otherwise the number |
| **Choice**     | one of a closed set of options                      | a chip that opens a menu                               |
| **List**       | an ordered list of lines of text or lore entries    | its items; open it to add, remove and reorder them     |
| **Story time** | a story date, with an optional time                  | as a date line: `Year 412, Mo. 3, Day 5, 22:30`        |

The shape says what kind of value it is; the slot says the rest. Health is a number whose
floor is 0 and ceiling 20; mood is a choice between calm, wary, afraid, angry and hopeful. A
card, a lorebook or a session can change those bounds and options without changing the shape.

A slot can also be **text** (one line) or **on or off**, and an extension can describe a
value more exactly than the four shapes do — a number that takes fractions, say. A **derived**
slot has no shape: it is computed whenever it is read, and never written down.

**Lists.** An inventory, the companions travelling with the party and the clues found so far
are all lists. An item is either a line of text or a reference to a lorebook entry, and a
reference always shows the entry's current title, so renaming the entry renames it in every
list. The same item cannot appear twice unless the slot allows it, and a list with a size
limit refuses a new item when it is full rather than dropping an old one. An inventory is not
a separate feature: it is a list the genre calls `inventory`.

**Items and how many.** A lorebook can hold **items** — things somebody can carry, like a key,
a sword or a letter — as their own kind of entry. Each item says how many of it the world has:
**one of a kind**, a **limited** number, or **unlimited**. A list item that points at an entry
can also say how many of it the owner holds, and it reads that way everywhere: `Rusty key ×2`.
An entry appears once in a list, with its count, rather than twice. Adding more of something
already in a list raises its count; taking some away lowers it, and taking the last one removes
it. A list can only point at entries in the session's own lorebook.

Serene Pub does not stop anybody holding more of an item than exists. The genre decides that:
its pipeline can ask how many are held across the world and the whole cast, and how many are
left, and then refuse, swap or tell the story of a shortage — whatever suits it.

Core offers an **Inventory** stat — a list for a character, for the world, or for a
[place](#places). **Adventure** and
**Lair** track it on every session; another genre that allows its own attributes can add it to a
session, and Chat does not track it. Adventure and Lair also keep an item's supply: when the AI reports
somebody picking up a one-of-a-kind item that someone already holds, or more of a limited item
than is left, that change is refused on the run's receipt rather than offered to you. Handing
something over in the same turn — one person gives it up, another takes it — is fine. What lies
in a place counts toward an item's supply as much as what somebody carries.

In a list, one of an item is written without a count (`Rusty key`); a count appears from two
up (`Rusty key ×2`). Taking all but one away leaves the plain item.

The AI's state-keeper reports items that changed hands in a list called `inventory`, the stat
they land on. If you wrote your own keeper prompt, it has to ask for `inventory`: a list under
any other name is not read.

**Story time** is written year first: `412`, `412-03`, `412-03-05`, or `412-03-05 22:30`.
The year can be negative, and months and days can go past 12 and 31, since a story calendar
doesn't have to match ours. Dates are always sorted part by part, so day 250 of year 3 comes
before day 50 of year 5. Age is worked out from a birthdate written the same way.

A lorebook is free-form until it declares a **calendar** (see
[Lorebooks](./lorebooks.md#calendar-and-clock)). Free-form, nothing rolls over: the day after day 31
of month 1 is day 32 of month 1. With a calendar, months have names and lengths, the next date
rolls over by them, and a date line is written through it: `Tuesday, 5 March, Year 412, 22:30`.
The stored value is the same numbers either way, and dates still sort part by part.

The story's "now" is the lorebook's **clock** on the session's line when one is set, and
otherwise the date of the newest history entry on that line. **Add the next date in sequence**,
over a lorebook's history list, adds a history entry dated the next day (see
[Lorebooks](./lorebooks.md#history-and-scenes)).

## Where a value comes from

The same slot can be answered in three places, with two defaults behind them, and a read takes
the nearest answer:

1. **The session** — this run, live, diverging from the first message.
2. **The lorebook** — what this world says, shared by every session using it.
3. **The character card** — what this character starts as, wherever they turn up.
4. **The sheet's default** — what the sheet that brings the slot into this session says it
   starts at, if it says anything.
5. **The declaration's own default**, if none of the above has an answer.

Compressed: **card is the template, lorebook is the world, session is the instance.**

Each layer stores only what it _changes_. A session that has never touched Verity's health
reads the world's; a world that has never touched it reads her card's. That is why a blank is
never a zero — a slot nobody has answered anywhere is **absent**, not nothing. It also means
that if a genre raises a default later, every character nobody overrode picks the new one up.

Clearing a value in a session does not set it to nothing: it goes back to inheriting.

A [place](#places) has a shorter chain: the session, then the location entry in the lorebook,
then the sheet's default, then the declaration's. There is no card behind a place.

A sheet's default is a starting point, not a value anybody wrote: any value at any layer
above it wins, including a zero or an empty list.

A slot's bounds layer the same way. "Health, maximum 20" is what a card says; a world may
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
ask to set a value or add or remove an item from somebody's inventory — and what it produces is a pending line with **Accept** and
**Reject**, not a change. A model that could silently rewrite a character between two messages
would leave you with no way to disagree and nothing to point at afterwards.

Accepting a proposal records it as the model's change that you agreed to, which is a different
sentence from "you set it" — and it is what makes "why is my health 3" answerable.

A proposal is a delta against the state the model read. The session keeps a **state version**
that every applied change moves by one, and a proposal carries the version it was made against;
accepting one whose value has not moved since applies it, and accepting one whose value *has*
moved — you edited the same bar, say — marks it **superseded** instead: nothing applied, the line
kept under its reply naming what moved, no buttons. See [Sessions](./sessions.md#stats-the-world-and-the-ledger).

A proposal is checked against the slot before it is ever held for you. A stat has a type and
bounds, and an option list has exactly the words it has, so a model asking for stamina 90 on a
slot that stops at 10, or for weather "Overcast with Storm Clouds", gets a refusal recorded on
the run's receipt rather than a pending line you could only reject. What reaches you as a
decision is a change that would actually apply.

## Swipes, regenerates and taking things back

Every value — an inventory included — is anchored to the message that changed it. So:

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

Lists read as their items, and an entry in a list reads as its title and how many are held —
`carrying Rusty key ×2, rope` — so a prompt never shows the raw reference.

A place's values are under `state.locations`, by the place's name — `state.locations.the_crypt.inventory`.
A pipeline and a condition also get `state.locations.byId` and `state.cast.byId` beside them, by the entry's id;
a template gets only the names, and only the stats the session tracks (see
[Context Templates](./context-templates.md#stats-state)). Adventure's state-keeper is told
what lies in each place that holds something ("The Crypt: inventory Rusty key.") and may move
items into or out of a place by naming it as the lorebook does.

### Heard by its holder alone (earshot)

Most values reach every prompt that reads the state. A slot can instead be declared **heard by
its holder alone** (`earshot: 'holder'`): only the prompt written in the voice of the cast
member who holds the value reads it. The Lair's **Whisper** works this way. When the dungeon's
master whispers to Brannoc and Vell, each of them holds the note, and each one's own voice reads
it the next time they speak. It never reaches a delver who wasn't picked, or any of the
Castellan's prompts (its planning, its books, its narration, its Sanctum talk), and a trap, a
reveal or a room build doesn't see it either.

This only changes what prompts read. The **Session state** step still carries the value, and
the Stats widget still shows it to you, because what a person sees follows who the value is
shown to, not its earshot. Only a slot that attaches to cast members alone can be declared this
way: a world or a place has no voice of its own to hold it.

A pipeline reads them through the **Session state** step and changes them through the
**Set state** step. Set state asks by default and applies only when the genre's author says so
— see [Pipelines](./pipelines.md). Session state also publishes the state **version** the turn
read, and Set state takes it back as `base`: a change whose value moved since is refused on the
receipt rather than applied over the newer value. The **Item supply** step answers, for each
item in the session's lorebook, how many exist, how many are held and by whom, and how many are
left; it only answers, and the genre's pipeline decides what to do with the answer.

## Reading stats in a pipeline

Two more steps read stats without a session's live layer in the way. Both only read.

**Lorebook state** reads what a lorebook holds for its world, each cast member and each place:
what earlier sessions recorded onto the world's timeline, and what you set on the lorebook
itself. It needs no session. Nothing is filled in from a card or a default — a stat the
lorebook never recorded is simply missing, rather than showing its starting value. You can
narrow it to one owner (the world, one cast member or one place) and to a list of stats by
name (`hp`, `weather`).

It reads only the stats the lorebook tracks: the sheets on the lorebook, its cast members and
its places, plus every stat it has a recorded value for — the same set a session brings in as
its [world attributes](#what-a-session-tracks). A stat core keeps for itself, or one whose
extension is no longer installed, is never read. A cast member's entry is keyed by the cast
member, not by the character card, because the value is true of them in this story only.

**Stat trail** lists one stat's values over time for one owner — the world, a cast member or
a place:

- **by message** — each change in this session, in order. A change a swiped or regenerated
  reply made is gone, because the swipe took it back, and a branched session keeps its own
  changes.
- **across sessions** — what the lorebook recorded, ordered by the story date of the history
  entry each value was recorded under. A value with no date (one you set, or one recorded
  before any capture) comes first.
- **both** (the default) — the lorebook's history, then this session's changes. A value this
  session recorded to the lorebook is not listed twice.

Each point carries its value, where it sits (the message, or the history entry and its date)
and who wrote it — you, a pipeline run, or a session recording to the lorebook. You can keep
only the last few changes, only changes after a given message, or only history dated on or
after a story date.

Both steps read the session's own lorebook, from where the session reads it: its line and its
story clock, as set in [the session's settings](sessions.md) (a session that follows the line's
present reads at the latest point). With no session, they read
the lorebook's **most recently used line** — the line of the session that was played last — at
the latest point.

**A branch reads main only up to where it forked.** A value main recorded under a history entry
dated after the fork is not part of the branch's story, so the branch does not see it; a value
with no date (one you set) always counts. A branch made "at now" has no fork date and keeps
following main. A branch forked from another branch reads through it the same way: its parent's
values up to its own fork date, and main's up to the earlier of the two. Values recorded on a
branch are deleted with it.

A pipeline can ask for a different reading, for a step that compares lines or looks back:

- **Line** — `main`, `mostRecent`, `session` (the session's own) or a branch id.
- **At** — `head` (the latest point) or a story date `{ year, month, day }`: only values dated on
  or before it count.
- **Fork cut** — `false` reads all of main from a branch, fork or not.

These are extra inputs on both steps; each answer says which line, point and fork cut it read.
A pipeline cannot read another lorebook, or a branch of another lorebook, and naming one — or a
cast member or place from another lorebook — fails with a message rather than returning
nothing.

## Genres that bring slots

A slot is declared by a genre, and a session gets the vocabulary of the genre it was created
under, not every slot the installation happens to know about. That is why installing a genre
with stats does not put a health bar on your sessions: the standard **Chat** genre declares
none, so its sessions have none, whatever else is on the machine. The stats widgets offer only
the slots the session tracks, and a change to any other slot — yours, the AI's or a
pipeline's — is refused with the reason ("… is not tracked in this session"), never stored
where nothing would read it.

The **Adventure** genre is the one core ships that does. It brings eight: **Health**,
**Stamina**, **Mood** and **Trust** on each cast member, **Location**, **Time of day** and
**Weather** on the world, and an **Inventory** on everybody. Nothing is written when a session is created: a value is read down
the chain (session, then the world, then the card, then the sheet's default, then the
declaration's own), so a fresh adventure already has them and a character whose card raises the health maximum keeps
that maximum. See [Sessions](./sessions.md#adventure) for what the genre does with them.

An extension or an administrator may declare more, under their own names. A genre declaring
none is not a genre that lost a feature; it is a session where no bar is ever drawn.

### Location

**Location** is a ready-made stat like the others, not something every session has. It can be
kept on the world (where the scene is) or on each cast member (where that character is), and a
genre's sheet says which. **Adventure**, **Lair** and **Whodunit** keep it on the world. A genre
whose characters can be in different places keeps it on the cast instead, and then the world
has no location at all. A stat kept on one owner cannot be set on the other: in Adventure,
asking to put a character somewhere is refused with the reason.

A location is a line of text — "the old mill" — or a **location** entry in the session's
lorebook. When the AI names a place the lorebook holds, by its title, the location points at
that entry, and it reads by the entry's current title. Anything else stays as words. Only a
location entry of this session's own lorebook can be pointed at. A place does not have a
location of its own.

## What a session tracks

A genre sets the **baseline** — the slots it brings — and decides whether a session may track
anything beyond it. **Chat** does not: a chat session tracks nothing, whatever its lorebook
carries. **Adventure**, **Lair** and **Whodunit** do, and then two more sources come in:

- **From the world.** The stats the session's lorebook brings — the sheets on the lorebook
  and on its cast members, and every stat an earlier session recorded on the world's timeline.
  These are on by default. Switch the whole set off, or untick any one of them.
- **The session's own.** Any other stat this installation declares, added for this session
  alone.

You change these in the session's settings, under **Attributes**, and a change applies at
once, from that moment on: values already recorded stay, new changes follow what is ticked.
The genre's own slots are always tracked and cannot be unticked. Only the session's owner can
change what it tracks. A character card's sheets do not count here: a card is the same in
every story, and what one story tracks of a character belongs to its cast member.

When a session's stats are recorded onto the world — at a scene capture, a manual mark, or
before the session is deleted — only the stats it tracks are written. A place's values are
written onto its location entry, so the next session in that world finds the lantern where it
was left. Everything else the
world holds carries forward untouched, ready for the next session that tracks it.

## Places

A **location** entry in the session's lorebook can hold stats of its own, as the world and each
cast member do. What a place tracks is what the session tracks, the same way: the genre's slots
that apply to a place, and, where the genre allows its own attributes, any the session adds or
the world carries in. Inventory applies to places, so in **Adventure** and **Lair** every
location can hold items — things lying in the crypt, the nets on the harbour wall. Nothing else
core ships applies to a place.

Every live location in the lorebook is a place; an archived one is not. A change to a place
goes through the same doors as any other: it must be a stat the session tracks, one that applies
to a place, and the place must be a location in this session's own lorebook. Moving an item
between a place and a character is a removal from one and an addition to the other, each
recorded under the message it happened at, so a swipe takes both back.

## In a session

Two widgets show stats while you play, and neither is on by default. Open the layout
editor's **Move** tab and add them from the tray (see
[Session layout](./session-layout.md)); a genre that wants them from the first message ships a
layout preset with them already placed. Each has its own settings in the same settings window
every widget uses.

**Stats** is one card per cast member. Each stat is drawn by its [shape](#stat-shapes): a
number with a floor and a ceiling as a bar (`14/20`), a choice as a chip, a list as its items,
a story time as a date line, text as a line, on-or-off as a toggle, and a derived value
greyed out because there is nothing to write. A retired stat is greyed too and cannot be
edited (its value still counts), and a stat a sheet requires is marked with `*`. Click a bar or
a line to edit it: **Enter** applies what you typed, **Escape** puts the stored value back, and
leaving a changed field applies it (stepping a number with its arrows applies nothing until
then); leaving an untouched field just closes it. Click a chip to pick from its set, or **not set** to clear
it. Click a list to open it: each item has buttons to move it up or down and to remove it, and
you add an item by typing it and pressing **Enter**. An item that is a lorebook entry reads as
its title and how many are held (`Rusty key ×2`), with **−** and **+** beside it: one fewer of
the last one removes it. **Add from the lorebook** opens a picker over the session's lorebook,
items first and then every other entry, each saying how many the list already holds; search by
name or key and press **Enter**, choose an entry, type how many, and press **Enter** or its
**Add** button. Adding something already held raises its count. **Escape** closes the picker;
only the lorebook's owner can pick from it, and a list limited to set words offers no picker.
Each change applies at once, and **Done** or **Escape** closes the list. Click a story time to edit its year, month, day and
time of day: **Enter** or **Save** applies all four together, **Escape** or **Cancel** leaves
it as it was, and clearing the year clears the value. A date the calendar can't read, such as
`25:00`, is not applied, and the widget says why. An edit is applied at once, because you are the one writer whose intent needs no review.
Clearing a field does not set it to nothing, it goes back to inheriting. If an edit is refused,
the reason shows in the widget you edited, not in every stats widget on the page. Before the
session's stats have loaded, a widget says it is loading rather than that nothing is declared;
if they cannot be read at all, it says why instead of loading forever.
Its settings choose
**which members** (whoever has a stat in play, everyone in the cast, or names you list), how
**dense** the cards are, and **which stats** to show.

The old **Inventory** widget is removed. What everyone is carrying is their Inventory stat, so
it shows in **Stats** and **World State** like any list, and a turn that hands something over
or picks something up says so in the line under its message. A layout or preset that placed the
old Inventory widget opens without it.

**World State** is the session's world stats, editable, meant to sit above the messages as a
strip (or down a side column as a list). These are the values a prompt reads as
`state.world.*`, so what you set here is what the model is told. Under the world's own stats it
shows each [place](#places) something has been said of, by name, with its stats editable the same
way; a place with nothing in it is not shown. **Which stats** narrows the places too. **Stats**
never shows a place.

**Scene Portraits** can draw a mini bar row under each portrait instead: turn **Show stat
bars** on in its settings. Only number stats with a floor and a ceiling become bars. A portrait is a picture rather than a person, so the bars appear
under one pinned from a character's avatar and not under one pinned from their gallery.

### Under the messages

A turn that changed something carries a compact line under the message:

> **Verity** hp 20 → 14 · Inventory → rusty key · mood calm → wary

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
on the character, read against the story's present date (the lorebook's clock, or its newest
history entry).

If either is missing, age is **absent** rather than zero. A character with no birthdate is not
newborn, and a book with no dated history has not just begun.

## What is not built yet

- **The story-time editor.** The story-time editing described under the widgets above exists,
  but no slot uses the story-time shape yet, so there is nothing to open it on. When one does,
  the session widget still writes its date line free-form: it is not handed the lorebook's
  calendar yet.
- **Computed stats on a place.** A stat computed by an expression reads as absent on a place;
  expressions are worked out for the world and the cast only, for now.
- **Picking a place in the widget.** A location that points at a location entry shows the
  entry's title, but the widget edits it as text: typing a new value replaces the reference
  with words. Picking an entry from the lorebook works for inventories only, for now.

- **As-of reading.** Values and their configuration both record which message they start from,
  and the resolution above always answers "what is it _now_". Asking what a stat was at message
  47 needs each message to carry its own story time, which is a later piece of work (the
  session's story clock and the lorebook's clock say where the story stands now, not where each
  message was). (A pipeline can list a
  stat's changes with [Stat trail](#reading-stats-in-a-pipeline), and a session or a
  pipeline can read the lorebook as of a story date, but nothing resolves a session's own
  changes as of a past message.)
- **Which value wins at one date.** When the lorebook holds two values for one stat, the one
  written last wins, even if it was recorded under an earlier story date. Reading at a date
  drops values dated after it, but does not reorder the rest by date.
- **Reading the lorebook from its own page.** Lorebook state can read a lorebook with no
  session, but nothing yet runs a pipeline from a lorebook, so today it always reads the
  lorebook of the session the pipeline runs in.
- **Modifiers** — poisoned, resistance, proficiency. They need a declared stacking order to
  mean anything, and they are deferred until stored and derived slots have been lived with.
- **Editing screens away from the session.** The session widgets above exist; the Stats tab on a
  character card and the cast member's own page, where you can see which layer a number came
  from, are the next piece of work.
