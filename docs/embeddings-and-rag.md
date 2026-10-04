# Embeddings and search by meaning

Keywords only find an entry when somebody types its words. **Search by meaning** finds lore by what it's about: a message about *"the dwarf's bar"* can bring in your entry on the Gilded Tankard even though neither word is a keyword. It works by turning every lorebook entry into an **embedding**, a list of numbers that captures its meaning, and comparing the conversation against them before each reply. This is what people call **RAG** (retrieval-augmented generation).

It's optional. Without it, lorebooks work on keywords alone. With it, keywords still work, and meaning adds to them.

:::note By the end of this page
You'll have an embedding model set up, your lorebook indexed, and Search by meaning finding entries in your sessions. Power users will also find how to choose a model, what each turn costs, and how retrieved lore is ranked.
:::

## Turning it on

1. Open the **Connections** view from the rail and find the **Embeddings** section.
2. Add a connection. Most people should pick **Local embeddings (ONNX)**: it runs on your own computer, offline and free.
3. Choose a model from the recommended list (see [Choosing a local embedding model](#choosing-a-local-embedding-model)), download it, and press **Use for embeddings** to star it.

That's all. Indexing starts by itself, and **Search by meaning** is on its default, **Automatic**, which searches whenever an embedding model is starred.

:::tip You should see
The starred connection's queue reads **Running** while it indexes, then **Idle**. Open a session with a lorebook: each entry row in the lorebook shows a small lightning bolt once it's indexed. Later, an entry's **Read in?** tab shows a meaning score beside the keyword score.
:::

:::warning If this didn't work
- **The queue stays Idle with nothing done.** Press **Start** on the status card. If it says **Backend not loaded**, press **Load now**. See [Troubleshooting a stuck or empty queue](#troubleshooting-a-stuck-or-empty-queue).
- **Local embeddings isn't offered.** It isn't available in the Android app; use a service or a computer on your network instead.
:::

## Embedding connections

An embedding connection is a connection like any other: a service, an address and key where the service needs them, and a model. One of them is starred, **Use for embeddings**, and that star decides which model indexes your lore. With no star, retrieval runs on keywords alone.

| Service | Runs | Cost | Good for |
| --- | --- | --- | --- |
| **Local embeddings (ONNX)** | On this computer, offline | Free | Most people. Pick, download and star a model in the Connections view. See [Local ONNX models](./connections.md#local-onnx-models). |
| **Ollama embeddings** | In Ollama, on this computer or your network | Free | People already running Ollama: any embedding model it has pulled. |
| **Embeddings (OpenAI-compatible)** | A service such as OpenAI, or LM Studio or llama.cpp on your network | Per request on a paid service | No spare memory locally, or a preferred hosted model. |
| **KoboldCPP** | Your KoboldCPP | Free | A KoboldCPP connection with an embedding model loaded can answer embeddings on the same address as text. |

An administrator can also set the embedding model in **Admin › Defaults**, under **Embeddings**. It's the same choice as the star, and changing it asks first in the same way.

The setup wizard doesn't ask about embeddings. Turn them on whenever you like.

### Choosing a local embedding model

The recommended list offers three tiers, trading speed and memory for how well they find things:

| Tier | Model | Size | Notes |
| --- | --- | --- | --- |
| Fast | all-MiniLM-L6-v2 | ~80 MB | Light and quick; fine for short, fact-style lore and low-memory machines. English. |
| Balanced | EmbeddingGemma-300M | ~300 MB | A good default. Multilingual, and handles longer prose and character descriptions well. |
| Best | bge-m3 | ~570 MB | The strongest retrieval, multilingual, with room for very long entries. Worth it if you have the memory. |

The list is kept up to date online, so you may see more models than these. Models you've placed in the local models folder as embedding models are offered too.

### Model idle timeout

On a local connection, **Model idle timeout** unloads the model after it has had nothing to do for that many minutes (5 by default), freeing memory between bursts of work. **0** keeps it loaded. On a hosted service the field does nothing.

## Search by meaning

**Search by meaning** is a setting on the **Retrieval queries** step of the reply pipeline, in the **Pipelines** view:

- **Automatic** (the default) searches whenever an embedding model is starred, local or paid.
- **On** searches on every turn.
- **Off** never searches by meaning, but keeps the index up to date.

Its companions are on the **Semantic search** step:

- **Entries found by meaning** (5): the most entries a search may add to one turn. Raising it doesn't turn the search on.
- **Closest matches per query** (40): how many candidates each search looks at.
- **Discount weak matches** (1): how much a loose resemblance counts against a close one. Higher pushes vague matches down without removing them.

The search always uses the starred model, because a question embedded by a different model wouldn't match the index. The retrieval explanation for a turn says whether it searched, and why not when it didn't.

### What it searches

Search by meaning searches the **entries of the session's own lorebook** and nothing else: world lore (places and items included), character lore and history. It reads what the session reads, on its line and as of its story clock (see [Time, history and branches](./lorebook-time.md#which-line-a-session-reads)), and never an entry that is off or archived.

It never searches messages. The recent conversation is already in the prompt, and a message found by meaning would only take room from lore. Characters, personas and the graph are indexed too, but nothing searches them by meaning yet.

An entry found by meaning reaches the prompt exactly as one found by keyword. If it was found both ways, it ranks above one found either way alone.

Adventure and the Lair search by meaning and by name too, as Chat does. A character's own turn there searches as that character, so it finds their private lore and never another's.

### What a starred model costs per turn

With a model **on this computer** (local, Ollama, KoboldCPP), these are work on your own hardware and nothing is billed. With a **paid service**, each is a billed request:

- **Search by meaning**, when it searches: one request per turn. On **Automatic**, that's every turn; set **Off** if you want the index without the searches.
- **Indexing the reply** once it lands: one request.
- **Indexing your own message** and anything else not yet indexed: about one more request.
- **Sprites**: when the speaker has sprites, picking a face for the reply is one request.
- **Descriptions to follow up**, on the **Descriptive mentions** step: on by default (up to 8). One request per turn that has a description such as *"the captain"* to match. Set it to 0 to turn it off.

Embedding requests are small, so even on a paid service a long evening usually costs very little.

## Keeping the index up to date

Everything is indexed in the background, a session at a time with its lorebook and characters, and kept current as you edit.

**Replies come first.** While a reply is being written, and for a moment after, background indexing waits, so it never slows the reply's own lookups. It picks up again between replies, so the queue can show **Running** with nothing changing while a reply is written. A reply that needs particular entries indexed right away still gets them: those go to the front of the queue and aren't held back.

**Only a change to the text re-embeds.** Each piece of content is embedded again only when the text it embeds changes:

| Content | Embedded text |
| --- | --- |
| A lorebook entry | Its name and content (a history entry: its content). The entry's own text, not its dated changes. |
| A message | Its content, once the reply has finished. |
| A character or persona | Its name and description. |
| A cast member | Their name and summary. |
| A relationship | Both names, its type, description and reason. |

So pinning, switching off, archiving, reordering, editing keywords or dating an entry costs nothing, and neither does hiding a message or changing a character's avatar. Spaces at either end of the text don't count as a change. Renaming a cast member re-embeds them and the relationships that name them.

### Changing the embedding model

Every stored embedding remembers which model and address made it. When you star a different model, Serene Pub counts the embeddings the new model can't use, tells you how many will be redone across how many lorebooks and sessions, and asks first. On confirm, those are deleted and indexing starts again with the new model. If there's nothing to redo (the first model on a new install, or the same model again), the star simply moves.

Editing the starred connection's address or model counts as a change of model and asks the same way. The same address written differently (a trailing slash, capitals, the default port) is not a change. `localhost` and `127.0.0.1` count as two different addresses.

Unstarring, or deleting the starred connection, stops indexing and keeps the embeddings, so starring the same model again later picks up where it left off.

### The queue

The starred connection's view shows its queue:

- A **status card**, **Running** or **Idle**, with **Start** and **Stop**, live counts, and what is being embedded now.
- **Queue**: what's waiting, grouped by session (with its lorebook and characters) so a session's content is indexed together.
- **Recent**: what was finished.
- **Load now**, when the local model isn't in memory, for example after a restart.

### Troubleshooting a stuck or empty queue

If the queue sits at **Idle** with content still waiting:

- **Backend not loaded**: press **Load now**, then **Start**. If the model was removed from disk, download it again.
- **A service stopped answering**: check its address and key in the connection.
- **One session never finishes**: its notice (below) has **Prioritize in queue**, which moves that session to the front.

The server log has a warning whenever the queue stops by itself.

## Understanding RAG notices

Once a session passes 10 messages, a quiet line can appear above the composer when its lorebook isn't fully searchable yet:

- *Lorebook entries aren't indexed yet, so Search by meaning can't find them.*
- *Lorebook entries were embedded with a different model and need re-indexing with ‹model›.*
- *Indexing 12 of 40 lorebook entries.* While the queue isn't running, it says *12 of 40 lorebook entries are indexed. The rest are waiting in the embedding queue.*

**Prioritize in queue** moves the session to the front. **Hide for this session** hides the notice; Search by meaning still searches whatever is indexed, and **Show again** brings it back. Only the session's owner can hide it. The notice goes away by itself once every entry is indexed.

### Why some short sessions never show a RAG notice

Sessions with 10 messages or fewer show no notice. Search by meaning still searches their lorebook on every turn it's set to.

### The status icon

Lorebook entry rows and character rows carry a small icon for their own index state: a lightning bolt when they're indexed with the current model, a refresh icon when they were indexed with a different one, and nothing when embeddings are off or they haven't been indexed yet.

## Named entities

**Named entities** is a fourth section of the Connections view, with one service, **Local named entities (ONNX)**. Its models, from a small English one (about 67 MB) to larger multilingual ones, find the people, places and things a message names. Download one and star it with **Use for entity extraction**.

It helps lore be matched by name even when nobody set a keyword, or when a scene writes a name in lower case. Without it, Serene Pub matches on the names the lorebook already knows and on capitalised words, which works well for most books.

Starring a different entity model asks first and says how many rows will be re-read. Like embeddings, only a change to the text re-reads a row.

## How Serene Pub ranks retrieved content

Most of this happens without settings; the ones you can change live on the reply pipeline's retrieval steps (see [Where the weights live](./pipelines.md#where-the-weights-live)). Knowing it helps explain why the model does or doesn't seem to remember something.

### How Search by meaning scores entries

On a turn it searches, Search by meaning embeds the latest two messages separately and searches with each. An entry's closeness is the best it scored against either, so an entry close to what was just said counts even if the message before was about something else. Closeness is added to what its keywords earned, never replaces it.

### What is left out before ranking

Before anything is ranked, a few rules take out lore the turn mustn't use, however it was found. Each one shows in the retrieval explanation as left out, with its reason:

- **Its own conditions.** An entry whose secondary keys or logic rule it out on this turn is left out even when Search by meaning or a name brought it in.
- **Secrets.** A secret relationship reaches only its holder.
- **Not in the world yet, or any more.** Lore about a cast member who has presences, none of them covering the session's story date, is left out (see [When a cast member is in the world](./lorebook-cast.md#when-a-cast-member-is-in-the-world)). A member with no presences is always here.
- **Already shown.** In Adventure and the Lair, the room the party stand in is written under its own heading, so it isn't ranked in a second time as lore.

Searching by name is on by default too: up to 5 entries whose names the recent conversation shares (**Entries found by name**, on the **Entity search** step). The same step also finds up to 20 earlier lines naming the same people and places (**Earlier messages found by name**), which keeps the session's messages indexed by name; they reach a prompt only where a context template places `{{{recalledLines}}}`, and no shipped one does (see [Context templates](./context-templates.md)). Set either to 0 to turn that half off.

### Pinned entries

Pinned entries are taken first, before anything is ranked, and they count against the room set aside for lore. They're never shortened: one that doesn't fit is left out whole. A book with a lot of pinned text leaves little room for anything else, so pin sparingly.

### Relationships from the graph

Relationships between cast members are offered from the point of view of whoever is speaking: what they think of the others, what the others think of them, and figures the whole world knows of. A secret relationship reaches only its holder.

**By default, all of them are included**: the prompt carries every relationship the speaker's view reaches, outside the lore budget, limited only by **Most relationships** on the relationship steps. To make them compete for room instead, raise **Share — relationships** on the **Relationships: ranked** step above zero. Then they're ranked, and only those that earn room are written, in this order:

1. **Who is in the scene.** A relationship with someone in the session's cast outranks one with someone who's only in the lorebook.
2. **Whose it is.** A relationship the speaker is party to outranks one between two other people.
3. **What changed most recently.**

The order is strict: presence beats everything below it. Set the share back to zero to return to the full set. The retrieval explanation lists every relationship it considered, with its reasons written out.

When nobody is speaking, as on an Adventure narrator's turn, there's no one to see from: the planner and narrator read every relationship any cast member holds, except secrets. Adventure gives relationships a share of their own out of the box. See [Adventure](./genre-adventure.md).

**Follow lore links**, on the same step, also ranks links reached from entries the turn found, such as a room's ways out. These count toward the relationships' share, but they aren't written into the prompt; a place's ways reach Adventure and Lair turns in their own way (see [Places and maps](./lorebook-places.md#how-a-session-uses-places)).

## Context debugging

To see exactly what the model was given, an administrator can turn on **Context debugging** in **Admin › Diagnostics**. Each reply then saves its full retrieval details, including what Search by meaning found, so you can inspect them afterwards from the message. It adds some work and storage to every reply, so leave it off unless you're investigating. See [Pub settings](./system-settings.md).
