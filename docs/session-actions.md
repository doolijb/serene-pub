# Session actions

Every button, menu entry and slash command in a session is an **action**; this page explains how actions are declared, who may use each one, and what happens when one runs.

:::note For power users
You don't need this page to play. It's for administrators and plugin authors who want to know exactly why a button is there, why it's grey, or what a press records. For using actions day to day, see [Sessions](./sessions.md#actions).
:::

## What an action is

Every button a session offers is an **action**: a genre's chip in the **Actions** row, a turn control such as **Continue**, an entry in a message's **⋮** menu, a slash command. Whatever contributes it (Serene Pub itself, a genre or a plugin) declares it once, with:

- a **venue**: where it appears (the composer's row, a message's menu, the turn controls, a widget), optionally on one conversation only;
- an **audience**: who may see it and who may use it;
- whether it's **quick**: shown up front rather than only in the overflow;
- a **description**: one sentence on what it does. An action without one is refused when its pipeline is saved.

## Where an action appears

- **Up front and in the overflow.** Each venue shows its quick actions up front (the chips, a message's hover icons) and lists *every* action in its overflow: the **More** menu beside the chips, the **⋮** menu on a message. Nothing is reachable only by being prominent. A message style may move the up-front set around, but it can't take an action away.
- **New.** An action you haven't met yet, such as one a newly installed plugin contributed, wears a small **New** mark in the overflow, and **More** carries a dot. Opening that menu, or the `/` palette, clears the mark for you.
- **The Actions widget.** The [Actions widget](./session-layout.md#the-widgets) draws the composer's actions and the turn controls as buttons that stay open, grouped turn controls first, then the genre's own, then those switched on from another plugin, and showing a newcomer there clears its **New** mark; a message's actions stay on the message.
- **Conversations.** An action declared for one conversation (the Lair's Sanctum, say) appears on that conversation's composer and messages only; one declared for none appears everywhere. This decides where it's *listed*, never who may use it.
- **The legend.** **What do these do?** at the end of the Actions row opens **What these do**: every action the session offers you right now, grouped **In the composer**, **Turn controls** and **On a message**, each with its icon, name, description, slash command and what it asks for before it runs (*Asks for text*, *Asks for text, if you have any*, *Asks who hears it*). An action hidden in the session's current state, such as the Lair's *Answer the door* with nobody knocking, isn't listed.

## Who may use it

A genre's action is seen by everyone in the session and, unless it says otherwise, used by the session's owner alone. A guest is not offered it at all: an action whose audience leaves them out is hidden from the chips, **More**, the `/` list and the actions guide. The server still refuses a press with *'Roll' is not yours to use here — its audience is owner.* An action may open itself to any participant.

Two actions that happen to share a key, such as Serene Pub's own and a plugin's, are two different actions: each has its own audience, runs its own pipeline, and is switched on or off on its own under **Actions** in the session's settings.

### Who may change a message

The message actions follow one ownership rule, checked by the server:

| The message is… | Who may edit, hide, regenerate, extend or swipe it (and delete it, where the genre offers Delete) |
| --- | --- |
| a persona's line | that persona's owner |
| a character's reply | the session's owner, or whoever owns that character |
| a narration, or an envoy's line | the session's owner |
| a line written with no persona | the person who wrote it |
| a line whose character or author no longer exists | the session's owner |

Anyone else is refused with *You don't have permission to change this message — only the session's owner, whoever owns the character or persona that voiced it, or the person who wrote it, may.*

Some actions don't follow that rule:

- **Stop** belongs to anyone in the session.
- **Branch from here**, **Narrator Response**, and **Back**, **Forward** and **Regenerate the last turn** (the conversation's history; the three presses sit in the session's header, and Regenerate the last turn is there only in the Lair and the Dungeon Crawler, not in the composer) belong to the session's owner.
- **Select for summary** is open to anyone in the session, on any message.
- **Continue** and **Pick who speaks**: a guest may take the turn at the head of the order, or a turn already lined up for their own character. Taking anyone else's turn out of order is refused with *Only the session owner can take somebody else's turn out of order.*

## Why a button is grey

Besides the audience, an action may declare an **enabled-when**: a condition over what the session already knows about itself, such as a world value (a *Survey* that waits for a location), a setting, whether anything is being written, or a fact about the message it's pressed on. The condition is data, not code. A genre may set defaults per action, the action may declare its own, and a session may override one action's; the nearest wins. No editor exists for the session's override yet.

An action whose condition doesn't hold stays listed (the chip, the menu entry, the palette row), greyed, with the reason in its tooltip and read to screen readers, and the server refuses a press with the same sentence. When the condition changes, the button lifts without a reload.

The reasons you'll meet most:

- *wait for the reply to finish*: anything is running in the session, including an image or a summary.
- *only the newest reply can be regenerated*: Regenerate, Extend and Swipe act on the newest reply only. Rewriting an earlier one would change history mid-conversation.
- *your own line is edited, not regenerated*: these never act on what you wrote.
- *a greeting is swiped, not regenerated*.
- *nothing to swipe to*, *finish the edit first*, *unhide it first*, *not yours to change*, *nobody is seated to pick*.
- *This session is archived. Its owner can unarchive it to play on.*: an [archived session](./sessions.md#archive-and-unarchive) greys every action with this reason, and so refuses a press.

## Close out

**Close out** is not a listed action. It is in the **⋯** menu of the session's details, for the session's owner (see [Close out](./sessions.md#close-out)). A genre registers it as `close-out`, which every scene summarizer contributes; that registration picks the summarizer and gives it a minimum age of 0, so it can summarize the newest lines.

## When an action fails

A press that ran and failed says why once, on the card above the composer, where administrators also get **Inspect** (see [Inspecting a run](./pipelines.md#inspecting-a-run)). The reason is the sentence alone; which step it stopped at is in the inspector. A press refused before anything ran (not yours to use, say) has no card, so it's said in a notice instead.

The one you're most likely to meet is **Image** while the **Images** [loadout](./connections.md#loadouts) (what pictures run on: a model on a connection and its settings) is empty: the button stays, and the run it starts ends with *No model is set for Images, and one is never picked automatically. An admin chooses it in Admin › Models › Loadouts.* For an administrator, **Admin › Models › Loadouts** in that sentence is a link to the page that fixes it; a member reads it as text. Filling the **Images** loadout there, or in the **Loadouts** view, fixes it (see [Images](./images.md#when-it-says-no-model-is-set)).

## Slash names

A slash name belongs to one action. Two pipelines claiming the same name for the same genre is refused when the second is published. Serene Pub's own actions have bare names (`/narrate`, `/advance`, `/retry`); a plugin's are `/<plugin>.<action>` (`/acme.roll`), so a plugin can never shadow a built-in one, and the palette completes the long form so nobody has to type it. Slash names are never translated; the label beside them is.

## Questions put to the cast: forms

Some actions **ask** rather than finish. A pipeline can end a message with a question and a row of choices addressed to one participant: Story's **Ask** puts a question with two to four options to one member of the cast, such as *Will you come to the festival? — Yes · Maybe · No*. That block is a **form**: an action waiting for its answer, which only the person it's addressed to may give.

- **A person plays the addressee** (the character is your persona): the buttons are yours. Your answer runs like any action you fired, and the line it writes is yours, under your persona. Everyone else sees *Awaiting an answer* and no buttons. A press from anyone else is refused: *That question was put to Tom, and it is theirs to answer.* The owner is no exception.
- **The AI plays the addressee**: the genre's answer pipeline answers for them as soon as the question lands. It puts the question to the model as that character, with the options spelled out, and presses the button just as a person would. The answer lands as the character's line, and the run is recorded as a child of the run that asked.
- **The question is put to nobody in particular** (or to someone no longer here): the buttons are open to whoever the action's audience names, and the answer is the presser's.
- **The question names a character outside the session**: it waits, and the owner may answer it.

A question is answered **once**. After that, everyone sees who answered and what they chose, and another press is refused, naming who already answered.

A question is **superseded** once the conversation on its channel moves past it unanswered: it collapses to *Superseded — the conversation moved on*, and a press is refused with *That question was overtaken — the conversation moved on before it was answered*. An answer doesn't count as moving on, so a message that puts three questions to three characters gets all three answered.

A pipeline may point a question's buttons at another pipeline's action (Story's *Ask* points at *Answer*), and the press is then held to *that* action's audience. That's how a question the owner's narrator wrote can be answered by any participant.

**The line a question can't cross.** Only questions inside the story can be put to a character. An action whose result reaches outside it (a character card, lorebook data, settings, permissions, connections) is marked as a *world* action, and a world action can never ride a message as a question, never be opened past the owner or an administrator, and never be answered by a model. So a character asking a question is fine, and a character granting another character permission is impossible.

Runs that start further runs (an answer that asks another question, say) are cut at four deep and sixteen per tree, and the cut is recorded as a stopped run rather than left to spin.

## Floors, built-ins and what each action emits

Every action that changes a message is a **built-in**: Serene Pub performs the write itself, as its own small pipeline run, and records an event saying what changed and what was lost. The write appears in the run inspector like a reply. An administrator may put a review on it in **Admin › Pipelines** (a delete that asks first, say), and the event reaches the next reply's pipeline, so it knows the history it reads has moved (see [What changed since the last reply](./pipelines.md#what-changed-since-the-last-reply)).

| Group | Actions | A genre may… | What the write records |
| --- | --- | --- | --- |
| **Floors** | Stop · Branch from here · Edit | nothing: every genre has them | how much text had arrived · the fork, on the new session · the previous text |
| **Opt-in built-ins** | Hide / Unhide · Swipe | switch one off, never replace it | which way it was hidden · the version that was showing and the one now selected |
| **Needs a pipeline** | Delete | offer it at all, by registering a deletion pipeline (below) | what the deleted line held, and what went with it |
| **Genre content** | Regenerate · Extend · a swipe's new version | forbid Regenerate or Extend, and supply the pipeline that writes the text | which of the three it was, from the reply's own finishing write |

A genre that switches an action off removes it from the menu, and the server refuses it regardless, naming the genre. A genre can't switch off a floor: a person can always stop a reply and rewrite a line, and a session's owner can always branch.

**What a review may change.** A review on a built-in offers only what that write declares reviewable: the text of an edit, the direction of a hide, the title of a branch, nothing for a delete. Which message it's about was settled when the person asked, and the write checks again, as it lands, that they may still act on it.

**What a delete leaves behind.** Deleting a line records what it held, so the *next* reply can be told what went; an edit or a swipe records the text it replaced. Once a reply has been told, the record keeps that the line was deleted and lets its content go. A reply that fails or is stopped before writing anything doesn't count as told.

### Deleting a message needs a pipeline

Hiding a message and going **Back** are the ways to take something out of a story (see [Sessions › Back and Forward](./sessions.md#back-and-forward)). **Delete** is off everywhere until something registers a pipeline that carries it out, and no genre Serene Pub ships does:

- Delete is offered on a message only when the session's registrations hold an event pipeline on **Deletion asked** (`core:event/message-deletion-asked@1`), registered the way every other event pipeline is, so a preset can drop it.
- Pressing Delete checks that the message is the session's and yours to change, then raises *Deletion asked* with the message, its channel and who asked. The registered pipeline does the rest. It ends in **Delete message** (`core:outlet/delete-message@1`), which removes that message and takes back everything it changed in one go. It can also put steps of its own around that: a note, a lorebook write, a question to confirm.
- A deletion pipeline deletes only the message it was asked about. It passes what *Deletion asked* carried, whole, into Delete message's **asked** input (`asked: $.input.main`), and a pipeline that names the message any other way is refused when it's published. Who may change a message still decides who may delete it.
- In a genre that keeps its turns (the Dungeon Crawler's Honour mode), a deletion pipeline still only reaches the latest turn, and that turn goes whole.

**Back** is no deletion: the turns it takes out are kept until something new is written, and only then deleted. That's the one deletion that is on by default, and it raises nothing.

### What a branch copies

| Copied | Not copied |
| --- | --- |
| the messages up to and including the fork, each on its own conversation, with its author and its time | the session's own pipeline choices and setting changes |
| the active cast, envoys, personas, guests (players and watchers) and tags | the record of edits, deletes and swipes: the branch's first change is the fork itself |
| the genre, preset and genre settings; the scenario; the lorebook, line and story clock, as it stood at the fork (moves made after it are taken off) | |
| stats and their changes recorded up to the fork, and the story clock's moves up to it | |
| each person's layout of the session and every panel's settings (tab names, which channel or lane a panel shows, a goal panel's key, the sheet's owners), and the tab they had open | |
| each person's lane of a channel with lanes, so everyone's channel stays theirs | |
| pipelines' own session data, as it stood at the fork | |

Characters removed from the source aren't copied.

## Who portrays a participant this turn

Each turn starts by deciding, for every participant it concerns, whether a **person** speaks as them, the **AI** does, or **nobody** can. That's the participant's **portrayal**. It's fixed before the turn's first step runs and shown as the **Portrayed by** line in the [run inspector](./pipelines.md#inspecting-a-run). Someone joining or leaving mid-reply changes the next turn, never the one under way.

| Participant | Who portrays them |
| --- | --- |
| a person | that person, if they're the owner or a guest of the session; otherwise nobody |
| the owner | the session's owner |
| an administrator | the person who started the turn, if they're an administrator; otherwise nobody |
| any participant | the person who started the turn, if they're in the session; otherwise nobody |
| a character | a **person**, when the character is someone's own persona in this session; otherwise the **AI**, when the character is in the cast (benched characters included) or is this turn's side character; otherwise nobody |
| an envoy | the AI |
| "whoever this message belongs to" | decided against the message itself, by the [ownership rule](#who-may-change-a-message) |

Portrayal is decided for every run that reaches the model, not for previews (the composer's token count, say). A persona attached to the session is never offered as a side character, because the model would be speaking as someone's own presence.

## How a preset decides what runs

:::note Admins only
Presets are set by an administrator. Everyone else picks a preset on the start screen, and switches the session's actions and routines on and off in its settings.
:::

Each genre has **defaults**: which pipeline runs on each of its events (the reply, the greeting on creation, a form's answer), which actions its sessions offer, and which routines run between turns. A **preset** is a set of changes on those defaults: it adds a pipeline, drops one, or changes one's values or mode, so two presets on one genre can differ entirely in what a turn does. Change them on the preset's page under **Admin › Presets** (*What this preset runs*), and the start screen's pre-filled values under *Creation defaults*. See [Pipelines › Presets](./pipelines.md#presets).

What a session runs is the genre's defaults, then the preset's changes, then what the session itself switched off or on. An action the preset runs can be switched off for one session under **Edit session › Settings › Actions**; an action can also carry an **Only when…** condition, and is greyed whenever it doesn't hold.

If a pipeline a preset runs disappears or stops fitting (an upgrade changed it, or its plugin was removed), the session keeps working on what the genre's defaults run for that event and says so: everyone sees a banner naming the event, and the preset's page in **Admin › Presets** says something it runs is not available until it resolves.

## Related

- [Sessions](./sessions.md): using actions, the message menu and slash commands.
- [Group sessions](./group-sessions.md): turn order and the turn controls.
- [Pipelines](./pipelines.md): the runs behind every action.
- [Forms and effects](./sdk/guides/forms-and-effects.md): declaring forms in a plugin.
