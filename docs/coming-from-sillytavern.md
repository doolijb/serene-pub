# Coming from SillyTavern

If you know SillyTavern well, most of what you do there has a home in Serene Pub, often under a different name and sometimes working a different way. This page maps one onto the other.

_Written for Serene Pub 0.6._

:::note By the end of this page
You'll know what's different and why, where each SillyTavern habit lives now, what you get without adding anything, and what isn't here yet. The last section gets you from your SillyTavern library to a first reply.
:::

## In one minute

- **Genres come with a ready-made pipeline.** You don't assemble a prompt out of a system prompt, a story string, an instruct template and an author's note. You pick a genre (Chat, Adventure, the Lair, the Guide), and its pipeline already knows what goes where. To change what the model is told, you change the prompt text. See [Genres](./genres.md).
- **Lorebooks are worlds.** A lorebook still holds keyword-triggered entries, but it can also hold places joined on a map, dated history, branches of the story, and a cast whose members each have lore only they know. See [Lorebooks](./lorebooks.md).
- **Several people can share one pub.** Turn on accounts and each person signs in to their own characters and stories. You can invite them as guests into one session, and a real turn order decides who speaks. See [Users and accounts](./users-and-accounts.md) and [Group sessions](./group-sessions.md).
- **Your library comes over with a guided import.** Point Serene Pub at your SillyTavern folder and it brings in characters, personas, chats and World Info, swipes included. See [Importing from SillyTavern](./importing-from-sillytavern.md).

## Bring your stuff over

On a computer, an administrator can import a whole SillyTavern folder from **Settings › Import**. Single cards work anywhere, from **New › Import a card** in the Characters view. [Importing from SillyTavern](./importing-from-sillytavern.md) walks through it.

What comes across:

- **Characters**, with their expression sprites.
- **Personas**, with their avatars. In Serene Pub a persona is simply a character you play.
- **Chats and group chats**, as sessions with every message and its swipes.
- **World Info files**, as lorebooks. Each entry's keys become keywords, and a book's scan depth, token budget and recursive scanning come with it.

What stays behind:

- The links between a chat's branches and checkpoints. Each branch file becomes its own session.
- A group's earlier chats (only its current one comes in), chat backgrounds, and extension data.
- Your connections and API keys, sampler presets, instruct and context templates, system prompts and Quick Replies. Serene Pub has its own versions of these (see the table below), and you set them up once.

:::note
The importer is offered to administrators only, and not in the [Android app](./android.md). On Android, import cards one at a time.
:::

## Rosetta stone

