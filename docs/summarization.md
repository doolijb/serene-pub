# Summarization

Summarization turns stretches of a session into lorebook entries: what happened in a scene, what the party learned about the world, what a character revealed about herself. A long story then keeps its important facts as short, searchable lore instead of relying on messages the model can no longer see.

It runs only when you ask. Nothing is summarized in the background, and nothing costs tokens until you start it.

:::note Before you start
The session needs a [lorebook](./lorebooks.md) to save into, and your [Lorebook writes from sessions](./lorebooks.md#what-a-session-may-write) setting must not be **Off**.
:::

## From a session to the graph

Session to lore is up to four steps. Each one stops for your review before anything is saved, and you can stop after any of them:

1. **Summarize to Lorebook**: pick messages in a session and save them as a scene, a world lore entry, or a character lore entry.
2. **Process a scene**: write (or rewrite) a scene's summary and its list of who was there.
3. **Compile to Entry**: merge a history entry's scenes into the entry's own text.
4. **Build the graph**: have the model read your scenes and history and propose cast members and relationships. See [Building the graph from your scenes](./lorebook-cast.md#building-the-graph-from-your-scenes).

## Summarize to Lorebook

1. In the session, open a message's options and choose **Select for summary**. (The session's **Lore** tab has **Summarize Scene**, which does the same.) The composer becomes a selection bar.
2. Select the messages. **Select all above** and **Select all below**, on each message, fill the gap up to the nearest selected one.
3. In the bar, choose what to make: **Scene**, **World lore** or **Character lore**. The **Summarize to Lorebook** window opens.
4. Fill in the details and press **Generate summary**. The window shows its progress: drafting each part, then combining the drafts into one entry, then naming it.
5. Edit the result if you like, then **Save to Lorebook**.

The details depend on the kind:

- **World lore** takes an optional **Focus topic**, such as *the smugglers' code*, to steer what the summary is about.
- **Character lore** needs a **Focus topic**, such as *her debts* or *relationship with Kira*, and can be **bound to a character** (your personas included) so the lore is private to them. Binding adds that character to the book's cast when you save.
- **Scene** needs a **History entry** to file the scene under. Pick one, or press **New** to make a blank one dated where the session's story stands. The messages must be one unbroken run: a gap in the selection is refused, and messages already in a scene can't be selected again. After saving, the scene is processed (below) and its review opens in the **Scene summary** window.

If the session doesn't read a lorebook yet, the window offers to pick one or make a new one first.

Images and files on the selected messages are read as their names: each file is written after its message's text, such as `[image: cat.png — a grey cat]` (with the description you gave it) or `[file: notes.txt]`. A message that is only a picture is summarized as that picture rather than skipped. The names count toward how much chat each drafting part holds. No summary step sends the files themselves to the model, and a text file's contents are not read into it.

A session on a [branch](./lorebook-time.md#branches) saves to that branch, and the review says so. Only history entries on the session's line, up to where its story stands, are offered.

## Processing a scene

**Process** on a scene, in the lorebook's History or Scenes, has the model write the scene's summary from its messages (their images and files read as names, as above) and lists who was there: **Participants** (who spoke) and **Mentioned** (who was talked about). Once a scene has a summary the action reads **Reprocess**, which writes it again from scratch; useful when the messages changed or the first summary came out wrong. Review the result in the **Scene summary** window and press **Apply**.

A scene keeps its summary and cast even if its messages, or the whole session, are later deleted.

## Compiling scenes into a history entry

A history entry can hold several scenes. **Compile to Entry**, in the entry's menu or under its scene list, has the model merge their summaries into the entry's own content. The review shows a word-by-word **Changes** view against what the entry said before; edit it and press **Save to Entry**. It's offered once the entry has scenes.

It compiles the scenes of the line you're reading, in the order they were played. Saving writes only what changed:

- At **now**, on the entry's own line, it changes the entry.
- While reading the book as of a date, it files an [amendment](./lorebook-time.md#amendments-changes-that-start-at-a-date) at that date.
- On a branch, for an entry the branch shares with main, it files an amendment on the branch, so main keeps its version. The review tells you.

A compile remembers the line and date it started from, so reopening its review later saves there.

## Changing the prompts

Each kind of summary is a pipeline in the **Pipelines** view: **Summarize world lore**, **Summarize character lore**, **Summarize scene** and **Summarize history entry**, plus **Build the story graph**. A summary runs in three steps, **Drafting**, **Combining** and **Naming**, each with its own prompt, model and sampling. So drafting can run on a smaller, cheaper model than combining.

To change the wording, clone a built-in prompt and pick your clone on the step. See [Pipelines](./pipelines.md#prompts).

## In the Activity view

Summaries, scene processing, compiles and graph builds run in the background, so you can close their windows and keep playing. The **Activity** view tracks them. [Getting around](./getting-around.md#activity) describes the whole view; here is what these jobs look like in it.

Each job has a card under **In progress** that moves from running to **Ready to review** or **Failed**:

| Card | While running | When it's done |
| --- | --- | --- |
| **Summarize** (world or character lore) | *Summarizing…*, with a stop button | The card's title takes you back to the session, where the review opens |
| **Scene** | *Processing…*, with a stop button | **Review results**, or **Go to Scene** if it failed |
| **Compile** | *Compiling…*; a compile can't be stopped | **Review and apply**, or **Go to Entry** |
| **Build graph** / **Extend graph** | The phase and *scene X/Y*, with **Stop** and **View progress** | **Review and apply**, or **View error** |

Dismiss a finished card with its **X**. While you have a failed job or one waiting for review, the Activity icon on the rail shows a dot.

### The LLM queue tab (admins)

Administrators also see **LLM queue**: every model call queued or running on the server, from session replies to summaries and graph steps, refreshed every second while it's open. Each row shows what the call is for, its connection and sampling, and its status; expand one for the session or lorebook it belongs to and how long it has been running.

### Troubleshooting a job that seems stuck

If a summary, scene, compile or graph build sits on its running state far longer than expected:

- **Check the LLM queue tab** (admins). If the call is queued behind other work, it will get its turn. If it's generating, the model is just slow. If it isn't there at all, the call probably failed at the connection: see [Connections](./connections.md).
- **A job that failed** keeps the rest of your work. Open it from its card (**View error**, **Go to Scene** or **Go to Entry**) to see what happened, and start it again.
- **A review that refuses to save** usually means the lorebook changed while it waited (a scene or history entry it used was deleted), or your lorebook writes are **Off**. The message says which.
