# Connections

A **connection** tells Serene Pub where a model runs and how to reach it: a program on your computer, a machine on your network, or an online service. This page covers the two rail views that look after them, every kind of connection, the KoboldCPP and Ollama that Serene Pub can look after for you, and the settings that shape what a model is sent: sampling configs, prompt formats, token counters, stop sequences and streaming.

:::tip Setting up for the first time?
You need one connection and one model, and [Connect a model](./connect-a-model.md) walks you through it in about ten minutes. Come back here when you want to add a second service, tune how a model writes, or work out why something stopped answering.
:::

Two views on the rail share the work:

- **[Models](#the-models-view)** is every model you have in one list, and where you get a new one.
- **[Loadouts](#loadouts)** is where you make your sessions work: which model each kind of work runs on, and how it is driven.
- **[Connections](#the-connections-view)** is where models run: the services and programs Serene Pub talks to, the KoboldCPP and Ollama it runs for you, and each one's settings.

Both belong to the administrator. **Models**, **Connections** and **Sampling** on the rail are only offered to administrators, and so are the **Admin › Models** pages. Members never see any of them; in a session, while the Reply loadout has no model, they see one line above the composer saying so (see [Sessions](./sessions.md)). Everyone else uses whatever the administrator has set up.

## How connections, models and loadouts fit together

Four ideas carry the whole page.

- **A connection is a place.** It holds an address, an API key where the service needs one, and a few settings about how requests are sent. It does not, by itself, pick a model.
- **A connection has models.** Serene Pub asks the service which models it offers and keeps that list up to date. One connection to OpenRouter can offer hundreds; one llama.cpp offers the one it was started with.
- **A loadout is what a kind of work runs on.** Writing replies, drawing pictures, embeddings, named entities and the rest are kinds of work the pub needs done. A **loadout** names a connection _and_ one of its models, a **pair** such as _Nemo 12B · KoboldCPP_, plus the sampling config it is driven with. Each kind of work has a **default loadout**: _the Reply loadout_ for replies, _the Images loadout_ for pictures, _the Embeddings loadout_, _the Entities loadout_ and _the Narration loadout_. A default loadout with no pair is switched off, which is fine for every one except Reply. Serene Pub also ships specialist loadouts, such as _Extraction_ for summaries, that start **unfilled** and simply use the default loadout of their kind until you fill them. You fill them in the [Loadouts view](#loadouts), in [Admin › Models › Loadouts](#admin--models--loadouts), or with **Use in…** wherever a model is listed. What a connection or a model _can do_ (chat, draw, embed, read pictures, stream, call tools) is its **capabilities**: a loadout can only be given a model whose capabilities include its kind of work.
- **A pipeline can ask for a different model.** Each model call in a pipeline names a loadout (summaries name _Extraction_), and the pipeline's settings can also name a pair or a sampling config for that one call, for example a small fast model for the Dungeon Crawler's planner. Anything it leaves unset comes from its loadout, and an unfilled loadout uses the default loadout of its kind. See [Pipelines → Model and sampling](./pipelines.md#model-and-sampling).

A **session never picks a connection or a model.** Its replies use whatever its pipeline names, else the Reply loadout. To change the model a session uses, an administrator changes it in **Admin › Pipelines** (see [Sessions → Which connection a session uses](./sessions.md#which-connection-a-session-uses)).

## The Models view

Open **Models** from the rail. It is the pub's inventory: every model it can use, on every connection, and the models it is still downloading. Which model each kind of work runs on is the [Loadouts view](#loadouts)'s question. Like any view it can sit beside your session, take half the window, or take all of it (see [Getting around](./getting-around.md)).

### Models, top to bottom

- **The toolbar.** **Get a model** opens the [model finder](#the-model-finder) as a dialog. **Filter** matches a model's name, its identifier, its connection's name and its service. The button beside it, **Model scope**, narrows the list to one kind of model: **All**, **Chat**, **Images**, **Embeddings** or **Entities**, each with how many models it keeps; the narrowing in force shows as a chip, and its **×** clears it. **⋯** holds **Add a model by name** (for a connection whose service doesn't publish a list of models).
- **The models list**: every model of every connection, described [below](#the-models-list).
- **The background remover**, the one local model no connection owns (see [The background remover](#the-background-remover)), with **Delete from disk** once it is downloaded.
- **Downloads**, at the foot while anything is downloading: a count, an overall bar, and **View**, which opens the [Downloads list](#downloads) above the tray.

With nothing connected yet, the list says _No models yet._ Under it, _Or add a connection to a service or a server you run._ ends in **Add a connection**, which opens the [Connections view](#the-connections-view).

### The models list

One row per model, from every connection at once, sorted by name. The models you can pick come first; models that are switched off or no longer listed are at the end. Each row shows the model's name and a line of facts about it, its connection as a small chip (hover it for the service as well), and a gold mark for each default loadout it is in. A local ONNX model that isn't downloaded yet says its size instead.

**Use in…** opens a small menu of the loadouts that can run this model, the default first (such as _Reply_, then _Extraction_, _Tool calling_), each saying what it runs on now or _Unfilled — falls back to Reply_. Picking one puts this model in that loadout; picking the default is the same as **Use** anywhere else. **Use in…** is offered only where it can work right now: not on a model that is switched off, no longer listed, or a local file still to download.

Tap a row and the model's own settings open beside the list, the same page a connection's Models tab opens, with its **Loadouts** (see [Endpoints and models](#endpoints-and-models)). In the dock and at half width it replaces the list, and **Back** returns to it; in Focus the list stays as a column on the left. A local ONNX model opens its own view, with **Download**, **Use in Embeddings** (or **Use in Entities**) and its disk state. A model of the KoboldCPP or Ollama that Serene Pub runs offers **Open KoboldCPP** or **Open Ollama**, which opens that connection in the Connections view.

### Set up chat

The Loadouts status strip's **Set up chat** (offered only while nothing can chat), the first-run card's **KoboldCPP, run by Serene Pub** door in Connections, and the wizard's door of the same name all open **Set up chat**: a dialog over the Models view with three steps.

1. **Runtime.** Serene Pub adds a KoboldCPP connection and shows the build picker. Pick the build for your hardware; it downloads and starts by itself. If you already run KoboldCPP yourself, **Point Serene Pub at it instead** closes the dialog and opens the connection in the Connections view, where **I'll manage it myself** is offered.
2. **Model.** The [model finder](#the-model-finder), already set to chat and to that KoboldCPP. Get one model.
3. **Done.** The first model to arrive fills the Reply loadout, but only if it was empty, so a pub that already replies is never switched to another model. The step says so, such as _Gemma 3 is now in the Reply loadout._ **Start a session** closes the dialog and opens Sessions; **Open KoboldCPP** closes it and opens the connection in the Connections view.

The step is worked out from what is actually there each time. Close the dialog with a download running, open it again later, and you land on the step you are really at.

### Filling a default loadout

A default loadout is filled in its [editor](#the-loadout-editor), in the Loadouts view. These open that editor: **Open in Loadouts** on a row of **Admin › Models › Loadouts**, a loadout listed under **Used by** in the Sampling view, and **Fill the Reply loadout** on the line above a session's composer. Every other way to choose a model for a kind of work fills its default loadout: **Use in…** in the [models list](#the-models-list), **Use** or **Use in Reply** on a connection's Models tab, **Use in…** on a model's own page, **Use in Reply** in KoboldCPP's or Ollama's own view, **Use in Embeddings** or **Use in Entities** on a local ONNX model, and Set up chat's first model. Switching the embedding or entity model can mean redoing stored work, so it asks first (see [Local ONNX models](#local-onnx-models)).

### The model finder

The finder searches the recommended model lists and Hugging Face from one box. In the Models view, **Get a model** opens it as the **Get a model** dialog, and a loadout editor's **Get a model…** opens it already set to that kind of model. It is also a managed or local ONNX connection's **Get** tab in the Connections view, and Set up chat's Model step. Getting a model doesn't close it: the downloads tray shows the progress. It has four rows:

1. **Search.** Typing narrows the recommended models at once and, after a pause, searches Hugging Face for GGUF files. For a local ONNX connection there is no search; **Add from Hugging Face by id** takes a model's id instead.
2. **For**: **Chat**, **Images**, **Embeddings** or **Entities**.
3. **Download to**: which of your managed connections the files go into, such as your KoboldCPP, your Ollama, or a local ONNX connection. Only programs Serene Pub can download into are offered; an online service never is. A line under it says where files will land and which memory size is set, with **Change**. On a device that can't run local ONNX models, a local ONNX connection's pill stays but is dimmed; picking it shows why on that line, and its **Get** buttons are greyed out.
4. **Results.** **Recommended** rows come from Serene Pub's curated lists; **Hugging Face** rows come from the search. Each row has a tier chip (_Ultra Budget_ to _Enthusiast_ for GGUF files, _Fast_, _Balanced_ or _Best_ for ONNX), its size and a short description. A model you already have says so instead of offering **Get**.

**Memory size.** **Change** asks _How much memory does this machine have?_ with five answers: 4 GB, 8 GB, 12 GB, 24 GB+ or **Not sure**. Answer with your graphics card's memory, or your Mac's memory. Rows that suit it turn gold, and the first one that fits gets the one gold **Get**. **Not sure** switches all the size hints off rather than guessing. The answer is remembered in this browser, so a phone and a desktop can answer differently.

**Get.** For a GGUF model, **Get** opens a list of the model's files (its _quantizations_: smaller files are faster and lose a little quality). With a memory size set, each says _Fits in 8 GB_, _Tight in 8 GB_ or _Too big for 8 GB_. Choose one and press **Download**. Progress shows in the row and in [Downloads](#downloads). An Ollama model starts pulling at once; an ONNX model goes into the local cache.

### Downloads

Everything the pub is downloading, in one list: model files for KoboldCPP, the KoboldCPP program itself, Ollama pulls and ONNX models. **View** on the tray at the foot of the Models list opens it above the tray, without leaving the list; **Hide** closes it. A managed connection's **Arriving** tab in the Connections view shows the same list. Each row has the name, where it is going, a progress bar (_1.2 of 4.1 GB_) and **Cancel**. Finished downloads stay listed until you press **Clear finished**, at the top of the list above the tray. Serene Pub never shows a time estimate.

## The Connections view

Open **Connections** from the rail. It is where models run: one row or card per connection, and inside each its status, its models and its settings. Choosing which model each kind of work runs on is the [Loadouts view](#loadouts)'s; getting a model and the downloads tray are in the [Models view](#the-models-view).

There are three places in the view: the list, a connection, and a model. **Back** always goes up one level. Adding a connection and deleting one are dialogs over the place you are on.

### The index, top to bottom

- **Add** opens a menu: **A connection** (the **New connection** dialog, with every service), **KoboldCPP, run by Serene Pub** (see [below](#koboldcpp-run-by-serene-pub)) and **Ollama**. The Android app does not offer KoboldCPP or Ollama here, because it cannot run them. **Ctrl/Cmd+N** opens the New connection dialog.
- **Filter** matches a connection's name, service, address and the names of its models. The menu beside it narrows the list to _Needs attention_ (every gold or red connection: unfinished or broken), or the connections that can serve _Chat_, _Images_, _Embeddings_ or _Entities_. The two buttons after it show the connections as a **list** or as **cards**; your choice is remembered in this browser.
- **The connections**, in two groups: **On this machine** (_private · free_) and **Services** (_billed per message_). The group comes from the kind of connection: KoboldCPP, Ollama, LM Studio, llama.cpp, Stable Diffusion, ComfyUI and the local ONNX models count as on this machine wherever their address points, and OpenAI, Anthropic, the OpenAI-compatible services and the online image services (AI Horde, NovelAI, Black Forest Labs) count as services.

Each row shows the connection's name, the host under it (or the host's own error when something failed), and its **state**: a small coloured dot and a few quiet words with one figure, such as _Ready · 9 models_, _Stopped · 2 on disk_ or _Not reachable · 127.0.0.1:11434_. A card shows the same, with room for all of it at once: what kind of connection it is, its state, how many models it has, its host, and its action. A small label after the name says what kind of connection it is, unless the name already says so. A gold star marks each default loadout the connection fills, so you can see at a glance which connection your sessions use. A row or card offers at most one quick action, such as **Start**, **Set up**, **Choose**, **Fix** or **Refresh**. Only two are ever filled in gold: **Start** on the connection that can start, and **Fix** on a connection that is blocking a loadout (below). Tap the row to open the connection.

There are five kinds of state, each with its own dot colour:

| State                                                                     | Colour | Means                                                                                                                                   |
| ------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Ready**                                                                 | green  | It works right now.                                                                                                                     |
| **Stopped**, **Offline**, **Not tested**, **Installed**, **Not in use** | grey   | Set up, nothing wrong, not running. **Offline** is a KoboldCPP that is switched off with its files kept; **Start** switches it back on. **Not in use** is a local embeddings or entities connection while its loadout uses another connection. Its counterpart, **In use**, means the Embeddings or Entities loadout runs on it; **Loadout unfilled** means that loadout is empty. |
| **Needs a key**, **Not set up**, **Pick a model**, **N no longer listed** | gold   | It is waiting for _you_. Nothing has failed.                                                                                            |
| **Checking**, **Downloading**                                             | amber  | Something is in progress.                                                                                                               |
| **Not working**, **Not reachable**, **Crashed**                           | grey, or red | It was set up and it still failed. Red only when a loadout runs on it (see below).                                       |

A connection you created a minute ago and haven't given a key yet is gold, not red: it is unfinished, not broken.

**Red means a loadout is blocked.** A failing connection is drawn red (red words, a red dot and a red bar along the row's edge) only when one of your default loadouts runs on it, so replies, pictures or whatever that loadout does will fail until it is fixed. That is the same case **Admin › Overview** lists under _Needs you_. A failing connection that nothing uses keeps a grey dot and says what went wrong, quietly; fix it or delete it when you like.

**Pick a model** means the connection works and lists models that can chat, but the Reply loadout is still empty. Its action, **Choose**, opens the connection, whose Models tab is where you choose. Every connection that can chat says this until the Reply loadout is filled from any of them; then they all read **Ready**.

In the dock and at half width, opening a connection replaces the list, and **Back** returns to it. A model opened from a connection replaces the connection at every width, and its **Back** returns to that connection. In Focus the list takes the whole view while nothing is open, with the cards side by side. Open a connection or a model and the list moves to a column on the left (always as rows there) while what you opened fills the rest.

A connection's models are listed on its **Models** tab. Where there is room they are a table, with each model's context window, price per million tokens in and out, and what it can do, plus **hide** for models you will never use. Hiding is not deleting: the model, its settings and anything that names it are kept, and one press brings it back.

### First run

With nothing connected, the Connections view asks _Where should the writing happen?_ and offers three doors. Each has a few chips saying what it costs you, and they use the same names as the setup wizard:

- **KoboldCPP, run by Serene Pub** (_Private · Free · Needs about 8 GB of memory_): Serene Pub downloads KoboldCPP and a model that suits your computer, then runs it for you. It opens the Models view on [Set up chat](#set-up-chat). The Android app doesn't offer it.
- **An online service** (_Fast · Nothing to install · Costs per message_): the New connection dialog, for OpenAI, Anthropic, OpenRouter, Groq and the rest. You need an account with the service and an API key.
- **A custom connection** (_Private · Free_): Ollama, LM Studio, llama.cpp or KoboldCPP you already run, on this computer or another. It opens the New connection dialog showing only those programs, and **Custom (OpenAI-compatible)** for any other server. Choosing that one asks its **Base URL** right in the dialog (often ending in `/v1`); a connection made without one, and with no key, says so (_This connection has no address, so it would call OpenAI's own API…_) until you put the address under **Settings**.

**Add a connection** lists everything, for people who know what they want. Once a connection lists a model that can chat, put it in the Reply loadout with **Use in Reply** on the connection's Models tab, or **Use in…** in the Models view.

### A connection's view

Tap a connection and its view opens. For a service you connect to, such as OpenRouter, Anthropic or your own llama.cpp, it has a status card and up to two tabs.

- **Status card.** One word and one sentence: _Reachable · Answered just now_, _Not reachable · ECONNREFUSED_, _Couldn't list models · 401 Unauthorized_, or _Not checked yet_. **Test** asks the service using the settings as they are on screen, saved or not; once pressed, it reads **Test again**. On the connection the Embeddings loadout uses, **Test** also embeds one word with that loadout's model, so a model swapped on the host fails the test. A service that still needs a key says **Needs an API key**, in gold, with a **Get a key ↗** link to that service's key page.
- **Models tab**, when the service offers models to choose from: how many it lists and how many are no longer listed, **Refresh**, the models themselves, each with **Use** (a table with context and prices where the view is wide enough), and **Add by name** for a service that doesn't publish a list. Tap a model to open its own settings. While the Reply loadout is empty, a model that can chat says **Use in Reply** instead of **Use**. Once it is filled, its model is listed first, with its star. A **Filter N models** box narrows the list by a model's name or id: it is always there in the table, and in the narrower list once there are more than 12 models.

The status card's second line names the one thing to do next, by the name of the button to press:

| When                                                             | State                                                          | The card says                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The service needs a key and none is saved                        | unfinished (gold)                                              | _Paste your API key below, then press **Save**._                                                                        |
| You changed something and haven't saved it                       | unfinished (gold)                                              | _Press **Save** to keep these changes._                                                                                 |
| A test or the model list failed                                  | broken (red) with a saved key; unfinished (gold) with none yet | What went wrong, then _Check the key and press **Test again**._                                                         |
| It lists models that can chat, and the Reply loadout is empty     | unfinished (gold)                                              | _Pick a model under **Models** and press **Use in Reply**._, with a **Choose a model** button that opens the Models tab |
| Sessions reply with one of its models                            | ready (green)                                                  | _Replies come from **Nemo 12B**._, with **Start a session**                                                             |

These are the five states every connection row is in: **ready** (green), **idle** (grey), **unfinished** (gold), **busy** (amber) and **broken** (red); the [state table](#the-index-top-to-bottom) lists the word each row shows for them. The dot beside the card's first line uses the same five: green once the service answered or listed its models, amber while a test or a check is running, red when either failed, grey before anything has been asked.

**Save** is the bar at the foot of the view and **Test** is the button above, so those two don't get a second button. Pasting a key and pressing **Test** checks it, but only **Save** keeps it: until you save, the card still says the key is needed. When nothing is left to do, the line isn't shown.

- **Settings tab.** The name, the API key, the address, and **Request settings** (token counter, streaming and anything particular to that service). Under **Advanced and notes** are your notes, **What this connection can do** (see [Chat messages or text completion](#chat-messages-or-text-completion)), any embedding or entity settings, and stop scripts. **Delete connection** is at the foot.

A connection with nothing to choose between, such as llama.cpp, has no tabs: its settings simply show. A new connection without its key opens on Settings. **Save** and **Discard** appear only while something has changed, and leaving with unsaved changes asks first.

KoboldCPP and Ollama run by Serene Pub, and the local ONNX connections, have their own views, described below.

## Loadouts

Open **Loadouts** from the rail (administrators only; members never see connections, models or loadouts). It answers one question: what does each kind of work run on? **Connections** is where models run, **Models** is what models exist, and **Loadouts** brings them together.

A **loadout** is a named choice of engine: a model on a connection, and the sampling config it is driven with (and, for a ComfyUI picture, the workflow). It never holds prompts or settings; those belong to the pipeline step that uses it. Serene Pub ships these, by kind of work:

- **Text:** _Reply_ (every session reply and form answer), _Tool calling_, _Extraction_ (summaries and the state keeper), _Scene prompt_.
- **Images:** _Images_ (the Image action), _Portrait_, _Sprites_, _Scene_.
- **Audio:** _Narration_ (reads text aloud), _Transcription_ (writes down what a voice note says, for a reply that can't hear it). **Text and audio:** _Spoken reply_ (one model writes a reply and speaks it). **Embeddings:** _Embeddings_. **Entities:** _Entities_.

One loadout per kind of work is its **default**, marked gold: _the Reply loadout_ for replies, _the Images loadout_ for pictures, then _Embeddings_, _Entities_, _Narration_, _Transcription_ and _Spoken reply_. Transcription and Spoken reply arrive unfilled and stay off until you fill them (see [Sound from OpenAI](#sound-from-openai)). Choosing a model for a kind of work anywhere (the wizard, **Use in Reply**, **Use in…**, Admin › Models › Loadouts) fills its default loadout.

**Unfilled falls back.** A loadout with no model yet is **unfilled**, and anything that names it simply runs on the default loadout of its kind. So on a fresh pub everything runs on the Reply loadout's one model, and you only fill _Extraction_ when you want summaries on something else, say a small fast model. The tile says _Unfilled — falls back to Reply_ until you do.

### Loadouts, top to bottom

- **The status strip** says whether sessions can reply: _Replies: Claude Sonnet 4.5 · Anthropic_ with **Change**, or _Sessions can't reply yet_ and _Fill the Reply loadout to start_, with one gold button: **Fill the Reply loadout**, or [Set up chat](#set-up-chat) while nothing can chat at all.
- **The loadouts grid**, one tile per loadout, grouped by what it produces (text, images, audio, embeddings, entities), the default first in each group. A tile shows the loadout's name, its model and connection or _Unfilled — falls back to Reply_, its sampling config, a quiet price line such as _≈ $0.05 per picture_ when its model is a paid picture model whose service publishes a price, a chip when it is merged into another or ships with a plugin, and one line on what a run on it would do differently, such as _JSON by instruction (no schema door)_ when its model can't be held to a schema. **New loadout** makes one of your own.
- **The defaults ledger**: every kind of work and its default loadout, with **Change** or **Fill**.

### The loadout editor

Tap a tile and its **editor** opens; **New loadout** opens the same editor empty, with a **What it's for** choice under the name. Nothing is changed until you press **Save** (or **Create loadout**), and closing with changes asks before it throws them away.

**At the top:** the loadout's name (type over it to rename one of your own), its short id, and who it belongs to: _Core_, the plugin that ships it, or _Yours_. The gold **Default for Chat** star makes it the default for its kind of work when you save; the default's star stays on until another loadout takes it. Beside the star, one line says what will run, and changes as you choose: _KoboldCPP · Nemo 12B · sampling Chat_, or, while no model is chosen, _Unfilled — falls back to Reply_. Then what the loadout is for: your own words on your loadouts, the shipper's on the others, with **Duplicate to edit** to make a copy of your own.

**What to choose for:** a box above the cards says what matters when you choose. **Needs** lists what the loadout's work asks of a model and what happens either way. For _Extraction_, that is _A structured answer_: a model with a schema door is held to the answer's shape, and any other is asked for JSON by instruction and can stray from it. _Tool calling_ needs tool calls, and _Portrait_ and _Sprites_ need reference pictures. **Best with** names the sampling config the loadout ships with, and the kind of model it suits (_Extraction sampling_, or _SD 1.5 sampling · the best model_ for _Portrait_). **Used by N steps** says how many pipeline steps run on it; tap it to list their pipelines.

Then three cards, each opening on one sentence that says what its choice decides:

- **Model.** Every model you have that can do this kind of work, from every connection, with the connection named on each row. The chosen model sits above the list so it never scrolls away, with its context size, its price, what it does natively (_Schema door_, _Native tools_, _Sees pictures_, _Takes references_) and, when this loadout's work needs something the model can't do, what a run will do instead, in the receipt's words: _Runs with JSON by instruction (no schema door)_, or _references dropped_. Every row says the same for this loadout: a _Schema door_ chip on a model that answers the need, _JSON by instruction (no schema door)_ on one that doesn't. **Clear** leaves the loadout unfilled. **Fill for me** chooses for you and says why. It picks the model you have that answers the loadout's needs (one with a schema door for _Extraction_, one with native tool calls for _Tool calling_), keeps the Reply loadout's model when nothing beats it so no second model loads, and picks the loadout's own sampling config if none is chosen. Like any other choice, it is saved only when you press **Save**.
  - **Finding a model in a long list.** Type in the filter box to match a model or connection name. The filter button beside it narrows the list further: **Where it runs** (_On this machine_ or _Services_), **Connection**, **Does natively** (only models with a schema door, native tools, and so on; what the loadout needs is listed first) and **Order** (_By connection_, _By name_, _Cheapest first_, _Largest context first_). Each choice shows how many models it would leave. Whatever is narrowing the list shows as a chip under the box, with an **×** to drop it, and a count says how many of the models are showing.
- **Sampling.** The sampling configs that fit this kind of model, each with its main settings read out (_Temperature 0.7 · 512 tokens max_, or _30 steps · CFG 7 · 1024×1024_). The one the loadout ships with comes first, marked **Best with**. A long list has its own filter box. **Open in Sampling** opens the chosen one to edit. If you change the model and the chosen config doesn't fit it any more, the card switches to the loadout's built-in config and says so.
- **Workflow**, for a ComfyUI picture loadout only. Choose the workflow it draws with; a sentence says what that workflow takes and makes. Below it are the workflow's **dials** (its steps, its CFG, a LoRA's strength…): each shows _Default 20_ until you change it here, then _Set here · default 20_ with **Use default** to put it back. The values you set belong to this loadout, so two loadouts can draw with one workflow at different settings. A pipeline step can still set its own.

**At the bottom:** **Merge into…** and **Unmerge** are explained [below](#merging). **Delete** removes one of your own loadouts after asking; anything that named it runs on its kind's default instead.

A **merged** loadout's editor says so at the top, with **Open** for the loadout it runs as and **Unmerge**; its own cards are kept but greyed out.

### Merging

A plugin may ship its own loadout, such as _Extract_, that does the same work as one you already have. **Merge into…** on the plugin's loadout sends it to yours: while merged, anything that names _Extract_ runs on _Extraction_, and the receipt says _Extract → Extraction (merged)_. Its own model and sampling are kept, unused, and **Unmerge** brings them back. A loadout merges only into one that does the same kind of work, and Serene Pub refuses a merge that would make a loop. Installing a plugin never changes which model runs: its loadouts arrive unfilled and unmerged, as soon as the plugin is switched on. Switching the plugin off keeps its loadouts, with anything you filled in; their tiles say _plugin off_.

A **session never picks a loadout**, just as it never picks a connection.

## Admin › Models › Loadouts

**Admin › Models › Loadouts** (its address is still `/admin/defaults`) is the admin's table of [loadouts](#loadouts): each default loadout first, named by the loadout (_Reply_, _Images_, _Embeddings_…), then the other loadouts that do the same kind of work (such as _Extraction_ under text). Nothing is picked for you: a default loadout with no model is off. A line at the top says how many loadouts this pub needs that have no model (_1 loadout needs a model_), or, in green, _Every loadout this pub needs is filled_. The Overview's **Models** card and **Needs you** list count the same loadouts.

A default loadout is **needed** when it is Reply, which every session reply uses, or when a run needed it in the last 7 days and failed without it (someone pressed **Image** with the Images loadout empty, say). One a pipeline merely could use is not needed until then.

Rows are grouped by what they produce (text, images, embeddings, named entities). Each row shows the loadout, what it is for, its status, a connection picker, a model picker, and a sampling config. The status is one of:

- **Set**, in green.
- **Off**, in grey: nothing has asked for it, and the pub runs without it. The row says what would use it, for example _Used by the Image action; set a connection to turn it on_.
- **Unfilled → falls back to Reply** (or whichever is the default loadout of its kind), for a loadout that isn't a default and has no model yet.
- **Needed**, in red: a needed default loadout with no model. The row says why.
- **Model gone** when its host stopped listing the model, or **Can't do this** when the chosen model can no longer do the loadout's work.

Every other row says how many pipeline steps use it. The **?** beside a loadout's name shows its transform id (such as `text->image`), the pipelines that use it and the node definitions that ask for it. A connection that can't do the work is still listed, greyed, with the reason. **Sampling for all** sets the sampling config for every loadout in a group at once; one set differently says _Different from the other text loadouts_. **Connection's own defaults** sends no sampling config, so the connection uses its own values. Embeddings and entities have no sampling.

Default loadouts can also be filled from **Use in…** on a model, **Use** in a loadout's editor, **Use** or **Use in Reply** on a connection's Models tab, or **Use in Embeddings** / **Use in Entities** on a local model. They all do the same thing. The Loadouts view shows the result as the status strip, the loadouts grid and the **defaults ledger**, and the Models view as a gold mark on the model in its list.

Changing the embedding or entity model here rebuilds stored work, so it asks first and shows how much; **Keep** puts the old choice back.

**Open in Loadouts**, on a row, opens that loadout's [editor](#the-loadout-editor) in the Loadouts view, with its model, its sampling and where it applies on one page.

## Admin › Models › Connections

**Admin › Models › Connections** manages the same connections as a table, for working with several at once. It lists every connection with its service, kind, number of models, the defaults it holds and its state. Search matches name, service, address and notes; **Filter** narrows by service, kind, status or whether it holds a default; column headers sort. The address keeps your search and filters, so a filtered list can be bookmarked or shared.

Tick rows and choose **Actions › Delete selected connections…** to delete several. The confirmation lists the models that go with each one and the defaults it releases. Deleting the KoboldCPP connection also switches KoboldCPP off, and deleting the last Ollama connection switches Ollama off.

**Add connection** asks for the service and a name. A connection's own page has sections for its status and **Test**, its name and notes, its address and key, the KoboldCPP runtime (for the managed KoboldCPP), its models, the defaults that point at it, stop scripts and advanced settings, with **Save**, **Save and continue editing** (Ctrl+S) and **Delete**. **History** shows what changed and when. Starting, stopping and downloading stay in the Connections view; **Open in Connections**, on a row or a connection's page, opens that connection there, and **Open Connections view** at the top opens its list.

In **Models**, a model's **hide** / **show** button and **Use** wait for **Save**, like every other change on the page. Each one you press is listed under the table as _Waiting for Save_, and its **×** puts it back. Save sends them one at a time and waits for each answer, showing first, then the defaults that need them; if one is refused, the page says which and why, and leaves it waiting so you can try again. **Refresh**, **Add by name** and a local model's **Download** or **Cancel** are not changes to save: they happen as soon as you press them.

## Choosing a service

The **New connection** dialog lists every service in one searchable box, grouped under **Cloud APIs**, **Local / Self-hosted** and **Custom**, with buttons to show only text, image, embedding or entity services. Each service's card has a chip saying what it asks of you: **Needs an API key**, **Runs locally**, **Address only** (its address, and a key only if that server asks for one), or **Free · queued** (no key needed; your pictures wait their turn).

Picking a service shows a short description under the list. For an OpenAI-compatible service it is one line: where the key comes from, such as _OpenRouter — needs an API key from openrouter.ai_, linked to that service's key page; _Runs on your own machine · no key_ for one you run yourself, such as vLLM; and _Any OpenAI-compatible server · paste its address, and a key only if it asks for one_ for **Custom (OpenAI-Compatible)**.

A search that finds nothing says _No service called "…"_, with two buttons: **Show all**, which looks again across every service, and **Custom (OpenAI-Compatible)**, which picks it for you.

| Service                                                                    | Runs                            | Good for                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **KoboldCPP, run by Serene Pub**                                           | On this machine                 | Most people running models locally. Serene Pub installs and looks after it. Added from **Add**, not from this dialog.                                                                |
| **Ollama**                                                                 | On this machine or your network | People who already use Ollama. Chat and embeddings from one connection.                                                                                                              |
| **LM Studio**                                                              | On this machine or your network | People who already use LM Studio and its window for managing models. Chat and embeddings from one connection.                                                                        |
| **KoboldCPP**                                                              | On this machine or your network | A KoboldCPP you start yourself.                                                                                                                                                      |
| **Llama.cpp**                                                              | On this machine or your network | People who build and run `llama-server` themselves. Embeddings too, from a server started for them.                                                                                  |
| **OpenRouter**, **OpenAI (Official)** and other OpenAI-compatible services | Online                          | Hosted models. OpenRouter reaches hundreds with one key. Several also embed (see [Embeddings](#embeddings-from-an-openai-compatible-service)).                                       |
| **Anthropic (Claude)**                                                     | Online                          | Claude models, direct from Anthropic.                                                                                                                                                |
| **Stable Diffusion (A1111-compatible)**                                    | On this machine or your network | Images from AUTOMATIC1111, Forge, SD.Next or a KoboldCPP with an image model.                                                                                                        |
| **ComfyUI**                                                                | On this machine or your network | Images from your own ComfyUI, drawn with a ComfyUI workflow. See [ComfyUI](#comfyui).                                                                                                |
| **AI Horde**                                                               | Online, free                    | Images at no cost from volunteers' computers, in a queue. See [AI Horde](#ai-horde).                                                                                                  |
| **NovelAI (Image)**                                                        | Online                          | Anime-style images with a NovelAI subscription. See [NovelAI](#novelai).                                                                                                              |
| **Black Forest Labs (FLUX)**                                               | Online                          | FLUX images, good at keeping a character from reference pictures. See [Black Forest Labs](#black-forest-labs-flux).                                                                   |
| **Local embeddings (ONNX)**, **Local named entities (ONNX)**               | Inside Serene Pub               | Helping characters remember a long story. Greyed out, with the reason, on devices that can't run it (Android, and some desktop builds). See [Local ONNX models](#local-onnx-models). |

:::note Most people: pick one
Running models on your own computer: **KoboldCPP, run by Serene Pub**. Using an online service: **OpenRouter**. Either can be added to later.
:::

Every connection form shares a pattern: the key or address it can't work without comes first, then a **Token counter**, then **Request settings** for how requests are sent. There is no Test button on the form; **Test** is on the connection's [status card](#a-connections-view).

One connection serves every kind of model its program has. One Ollama or LM Studio connection offers every chat and embedding model it holds, a KoboldCPP offers what it has loaded, the managed KoboldCPP writes, draws and embeds, and an OpenAI-compatible service that embeds does so from the same connection that chats. Where the program says what each model is for, an embedding model is never offered for chat and an image model never for text. There is no separate connection type for embeddings any more: a connection made as **Embeddings (OpenAI-compatible)** in an earlier version becomes an ordinary OpenAI-compatible connection the next time Serene Pub starts, keeping its address, key, model and index.

## LM Studio

Connects to LM Studio's REST API, which you must first switch on in LM Studio's own settings. Its models are the ones LM Studio has downloaded, listed automatically. **Request settings** hold the **Base URL** (default `ws://localhost:1234`, a `ws://` address rather than `http://`), **Stream**, and **Keep Alive (seconds)** (default 60), which is how long LM Studio keeps a model loaded after a request.

The same connection serves **embeddings**: LM Studio says which of its models are embedding models, and those are the ones offered for Embeddings. They are asked over LM Studio's OpenAI-compatible address on the same port (`http://localhost:1234/v1` for the default `ws://localhost:1234`), so its server must be running, as it must be for chat.

## Ollama

Connects to an Ollama you installed and run yourself. Its models are whatever Ollama has pulled, listed automatically, and one connection serves both chat and **embeddings** from the same host. To use embeddings, pull an embedding model (for example `ollama pull nomic-embed-text`, or from the connection's **Get** tab) and choose it for Embeddings. Ollama 0.6 or newer says which models are which; with an older Ollama every model is offered for both.

The form shows the **Base URL** (default `http://localhost:11434/`). **Request settings** hold **Keep Alive**, a number and a unit (default `5m`), which is how long Ollama keeps a model loaded, and **Stream**. Pulling, deleting and updating happen in the connection's own view: see [Ollama, managed](#ollama-managed).

## OpenAI-compatible services

Many services accept requests in the same shape as OpenAI's API, so one kind of connection reaches all of them. The **Service** list in the New connection dialog names each of these services directly. Picking one fills in its address and a sensible token counter; you add the API key. Its models come from the service's own list when it publishes one, and **Add by name** covers a service that doesn't. **Request settings** hold the **Token counter** and **Stream**.

| Service                                | Base URL                                                   |
| -------------------------------------- | ---------------------------------------------------------- |
| Custom (OpenAI-Compatible)             | _(blank: fill in your own)_                                |
| OpenRouter                             | `https://openrouter.ai/api/v1/`                            |
| OpenAI (Official)                      | `https://api.openai.com/v1/`                               |
| Groq                                   | `https://api.groq.com/openai/v1/`                          |
| Together AI                            | `https://api.together.xyz/v1/`                             |
| DeepInfra                              | `https://api.deepinfra.com/v1/openai/`                     |
| Fireworks AI                           | `https://api.fireworks.ai/inference/v1/`                   |
| Perplexity AI                          | `https://api.perplexity.ai/v1/`                            |
| AnyScale                               | `https://api.endpoints.anyscale.com/v1/`                   |
| LocalAI                                | `http://localhost:8080/v1/`                                |
| Ollama (via OpenAI-Compatible API)     | `http://localhost:11434/v1/`                               |
| KoboldCPP (via OpenAI-Compatible API)  | `http://localhost:5001/v1/`                                |
| Mistral AI _(Experimental)_            | `https://api.mistral.ai/v1/`                               |
| xAI Grok _(Experimental)_              | `https://api.x.ai/v1/`                                     |
| DeepSeek _(Experimental)_              | `https://api.deepseek.com/v1/`                             |
| Google Gemini _(Experimental)_         | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Cohere _(Experimental)_                | `https://api.cohere.ai/compatibility/v1/`                  |
| Novita AI _(Experimental)_             | `https://api.novita.ai/openai/`                            |
| Featherless AI _(Experimental)_        | `https://api.featherless.ai/v1/`                           |
| text-generation-webui _(Experimental)_ | `http://127.0.0.1:5000/v1/`                                |
| vLLM _(Experimental)_                  | `http://localhost:8000/v1/`                                |
| SGLang _(Experimental)_                | `http://localhost:30000/v1/`                               |
| Aphrodite Engine _(Experimental)_      | `http://localhost:2242/v1/`                                |

_Experimental_ services have had less testing with Serene Pub; check the address and the service's own notes. Everything a preset fills in can be changed afterwards.

### Sound from OpenAI

An **OpenAI (Official)** connection can hear and speak as well as write. Three loadouts use it:

- **Transcription** writes down what a voice note says, so a reply whose model can't hear still reads it. Put a transcription model in it (`whisper-1`, `gpt-4o-transcribe`); each recording is heard once and the words are kept with the file.
- A reply model that **Hears** (an OpenAI audio model) is sent voice notes as sound, WAV or MP3, instead of their words. Tick **Hears** on it.
- **Spoken reply** is for a model that writes a reply and speaks it in the same call. A step asks for it when its **Outputs** include audio; the reply's sound then plays under the message, and its transcript is the message's text. Tick **Speaks** on the model. The voice is the **Narration** loadout's sampling (**Voice**, **Speed**), unless the step picks its own **Speech sampling**.

A llama.cpp server can also be sent voice notes when its model was loaded with an audio projector: switch on **Hearing** under **What this connection can do**. Other connection types don't send sound to their model; their replies get the words instead, through the Transcription loadout.

### Embeddings from an OpenAI-compatible service

**OpenAI (Official)**, **OpenRouter**, **Google Gemini**, **Together AI**, **Mistral AI** and **LocalAI** serve embeddings, so a connection to one of them can be chosen for Embeddings as soon as it's added. The New connection dialog lists them under embedding services too; picking one there adds the same connection. Others either don't (Groq, DeepSeek) or only when started for it (vLLM, SGLang, text-generation-webui). For those, and for a **Custom** address, switch on **Embeddings** under **What this connection can do** if the service has an `/embeddings` endpoint. OpenRouter lists its embedding models with the rest and says which they are, so only those are offered for Embeddings and never for chat. The other services don't say, so choose one by name for Embeddings, such as OpenAI's `text-embedding-3-small`; **Add by name** adds one the list doesn't show. Then set that model's **What it's for** to **Embeddings**, and your chat models' to **Chat**, so each is offered only for its own job (see [What a model is for](#what-a-model-is-for)).

The **(via OpenAI-Compatible API)** entries for Ollama and KoboldCPP use those programs' OpenAI-style endpoints. The dedicated [Ollama](#ollama) and [KoboldCPP](#koboldcpp-you-run-yourself) connections use their own native APIs, which Serene Pub supports more fully; prefer those.

### Images from OpenAI

An **OpenAI (Official)** connection draws pictures as well as writing. Its image models (`gpt-image-2.5-sunburst`, `gpt-image-2` and the others) appear in its model list already marked **Image generation**, so they are never offered for chat; put one in the **Images** [loadout](#loadouts) (or press **Use in…** beside it in the Models view). OpenAI doesn't say what its other models are for, so set your chat models' **What it's for** to **Chat** and they won't be offered for images (see [What a model is for](#what-a-model-is-for)).

What an OpenAI image model takes:

- **Size and count** from the sampling config. Use the **Hosted (OpenAI, Gemini)** preset. `gpt-image-2` and later take almost any size; older models take three (square, landscape, portrait), and the nearest one is used.
- **Reference pictures**, so a character keeps their likeness: up to 16 (one on `gpt-image-1-mini`).
- **Transparent backgrounds**, drawn by the model itself, so sprites need no separate cut-out step.
- **Quality**, **Moderation** and **Compression** in the connection's settings. Higher quality costs more. **Extra high** and **Max** exist only on `gpt-image-2.5`; on another model the setting is skipped and the picture's details say so.

There is no negative prompt, seed, steps or CFG. If you set them anyway, they are skipped and the picture's details list them as not sent.

If OpenAI's safety system refuses a prompt, the step stops and shows OpenAI's reason. Nothing is retried, because the same prompt would be refused again and each attempt is billed.

**xAI Grok** and **Together AI** connections draw too, through the same kind of request. xAI chooses a shape (such as 3:2) rather than an exact size. Together also takes a negative prompt, steps and a seed. Other OpenAI-compatible services may draw as well: switch on **Image generation** under **What this connection can do** if yours has an `/images/generations` endpoint.

### Images from Google Gemini

A **Google Gemini** connection draws pictures too, with Gemini's image models (Nano Banana 2.1 is the recommended one; 3.1 Flash, 3.1 Flash Lite, 3 Pro and the older 2.5 Flash also work). The New connection dialog lists Gemini under image services as well; picking it there adds the same connection that chats. Serene Pub asks Gemini's own image route for pictures, with the same key.

What Gemini takes:

- **A shape and a size tier**, not an exact size: the nearest shape to the size you asked for (square, 16:9, 3:4 and others), drawn at 1K, 2K or 4K (and 512 on 3.1 Flash). Flash Lite draws at 1K only.
- **Reference pictures** so a character keeps their likeness: up to four on Flash and Nano Banana, five on 3 Pro, none on Flash Lite.
- **One picture per request.** Asking for several makes several requests.

There is no negative prompt, seed, steps, CFG or transparent background. If you set them, they are skipped and the picture's details say so; a sprite's background is cut out afterwards instead. If Google's safety filter blocks a prompt, the step stops and shows the reason, and nothing is retried.

### Where the API keys come from

Make an account on the service's website, create an API key there, and paste it into the connection's **API Key** field. For OpenAI that is `platform.openai.com`, for Anthropic `console.anthropic.com`, and for OpenRouter its account settings. A key is a password for your account: keep it private. Keys are stored per connection, so you can have two connections to the same service with different keys.

## Llama.cpp

Connects to `llama-server`. **Request settings** hold the **Base URL** (default `http://localhost:8080/`) and **Stream**. There is no API key and no model list to choose from: llama-server runs the one model it was started with, and the connection lists that model. It sends a text completion by default, so a **Prompt format** setting is shown; its chat API can be used instead (see [Chat messages or text completion](#chat-messages-or-text-completion)).

A `llama-server` started with `--embeddings` serves **embeddings** instead. Nothing it reports says so, so **Test** asks it to embed one word: when it can, the connection can do Embeddings and its model is offered for them rather than for chat. Restarted without the flag, the next test or model refresh says so and the model goes back to chat.

## Anthropic (Claude)

Connects directly to Anthropic's API with your **API Key** (it starts `sk-ant-`). Its models come from a built-in list of Claude models, and a newer one can be added by name. **Request settings** hold **Stream**. Extended thinking is set on the sampling config, not here: see [Reasoning](#reasoning).

## Image services online

Three services draw pictures and have their own connection type. Each one's model list fills in by itself; put a model in the **Images** [loadout](#loadouts) to draw with it. Getting pictures working from start to finish is in [Images](./images.md).

### AI Horde

**AI Horde** is a crowd of volunteers lending their computers to draw pictures for anyone, free. Your request joins a queue, so a picture can take seconds or several minutes; while it waits, its progress shows your place in the queue. No key is needed. A free key from aihorde.net moves you up the queue, and you earn priority by lending your own computer.

It takes nearly everything a local Stable Diffusion does: a negative prompt, seed, steps, CFG, sampler, any size in steps of 64 pixels, a starting picture, and up to twenty pictures at once. It can draw transparent backgrounds itself. Reference pictures are passed on, but only some volunteers' models use them, so a likeness is weaker than on a paid service. The model list shows the models someone is serving right now. The connection's settings choose which models any volunteer may use, whether adult content is allowed, LoRAs, and clean-up steps such as face restoration or background removal. Stopping a picture cancels it in the queue. If the Horde's filter refuses a prompt, the step stops and nothing is retried.

### NovelAI

**NovelAI** draws anime-style pictures with its V4.5 and V5 models. It needs a NovelAI subscription and a persistent API token from your NovelAI account settings. It takes a negative prompt, seed, steps, CFG and sampler, any size in steps of 64 pixels, a starting picture, an area to repaint, and up to four reference pictures of a character. The connection's settings hold NovelAI's own options: its built-in undesired-content preset, quality tags, noise schedule, and whether a reference copies the art style as well as the character. It does not draw transparent backgrounds here, so sprites are cut out afterwards.

NovelAI can also change a finished sprite's expression without redrawing the character. That will be offered on a character's sprites once there is a button for it.

### Black Forest Labs (FLUX)

**Black Forest Labs** makes the FLUX models, and its connection needs an API key from bfl.ai. FLUX.2 (pro, max and flex) takes a size up to about four megapixels, a seed, and up to eight pictures to work from, which makes it good at keeping a character's likeness; flex also takes steps and guidance. FLUX.1 Kontext takes a shape instead of a size and up to four pictures. FLUX 3 takes a shape and a size tier, up to ten pictures, and no seed. None takes a negative prompt or draws transparent backgrounds, and each request draws one picture. The connection's settings choose how strict BFL's safety filter is, whether BFL may rewrite your prompt with more detail, and the region (worldwide, EU or US) the request is served from. Stopping a picture stops waiting for it, but BFL has no way to cancel, so it is still billed. If BFL's moderation refuses a prompt or a picture, the step stops and nothing is retried.

## KoboldCPP you run yourself

The plain **KoboldCPP** connection talks to a KoboldCPP you start and manage yourself, on this machine or another one, through KoboldCPP's own API. If this pub also [runs its own KoboldCPP](#koboldcpp-run-by-serene-pub), the form warns you, since you probably want that connection instead.

**Its models are whatever KoboldCPP has loaded.** It lists the loaded text model and, when they are loaded, the image and embedding models, each offered only for its own kind of work. Restart KoboldCPP with a different model and, on the next refresh, the old one is marked no longer listed and the new one appears. When KoboldCPP is restarted with a different _embedding_ model than the one in the Embeddings loadout, Serene Pub refuses to use it and names both models, rather than mixing two models' results in your lore. Put the new model in the Embeddings loadout, which re-indexes after asking.

The form has the **Base URL** (default `http://localhost:5001`), a **Token counter**, a **Prompt format** when sending a text completion, and **Request settings**. Each field and switch has a one-line note under it saying what it does:

- **Stream**: show the reply as it is written.
- **Use memory**: reveals a **Memory text** box whose text is added to the start of every text-completion request.
- **Trim stop sequences** (on by default): cut the stop sequence that ended a reply off its end.
- **Render special tokens**: show the model's special tokens (such as end-of-turn markers) in the text instead of hiding them.
- **Bypass EOS token**: keep writing past the point where the model would normally end its reply, until the length limit or a stop sequence.
- **Retain grammar state**: carry a response grammar's position over from one request to the next instead of starting it fresh.
- **Replace instruct placeholders**: let KoboldCPP swap its own placeholders, such as `{{[INPUT]}}` and `{{[OUTPUT]}}`, for the loaded model's instruct tags. Serene Pub's own prompts never use them, so this only matters if you typed them yourself.

Each switch is sent to KoboldCPP with every request, on both its chat and text-completion endpoints.

## Stable Diffusion (A1111-compatible)

For images from a program that speaks the AUTOMATIC1111 API: AUTOMATIC1111 itself, Forge, SD.Next, or a KoboldCPP with an image model loaded. Point the **Base URL** at it (default `http://localhost:5001`). Its models are the checkpoints the program lists. How a picture is drawn (size, steps, CFG) comes from an image [sampling config](#sampling-configs). If you use the KoboldCPP run by Serene Pub, you don't need this connection: it draws too (see [Images from the same connection](#images-from-the-same-connection)).

## ComfyUI

For images from a ComfyUI you run yourself, on this machine or your network. Its chip says **Address only**: point the **Base URL** at ComfyUI (default `http://localhost:8188`) and press **Test**. A key is needed only if your ComfyUI sits behind a proxy that asks for one.

A ComfyUI connection draws with a **ComfyUI workflow**: a graph saved in Serene Pub with blanks where the prompt, the size, the seed and the checkpoint go. A workflow is not a pipeline and not a prompt template; it is the drawing recipe ComfyUI runs. Serene Pub ships six to start from (SD 1.5, SDXL, Flux from a GGUF file, Flux Kontext with a reference picture, an SDXL sprite on a plain green background, and an SDXL cut-out with a transparent background), and you can bring your own: export it from ComfyUI with **Export (API)** (turn on Dev mode in ComfyUI's settings to see it). A normal ComfyUI save is refused with that instruction, because it is a different file. When you bring one in, Serene Pub finds the prompt, negative, size, seed, sampler and checkpoint in it and turns them into blanks; anything else it found, such as a LoRA's name or strength, you can turn into a setting of your own. Each starter that needs extra ComfyUI nodes says which in its description.

Its models are the checkpoints and UNETs ComfyUI lists. The model you pick in a loadout is sent into the workflow's checkpoint blank. A workflow can keep its own checkpoint instead; the picture's details then say the model was not used.

What Serene Pub does with your ComfyUI, and nothing more: it reads the list of nodes and models, the version and the graphics card, the queue, and finished pictures; it uploads reference pictures (named after their contents, so a picture is uploaded once); it queues a workflow; and it stops one when you press Cancel. It never installs nodes, downloads models, or changes ComfyUI's settings or saved workflows.

When a workflow needs something your ComfyUI doesn't have, the connection shows **Missing on server** in gold and says exactly what is missing, for example _Missing nodes: IPAdapter_ or _This workflow names sd_xl_base_1.0.safetensors; your ComfyUI doesn't have it._ Install the node pack or the model in ComfyUI, then press **Test** again. Workflows are checked when you test the connection, when one is saved, and before each picture.

A series of pictures (a whole set of sprites, say) goes to ComfyUI as one queued job of up to eight pictures, sharing the checkpoint and the reference picture. **Pictures per call** in the connection's settings changes that number: lower it if ComfyUI runs out of memory.

### The Workflows tab

A ComfyUI connection's view has a **Workflows** tab beside **Models** and **Settings**. It lists every workflow, because a workflow belongs to no one server: the same list appears on every ComfyUI connection. Each row carries a chip saying whether it fits _this_ ComfyUI: **ready**, **Missing nodes: …**, or **This workflow names … ; your ComfyUI doesn't have it**. The chip is read from what the last **Test** learned about the server, so a ComfyUI that hasn't been tested yet says **Not checked**. The shipped starters say **Built in**: they can be viewed, duplicated and exported, never changed or deleted. **Open ComfyUI** opens your ComfyUI in a new tab, which is where a missing node or model is fixed.

**Add workflow** offers two ways in:

- **Import a file**: choose or paste a file exported from ComfyUI with **Export (API)**. Serene Pub reads it and shows the **fitting form**: one row for each thing a run sends (the prompt, the negative, the seed, the steps, the CFG, the sampler and scheduler, the width and height, the checkpoint, and any reference picture, starting picture or mask it found), each saying which node and setting it lands on. Change a row to put it somewhere else, or choose **Not used** to keep the workflow's own value; leaving the checkpoint unused keeps the model the workflow names. Values the workflow declares itself (with a SwarmUI, Krita or ComfyDeploy parameter node) are listed as declared. Under **Other values** is everything else the workflow fixes, such as a LoRA's name or strength: **Keep literal** leaves it as it is, and **Promote to variable** turns it into a setting of the workflow, with its name and its current value filled in (a value from a list, such as a LoRA, offers the names your ComfyUI has). **Output** picks the node whose picture the run keeps. Give it a name and press **Save workflow**.
- **Start from a starter**: pick one of the six; each says what it needs and whether this ComfyUI has it. You get your own copy, opened in the editor.

After saving, the workflow is described in one sentence, such as _This workflow takes a prompt, a negative, a seed, a size and 1 reference image. It makes 1 picture per run. No transparent output: the cut-out step will run for sprites._ **Validate against this server** asks ComfyUI again, there and then, and remembers the answer on the connection, so its row shows **Missing on server** until it is fixed.

Each row's **⋯** holds **Edit** (or **View** for a starter), **Duplicate**, **Export (with holes)**, which saves a file another Serene Pub can import as it is, **Export (with current defaults)**, which saves a plain ComfyUI file that loads in ComfyUI with every blank filled in, and **Delete**. The editor shows the workflow's text, its variables and their defaults, the output node, the sentence, and **Draw a test**; **Paste a new export** fits an updated file again. Each variable's default is the value the workflow draws with; change it here.

**Draw a test** draws one picture with a workflow at its own settings (its variables' defaults), and keeps it in your media. The connection's **Test Generation** does the same: choose a workflow (the first that fits this server is chosen for you) and type a prompt; a negative is offered only when the workflow uses one.

## KoboldCPP, run by Serene Pub

Serene Pub can download KoboldCPP, start and stop it, fetch models into it, and load whichever model a request needs. All of that lives on one connection, **KoboldCPP, run by Serene Pub**, and its own view. Add it with **Add › KoboldCPP, run by Serene Pub**, or with the door of the same name on a new pub. **Remove KoboldCPP from this pub**, in the view's **⋯** menu or at the foot of its Settings tab, switches it off again; files already on disk are left where they are.

The view starts with a setup screen. Once set up, a **status card** sits at the top and four tabs sit under it: **Models**, **Get**, **Arriving** and **Settings**. On the index its row reads _Not set up_ until setup is done, then something like _Stopped · starts on first use · 3 on disk_ or _Running · Nemo 12B loaded_. A stopped KoboldCPP starts by itself the first time something needs it.

### Managed or External mode

The setup screen asks how to run it:

- **Let Serene Pub manage it** (recommended): Serene Pub downloads KoboldCPP and starts, stops and loads models for you. This is **Managed mode**.
- **I'll manage it myself**: you start KoboldCPP and give Serene Pub its address. KoboldCPP must be started with `--admin` so Serene Pub can swap models and read its status. This is **External mode**.

Managed mode goes straight to the build picker. External mode asks for the **Address**, with **Test** to check it and **Save**. **Test** always checks the address as typed, saved or not, and a failed test says why. A managed install can move to External mode later: **Connect to a KoboldCPP I run myself** at the foot of the Settings tab.

### Downloading the KoboldCPP binary

**Choose a KoboldCPP build** lists the builds of the chosen **Version** (default _Latest_), grouped by system (Linux, Windows, macOS, Other). Each shows a short description of the hardware it suits, and its size. The **Download directory** is filled in for you: a `koboldcpp` folder inside Serene Pub's data folder (the `SERENE_PUB_DATA_DIR` folder when that is set). Serene Pub needs to be able to write there, both to download and every time it loads a model.

**Download & Start** downloads and then starts KoboldCPP. If either step fails, the reason is shown right there; see [Troubleshooting: download or start failures](#troubleshooting-download-or-start-failures).

### The status card

In Managed mode the card shows the process state (_Running_, _Starting_, _Stopped_, _Crashed_) with **Start** or **Stop**, how long it has been running, the **Loaded model** with **Unload** to free its memory without stopping KoboldCPP, and an **Update** button when a newer KoboldCPP is out. If KoboldCPP failed to start or crashed, the error is shown under the card. A start that fails, including the first start after **Download & Start**, leaves the card on _Crashed_ with the reason and **Start**, so you can try again; it never stays on _Starting_. **Details** opens live performance figures: busy or idle, generation and prompt speed in tokens per second, the last request's timings, and totals. In External mode the card says whether the address answered and which version it runs.

### Models tab

Lists every model file the connection has, under **Text models**, **Image models** and **Embedding models**, one row each, with how many there are and **Refresh** at the top and a filter box once there are more than twelve. The Reply loadout's model comes first. **Use in Reply** on a text model, or **Use in Images** on an image model, puts it in that default loadout without loading it: it loads the first time something asks. **Use in Embeddings** on an embedding model does the same for the Embeddings loadout, but asks first, because changing the embedding model re-indexes your stored lore and messages (see [Embeddings from the same connection](#embeddings-from-the-same-connection)). Once a job has its model, the other rows' buttons read just **Use** in a narrow view. Each row's **⋯** menu has **Model settings**, a move to another section (**Move to text models**, **Move to image models** or **Move to embedding models**) for a file Serene Pub sorted wrongly, and **Delete from disk**, which asks first. A model whose **What it's for** is **Not sure** is listed under every section it can serve, since it's offered for every job. A model that's switched off, or that the runtime no longer lists, stays under its own section without **Use**.

Whether a file is a text, image or embedding model is read from inside the file, not guessed from its name or folder. An embedding model that an earlier version listed under Text models moves to Embedding models the first time the list refreshes after updating; one you moved yourself stays where you put it.

### Get and Arriving tabs

**Get** is the [model finder](#the-model-finder) with this connection as the destination; its line says which folder files will land in. **Arriving** is the [Downloads](#downloads) list.

### Settings tab

- **Binary** (Managed mode): the installed build and version, the latest version, **Check for updates**, **Change binary**, and **Update binary** when there is a newer one.
- **Model unload timer**: seconds of no use before the loaded model is unloaded (default 300; 0 means never).
- **Subprocess idle timeout**: seconds of no use before KoboldCPP itself is stopped (default 1800; 0 means never).
- **Server URL** and **Port** (default 5001): where Serene Pub reaches KoboldCPP. Changing the port needs a restart. If the two disagree, a warning says so: requests go to the Server URL, so make them match.
- **Base URL** (External mode only): the address of your KoboldCPP.
- **Models directory**: where text and embedding models are stored and downloaded to. It must be set before anything can be listed or downloaded.
- **Image models directory**: where image models go. Left blank, image models are looked for in the **Models directory**. Setting it never moves files; models already in the Models directory keep working.
- **Active capabilities**: what the running KoboldCPP build supports (Image Gen, Vision, TTS, Speech-to-Text, Embeddings, Multiplayer, Web Search, Admin API).
- **Image generation**: the thread count and quantization level for loading image models, and **Test Generation**, which draws a test picture with the model in the **Images** loadout.

### Launch settings and when a model reloads

Further down the Settings tab, under the connection's own settings, **Managed mode launch settings** decide how KoboldCPP loads a model:

- **GPU layers**: how many layers of the model go on the graphics card. `-1` (the default) fits as many as will fit; `0` runs on the processor only.
- **Flash attention**: faster processing, using less graphics memory, on graphics cards that support it. Off by default.
- **Batch size**: how much of the prompt is processed at a time. Default `512`.

A text model can also have a **Vision projector**: its mmproj file, which lets it read images. Set it in the model's **Model settings** (the **⋯** menu in the Models tab), as the file's name; the file must be in the Models directory, and files whose names contain `mmproj` are suggested. Setting one turns **Vision** on for that model. Clear the box to load the model without it.

Before each request, Serene Pub checks which model KoboldCPP has loaded and with which settings. If the model, any of the three settings above, its vision projector, or a larger context size than the one loaded doesn't match, it reloads KoboldCPP with the right ones and waits (up to ten minutes) before sending the request. So a change to these settings, or switching to another model, takes effect the next time the model is used, not when you save. The first request after restarting Serene Pub also reloads once, because the new Serene Pub can't be sure what the old one loaded.

The connection's settings also have the **Prompt format**, **Token counter** and the [same request settings](#koboldcpp-you-run-yourself) as a KoboldCPP you run yourself. There is no Base URL field: the address is the Server URL in the Settings tab.

### Images from the same connection

The managed KoboldCPP draws as well as writes. **Use in Images** on an image model puts it in the **Images** loadout. The image model is loaded when a picture is asked for. KoboldCPP holds one model at a time, so drawing a picture unloads the Reply loadout's model and the next reply loads it again; with large models that can take minutes each way.

### Embeddings from the same connection

The managed KoboldCPP can also do the embeddings behind [search by meaning](./embeddings-and-rag.md). Put an embedding model in the Models directory (a GGUF such as nomic-embed-text or bge-m3, from the **Get** tab or copied in by hand); it is listed under **Embedding models**. **Use in Embeddings** puts it in the Embeddings loadout, after asking first and saying how much will be re-indexed.

The embedding model loads beside the text model, not instead of it. KoboldCPP keeps it in a slot of its own, on the processor by default, so it doesn't take graphics memory from the text model: embedding never unloads the text model, and a reply or a picture never unloads the embedding model. It is loaded the first time something is embedded. Changing the embedding model, or choosing one from another connection, reloads KoboldCPP once, the next time any of its models is used. Embedding counts as use, so it keeps the **Model unload timer** from running out.

If something other than the KoboldCPP Serene Pub started answers on its port with a different embedding model, Serene Pub refuses its results and names both models, rather than mixing two models' results in your lore.

### Troubleshooting: no model loaded, or a rejected model load

If KoboldCPP answers without a model loaded (for example, it was started with `--nomodel`), the reply fails with _KoboldCPP rejected the request — is a model loaded?_ instead of arriving blank.

In External mode, if KoboldCPP refuses to load a model, the most likely cause is that the admin password or admin directory on this connection doesn't match what KoboldCPP was started with (`--admin --adminpassword … --admindir …`).

### Troubleshooting: download or start failures

When the download or the first start fails, read the message under the status, not just the word _Failed_ or _Crashed_. A download failure is shown on the download screen; a start failure under the status card.

- **_Download failed: HTTP 404_** (or another number): the download site answered with an error page instead of the program. Nothing is kept: KoboldCPP downloads under a temporary name (ending `.part`) and gets its real name only once the whole file has arrived, so a half-finished download is never started. Try again, or pick another build or version.
- **_Crashed_ after Download & Start**: the reason is under the card. Press **Start** to try again.
- **A reply fails with _KoboldCPP did not start:_** and a reason: Serene Pub tried to start KoboldCPP for that reply and it didn't come up. The reason is the same one the status card shows.

On Docker or a NAS, the usual cause is that Serene Pub's data folder is a mounted volume the container can't write to. Check that it can create folders and files there before retrying the download or choosing another build.

## Ollama, managed

Every Ollama connection gets its own view, and each one manages its own host: two Ollama connections (this machine and another computer, say) are two independent views. Serene Pub doesn't install or start Ollama; you install it yourself, and the view uses Ollama's API to list, pull and delete models. Add one with **Add › Ollama**, or on a new pub with **A custom connection**, then **Ollama**.

The **status card** reads, for example, _Running · 0.30.7 · 4 models_, with an **Update available** chip when Ollama has a newer release. When Ollama can't be reached it says **Not reachable** with the address, **Check again**, **Change address** and a **Get Ollama** link.

- **Models** lists what this host has pulled, under **Chat models** and **Embedding models**, one row each, with how many there are and **Refresh** at the top and a filter box once there are more than twelve; the Reply loadout's model comes first. **Use in Reply** or **Use in Embeddings** puts a model in that default loadout (embeddings ask first, since they rebuild the index); once that loadout is filled, the other rows' buttons read just **Use** in a narrow view. Each row's menu has **Model settings**, **View on ollama.com** and **Delete from disk**. A model whose **What it's for** is **Not sure** is listed under every section it can serve, since it's offered for every job. A model that's switched off, or that the runtime no longer lists, stays under its own section without **Use**.
- **Get** is the [model finder](#the-model-finder), pulling into this host. **Arriving** is the [Downloads](#downloads) list.
- **Settings** shows Ollama's version with **Check for updates** (and **Download update** when Ollama runs on this machine), then the connection's name and **Base URL**.

## Local ONNX models

**Local embeddings (ONNX)** and **Local named entities (ONNX)** run small models inside Serene Pub, on the processor, with no program to install and no key. They power Search by meaning and finding lore by name, both described in [Embeddings and search by meaning](./embeddings-and-rag.md).

They need a part of Serene Pub that doesn't run on every device. On devices that can't run it (Android, and some desktop builds), they stay listed but can't be used, and each place says why:

- **New connection** shows both greyed out, with the reason in place of the chip that says what a service needs. Document View's **New connection** form greys out both too.
- In the connections list, a local ONNX connection made earlier reads **Unavailable**, with the reason. Its own view and **Admin › Connections** show the reason above its models, where **Download** and **Retry** would be.
- **Use in Embeddings** / **Use in Entities** (or **Use**) stays greyed out on its downloaded models for as long as the reason holds: in the connection's view, a model's view, a [loadout's editor](#the-loadout-editor), **Admin › Connections**, Document View and **Admin › Models › Loadouts**, which also notes the reason on the Embeddings and Entities loadouts. Switching a loadout to another connection, or to none, still works.
- A loadout's editor greys out **Download** and _N more are available to download_. The [model finder](#the-model-finder) dims the destination and greys out **Get**.
- Named entities come only from local ONNX models, so the Entities loadout's **Get a model…** is greyed out with the reason. The Embeddings loadout's stays, because a service can do that work.

Use an embeddings service instead (see [Embedding connections](./embeddings-and-rag.md#embedding-connections)); without an entity model, names the lorebook already knows are still matched.

Their models come from a recommended list Serene Pub downloads from [github.com/SerenePub/serene-pub-onnx-list](https://github.com/SerenePub/serene-pub-onnx-list) (with a built-in copy for when you're offline). Each model has a tier (_Fast_, _Balanced_, _Best_), a download size, the languages it handles and its licence. **Add from Hugging Face…** adds another model by its Hugging Face id (`org/name`), after checking it has what Serene Pub needs.

### Download state and loadout state are independent

A model's download state is about the disk:

| State           | Shows                      | Action          |
| --------------- | -------------------------- | --------------- |
| Not downloaded  | its size                   | **Download**    |
| Downloading     | a progress bar             | **Cancel**      |
| On disk         | **On disk** and its size   | **Use in Embeddings** / **Use in Entities** |
| Download failed | Hugging Face's own message | **Retry**       |

Being **In use**, the model in the Embeddings or Entities loadout, is separate. Downloading never puts a model in a loadout, and a loadout can hold a model that isn't on disk (it is shown in amber until downloaded). The loadout's model is loaded when there is work and unloaded after the connection's idle timeout.

**Use in Embeddings** and **Use in Entities** ask first whenever they would throw stored work away. For embeddings, it says how many items will be re-embedded and that retrieval falls back to keywords until that finishes; the old model stays on disk. When nothing would be lost, it switches straight away. The same question appears before **Admin › Models › Loadouts** or any other **Use** changes these models.

**Cancel** can't stop a file halfway, so the current file finishes first, then the partial download is deleted. A download interrupted by a restart is marked failed.

The connection's view has four tabs, like KoboldCPP's: **Models** (on this machine first, then what's available to download), **Get**, **Arriving** and **Settings**. A model's own view shows whether it is loaded, **Unload now**, its size on disk with **Remove** (not for the model its loadout holds), and its details. With room, the models show as a table.

### The background remover

Cutting the background out of a generated picture (a sprite with a transparent background, for example) uses one more small ONNX model, BiRefNet-lite, that no connection owns. It downloads by itself the first time a picture needs cutting out, once (a couple of hundred megabytes), and the step that asked says _Downloading the background remover, once_ while it does; you get a notification when it finishes or fails. It lives with the other local models, in the `models/matting` folder of Serene Pub's data folder, and is recorded as a local model. The Models view lists it under the models, with its state, and **Delete from disk** frees the space; the next cut-out downloads it again. While it downloads, the downloads tray offers **Cancel**: the file it is fetching finishes first, then the partial download is removed, and the picture that was waiting for it stops without a cut-out. Like the other ONNX models, it can't run on Android.

## Endpoints and models

Everywhere you choose "which model", you are choosing a **pair**: a connection and one of its models. A connection holds what is about _where_ (the address, key, how requests are sent, prompt format, token counter, stop scripts, notes). A model holds what is about _that model_: the name the service knows it by, a display name, its own capabilities, an optional context window, and optional prompt format and token counter that override the connection's. A model's settings start blank, and blank means "use the connection's".

### Models are listed by the service

You don't normally add models by hand. Serene Pub asks each service what it offers when the Models or Connections view opens, when you open a connection or model, after a connection is saved or tested, and after a download finishes. It skips a connection it asked less than ten minutes ago; **Refresh models** always asks again.

| Service                        | Lists                                    |
| ------------------------------ | ---------------------------------------- |
| Ollama                         | the models it has pulled                 |
| LM Studio                      | the models it has downloaded             |
| OpenAI-compatible services     | the service's model list                 |
| Anthropic                      | a built-in list of Claude models         |
| llama.cpp, a KoboldCPP you run | the model currently loaded               |
| KoboldCPP run by Serene Pub    | the model files in its folders           |
| Local ONNX                     | the recommended list plus what you added |
| Stable Diffusion               | its checkpoints                          |
| ComfyUI                        | its checkpoints and UNETs                |
| AI Horde                       | the models volunteers are serving now    |
| NovelAI, Black Forest Labs     | a built-in list of their image models    |

A model the service stops listing is marked **no longer listed**, not deleted, so its settings survive if it comes back. If the service can't be reached, nothing changes: the connection says _Couldn't list models_ and its models stay as they were. A model you don't want offered can be switched **off** in its view instead.

### A model that is no longer listed is unavailable everywhere

A model that is no longer listed can't be used anywhere, and every screen says so: the row, the connection, the status strip and loadout tiles, **Admin › Models › Loadouts**, and the pipeline's **Model** setting. A run that would use it stops with a sentence pointing at the fix, rather than sending a request the service would reject. Its settings are kept: refresh once the service offers it again, or pick another model.

### Adding and removing by hand

Where a service's list can be incomplete, the connection's Models tab offers **Add by name**: the model's id exactly as the service expects it, and an optional display name. Use it for a service that publishes no list, or a new model the list hasn't caught up with. Models added this way can be removed from their own view.

Ollama and the KoboldCPP run by Serene Pub have no **Add** or **Remove**: their models are pulled, downloaded and deleted in their own view, and the list follows. On a local ONNX connection, models are switched on or off, and downloaded or removed from disk.

### What a model is for

A model's view has **What it's for**: what the model **writes** and what it **reads**, ticked separately — **Writes replies**, **Draws pictures**, **Speaks**, **Hears** and **Sees**. Only the choices its connection can carry are shown; a connection whose models can only do one thing doesn't show it. One model can tick several: an OpenAI audio model **Writes replies**, **Speaks** and **Hears**. An embedding or entities model has one job and keeps the single choice (**Embeddings**, **Named entities** or **Not sure**).

Ticking **Hears** or **Sees** says what the model reads; until you tick either, the connection's own switches (**Vision**, **Hearing**) decide whether it gets pictures and sounds. Unticking everything it writes is **Not sure**, which offers it for every kind of work its connection can do.

It decides which models are offered for which loadout. A model for embeddings isn't offered for chat, and a chat model isn't offered for embeddings: **Use** and **Use in…** leave it out, **Admin › Models › Loadouts** refuses it, and a run that names it for the wrong kind of work stops with a sentence saying so. **Not sure** offers the model for every kind of work its connection can do.

Some services say what each model is for, and Serene Pub fills it in from their list: Ollama, LM Studio, llama.cpp, KoboldCPP, OpenRouter, Together AI, Mistral AI and Google Gemini. Others don't, OpenAI's own service and LocalAI among them, so their models start as **Not sure** and every chat model is offered for embeddings too. The exception is image models whose names Serene Pub recognises, such as OpenAI's `gpt-image` and `dall-e` models, which start as **Image generation**. Set it on the models you use. When the service does say, its answer wins and replaces yours on the next refresh; when it says nothing, your choice is kept.

A change that would break something is refused. **What it's for** can't be changed while a loadout or a pipeline's settings use the model for work the new choice can't do; the message names each one, so choose another model there first. A model in the Reply loadout, for example, can't be set to **Embeddings** until another model is put in the Reply loadout (_This model is in the Reply loadout._).

When the service's own list changes what a model is for, its answer stands even if that model is in a default loadout. The loadout isn't cleared or moved to another model; it is shown as broken. **Admin › Models › Loadouts** marks it **Can't do this** and says why, the status strip and loadout tiles show it in red as _can't do this loadout's work_, and Admin's **Needs you** lists it, for example _The Embeddings loadout can't use its model_, with **Choose a model**. Runs that need it stop with a sentence until you choose a model that can. The same happens when that kind of work is switched off on the connection the loadout uses.

### Choosing a pair

- A [loadout's editor](#the-loadout-editor) sets one pair per loadout, and **Admin › Models › Loadouts** does the same for each default loadout. In the editor you pick the model itself, from one list of every connection's models; in Admin, choosing a connection picks its first usable model and the model picker beside it changes that.
- A pipeline's **Model** setting picks a pair the same way, as one choice (see [Pipelines → Model and sampling](./pipelines.md#model-and-sampling)).
- A model's own **Use in…** puts it in one default loadout it can run, or all of them.
- A model that is deleted leaves whatever used it unset, with a message naming the fix. A model that is switched off or no longer listed is refused when used, rather than quietly replaced with another.

## Sampling configs

A **sampling config** is a named set of generation settings: how adventurous or predictable a model's writing is, how long a reply may be, how much of the story it is sent. Each loadout names one, and a pipeline's settings can pick a different one for any of its model calls.

Configs are edited in the **Sampling** view, on the rail. Its list groups every config by what it samples, **Large language models** or **Image generation**; a row says whether the config is built in, carries a star when a default loadout uses it (its tooltip names the loadouts, _In the Reply loadout_), and says how many settings it turns on and what uses it. **New** makes a config. Pick one and its editor opens beside the list: its name, its [parameters](#adjustable-parameters) with **Choose parameters**, and a **Used by** card naming the default loadouts that use it (each opens [that loadout](#the-loadout-editor) in Loadouts) and the pipelines that pick it (each opens in **Admin › Pipelines**). **Save** keeps your changes; **⋯** holds **Set as default…**, **Duplicate**, **Reset unsaved changes** and **Delete**, whose dialog says which jobs and pipelines lose it.

A config is chosen wherever it is used:

- **Per loadout**, in [the loadout's editor](#the-loadout-editor) in Loadouts. Its **Sampling** card lists the configs that fit its model; choosing one sets it, and **Open in Sampling** opens the chosen one in the Sampling view to edit.
- **Per session**, in **Edit session › Settings**, under **Pipelines** (see [Sessions → Pipeline settings in a session](./sessions.md#pipeline-settings-in-a-session)).
- **Per model call**, in **Admin › Pipelines**, where each model call's **Sampling** choice picks a config for that call (see [Pipelines → Model and sampling](./pipelines.md#model-and-sampling)).

Configs come in two kinds, **Large language models** and **Image generation**: the two share no parameters, so a config belongs to one, and a loadout is only offered configs of its own kind. A built-in config is read-only and can't be deleted: **Duplicate** it to change it. Deleting a config that a default loadout uses leaves that loadout with the connection's own settings until you choose another, and any pipeline that picks it will need another choice.

**Admin › Models › Sampling** manages the same configs as a table with its main values, how many settings it turns on, what uses it, and whether it is built in, with search, filters and bulk delete, and is where a new config can be added too. A config's own page edits its name and parameters, with **Save**, and its **Used by** part names the default loadouts that use it and the pipelines that pick it. **Open in Sampling**, on a row or a config's page, opens that config in the Sampling view; **Open Sampling view**, at the top, opens the view's list.

### Adjustable parameters

Each parameter that is sent has a slider or text box ([Logit Bias](#logit-bias) is a list of rows), and each group's heading says how many of its parameters are sent. For text there are about thirty, grouped as Core (temperature, top P, top K, min P, typical P, seed), Repetition (repetition, frequency and presence penalties, and more), Mirostat, XTC, DRY, Dynamic temperature, a KoboldCPP-only group (top A, N-sigma, smoothing factor, banned tokens), Reasoning, and Budget (response tokens, context tokens, stop sequences, logit bias). For images: steps, CFG scale, width, height, batch, seed, sampler, scheduler, CLIP skip and denoise.

**Response Tokens** is the longest reply allowed. **Context Tokens** is how much of the story, lore and instructions can be sent; set it to what your model supports. Each has **Unlock max** for unusually long-context models.

### Switching a parameter on and off

The editor shows only the parameters that are sent. **Choose parameters** shows every one, each with a checkbox that decides whether it is sent at all; nothing is saved until **Save**. Unticked, a parameter is dimmed and marked _not sent_: its value is remembered, and the service uses its own default. Those defaults are not always neutral: Ollama, for example, applies its own repeat penalty, top K and top P to any request that doesn't name them.

A ticked parameter may still not reach a given service, because not every service understands every setting (Anthropic accepts only temperature, top P, top K and response tokens). Those are left out of the request and noted, never an error. An administrator can see exactly what was sent in the run inspector's **Wire** tab (see [Pipelines → Inspecting a run](./pipelines.md#inspecting-a-run)).

### Reasoning

Some models reason before they answer. That reasoning costs tokens and, on most services, counts against the reply length. It shows in the reply's **Reasoning** fold as it arrives, never in the reply itself. Two parameters control it:

- **Reasoning**: `off`, `low`, `medium` or `high`. Unticked, the model does whatever it does by default.
- **Reasoning budget**: a token count, for the services that take one (Anthropic and llama.cpp). With a level and no budget, the level decides: low 2048, medium 8000, high 32000.

Each service is sent this in its own way, and a service that can't express it ignores it. While Anthropic's extended thinking is on it does not accept temperature, top P or top K, so those are left out. Where a service reports reasoning tokens separately, the run inspector shows them.

### Logit bias

**Logit Bias** makes chosen words more or less likely. It is a list of rows, each with the text to bias and a bias from −100 to 100: below 0 makes the text less likely, above 0 more likely, and −100 all but bans it where the service honours it. Every token of a row's text gets its bias. A row is read the way SillyTavern reads it:

- A plain word, such as `maybe`, is biased as it appears mid-sentence, with a space before it.
- Text in braces, such as `{Maybe}`, is biased exactly as written, spaces included.
- Numbers in brackets, such as `[1, 2, 3]`, are token ids, used as they are.

**Add** puts a blank row at the end; the arrows move a row up or down and × removes it. A blank row is marked _ignored_, and a row that can't be read (brackets around anything but whole numbers, or nothing between the braces) says why beside it. Neither is sent, and neither is removed for you. A bias outside −100 to 100 is set to the nearest end as you type.

The list starts filled with the "overthinking markers": about fifty words that reasoning models hedge and backtrack with, such as _wait_, _hmm_, _perhaps_ and _alternatively_, each at −2. Like every parameter it is sent only once its checkbox is ticked, and no built-in config ticks it.

**Import SillyTavern list** adds the rows of a SillyTavern file to the end of the list: a bias preset exported from SillyTavern's Logit Bias panel, a text completion preset, or SillyTavern's `settings.json` (the bias preset it has selected). What was added, or why the file couldn't be used, is said under the button. Nothing is saved until you save the config.

Words are turned into the token ids of the model each request goes to, so one list works on any model:

- **KoboldCPP** (both kinds) and **llama.cpp** ask the running program, which is exact for the loaded model.
- **OpenAI-compatible** connections use the [Token counter](#prompt-formats-and-token-counters) set for the model, or else the connection's, when it is a model family's own tokenizer. With **Estimate** or another estimate (Cohere's is one) there are no token ids to find: word and `{exact}` rows are left out, `[ids]` rows are still sent, and a list that sends nothing is noted on the request.
- **Ollama**, **LM Studio** and **Anthropic** take no logit bias; it is left out and noted, like any parameter a service can't take.

Each row's tokens are remembered per connection and model, so a word is looked up once rather than on every request; changing the connection's model or token counter looks them up again. A logit bias written as JSON in an earlier version is kept, with each token id as an `[id]` row.

### Sampling and ComfyUI workflows

A ComfyUI workflow has no sampling configs of its own. Its settings are its **variables**: the standard ones it uses (steps, CFG, seed, size, sampler, scheduler, denoise, CLIP skip, pictures per run) and every value you promoted when you brought it in, such as a LoRA's strength. Each has a default, and you set those in the workflow's editor on the [Workflows tab](#the-workflows-tab). A loadout that draws with the workflow can change any of them for that loadout only, and a run with nothing changed draws at the workflow's own values. A ComfyUI loadout is offered the image configs like any picture loadout; a setting its workflow doesn't use is left out, and the picture's details say so.

### Immutable presets

Serene Pub ships eleven configs you can't change or delete; duplicate one to make your own.

For text:

- **Default**: temperature, response tokens (reply length) and context tokens; everything else is left to the service.
- **Disabled**: nothing at all, so the service's own settings apply.
- **Precise (Extraction)**: low temperature, tighter top P and top K, and reasoning off, for steps that extract facts rather than write.
- **Extraction**: low temperature and a short answer. The _Extraction_ and _Scene prompt_ loadouts start with it.
- **Background**: the same values as Precise, named for steps nobody reads, such as planning, record-keeping and summaries. Adventure's planner and state keeper use it.

For images, one per model family, because a model drawn at the wrong size duplicates and smears its subject:

- **SD 1.5**: 512×512, 25 steps, CFG 7. The default for images.
- **SDXL**: 1024×1024, 30 steps, CFG 6.
- **SD 3.x**: 1024×1024, 28 steps, CFG 4.5.
- **Flux**: 1024×1024, 20 steps, CFG 1.
- **Turbo / Distilled**: 512×512, 4 steps, CFG 1. For SDXS, SD-Turbo, SDXL-Turbo, Lightning and LCM models.
- **Hosted (OpenAI, Gemini)**: 1024×1024, one picture, and nothing else. For online image services, which have no steps, CFG or seed; the sampling line then reads what is actually sent.

CFG 1 on Flux and Turbo is deliberate: those models are made to run at that setting. Sampler and scheduler are left unset, so the program uses whatever it already uses. A config's name must be unique within text or within images.

An online image service such as OpenAI's has no steps or CFG; its quality options are on the connection instead (see [Images from OpenAI](#images-from-openai)).

## Chat messages or text completion

A model can be sent the story in one of two ways:

- **Chat messages**: a list of messages, each marked as system, user or assistant. Online services and most programs work this way, and it is the right choice for nearly everyone.
- **Text completion**: one long piece of text laid out with the model's own markers for whose turn it is. This needs a [Prompt format](#prompt-formats-and-token-counters) that matches the model.

Which one a connection uses is a capability, set under **Advanced and notes › What this connection can do** in the connection's Settings tab. Each capability is **Auto**, **On** or **Off**: Auto follows the service's preset and the last successful test, and a hand-set value overrides every later test. A line above the switches says which way requests are being sent. llama.cpp uses text completion by default; the others use chat messages.

### Where placed reminders go

Some text is placed _inside_ the conversation rather than at the top: the post-history reminder and an [author's note](./sessions.md#authors-note) sent as **system** (both just before the reply unless moved), and script injections (see [Context templates](./context-templates.md#on-the-chat-wire)). On chat messages each would be a system message in the middle of the list, and not every service keeps one there:

- **OpenAI-compatible services** keep it where it is.
- **Anthropic** takes system text only at the top, and **Ollama** gathers every system message to the top, so the reminder would lose its place.
- **KoboldCPP** (both kinds), **llama.cpp** and **LM Studio** use the model's own chat template, and some refuse a system message that is not first. Qwen's does: KoboldCPP then drops it, so the reminder and the example dialogue never reached the model.

For all of these except the OpenAI-compatible services, Serene Pub folds the text into the user message right after it (or right before it, when it comes last) as a marked aside, `[System note]` … `[/System note]`, so it keeps its place everywhere. A text completion lays every block out in place and needs none of this.

### Images and files

Files attached to messages (see [Sessions](./sessions.md#attach-images-and-files)) reach a model only by **chat messages**: a text completion is one piece of text with nowhere to put a picture. Every connection type sends images on its chat messages: Anthropic, the OpenAI-compatible services, Ollama, KoboldCPP (both kinds), llama.cpp and LM Studio. Anthropic also takes PDFs; the others don't. Text files are put into the prompt as text, so every model reads them.

Whether a model may be sent images is its **Vision** capability, under **What this connection can do**. On **Auto** it is decided per model, in this order, each one overruling the one before:

1. the service's preset: Anthropic, OpenAI, OpenRouter and Gemini say their models can see;
2. what the model's own host says, which is more specific than the preset: OpenRouter-style listings name each model's inputs, Ollama says which models have vision, LM Studio says which models are vision models, and a KoboldCPP run by Serene Pub says so for a model with a [Vision projector](#launch-settings-and-when-a-model-reloads). So a text-only model on OpenRouter isn't offered images, and `qwen2.5vl` in Ollama is, with nothing to switch;
3. the last successful test, for a KoboldCPP you run yourself (whether it has a vision part loaded);
4. your own **On** or **Off**, which wins over all of them.

Anything nothing has spoken for stays off, because only you know whether the model you run can see. A local model needs its vision part loaded as well: start llama-server with `--mmproj`, and load the mmproj file in a KoboldCPP you run yourself. A host's word about a model is read when its models are listed, so press **Refresh** in its Models tab after pulling a new model. Images are sent as PNG or JPEG to the local servers, which can't read WebP, and are converted on the way when needed.

## Prompt formats and token counters

When a connection sends a text completion, its **Prompt format** decides how the story is laid out for the model:

- **Vicuna (Default)**
- **ChatML**
- **Basic / Legacy**
- **OpenAI**
- **LLaMA2/Mistral Instruct**
- **Claude (Human/Assistant)**
- **Instruct (Alpaca)**

The wrong format usually shows up as a model that ignores whose turn it is or writes past where it should stop. If a text-completion connection writes garbled or run-on replies, check this against the format the model was trained on (its page on Hugging Face usually says). A prompt format is not the same thing as a [prompt](./pipelines.md#prompts): the prompt says _what_ to write, the format says how it is laid out.

Every connection also has a **Token counter**, which Serene Pub uses to estimate how much story and lore fits within the sampling config's **Context Tokens**. Nothing about it is sent to the model, except that an OpenAI-compatible connection turns [logit bias](#logit-bias) words into token ids with it. **Estimate** (the default) is a quick approximation that suits most models. The others are for a model family. **OpenAI GPT-2/3**, **OpenAI GPT-3.5 Turbo**, **OpenAI GPT-4**, **OpenAI GPT-4o**, **Llama**, **Llama 3** and **Mistral/Mixtral** count with that family's own tokenizer. **Cohere (approximate)** counts with Gemma's tokenizer, because no Cohere tokenizer ships with Serene Pub. **Anthropic Claude**, **Google Gemini/PaLM** and **Google Gemma** are estimates. A matching counter gives a more accurate fit; a mismatched one can send too much or too little.

**KoboldCPP** (both kinds) and **llama.cpp** can count with the loaded model's own tokenizer, and Serene Pub asks them to: the counts are kept per piece of text, so from the second turn on almost every count is the model's own, and the token counter only estimates what has not been counted yet (scaled up by how far it has been off). This matters because a prompt the estimate thought would fit, and the server finds too long, is cut by the server from the front, on every turn. The other services publish no tokenizer and keep the estimate.

A model can override its connection's prompt format and token counter in its own view.

## Stop sequences

A stop sequence is a piece of text that ends the reply the moment the model writes it. Each request gets one list, from three sources:

- **Format**: the prompt format's own markers, such as ChatML's `<|im_end|>`.
- **Speaker**: a `Name:` label for every character and persona in the scene except the one speaking, so the model stops before writing someone else's line.
- **Your own**: whatever you put in the sampling config's **Stop sequences**, one per line. `{{char}}` and `{{user}}` are filled in.

Which of these are sent depends on how the connection sends the story:

| Sent as             | Format    | Speaker                              | Your own |
| ------------------- | --------- | ------------------------------------ | -------- |
| **Text completion** | sent      | sent                                 | sent     |
| **Chat messages**   | held back | sent when messages carry name labels | sent     |

Format markers mean nothing in a list of chat messages, and some services let them override the model's own stopping point, cutting replies short, so they are held back. Speaker labels are still useful in chat messages when each message starts with a name, which the default context template does.

Some services ignore stop sequences on chat messages. So Serene Pub also cuts a reply at the first line that starts with another participant's label. Only the start of a line counts, never the reply's first line, so a name mid-sentence is kept.

When a reply runs on or stops too soon, the reply's **What actually fired** shows a **Stops** row: each stop sequence, whether it was sent or held back and why, and which one the model hit where the service reports it.

## Streaming

Streaming shows a reply as it is written rather than all at once. Each connection has a **Stream** setting. Each model call in a pipeline also has a **Streaming** setting: **Automatic** (the default) follows the connection, and **Off** waits for the whole answer. Off suits steps nobody watches, such as planning, record-keeping or summaries; some services answer those faster and report their token use more fully. Automatic never turns streaming on for a connection that has it off.

## Everyday management

- **Test** on a connection's status card checks the address and key before you rely on it, and shows the service's own error when it fails.
- **Default loadouts are per kind of work.** **Use in Reply**, **Use in Images**, **Use in Embeddings**, **Use in Entities** and **Use in…** all fill one default loadout.
- **The KoboldCPP run by Serene Pub can't be used while it is switched off.** Switched off with its files kept it says _Offline_, and **Start** switches it back on; with nothing set up it says _Not installed_ with **Set up**.
- **Deleting asks first** and says what goes with it. A model a loadout still holds can't be deleted from disk until you pick another.
- **Unsaved changes** in a connection or a model, and in a sampling config's parameters, are kept until you save or discard; switching away asks first.