| In SillyTavern | In Serene Pub |
| --- | --- |
| Chat | [Session](./sessions.md) |
| Group chat | A session with several characters, plus a [turn order](./group-sessions.md#choose-how-the-turn-order-works) |
| Muting a group member | [Benching](./group-sessions.md#bench-a-character) them |
| Persona | [Persona](./personas.md): a character you play |
| API connection, connection profile | A [connection](./connections.md) and one of its models. Each job has a default model, and an administrator can give a pipeline a different one. A session never picks its own. |
| Text completion or chat completion | [Chat messages or text completion](./connections.md#chat-messages-or-text-completion), which the connection works out for itself unless you set it |
| Sampler presets | [Sampling configs](./connections.md#sampling-configs) |
| Instruct template | A connection's [prompt format](./connections.md#prompt-formats-and-token-counters), used for text completion |
| Context template, story string | [Context template](./context-templates.md) |
| System prompt | The **System prompt** of a pipeline's [prompt](./pipelines.md#prompts) |
| Post-history instructions | **Post-history instructions**, on the prompt and on the character card ([where they go](./context-templates.md#the-posthistory-object)) |
| Author's Note | Chat's [**Author's note**](./sessions.md#authors-note): the same note, depth and interval, edited in the session's settings or its own widget. A new note goes at the end, right before the reply (depth 0, where SillyTavern uses 4); an imported chat keeps the depth it had. Adventure, the Lair and the Guide don't offer one. |
| World Info, lorebook | [Lorebook](./lorebooks.md) entries, plus [places](./lorebook-places.md), [history](./lorebook-time.md) and [cast](./lorebook-cast.md) |
| Swipes | [Swipes](./sessions.md#regenerate-extend-and-swipe) |
| Continue | **Extend** |
| Hide message | **Hide** |
| Branch, checkpoint | [Branch from here](./sessions.md#branch-from-here) |
| Quick Replies, STscript | [Actions](./sessions.md#actions), [slash commands](./sessions.md#slash-commands) and scripts an administrator attaches to a pipeline |
| Character Expressions | [Sprites](./characters.md#sprites) |
| Vector Storage | [Search by meaning](./embeddings-and-rag.md) |
| Summarize extension | [Summaries saved to a lorebook](./summarization.md) |
| Prompt itemization | [Prompt details](./sessions.md#statistics) and the [run inspector](./pipelines.md#inspecting-a-run) |
| Extensions | Plugins, which declare what they're allowed to do (a preview in 0.6, see [Not here yet](#not-here-yet)) |

## What works differently, and why

### Prompts

In SillyTavern you build the prompt: you choose the order of its pieces and fill in each field. In Serene Pub the **genre's pipeline** owns that order. A **context template** lays out where each piece goes (instructions, cards, scenario, lore, conversation), and the **prompt** is just the words. Most of the time you only touch the words: anyone can change the prompts of a session they own, from **Edit session › Settings**, under **Pipelines**. Administrators can reorder the pieces with **Prompt blocks**, or write their own context template, in the Pipelines view. See [Pipelines](./pipelines.md) and [Context templates](./context-templates.md).

**What you'll notice:** fewer prompt fields to fill in, and a list of every value a template can use, with what each one is, so you never have to guess a macro's name.

### Lore

Entries still fire on keywords, with regex, case sensitivity and priority. With an embedding model set up, they can also be found by **meaning**, so a message about "the dwarf's bar" can bring in your tavern entry with no keyword. Lore that belongs to one character is read only on that character's turns, and the context template decides where it sits. Entries can be dated, switched off between two story dates, changed from a date onward (**amendments**), and differ between **branches** of the story. See [Lorebooks](./lorebooks.md) and [Time, history and branches](./lorebook-time.md).

**What you'll notice:** each entry's **Read in?** tab tells you whether it would be read in on the latest turn, and why or why not.

### Group chats

A group session is a Chat session with more than one character. A turn order decides who speaks: **Round robin**, **Round robin by user**, **Random**, **Scripted**, **Manual** or **Narrator replies**, or let the model pick. **Auto-advance** decides whether one character answers or the whole round plays out, and **Character detail** sets how much the model is told about everyone who isn't speaking. See [Group sessions](./group-sessions.md).

**What you'll notice:** a line beside the composer says who is due next, with **Continue** and **Pick who speaks** in the Actions row.

### Stats and state

**Adventure** and **the Lair** keep track of health, mood, inventory, location and the like for you. The model can only *propose* a change: it shows under the reply with **Accept** and **Reject**, and **Review N changes** gathers every waiting one. Every change is tied to the message that made it, so swiping or deleting that message takes the change back. Chat tracks nothing. See [Stats and states](./stats-and-states.md).

**What you'll notice:** no extension or prompt trick needed to keep numbers straight, and nothing changes behind your back.

### Several people, one pub

A pub starts as just you. Turn on accounts in **Admin › General** and everyone signs in to their own characters, personas, sessions and lorebooks. A session's owner can add **guests**, who write as their own personas and take their turns. Members can change the prompts of their own sessions; models, sampling and connections are the administrator's. See [Users and accounts](./users-and-accounts.md) and [Sessions › Guests](./sessions.md#guests).

**What you'll notice:** the Connections and Sampling icons are only on an administrator's rail.

### Settings live in fewer places

Instead of a stack of drawers, settings sit in a few places:

- **Edit session › Settings**: everything about one session, including its genre settings and its prompts.
- **The Pipelines view**: what each model call runs on, for administrators. See [Who can change what](./pipelines.md#who-can-change-what).
- **Admin**: connections, defaults, users, backups and the rest of the pub. See [The admin area](./getting-around.md#the-admin-area).
- **Settings**: your own language, theme and preferences.

**What you'll notice:** a session's model isn't on the session screen. It comes from the pipeline's configuration, or the pub's default (see [Which connection a session uses](./sessions.md#which-connection-a-session-uses)).

## What Serene Pub gives you built in

Things you'd otherwise patch together with extensions, or do by hand:

- **Places.** Rooms and towns joined by ways, drawn on a map, each holding its own lore. See [Places and maps](./lorebook-places.md).
- **Time and branches.** Dated history, a story clock per session, and branches of the lorebook that part from the main line. See [Time, history and branches](./lorebook-time.md).
- **Amendments.** Lore that changes from a date onward, without losing what was true before. See [Amendments](./lorebook-time.md#amendments-changes-that-start-at-a-date).
- **A cast with private lore.** Each cast member can know things nobody else does, and has relationships to the others. See [Cast and relationships](./lorebook-cast.md).
- **Real turn order.** Strategies, auto-advance, benching and a narrator on request. See [Group sessions](./group-sessions.md).
- **Multiplayer.** Accounts, invite links and guests in one shared story. See [Users and accounts](./users-and-accounts.md).
- **Genres.** **Chat**, **Adventure** (a narrated world with stats), **the Lair** (you are the dungeon; an AI party explores it) and the **Guide** (answers questions about the app from these docs). See [Genres](./genres.md).

### More

- **Stats tracked for you**, with every change shown under its message. See [Stats and states](./stats-and-states.md).
- **Visible pipelines.** Each model call has a name and its own prompt, model and sampling, so Adventure's planner can run on a small model and its narrator on a large one. See [Agents](./pipelines.md#agents).
- **The run inspector**, for administrators: every step of a reply, the exact request sent, and why each piece of lore went in or not. See [Inspecting a run](./pipelines.md#inspecting-a-run).
- **The template variable list**, with each value's shape and an example. See [Finding the variables a template can use](./context-templates.md#finding-the-variables-a-template-can-use).
- **Search by meaning that doesn't redo work.** Only a change to an entry's text re-embeds it. See [Keeping the index up to date](./embeddings-and-rag.md#keeping-the-index-up-to-date).
- **Summaries that become lore**: scenes, world lore or character lore, saved to the lorebook after you review them. See [Summarization](./summarization.md).
- **Backups and recovery.** A daily backup, and a recovery page when the database won't open. See [Data and backups](./system-settings.md#data-and-backups).
- **Two-factor sign-in and invite links.** See [Two-factor authentication](./users-and-accounts.md#two-factor-authentication).
- **A built-in tunnel** to reach your pub from anywhere, with nothing to change on your router. See [Hosting](./hosting.md#from-anywhere-the-built-in-tunnel).
- **Layouts.** Put widgets such as portraits, stats and lore around the conversation, pick a message style (or write your own CSS), and open any view at **Dock**, **Half** or **Focus** width. See [Session layout](./session-layout.md) and [Widths](./getting-around.md#widths-dock-half-and-focus).
- **Document View**: a separate, high-contrast, screen-reader-friendly way to use the app. See [Document View](./document-view.md).
- **Android and portable builds.** A complete pub on your phone, or one folder you can carry. See [Android app](./android.md) and [Portable, self-contained setup](./environment-variables.md#portable-self-contained-setup).

## Not here yet

- **Impersonate.** The model never writes your persona's lines for you.
- **Voice.** There's no text-to-speech or speech input in sessions.
- **More than one lorebook per session.** A session reads one book at a time, so there's no stacking of global, character and chat books.
- **Lorebook export.** It's paused while the format settles. A [character card](./characters.md#exporting-a-character) can still carry a book.
- **SillyTavern's extension catalogue.** SillyTavern extensions don't run here. Serene Pub's own plugins (including showcase genres such as Whodunit, Writing Room, Battleship and Twenty Questions) are a preview in 0.6 and switched off in releases; an administrator turns them on with `SP_PLUGINS_ENABLED` (see [Feature toggles](./environment-variables.md#feature-toggles)).

## Your first session, the SillyTavern way

:::note You'll need
Serene Pub installed and open in your browser ([Install](./install.md)), and an administrator account, which you are if you run the pub and haven't turned accounts on.
:::

### 1. Bring a character over

Import one card from **Characters › New › Import a card** (PNG, JSON and CHARX all work), or your whole folder from **Settings › Import**.

:::tip You should see
The character in the Characters view, with its avatar. After a folder import, **Import complete** with a summary of what came in.
:::

:::warning If this didn't work
See [Cards that won't import](./characters.md#cards-that-wont-import), or the checklist in [Importing from SillyTavern](./importing-from-sillytavern.md#import-your-folder).
:::

### 2. Connect the API you already use

Add the service you used in SillyTavern, from the setup wizard's **Choose an LLM** screen or the **Connections** view on the rail. KoboldCPP, Ollama, LM Studio or llama.cpp already running on this computer is listed for you in the wizard under **Found on this computer** (in Connections, choose **Something I already run**). OpenRouter, OpenAI, Anthropic and other OpenAI-compatible services take your API key. Pick a model. [Connect a model](./connect-a-model.md) has the details.

:::tip You should see
The status line at the top of the Connections view reads **Sessions can reply**, naming the model and connection.
:::

:::warning If this didn't work
- **Needs a key**: open the connection and paste the API key.
- **Not reachable**: check the program is running, or the address and your network. See [Check that it worked](./connect-a-model.md#check-that-it-worked).
:::

### 3. Start a Chat session

Open **Sessions** on the rail and press **New**. Leave **Genre** on **Chat**, pick your character under **Who is in it** and your persona under **Who you play as**, then press **Start**. Send a message.

:::tip You should see
The character's greeting from their card, then their reply streaming in under your message.
:::

:::warning If this didn't work
- **Start stays grey**: something marked `*` still needs a choice.
- **Nobody replies**: in a session with several characters, **Auto-advance** may be **Off**. Press **Continue**. See [Sessions › Troubleshooting](./sessions.md#troubleshooting).
:::

## Related

- [Importing from SillyTavern](./importing-from-sillytavern.md)
- [Genres](./genres.md)
- [Pipelines and configurations](./pipelines.md)
- [Lorebooks](./lorebooks.md)
