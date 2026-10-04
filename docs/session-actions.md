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
- **Conversations.** An action declared for one conversation (the Lair's Sanctum, say) appears on that conversation's composer and messages only; one declared for none appears everywhere. This decides where it's *listed*, never who may use it.
- **The legend.** **What do these do?** at the end of the Actions row opens **What these do**: every action the session offers you right now, grouped **In the composer**, **Turn controls** and **On a message**, each with its icon, name, description, slash command and what it asks for before it runs (*Asks for text*, *Asks for text, if you have any*, *Asks who hears it*). An action hidden in the session's current state, such as the Lair's *Answer the door* with nobody knocking, isn't listed.

## Who may use it

A genre's action is seen by everyone in the session and, unless it says otherwise, used by the session's owner alone. A guest sees the chip greyed with the reason, *'Roll' is not yours to use here — its audience is owner.*, which is also the sentence the server refuses a press with. An action may open itself to any participant.

Two actions that happen to share a key, such as Serene Pub's own and a plugin's, are two different actions: each has its own audience, runs its own pipeline, and is switched on or off on its own under **Actions** in the session's settings.

### Who may change a message

The message actions follow one ownership rule, checked by the server:

| The message is… | Who may edit, hide, delete, regenerate, extend or swipe it |
| --- | --- |
| a persona's line | that persona's owner |
| a character's reply | the session's owner, or whoever owns that character |
| a narration, or an envoy's line | the session's owner |
| a line written with no persona | the person who wrote it |
| a line whose character or author no longer exists | the session's owner |

Anyone else is refused with *You don't have permission to change this message — only the session's owner, whoever owns the character or persona that voiced it, or the person who wrote it, may.*

Some actions don't follow that rule:

- **Stop** belongs to anyone in the session.
- **Branch from here**, **Regenerate the last turn** (the Lair), and **Narrator Response** belong to the session's owner.
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

## Slash names

A slash name belongs to one action. Two pipelines claiming the same name for the same genre is refused when the second is published. Serene Pub's own actions have bare names (`/narrate`, `/advance`, `/retry`); a plugin's are `/<plugin>.<action>` (`/acme.roll`), so a plugin can never shadow a built-in one, and the palette completes the long form so nobody has to type it. Slash names are never translated; the label beside them is.

## Questions put to the cast: forms

Some actions **ask** rather than finish. A pipeline can end a message with a question and a row of choices addressed to one participant: Adventure's **Ask** puts a question with two to four options to one member of the cast, such as *Will you come to the festival? — Yes · Maybe · No*. That block is a **form**: an action waiting for its answer, which only the person it's addressed to may give.

- **A person plays the addressee** (the character is your persona): the buttons are yours. Your answer runs like any action you fired, and the line it writes is yours, under your persona. Everyone else sees *Awaiting an answer* and no buttons. A press from anyone else is refused: *That question was put to Tom, and it is theirs to answer.* The owner is no exception.
- **The AI plays the addressee**: the genre's answer pipeline answers for them as soon as the question lands. It puts the question to the model as that character, with the options spelled out, and presses the button just as a person would. The answer lands as the character's line, and the run is recorded as a child of the run that asked.
- **The question is put to nobody in particular** (or to someone no longer here): the buttons are open to whoever the action's audience names, and the answer is the presser's.
- **The question names a character outside the session**: it waits, and the owner may answer it.

A question is answered **once**. After that, everyone sees who answered and what they chose, and another press is refused, naming who already answered.

A question is **superseded** once the conversation on its channel moves past it unanswered: it collapses to *Superseded — the conversation moved on*, and a press is refused with *That question was overtaken — the conversation moved on before it was answered*. An answer doesn't count as moving on, so a message that puts three questions to three characters gets all three answered.

A pipeline may point a question's buttons at another pipeline's action (Adventure's *Ask* points at *Answer*), and the press is then held to *that* action's audience. That's how a question the owner's narrator wrote can be answered by any participant.

**The line a question can't cross.** Only questions inside the story can be put to a character. An action whose result reaches outside it (a character card, lorebook data, settings, permissions, connections) is marked as a *world* action, and a world action can never ride a message as a question, never be opened past the owner or an administrator, and never be answered by a model. So a character asking a question is fine, and a character granting another character permission is impossible.

Runs that start further runs (an answer that asks another question, say) are cut at four deep and sixteen per tree, and the cut is recorded as a stopped run rather than left to spin.

## Floors, built-ins and what each action emits

Every action that changes a message is a **built-in**: Serene Pub performs the write itself, as its own small pipeline run, and records an event saying what changed and what was lost. The write appears in the run inspector like a reply. An administrator may put a review on it in the Pipelines view (a delete that asks first, say), and the event reaches the next reply's pipeline, so it knows the history it reads has moved (see [What changed since the last reply](./pipelines.md#what-changed-since-the-last-reply)).

| Group | Actions | A genre may… | What the write records |
| --- | --- | --- | --- |
| **Floors** | Stop · Branch from here · Edit | nothing: every genre has them | how much text had arrived · the fork, on the new session · the previous text |
| **Opt-in built-ins** | Delete · Hide / Unhide · Swipe | switch one off, never replace it | what the deleted line held · which way it was hidden · the version that was showing and the one now selected |
| **Genre content** | Regenerate · Extend · a swipe's new version | forbid Regenerate or Extend, and supply the pipeline that writes the text | which of the three it was, from the reply's own finishing write |

A genre that switches an action off removes it from the menu, and the server refuses it regardless, naming the genre. A genre can't switch off a floor: a person can always stop a reply and rewrite a line, and a session's owner can always branch.

**What a review may change.** A review on a built-in offers only what that write declares reviewable: the text of an edit, the direction of a hide, the title of a branch, nothing for a delete. Which message it's about was settled when the person asked, and the write checks again, as it lands, that they may still act on it.

**What a delete leaves behind.** Deleting a line records what it held, so the *next* reply can be told what went; an edit or a swipe records the text it replaced. Once a reply has been told, the record keeps that the line was deleted and lets its content go. A reply that fails or is stopped before writing anything doesn't count as told.

### What a branch copies

| Copied | Not copied |
| --- | --- |
| the messages up to and including the fork, each on its own conversation | the session's own pipeline choices and setting changes |
| the active cast, envoys, personas, guests and tags | the layout: the branch opens like a [new session](./session-layout.md#new-sessions) |
| the genre, preset and genre settings; the scenario; the lorebook, line and story clock | pipelines' own session data |
| stats and their changes recorded up to the fork | the record of edits, deletes and swipes: the branch's first change is the fork itself |

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
Presets and their bindings are set by an administrator. Everyone else just picks a preset on the start screen.
:::

A preset's **event bindings** decide which pipeline answers each of the genre's events (the reply, the greeting on creation, each action) and which named configuration it runs with, so two presets on one genre can differ entirely in what a turn does. Set them on the preset's page under **Admin › Presets**: bindings under *Event bindings*, the start screen's pre-filled values under *Creation defaults*.

When several layers name a pipeline for the same event, the nearest wins: a choice made for the session itself, then the preset's binding, then an administrator's default for the whole pub, then the genre's own pipeline. A choice that has stopped being eligible (its pipeline was retired, or no longer answers this genre) is skipped and the next layer decides. No screen offers the per-session choice yet.

If a bound pipeline disappears (an upgrade republished it, or its plugin was removed), the session keeps working on the genre's default pipeline for that event and says so: everyone sees a banner naming the event, administrators also see which pipeline it was bound to with a link to fix it, and the preset is flagged in **Admin › Presets** until the binding resolves.

## Related

- [Sessions](./sessions.md): using actions, the message menu and slash commands.
- [Group sessions](./group-sessions.md): turn order and the turn controls.
- [Pipelines](./pipelines.md): the runs behind every action.
- [Forms and effects](./sdk/guides/forms-and-effects.md): declaring forms in a plugin.
