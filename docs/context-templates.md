# Context templates

A **context template** decides what a model is sent and in what order: the instructions, the character and persona cards, the scenario, the lore, the conversation, and the reminders placed near the end. Where a [sampling config](./connections.md#sampling-configs) controls _how_ a model writes, the context template controls _what it reads_.

:::tip You probably don't need to edit one
The shipped **Default** template works for every genre and model. Edit a template when you want to change the structure of what is sent, for example to move the lore above the characters or leave a section out. To change the _wording_ of the instructions, edit the step's [prompt](./pipelines.md#prompts) instead.
:::

Three things are easy to mix up:

- A **prompt** is the written instructions (style, tone, rules). The template places it with `{{{instructions}}}`.
- A **context template** is the structure: which sections go where.
- A **variable layout** is how one section is written out: JSON or prose, with or without a heading. See [Variable layouts](#variable-layouts-where-the-headings-and-fences-come-from).

Templates are written in **Handlebars** (everything Serene Pub ships, and every example on this page) or **Liquid**, described [below](#writing-a-template-in-liquid). Both are equally supported.

## Where they live

A context template is chosen per pipeline, in **Admin › Pipelines**, on the step that builds the prompt. The choice is one of the pipeline's settings: the genre's default, which a preset can change for its sessions (see [Pipelines](./pipelines.md#where-a-value-comes-from)).

Templates are **shared, not owned by one pipeline**. A template fits the _kind of step_ that renders it, so one written for session replies is just as selectable for the narrator. The picker groups templates by where they came from (this pipeline's, then the shipped ones, then everything else that fits), and hides nothing.

Administrators see every template in **Admin › Context templates**, with a **Built-in** badge on the shipped ones and how many pipelines use each. **Admin › Completion templates** works the same way. Variable layouts have their own page, **Admin › Variable layouts**, listed by variable (see [Variable layouts](#variable-layouts-where-the-headings-and-fences-come-from)); an old **Variable templates** bookmark opens it.

A pipeline that builds no prompt from the conversation, such as a summarizer or the graph builder, has no context template setting.

## Editing and creating your own

The shipped **Default** can't be changed: duplicate it and edit the copy. Everything already using the original keeps working.

A template that doesn't parse is refused when you save it, but one that parses and says the wrong thing is not, so try changes on a low-stakes session before an administrator makes one the default. See [Templates are checked when you save them](#templates-are-checked-when-you-save-them).

A template can't be deleted while any pipeline or session still uses it. Because templates are shared, that may be a pipeline you aren't looking at: point it elsewhere first.

### The editor

The template sits in a code editor: line numbers, undo and redo, **Ctrl+F** to search and replace, bracket matching, and the tags of your language — Handlebars or Liquid — coloured apart from the prose around them. The field starts a few lines tall and grows with the text. Opened from a pipeline step, the editor also knows exactly what that step supplies, and helps in both languages:

- **Completion.** Type `{{` (or `{{{`) for the names available, each with its type and a description. After a `.` it offers that value's fields; inside `{{#each}}` it offers the item's fields plus `@index`, `@first` and `@last`. `{{#` offers the blocks and writes the closing tag too. In Liquid, `{% ` offers the tags and `|` the filters. **Ctrl+Space** reopens the list; **↑**/**↓** move through it and **Enter** or **Tab** accepts.
- **Hover.** Rest the caret on a name to see, under the field, its type, description and which step supplies it, or the name you probably meant.
- **Lint.** A name nothing supplies is underlined: a red wave for an error, an ember one for a warning. Rest the pointer on the wave to read the finding, or read the list below the field, which says what is wrong and on which line and offers a fix such as **Use "message"** where there is an obvious near miss (**Ctrl+.** at the caret applies it). A template that doesn't parse is underlined once you stop typing, not on every keystroke. These are the same checks as saving and selecting, so the editor and the save never disagree.
- **Variables available here.** Beside the text (below it when narrow): see the next section.
- **Variable layouts.** Wherever a context template is edited (on a copy: a shipped template is read-only), the editor also helps with how each value is written out. With the caret on `{{{characters}}}`, the line under the field says how it is written now (_Written as Titled JSON block (this pub's choice)_) and offers one button per other layout, such as **Write as JSON here**, which rewrites that one tag to name it (see [A template may name one](#a-template-may-name-one)). **Layouts in this template**, above the field, has a row for each laid-out value the template reads, with a select (_The pub's layout_, each layout by name, or _Mixed — leave as it is_), plus **All bare** and **All titled**; **Apply** rewrites every occurrence in one edit, which one undo reverses. Inside `layout characters "` completion lists that value's references with their names, and lint marks a reference the value doesn't have, with a fix such as **Use "core/json@1"** for a near miss.

The same editor edits a **variable layout** and, in **Admin › Scripts**, a script's source — there in JavaScript, offering the reads the script declares and marking a read it uses but hasn't declared.

### Finding the variables a template can use

**Variables available here** lists every value this template can read, and nothing it can't. It is the same list completion and lint use, so a value a plugin adds appears here too.

- **Shelves.** Values are grouped as **Characters and personas**, **Lore**, **History and messages**, **Instructions and scene**, **Session** and **Other**. For example, `characterLore` is under **Lore** and `postHistoryInstructions` under **Instructions and scene**.
- **Each row** gives the name, its shape (_text_, _list_, _object_, _keyed list_, _number_ or _true/false_), what it is, and an example where one is available. A list's fields open underneath it.
- **Filter.** Type in the box above the list. Every word must appear in a name, description or supplier; a shelf's name matches the whole shelf, so _lore_ shows every lore value.
- **Insert.** Click a row, or press **Enter**, to write it at the caret: `{{{characterLore}}}` in Handlebars, `{{ characterLore }}` in Liquid. A list is written as a loop with the caret inside.
- **Used.** A value the template already reads is marked **Used**. Leaving a value out is never a warning.
- **Keyboard.** The list is one tab stop: **↑**/**↓** move, **→** opens, **←** closes, **Home**/**End** jump, **Enter** or **Space** inserts. A screen reader hears each row's name, shape, description and whether it is used.

In the template **library** (**Pipelines › Library**) there is no step in view, so the editor checks against everything that kind of step can supply and says so: _Checked against every step that uses it when you pick it._ An unknown name there is a warning, not an error.

## The default template and available variables

The shipped **Default** template, exactly as it is:

````handlebars
{{#systemBlock}}

{{#if instructions}}
{{{instructions}}}
{{/if}}

{{#if characters}}
{{{characters}}}
{{/if}}

{{#if personas}}
{{{personas}}}
{{/if}}
{{#if characterLore}}
{{{characterLore}}}
{{/if}}

{{#if scenario}}
{{{scenario}}}
{{/if}}

{{#if worldLore}}
{{{worldLore}}}
{{/if}}

{{#if history}}
{{{history}}}
{{/if}}
{{#if earlierScenes}}
{{{earlierScenes}}}
{{/if}}

{{#if relationshipsPerspectives}}
{{{relationshipsPerspectives}}}
{{/if}}
{{#if relationshipsKnown}}
{{{relationshipsKnown}}}
{{/if}}
{{#if currentDate}}
{{{currentDate}}}
{{/if}}

{{/systemBlock}}

{{#each sessionMessages as |sessionMessage msgIndex|}}
{{#with ../authorsNote}}
{{#if (and (eq msgIndex targetIndex) hasContent)}}
{{#if (eq role "user")}}
{{#userBlock}}
{{{text}}}
{{/userBlock}}
{{else if (eq role "assistant")}}
{{#assistantBlock}}
{{{text}}}
{{/assistantBlock}}
{{else}}
{{#systemBlock}}
{{{text}}}
{{/systemBlock}}
{{/if}}
{{/if}}
{{/with}}
{{#each (lookup ../injectionsByIndex msgIndex)}}
{{#if (eq this.role "assistant")}}
{{#assistantBlock}}
{{{this.content}}}
{{/assistantBlock}}
{{else if (eq this.role "user")}}
{{#userBlock}}
{{{this.content}}}
{{/userBlock}}
{{else}}
{{#systemBlock}}
{{{this.content}}}
{{/systemBlock}}
{{/if}}
{{/each}}
{{#with ../postHistory}}
{{#if (and (eq msgIndex targetIndex) hasContent)}}
{{#systemBlock}}
{{#if instructions}}
Response reminder:
```text
{{{instructions}}}
```
{{/if}}
{{#if charInstructions}}
Character reminder:
```text
{{{charInstructions}}}
```
{{/if}}
{{#if exampleDialogue}}
Example dialogue:
```text
{{{exampleDialogue}}}
```
{{/if}}
{{/systemBlock}}
{{/if}}
{{/with}}
{{#if (eq role "assistant")}}
{{#assistantBlock}}
{{{name}}}: {{{message}}}{{{attachments}}}
{{/assistantBlock}}
{{/if}}
{{#if (eq role "user")}}
{{#userBlock}}
{{{name}}}: {{{message}}}{{{attachments}}}
{{/userBlock}}
{{/if}}
{{/each}}
````

### The variables

All of these may be empty, so wrap each in `{{#if …}}`. Use triple braces, `{{{…}}}`, for every one. A value written out by a variable layout prints the same in `{{characters}}` and `{{{characters}}}`, but other text in double braces is escaped (a quote becomes `&quot;`), so triple braces stay the habit.

- **`currentDate`**: the date in the story, from the session's [story clock](./pipelines.md#the-story-clock) or its lorebook's present. Empty when the session reads no dated lorebook. The Default template places it last in the system block: the top of the prompt is the part a model's server can reuse from one turn to the next, and the date is the one value there that changes on its own.
- **`instructions`**: the step's prompt (see [Pipelines → Prompts](./pipelines.md#prompts)).
- **`characters`**: a card for every seat in play, plus the speaker, trimmed by the session's **Character detail** setting where the genre has one (see [Character detail](./group-sessions.md#character-detail)). At **Name and description**, cards other than the speaker's leave out personality; at **Only whoever is speaking**, only the speaker's card is there.
- **`personas`**: the cards of the people playing.
- **`characterLore`**: the character lore chosen for this turn, as a list of entries, each with its title, the cast member it belongs to and its text. It holds only what the one speaking may know: their own private entries and those of characters a person plays. The narrator gets entries bound to nobody, or to cast members without a card. Character lore reaches the model **only because the template places `{{{characterLore}}}`**: nothing adds it to the cards, so a template that leaves it out sends no character lore at all.
- **`scenario`**: the session's scenario.
- **`worldLore`**: the world lore chosen for this turn, most relevant first.
- **`history`**: summaries of earlier parts of the story, newest first, each headed by its date.
- **`earlierScenes`** 🚧: the summaries of this session's finished scenes whose lines are no longer in the prompt, oldest first, each with its scene's name, under the heading _Earlier in the story:_. Empty until the conversation is long enough to be cut, and in a pipeline that doesn't read earlier scenes. See [Earlier in the story](#earlier-in-the-story).
- **`relationshipsPerspectives`** and **`relationshipsKnown`**: how the speaking character sees the others, and how they are seen in return (plus well-known figures marked **legendary**). Built fresh for whoever is speaking, whenever the speaker is bound in the session's lorebook (or, with none, its **Session notes**).
- **`docsExcerpts`**: the Guide's documentation excerpts, only on the Guide's reply (see [Guide](./genres.md#guide)).
- **`recalledLines`**: older lines of the conversation found again because they name what the scene names now, one per line (_Earlier (turn 12) — Mira: I hid the brass key under the chapel floor._). No shipped pipeline or template uses it yet; to use it, set Entity search's **Earlier messages found by name** above 0 and place `{{{recalledLines}}}` in your template.
- **`sessionMessages`**: the conversation, looped with `{{#each sessionMessages as |sessionMessage msgIndex|}}`. Each message has `role`, `name` and `message`, and `attachments` when it carries files: the files placed for the model (marked out so they reach that message's turn), text files written out, and names for the rest. Write `{{{attachments}}}` right after `{{{message}}}`, inside the message's block; it renders nothing on a message with no files. The last message is always the line the model continues (for example `Ash: `), so it must stay the last thing in the output. On a connection that sends chat messages, that line is left out when it is only a name (see [On the chat wire](#on-the-chat-wire)).
- **`authorsNote`**, **`postHistory`** and **`injectionsByIndex`**: see below.
- **`characterNames`**: the enabled characters' names as one list ("A, B, and C"), empty at **Only whoever is speaking**.

### Block helpers: systemBlock, assistantBlock, userBlock

Three blocks mark who is speaking: `systemBlock` for instructions and context, `assistantBlock` for a line by an AI-played character, and `userBlock` for a line by a person. The connection turns them into whatever the service needs: separate system, assistant and user messages when it sends [chat messages](./connections.md#chat-messages-or-text-completion), or one piece of text laid out by its [Prompt Format](./connections.md#prompt-formats-and-token-counters) when it sends a text completion. Inside the message loop, `(eq role "assistant")` picks the right block for each message.

### Variable layouts: where the headings and fences come from

The template above has no `Assistant Characters (AI-controlled):` heading and no ` ```json ` fence, just `{{{characters}}}`. Those come from a **variable layout**: a small template that writes out one value.

The template owns the _structure_ (blocks, order, `{{#if}}`, `{{#each}}`); a layout owns the _presentation_ (the heading, the fence, JSON or prose). So to write characters as prose, you don't rewrite the whole template: write a prose layout for `characters` and use it. Layouts belong to the value they render, so the same one is offered wherever that value is written out.

#### One choice for the whole pub

**Admin › Writing › Variable layouts** lists the **variables**, not the layouts: each with its name, **Supplied by**, **Written as** and how many layouts it has. Filter by shelf (**Characters and personas**, **Lore**, …) or by text. There is no Add: a variable arrives with code. _How each variable is written out. One choice for the whole pub._

Open a variable to see its layouts, each previewed against an example value. **In use** marks the one in use; **Use this** on another makes it the pub's layout at once. When the pub's choice isn't the default, **Back to the default** returns to it.

**In use** is the pub's choice. Where something writes the variable out with another layout, the page lists it under **Where this differs**: each preset that chooses another, each context template that names another, each step that keeps a pick from before layouts moved, and, while the pub has no choice of its own, each step whose pipeline chose another. Each names its layout and links to where it is changed. When nothing differs, the list isn't shown.

Two layouts ship for each wrapped value:

- **Titled JSON block** / **Titled block** / **Sentence**: with a heading and fence. This is the default.
- **JSON** / **As written**: the value alone, no heading.

A value with nothing in it renders nothing, heading included. Every value that holds an object or a list of them gets a layout; when nothing ships one (for example a plugin's own value), Serene Pub adds a plain automatic **JSON** layout for it. A variable with no layout at all reads _As written_: exactly what the pipeline gives. Shipped layouts can't be edited; duplicate one to write your own.

#### Writing your own

On a variable's page, **New layout** starts from the layout in use and **Duplicate** copies another (_‹name› (copy)_). The form asks for:

- **Name**.
- **Referenced as**: an **Owner slug** (prefilled with the last one you used) and a **Name to reference it by** (it follows the name until you edit it), shown together as `mypub/prose@1`. _Fixed once saved, so templates that name it keep working._
- **Language**: Handlebars or Liquid, fixed once made.
- The source, in the template editor, with **Variables available here** showing that value's own fields and a live **Preview** against the example.
- **Use it everywhere** (a new layout only, off by default): _Every template that writes {{{characters}}} without naming a variable layout uses this one: N pipelines, M templates._ Left off, the layout is only offered on the variable's page with **Use this**.

An older layout of yours with no reference is given one the next time you save it. **Edit** and **Delete** appear only on layouts made in this pub. Delete is refused, in words on the row, while the layout is the pub's choice, a preset's choice, named by a context template, or held by a leftover pick (see [Upgrading from 0.5](#upgrading-from-05)).

#### A preset may differ

A preset can choose its own layout for a variable, so only its sessions write it differently. See [Pipelines → Presets](./pipelines.md#presets).

#### A template may name one

A template can name a layout itself. In Handlebars, `{{{layout characters "core/json@1"}}}`; in Liquid, `{{ characters | layout: "core/json@1" }}`. That template writes the value that way whatever the preset or pub chose.

A reference is `<owner>/<slug>@<major>`: Serene Pub's are `core/titled-json@1` (Titled JSON block), `core/json@1` (JSON), `core/titled@1`, `core/as-written@1`, `core/sentence@1` and so on; a plugin's look like `acme.dice/prose@1`; yours use your owner slug. A reference is unique within its value, so two values can each have a `core/json@1`.

A bare `{{{characters}}}` is written out by the first of these that applies:

1. A leftover pick on that step (upgrade only, see [Upgrading from 0.5](#upgrading-from-05)).
2. The session's preset's layout for that value.
3. The pub's layout for that value.
4. The default: the one the pipeline's author chose for that step, else Serene Pub's shipped one, or the plugin's first.
5. The automatic **JSON** layout, or plain text.

A layout the template names itself comes before all of these. If it names one the value doesn't have, the template is refused when saved or selected (see [Templates are checked when you save them](#templates-are-checked-when-you-save-them)). A stored template that names a missing layout (a plugin was removed) keeps running with the value's layout in use, and the run inspector says so.

#### Three examples

- **Small models.** An administrator writes a **Prose** layout for Characters and one for Personas, then sets them on the **Small models** preset; other presets keep the pub's layout. The steps are in [Pipelines → Presets](./pipelines.md#presets).
- **A plugin's value.** A plugin adds an `omens` value that has only the automatic JSON layout. Open it, press **New layout**, write prose, and turn on **Use it everywhere**. Later one copied template needs it as JSON: put the caret on `{{{omens}}}` and press **Write as JSON here**, which writes `{{{layout omens "acme/json@1"}}}`.
- **A 0.5 template.** It writes its own headings and fences, so its copy names the bare layouts: see [Upgrading from 0.5](#upgrading-from-05).

**When a pipeline means something else by a name.** A plugin's pipeline can put its own data under a name core uses, such as a ranked list of lore under `characterLore`. The pipeline says so, and that name is then written out by the plugin data's own variable layouts (its own row on **Admin › Variable layouts**), not core's: its plain **JSON** layout when the data is an object, or the built-in default when it is plain text. A leftover pick for core's version is removed, with a notice on the configuration. The run inspector lists which layout each value used (see [Pipelines → Inspecting a run](./pipelines.md#inspecting-a-run)).

**Reading a shipped layout.** Each one is written one tag or one JSON key per line, indented the way the value nests. Two Handlebars rules keep that layout out of the prompt. A tag alone on its line (`{{#each …}}`, `{{/if}}`) leaves nothing behind, not even its line break. Where the prompt has no line breaks at all, such as the minified world lore and history, a `~` inside a tag swallows the whitespace beside it: `{{~#each x~}}` on both sides, `{{~else}}` before it. So a line that starts with `{{~` continues the one above, and the indentation is for you, not the model. A duplicate keeps the same shape, and the same rules apply to anything you write in it.

### The postHistory object

The **post-history reminder** is a block of reminders placed near the end of the conversation, where a model many turns in pays most attention. It is the `postHistory` object, read from inside the message loop with `{{#with ../postHistory}}`:

- **`targetIndex`**: which message the reminder goes before. Set by the prompt-building step's **Post-history depth**: **0**, the default, is the end — right after the newest message, just before the line the model continues; _N_ is _N_ messages earlier.
- **`hasContent`**: true when there is something to remind and the trigger (below) allows it, so one check gates the whole block.
- **`instructions`**: the prompt's **Post-history instructions**.
- **`charInstructions`**: the speaking character's own **Post-History Instructions** (see [Characters](./characters.md)).
- **`exampleDialogue`**: one of the speaking character's **Example Dialogues**, placed here rather than at the top because a model deep into a conversation benefits more from seeing them just before it writes. A character with several shows the same one on every turn of a session (each session and speaker gets its own pick), so the prompt does not change from turn to turn for no reason.

**The trigger.** The step's **Post-history token trigger** holds the whole block back until the conversation is that long, since a reminder two messages after the instructions is noise. Reply pipelines ship with it at **3000** tokens, and so do the actions that write prose from the conversation (a side character's line, Story's **Look**, the Lair's **Trigger trap** and **Reveal**). **Narrate** and short structured calls (answering a form, Story's **Ask**, **Rest** and **Time passes**, the Lair's room drafting, the tool loop) use 0, so their reminder is always there: for them it carries the direction or the answer format, not a nudge back into character.

The depth and trigger apply to every prompt-building step in a pipeline. the Dungeon Crawler has several such steps, and each can be set separately in **Admin › Pipelines**. The three reminders always travel together: below the trigger none is sent, above it all are.

**Checking what happened.** A held-back reminder leaves nothing in the prompt, so the run inspector's **Prompt** tab says so for the step that decided: _Post-history reminder: suppressed, 278 tokens is below the 3000 trigger_, or _included at message 12_ (see [Pipelines → Inspecting a run](./pipelines.md#inspecting-a-run)).

### The authorsNote object

A Story session's [author's note](./sessions.md#authors-note) is the `authorsNote` object, read from inside the message loop with `{{#with ../authorsNote}}`:

- **`targetIndex`**: which message the note goes before, set by the note's **Messages from the end** (counted the same way as the post-history depth, and also **0**, the end, unless you move it).
- **`hasContent`**: true when the note has text and its **Every how many replies** lets it into this reply.
- **`text`**: the note, with `{{char}}` and `{{user}}` filled in.
- **`role`**: `system`, `user` or `assistant`, from **Sent as**; the default template places the note in the block it names.

The default template places the note before the injections and the post-history reminder at the same position, so the reminder stays closest to the reply. Genres without an author's note leave `authorsNote` empty.

### The injectionsByIndex map

Scripts (**Admin › Scripts**) can inject extra messages into the conversation at a chosen depth. They arrive in `injectionsByIndex`: for each message position, a list of entries with a `role` and `content`. Depth counts the same way as the post-history depth. The default template places them just before the message at that position, in the block their role names.

An injection is data your template places, never a message slipped in behind it. Move the block, restyle it, or leave it out and injections appear nowhere.

Keep both reminders and injections _inside_ the `{{#each}}` loop. Anything placed after the loop would come after the line the model continues, turning it into a separate turn that the model no longer continues.

### On the chat wire

When the connection sends [chat messages](./connections.md#chat-messages-or-text-completion), the rendered blocks are adjusted in two ways before they are sent:

- **The line the model continues is left out when it is only a name** (`Ash:`). A chat service renders a trailing assistant message its own way, and differently from the same message once it is history, so sending it stopped the model's server from reusing the previous turn's work. The model writes its own name in front of its reply, as every line of history shows, and Serene Pub takes it off again. When other voices have spoken in the conversation (a group, or a narrator beside a character), the last user message ends with _[Your turn, Ash]_ instead. A line that already holds text, such as a reply being continued, is still sent.
- **System blocks placed inside the conversation** (the post-history reminder, the author's note sent as **system**, script injections) are folded into the user message right after them (or right before them, or into a user message of their own between two of the model's lines) as a marked aside: `[System note]` … `[/System note]`. This happens only on connections whose services move or refuse a system message that is not at the top; [Connections](./connections.md#where-placed-reminders-go) lists which.

At the default depth of **0** the author's note and the reminder go at the end on every connection: right before the line the model continues on text completion, as the last messages on a chat connection, and, where system blocks are folded, at the end of your newest message (after it on its own if the newest line is the model's).

### Stats: `state`

When a pipeline passes the **Session state** step's output to the prompt-building step, the template can read the session's stats (see [Stats and states](./stats-and-states.md#in-a-prompt)):

- `state.world.<stat>`: `{{state.world.weather}}`
- `state.cast.<member>.<stat>`, plus the member's `id`, `key` and `name`: `{{state.cast.verity.hp}}`
- `state.locations.<place>.<stat>`: `{{state.locations.the_crypt.inventory}}`

A stat is available under its short name (`hp`) and its full one (`adventure_hp`). Members and places are keyed by their short id. The editor checks stat names against the genre's stats, except where a genre lets sessions add their own. No shipped pipeline passes `state` to a template, so there `{{#if state}}` is false.

### The annex: `annex`

A plugin or genre keeps what it remembers between turns in the session's **annex** (see [Pipelines → The annex](./pipelines.md#a-pipelines-own-session-state-the-annex)). A template can read declared values as `annex.<owner>.<key>`. An owner's name has dots in it, so put it in square brackets:

```handlebars
{{#if annex.[showcase.twenty-questions].secret}}
You are thinking of {{annex.[showcase.twenty-questions].secret.secretEntryName}}.
{{/if}}
```

In Liquid: `{{ annex["showcase.twenty-questions"].secret.secretEntryName }}`.

Only values declared for this session's genre, by core and plugins that are switched on, arrive. And only where the pipeline passes them: the step's `annex` input must come from the **Session annex** step's template view. No shipped pipeline does this, so at a step without it, a template that names `annex` is refused when selected.

## How entries and older messages are chosen

Deciding _which_ lore entries and _which_ summaries make it into `worldLore`, `characterLore` and `history` is the job of **retrieval**. The template receives the same shapes however they were found. (The relationship blocks are built separately.)

### Mechanisms add up

Several ways of finding an entry run side by side, and each adds to one score rather than replacing the others:

- **Keywords**: each entry's **Keywords** are matched against recent messages (ignoring case unless the entry says otherwise, or as regular expressions), along with whether the entry's name is mentioned, which characters appear with it, and how recently it came up.
- **Meaning**: when **Search by meaning** is on (it is **Automatic** by default, searching whenever an embedding model is set up), entries are also scored by how close their meaning is to the conversation. See [Embeddings and search by meaning](./embeddings-and-rag.md#how-serene-pub-ranks-retrieved-content). Without an embedding model this adds nothing and the rest still work.
- **Names and links**: names recognised in the conversation, and how entries relate to each other and to the cast, add to the same score.

An entry's **Priority** (see [Lorebooks](./lorebooks.md)) adds a bonus. Entries then fill each band (world lore, character lore, history) until its [share](./pipelines.md#where-the-weights-live) of the budget or its limit is reached.

### What is always true

- The most recent messages are always included.
- A **Pinned** entry is always included.
- The relationship blocks and `postHistory` don't depend on what retrieval chose.
- `{{{worldLore}}}` and `{{{characterLore}}}` are in order of relevance, not lorebook order, so the first entry can change from turn to turn. `{{{history}}}` is newest first, each headed by its date (`412-03-05`, `412-03`, or `Year 412`).
- When the model's context window is full, nothing more is added that turn. **Context Tokens** in the [sampling config](./connections.md#sampling-configs) sets the window.
- When the conversation itself no longer fits, its oldest messages are left out: enough to free about a quarter of the budget at once, starting at a message kept for the next turns, so the start of the prompt stays the same until the conversation outgrows it again. The run inspector's **Prompt** tab says how many were left out.
- How much of the conversation is read in the first place follows the context window too, not a count of messages: a reply reads about twice what the window could hold (up to 2,000 messages), so a long session never loses a message off its start on every turn just because it passed a fixed number. Steps that ask the model a question rather than continue the story (answering a form, Story's **Ask**, the Lair's room drafting) still read the newest **100**, set by the history read's **Limit** in [Admin › Pipelines](./pipelines.md).

### Earlier in the story

🚧 When the oldest messages are left out, the summaries of the scenes they belonged to take their place, in the `{{{earlierScenes}}}` block (_Earlier in the story:_), which the Default template places after `{{{history}}}`.

- **Which scenes.** Every finished scene on the main channel that has lost at least one of its lines from the prompt, has a saved summary (yours, or one **Summarize finished scenes** saved), and isn't compiled into a history entry yet. A scene that lost only its first lines is included too, so the model may read its last lines twice. A scene made by selecting messages counts from its first selected message. Oldest first, each with its name.
- **Which summaries don't count.** One being written, one waiting for review, one that failed, one marked out of date, and one **Back** took back (it returns with **Forward**). The scenes around it still show.
- **Its own share of the window.** The block may take **Share — earlier scenes** of the window (0.15 by default, on the **Earlier scenes** step). When the summaries don't fit, the oldest are left out first.
- **Nothing else moves.** No message is left out because a summary exists. The cut that decides where the conversation starts counts the block, so the start of the prompt still stays the same from turn to turn.
- **Once compiled**, a scene leaves this block and reaches the prompt as history does, when retrieval chooses its history entry.
- **Who reads it.** Story's reply, **Narrate** and a side character's turn, and the Dungeon Crawler's Narrator. The Lair's turns don't (see [The Lair](./genre-lair.md)). In a pipeline that doesn't read earlier scenes the block is empty.
- **Checking what happened.** The run inspector's **Prompt** tab names the scenes whose summaries were included and how many older ones were left out. To stop it, leave **Earlier in the story** out under [Prompt blocks](./pipelines.md#prompt-blocks).

## Why character, persona, and lore data is JSON, not prose

The default layouts write **facts** (characters, personas, lore, history, relationships) as JSON blocks, and **directions** (the instructions, the scenario, the reminders) as plain text. Keeping the two visibly apart helps the model tell what is true from what it is asked to do. JSON in particular:

- **Keeps traits with the right character.** In a group scene, prose descriptions run together, and a trait at the end of one character's paragraph can be read as the next one's. JSON's explicit `name` keys prevent that.
- **Is something models read well.** Roleplay fine-tuning mostly changes how a model writes, not how it reads; reading structured data is a skill most models keep from their base training.
- **Looks the same however an entry was found**, so turning embeddings on or off doesn't change what the model sees.

If you prefer prose, change the [layout](#variable-layouts-where-the-headings-and-fences-come-from), not the template.

## Writing a template in Liquid

**Liquid** is offered alongside Handlebars for people who know it, or find `{% if %}…{% endif %}` easier to read than `{{#if}}…{{/if}}`. Both languages get the same values and are held to producing the same output from equivalent templates, so the choice is only about which syntax you prefer. Everything Serene Pub ships stays in Handlebars.

### Choosing the language

The language is chosen when a template is **created** and can't be changed afterwards: the same text read by the other language would arrive at the model as literal characters. To move a template to the other language, duplicate it and rewrite the copy.

The prompt-building step accepts both languages, so a Liquid template can be picked wherever a template is chosen. In a pipeline's settings the picker lists both, with each row's language beside it, and the `+` button beside it splits into one button per language. In **Pipelines › Library** each language has its own heading. New templates are Handlebars unless you ask for Liquid.

### The syntax, side by side

|                        | Handlebars                                 | Liquid                                                            |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| A variable             | `{{{scenario}}}`                           | `{{ scenario }}`                                                  |
| Conditional            | `{{#if x}}…{{else if y}}…{{else}}…{{/if}}` | `{% if x %}…{% elsif y %}…{% else %}…{% endif %}`                 |
| Negated                | `{{#unless x}}…{{/unless}}`                | `{% unless x %}…{% endunless %}`                                  |
| Loop                   | `{{#each xs}}…{{/each}}`                   | `{% for x in xs %}…{% endfor %}`                                  |
| The item               | `{{name}}` (implicit `this`)               | `{{ x.name }}` (the loop names it)                                |
| Position               | `{{#each xs as \|x i\|}}` … `{{i}}`        | `{{ forloop.index0 }}`                                            |
| Last item              | `{{#if @last}}` / `{{#unless @last}}`      | `{% if forloop.last %}` / `{% unless forloop.last %}`             |
| A record's key/value   | `{{#each rec}}{{@key}}:{{this}}{{/each}}`  | `{% for pair in rec %}{{ pair[0] }}:{{ pair[1] }}{% endfor %}`    |
| Lookup by index        | `{{lookup m i}}`                           | `m[i]`                                                            |
| Reaching out of a loop | `{{../postHistory}}`                       | `{{ postHistory }}` — a Liquid loop does not hide the outer names |
| Shifting scope         | `{{#with obj}}…{{/with}}`                  | no equivalent; write `obj.field`, or `{% assign o = obj %}`       |
| Comparison             | `(eq a b)`, `(ne a b)`                     | `a == b`, `a != b`                                                |
| Combining              | `(and a b)`, `(or a b)`                    | `a and b`, `a or b`                                               |
| Present vs. empty      | `(isSet x)`                                | `x != nil`                                                        |
| Whitespace control     | `{{~ … ~}}`                                | `{{- … -}}` and `{%- … -%}`                                       |

Helpers become **filters**, with the same names and the same arguments:

| Handlebars                                  | Liquid                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `{{{json x}}}` / `{{{json x 1}}}`           | `{{ x \| json }}` / `{{ x \| json: 1 }}`           |
| `{{{jsonValue x}}}` / `{{{jsonValue x 4}}}` | `{{ x \| jsonValue }}` / `{{ x \| jsonValue: 4 }}` |
| `{{{jsonValue x indent=1 offset=1}}}`       | `{{ x \| jsonValue: indent: 1, offset: 1 }}`       |
| `{{pad n 2}}`                               | `{{ n \| pad: 2 }}`                                |
| `{{{layout characters "core/json@1"}}}`     | `{{ characters \| layout: "core/json@1" }}`        |

And the three block helpers become **tags**, spelled the same way:

| Handlebars                                | Liquid                                         |
| ----------------------------------------- | ---------------------------------------------- |
| `{{#systemBlock}}…{{/systemBlock}}`       | `{% systemBlock %}…{% endsystemBlock %}`       |
| `{{#userBlock}}…{{/userBlock}}`           | `{% userBlock %}…{% enduserBlock %}`           |
| `{{#assistantBlock}}…{{/assistantBlock}}` | `{% assistantBlock %}…{% endassistantBlock %}` |

`assistantBlock` takes one optional argument that Handlebars did not need: **`{% assistantBlock id: sessionMessage.id %}`**, inside the message loop. Handlebars reads the message off the block's implicit `this`; Liquid has no implicit `this`, so the message is named. It is load-bearing — the seed/prefill placeholder carries `id` `-2`, and that is what tells the block to leave its closing delimiter off so the model continues the turn rather than starting a new one.

### Three things that behave differently

**Blank lines.** Handlebars removes a line holding only a block tag; Liquid doesn't. Write `{%- if x -%}` rather than `{% if x %}` for a tag on its own line. Serene Pub's Liquid trims only to the end of the line, so `{%-`/`-%}` removes exactly what Handlebars would and leaves your blank lines alone.

**Empty lists.** `""`, `0`, `nil` and `false` are false in both. An empty list is not: `{{#if xs}}` is false in Handlebars but `{% if xs %}` is **true** in Liquid. Write `{% if xs.size %}`.

**`nil` covers both.** Handlebars' `(ne x undefined)` can tell a missing value from one set to `null`; Liquid's `x != nil` treats them the same.

### What Liquid is not allowed to do

`{% include %}`, `{% render %}` and `{% layout %}` are **refused when the template is saved**, naming the tag and the line. A template lives in the database, not in a folder, and a template able to open files could read the server's. Put shared text in the template itself. An unknown filter is refused the same way, so a misspelled `{{ x | jsonvalue }}` never quietly renders `x` unfiltered. The `layout` _filter_ is a different thing and is allowed; the refused one is the `{% layout %}` tag.

## Templates are checked when you save them

**A template that doesn't parse is refused**, with the language's own error and the line. Nothing is saved.

**A template that uses a name nothing supplies is saved, with a warning.** `{{{worldLoer}}}` parses fine and renders nothing: a whole section of lore quietly missing. The warning names the value and the line, and the editor shows it as you type. Saving only warns because a template is shared: it is checked against every step that could use it, and each warning names the pipeline. A template may fit one pipeline and not another.

**Choosing it for a step where it doesn't fit is refused.** When you pick a template for a step, it is checked against exactly what that step supplies, including any plugin bands such as `secretEntry`:

> 'prompt' can't render 'Riddle layout': it uses `secretEntri`, which nothing supplies here. Did you mean `secretEntry`? Available: …

A name the step might still receive from something that doesn't declare its values only warns. Pipelines and plugins are held to the same rule when they are published or packaged.

**A `layout` call must name a layout its value has.** One that doesn't is refused at save and select like an unknown name, and a stored one shows a notice on the configuration.

**Choices already made are never undone.** At startup Serene Pub checks every stored choice. One that would be refused today keeps running as before; it is listed in the server log and shown as a notice on the configuration until it is fixed.

The checks are careful not to cry wolf: loop items, names you `{% assign %}`, `@key`, `forloop.last` and built-in helpers and filters are never reported. Where a value's fields are known, a misspelled field is caught too, with the name you probably meant. Where they aren't known, nothing is guessed.

## Upgrading from 0.5

0.6 does **not** carry 0.5's context templates across: after upgrading, every pipeline uses the shipped template. Any template you wrote is listed in the upgrade's notes (**Admin › History**, data upgrade), and its text is in the pre-upgrade backup in the data folder's `backups/`. Paste it into a new context template if you want it back, and open **Layouts in this template** above the field, press **All bare**, then **Apply**: a 0.5 template writes its own headings and fences, so the copy now names the bare [layouts](#variable-layouts-where-the-headings-and-fences-come-from) itself. If it uses `narrativeGraph` or `speakerRelationships`, replace them with `relationshipsPerspectives` and `relationshipsKnown`: the old names no longer render anything.

Your prompt text _is_ carried: each 0.5 prompt, narrator, summarizer and graph-build config becomes a prompt of the step it fed, picked where you had picked it (see [Pipelines → Upgrading from 0.5](./pipelines.md#upgrading-from-05)). Everything else the upgrade does is in [Upgrading from 0.5](./upgrading-from-0.5.md).

**Layout picks made before layouts moved.** The upgrade folds each per-step pick in without changing any prompt: where every step agreed, it became the pub's layout; where every step a preset runs agreed, that preset's. Any other pick whose removal would change a prompt is kept and shown on its step as _Characters uses JSON here (set before layouts moved)._ with **Remove this pick**. What applies then is the next in the order above, which may be the session's preset's layout rather than the pub's. A pick made on another step, such as the one that builds the character cards, names that step: _Characters uses JSON (set on Build template context before layouts moved)._ When one variable has picks at more than one level, each line says whose it is: _Characters uses the genre's JSON here…_, _Characters uses the Small models preset's Prose here…_ When the step's template is the pub's own copy, **Move into the template** rewrites it to name those layouts itself and clears the picks, with the prompt unchanged. These leftover picks go away at 0.7.
