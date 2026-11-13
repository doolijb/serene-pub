# Summarization

Summarization turns stretches of a session into lorebook entries: what happened in a scene, what the party learned about the world, what a character revealed about herself. A long story then keeps its important facts as short, searchable lore instead of relying on messages the model can no longer see. A scene's saved summary also stands in for its lines in the reply's prompt once they no longer fit there, in Story and the Dungeon Crawler (see [Context templates → Earlier in the story](./context-templates.md#earlier-in-the-story)).

It runs when you ask. In a genre that summarizes finished scenes by itself (Story, the Lair and the Dungeon Crawler), it also runs a few rounds after each scene ends (see [Finished scenes, summarized by themselves](#finished-scenes-summarized-by-themselves)). Nothing else is summarized in the background, and nothing costs tokens until one of these starts.

:::note Before you start
What you save goes into the session's [lorebook](./lorebooks.md), or into its own [Session notes](./lorebooks.md#your-sessions-own-notes) when it reads no shared lorebook. Neither your [Lorebook writes from sessions](./lorebooks.md#what-a-session-may-write) setting nor the book's own may be **Off**.
:::

## From a session to the graph

Session to lore is up to four steps. Each one stops for your review before anything is saved, and you can stop after any of them:

1. **Summarize to Lorebook**: pick messages in a session and save them as a scene, a world lore entry, or a character lore entry.
2. **Process a scene**: write (or rewrite) a scene's summary and its list of who was there.
3. **Compile to Entry**: merge a history entry's scenes into the entry's own text.
4. **Build the graph** (with [advanced controls](./themes-and-settings.md#show-advanced-controls) on): have the model read your scenes and history and propose cast members and relationships. See [Building the graph from your scenes](./lorebook-cast.md#building-the-graph-from-your-scenes).

## Summarize to Lorebook

1. In the session, open a message's options and choose **Select for summary**. (The **Chronicle** widget's **Summarize scene** does the same.) The composer becomes a selection bar.
2. Select the messages. **Select all above** and **Select all below**, on each message, fill the gap up to the nearest selected one.
3. In the bar, choose what to make: **Scene**, **World lore** or **Character lore**. The **Summarize to Lorebook** window opens.
4. Fill in the details and press **Generate summary**. The window shows its progress: drafting each part, then combining the drafts into one entry, then naming it.
5. Edit the result if you like, then **Save to Lorebook**.

The details depend on the kind:

- **World lore** takes an optional **Focus topic**, such as *the smugglers' code*, to steer what the summary is about.
- **Character lore** needs a **Focus topic**, such as *her debts* or *relationship with Kira*, and can be **bound to a character** (your personas included) so the lore is private to them. Binding adds that character to the book's cast when you save.
- **Scene** needs a **History entry** to file the scene under. Pick one, or press **New**, which uses the history entry of the day where the session's story stands, making a blank one only when that day has none (see [History entries and scenes](./lorebook-time.md#history-entries-and-scenes)). The messages must be one unbroken run: a gap in the selection is refused, and messages already in a scene can't be selected again, including every line of a scene started in the conversation (the open one's too). After saving, the scene is processed (below) and its review opens in the **Scene summary** window.

The window says where it saves: **Saving to:** the lorebook the session reads, or *Session notes*.

Images and files on the selected messages are read as their names: each file is written after its message's text, such as `[image: cat.png — a grey cat]` (with the description you gave it) or `[file: notes.txt]`. In a scene that reads side talk as asides (the Lair's Sanctum), an aside's files are named after its text the same way. A message that is only a picture is summarized as that picture rather than skipped. The names count toward how much chat each drafting part holds. No summary step sends the files themselves to the model, and a text file's contents are not read into it.

A session on a [branch](./lorebook-time.md#branches) saves to that branch, and the review says so. Only history entries on the session's line, up to where its story stands, are offered.

## Processing a scene

**Process** on a scene, in the lorebook's History or Scenes, has the model write the scene's summary from its messages (their images and files read as names, as above) and lists who was there: **Participants** (who spoke) and **Mentioned** (who was talked about). Notes a pipeline added to the scene are read with it, under *Noted in this scene:* (see [Summaries and the lorebook](./pipelines.md#summaries-and-the-lorebook)). The prompts ask for the scene's key beats, deaths, departures and arrivals among them. Once a scene has a summary the action reads **Reprocess**, which writes it again from scratch; useful when the messages changed or the first summary came out wrong. Review the result in the **Scene summary** window and press **Apply**.

The model is told the scene's name, the day it began and who was present, and, in a genre that keeps a place (Story and the Lair keep the party's **Location**), where the scene began, even after the scene has been renamed.

A scene keeps its summary and cast even if its messages, or the whole session, are later deleted.

A scene started and ended in the conversation can also be summarized from the session: **Summarize** on its divider or its row in the [Chronicle](./session-layout.md#the-widgets), **Close and summarize** on the Chronicle's open scene, and **Summarize all (N)** for every finished scene of the session with no summary yet, one after another. When the session's **Summaries** is **On close**, each scene is summarized in the background as it ends (a scene made with **Mark as scene** included), and the routine above leaves that scene alone; with **Never**, none of these is offered, and the routine stops too (see [When a new scene begins](./sessions.md#when-a-new-scene-begins)). Each run lands in the activity list for review, as above.

A finished run waits for you. Until you decide, the scene's divider and its Chronicle row say **Ready to review**; click it to open the review in the **Scene summary** window. The summary is written only when you press **Apply**. **Discard** (or dismissing its card in the Activity view) leaves the scene as it was before the run: summarized, not summarized or out of date. Stopping a run does the same. **Summarize all (N)** skips a scene that's waiting for review, so it never replaces a result you haven't looked at.

When a scene's boundaries move afterwards (its start nudged or dragged, its end moved, the scene reopened, or another scene joined to it with **Remove boundary**), its summary no longer matches its lines. The summary is kept, and its divider says **Summary out of date** until you **Summarize** it again (**Summarize all (N)** counts only scenes with no summary at all). A scene that joins the one before it takes its own summary with it.

## Finished scenes, summarized by themselves

Story (its **Living** and **Rule Based** presets), the Lair and the Dungeon Crawler register a routine, **Summarize finished scenes**, that summarizes each scene a few rounds after it ends. It is listed under **Edit session › Settings › Routines** like any routine, with its mode: **Off**, **Review** or **Full**. See [Routines](./sessions.md#routines).

- **Which scene.** Each run takes the oldest scene on the main channel that ended at least 6 rounds ago and has no summary, and that nobody has decided about. A summary you saved (even one a moved boundary marked out of date), a review you discarded, a summary that failed, and one being written or waiting for review are never taken. One scene per run. Nothing runs while **Summaries** is **Never**, or while you have taken turns back with **Back** and a Forward is waiting. On a branch, only the scenes on the branch's own lines are summarized.
- **One at a time.** While one scene's summary is being written, the routine starts no other. If you go **Back**, swipe or delete lines of that scene while it is written, nothing is saved and the scene is summarized again once it is old enough. If you stop a summary the routine started, the routine leaves that scene alone from then on; you can still summarize it yourself.
- **Full** (the default) saves the summary by itself, and the model's name for the scene only while the scene still has its automatic name (*Scene 3*); a name you gave is kept. Saving a name stops the automatic *Scene N* numbering, as any name does. The scene's cast stays as the scene's close recorded it. New characters are not proposed.
- **Review** waits for you in the activity list and the **Scene summary** window, like a summary you started: **Ready to review**, **Apply**, **Discard**.
- **Off** runs nothing.

The routine asks no model itself. It starts the genre's own scene summarizer, the same **Summarize scene** pipeline your **Summarize** runs. Its model calls queue as a routine's do: replies to people reach the model first. You can keep playing, write, get replies and press **Back** while it runs. The run shows as a **Scene** card in the Activity view, and goes away once the summary is saved under **Full**.

A summary saved by itself is not yet the record. It does not fix the story for **Back**: Back can go into that scene, which marks its automatic summary out of date, and the routine writes it again once the scene is old enough (**Forward** puts the summary back). It writes no *In the lorebook up to here* mark and no *Written from…* line. It becomes yours when you save it: editing the summary in the lorebook's scene page, or applying a review of it, makes it a summary you applied (see [What an applied summary fixes](#what-an-applied-summary-fixes)). The scene page says, on a summary saved this way, *Summarized by itself. You can edit it, or turn this off under Routines.*

**What it is for.** 🚧 Once a scene's lines no longer fit in the reply's prompt, its saved summary is read in their place, under *Earlier in the story* (in Story and the Dungeon Crawler; the Lair's turns don't read them). A summary saved by itself counts as soon as it is saved, a summary **Back** took back stops counting at once, and a scene compiled into a history entry is read as history instead. See [Context templates → Earlier in the story](./context-templates.md#earlier-in-the-story).

Held [lorebook changes](./pipelines.md#summaries-and-the-lorebook) still apply as each scene ends; they do not wait for a summary that has not started. While a summary is being written or waits for review, changes from that scene on wait. When the routine's summary is saved, fails or is stopped, the changes held up to the newest finished scene apply.

## Which summarizer runs

World and character summaries run the pipeline that the session's genre (or preset) registers on the summarize action. A genre that registers its own replacement runs its own. The summary is written into the lorebook the session reads or, when it reads none or its scenes end by themselves, into the session's **Session notes** (see [Your session's own notes](./lorebooks.md#your-sessions-own-notes)).

A routine that summarizes (see [Routines](./pipelines.md#routines)) reads only lines at least 20 messages old, so the newest lines are left to the story. Summaries you ask for yourself, from an action or an event, have no such minimum, and neither does a closed scene or [Close out](#close-out-and-the-catch-up-offer). See [Summaries and the lorebook](./pipelines.md#summaries-and-the-lorebook) for how a registration sets it.

## What an applied summary fixes

Saving a reviewed summary, or applying a scene's summary, puts that part of the story in the lorebook. (A summary [saved by itself](#finished-scenes-summarized-by-themselves) does not, until you save it.) From then on [Back](./sessions.md#back-and-forward) stops at the newest line the summary was written from, and says *This part of the story is in the lorebook now.* The conversation marks the spot with *In the lorebook up to here*, and for a scene's summary the scene's row in Chronicle says *Written from the story up to 3 Oct, 14:20*: when the newest line it was written from was written. What you save is kept; to change it, edit the lorebook entry.

## Close out and the catch-up offer

**Close out** turns what was played since the last scene into a closing scene and summarizes it with the session's scene summarizer, with no minimum age. The summary is held for your review before it reaches the lorebook; it is never applied by itself. It is in the session's details, in the **⋯** menu, for the session's owner, where the genre offers it, and [archiving a session](./sessions.md#archive-and-unarchive) runs it once.

When you start a session on the same lorebook line as an older session of yours whose last lines never reached the lorebook, the new session's header offers **Catch up on ‹session›**, which closes the older session out the same way. See [Close out](./sessions.md#close-out) and [Catching up on an older session](./sessions.md#catching-up-on-an-older-session).

## Compiling scenes into a history entry

A history entry can hold several scenes. **Compile to Entry**, in the entry's menu or under its scene list, has the model merge their summaries into the entry's own content. It always goes through the model, even for a day with one scene: a scene's notes become prose, never pasted. Each scene's notes are read after its summary; a scene with no summary isn't compiled. Compiling stays a person's press: no pipeline compiles. It files under the day's one history entry (see [History entries and scenes](./lorebook-time.md#history-entries-and-scenes)), and first forks any branch session still riding the line, so its scenes are compiled on its own line (see [Which line a session reads](./lorebook-time.md#which-line-a-session-reads)). The review shows a word-by-word **Changes** view against what the entry said before; edit it and press **Save to Entry**. It's offered once the entry has scenes.

It compiles the scenes of the line you're reading, in the order they were played. Saving writes only what changed:

- At **now**, on the entry's own line, it changes the entry.
- While reading the book as of a date, it files an [amendment](./lorebook-time.md#amendments-changes-that-start-at-a-date) at that date.
- On a branch, for an entry the branch shares with main, it files an amendment on the branch, so main keeps its version. The review tells you.

A compile remembers the line and date it started from, so reopening its review later saves there.

## Changing the prompts

Each kind of summary is a pipeline in **Admin › Pipelines**: **Summarize world lore**, **Summarize character lore**, **Summarize scene** and **Summarize history entry**, plus **Build the story graph**. A summary runs in three steps, **Drafting**, **Combining** and **Naming**, each with its own prompt, model and sampling. So drafting can run on a smaller, cheaper model than combining.

To change the wording, clone a built-in prompt and pick your clone on the step. See [Pipelines](./pipelines.md#prompts).

## In the Activity view

Summaries, scene processing, compiles and graph builds run in the background, so you can close their windows and keep playing. The **Activity** view tracks them. [Getting around](./getting-around.md#activity) describes the whole view; here is what these jobs look like in it.

Each job has a card under **In progress** that moves from running to **Ready to review** or **Failed**:

| Card | While running | When it's done |
| --- | --- | --- |
| **Summarize** (world or character lore) | *Summarizing…*, with a stop button | The card's title takes you back to the session, where the review opens |
| **Scene** | *Processing…*, with a stop button | **Review results**, or **Go to Scene** if it failed; a run of the routine under **Full** leaves when it is saved |
| **Compile** | *Compiling…*; a compile can't be stopped | **Review and apply**, or **Go to Entry** |
| **Build graph** / **Extend graph** | The phase and *scene X/Y*, with **Stop** and **View progress** | **Review and apply**, or **View error** |

Dismiss a finished card with its **X**. Dismissing a scene's review discards it: the scene goes back to how it was before the run. While you have a failed job or one waiting for review, the Activity icon on the rail shows a dot.

A review lives only while the server runs. If it restarts while a scene is being summarized or waits for review, that result is lost: the scene reads as not summarized (a summary it had is kept, marked out of date), ready to summarize again.

### The LLM queue tab (admins)

Administrators also see **LLM queue**: every model call queued or running on the server, from session replies to summaries and graph steps, refreshed every second while it's open. Each row shows what the call is for, its connection and sampling, and its status; expand one for the session or lorebook it belongs to and how long it has been running.

### Troubleshooting a job that seems stuck

If a summary, scene, compile or graph build sits on its running state far longer than expected:

- **Check the LLM queue tab** (admins). If the call is queued behind other work, it will get its turn. If it's generating, the model is just slow. If it isn't there at all, the call probably failed at the connection: see [Connections](./connections.md).
- **A job that failed** keeps the rest of your work. Open it from its card (**View error**, **Go to Scene** or **Go to Entry**) to see what happened, and start it again.
- **A review that refuses to save** usually means the lorebook changed while it waited (a scene or history entry it used was deleted), or your lorebook writes are **Off**. The message says which.
