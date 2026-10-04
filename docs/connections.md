# Connections

A **connection** tells Serene Pub where a model runs and how to reach it: a program on your computer, a machine on your network, or an online service. This page covers every kind of connection, the KoboldCPP and Ollama that Serene Pub can look after for you, and the settings that shape what a model is sent: sampling configs, prompt formats, token counters, stop sequences and streaming.

:::tip Setting up for the first time?
You need one connection and one model, and [Connect a model](./connect-a-model.md) walks you through it in about ten minutes. Come back here when you want to add a second service, tune how a model writes, or work out why something stopped answering.
:::

Connections belong to the administrator. The **Connections** view on the rail is only offered to administrators, and so are **Sampling** and the **Admin › Models** pages. Everyone else uses whatever the administrator has set up.

## How connections, models and defaults fit together

Four ideas carry the whole page.

- **A connection is a place.** It holds an address, an API key where the service needs one, and a few settings about how requests are sent. It does not, by itself, pick a model.
- **A connection has models.** Serene Pub asks the service which models it offers and keeps that list up to date. One connection to OpenRouter can offer hundreds; one llama.cpp offers the one it was started with.
- **Each job has a default model.** Chat, image generation, embeddings, named entities and the rest are **jobs** (also called capabilities). Each job's default names a connection _and_ one of its models, a **pair** such as _Nemo 12B · KoboldCPP_. A job with no default is switched off. You set them in [Admin › Models › Defaults](#admin--models--defaults), or with **Use** wherever a model is listed.
- **A pipeline can ask for a different model.** A pipeline's configuration can name another pair for one of its model calls, for example a small fast model for Adventure's planner. Anything it leaves unset uses the job's default. See [Pipelines → Model and sampling](./pipelines.md#model-and-sampling).

A **session never picks a connection or a model.** Its replies use whatever its pipeline configuration names, else the pub default. To change the model a session uses, an administrator changes it in the **Pipelines** view (see [Sessions → Which connection a session uses](./sessions.md#which-connection-a-session-uses)).

## The Connections view

Open **Connections** from the rail. Like any view it can sit beside your session, take half the window, or take all of it (see [Getting around](./getting-around.md)). It opens on a list of your **connections**, with the **defaults** (which model each job uses) at the top. A connection's models are inside it: open the connection to see them.

### The index, top to bottom

- **Add** opens a menu: **A connection** (the **New connection** dialog, with every service), **KoboldCPP, run by Serene Pub** (see [below](#koboldcpp-run-by-serene-pub)), **Ollama**, **A model** (the [model finder](#the-model-finder)) and, when some connection can take one, **A model by name**. The Android app does not offer KoboldCPP or Ollama here, because it cannot run them. **Get a model**, the download button at the other end of the row, opens the finder directly. **Ctrl/Cmd+N** opens the New connection dialog.
- **Filter** matches a connection's name, service, address and the names of its models. The menu beside it narrows the list to _Needs attention_, the _Defaults ledger_ (every job with the pair it uses), or the connections that can serve _Chat_, _Images_, _Embeddings_ or _Entities_. The two buttons after it show the connections as a **list** or as **cards**; your choice is remembered in this browser.
- **The defaults**, at the top:
  - **The status strip** says whether sessions can reply: _Sessions can reply_ with the model and connection that answer and **Change**, or _Sessions can't reply yet_ with a gold **Set up chat**.
  - **Other jobs** is a grid of tiles: images, embeddings and named entities first, then **N more** for the rest. Each says which model is set up for it, or _Not set up_, and opens that job's own [view](#the-capability-view). There is no score out of ten on purpose: every job except chat is optional, and leaving one off is fine.
- **Connections**, the main list: one row or card per connection, in two groups: **On this machine** (_private · free_) and **Services** (_billed per message_). The group comes from the kind of connection: KoboldCPP, Ollama, LM Studio, llama.cpp, Stable Diffusion and the local ONNX models count as on this machine wherever their address points, and OpenAI, Anthropic and the OpenAI-compatible services count as services.
- **Downloads**, at the foot while anything is downloading: a count, an overall bar, and **View** for the [Downloads list](#downloads).

Each row shows the connection's name, the host under it (or the host's own error when something failed), and on the right its **state** and one figure, such as _Ready · 9 models_ or _Stopped · 2 on disk_. A card shows the same, with room for all of it at once: what kind of connection it is, its state, how many models it has, its host, and its action. A small label after the name says what kind of connection it is, unless the name already says so. A gold star marks each job the connection is the default for, so you can see at a glance which connection your sessions use. A row or card offers at most one quick action, such as **Start**, **Set up**, **Fix** or **Refresh**. Tap it to open the connection.

There are five kinds of state, and only one of them is red:

| State | Colour | Means |
| --- | --- | --- |
| **Ready** | green | It works right now. |
| **Stopped**, **Offline**, **Not tested**, **Installed** | grey | Set up, nothing wrong, not running. **Offline** is a KoboldCPP that is switched off with its files kept; **Start** switches it back on. |
| **Needs a key**, **Not set up**, **N no longer listed** | gold | It is waiting for _you_. Nothing has failed. |
| **Checking**, **Downloading** | amber | Something is in progress. |
| **Not working**, **Not reachable**, **Crashed** | red | It was set up and it still failed. |

A connection you created a minute ago and haven't given a key yet is gold, not red: it is unfinished, not broken.

In the dock and at half width, opening a connection replaces the list, and **Back** returns to it. In Focus the list takes the whole view while nothing is open, with the job tiles four across and the cards side by side. Open something and the list moves to a column on the left (always as rows there) while what you opened fills the rest; the job tiles shrink to a row of small buttons, and **N more** gives the list the whole view again.

A connection's models are listed on its **Models** tab. Where there is room they are a table, with each model's context window, price per million tokens in and out, and what it can do, plus **hide** for models you will never use. Hiding is not deleting: the model, its settings and anything that names it are kept, and one press brings it back.

### First run and Set up chat

With nothing connected, the index offers three doors: **On this machine** (KoboldCPP, installed and run by Serene Pub), **A service** (the New connection dialog), and **Something I already run** (the New connection dialog narrowed to programs such as Ollama, LM Studio, llama.cpp and KoboldCPP). **Add a connection** lists everything, for people who know what they want.

**On this machine**, or the status strip's **Set up chat**, opens **Set up chat**: three steps on one screen.

1. **Runtime.** Serene Pub adds a KoboldCPP connection and shows the build picker. Pick the build for your hardware; it downloads and starts by itself. If you already run KoboldCPP yourself, a link opens the connection's own view, where **I'll manage it myself** is offered.
2. **Model.** The [model finder](#the-model-finder), already set to chat and to that KoboldCPP. Get one model.
3. **Done.** The first model to arrive becomes the chat default, but only if no chat default was set, so a pub that already replies is never switched to another model. **Start a session** or **Open KoboldCPP**.

The step is worked out from what is actually there each time. Close the view with a download running, come back later, and you land on the step you are really at.

### The capability view

Tap a job tile, or the status strip's **Change**, to open that job's own screen.

- A **status card** at the top: one word for its state (_Ready_, _Not set_, _Downloading_, _Needs attention_), one sentence on what that means ("Sessions reply with this model"), and the one fix when something is wrong. Under it, the pair in use with a link to **Admin › Defaults**, or _Not set · pick one below_.
- **Also able to …** (chat, draw, embed, find entities) lists every model, on any connection, that can do this job and is ready to use, each with **Use**. A local model that is still downloading has no **Use** yet, and local models that aren't downloaded are counted in a line that opens the finder.
- **Get a … model**, at the foot, opens the [model finder](#the-model-finder) for this job.

**Use** sets the job's default, exactly as Admin › Defaults does. Switching the embedding or entity model can mean redoing stored work, so it asks first (see [Local ONNX models](#local-onnx-models)).

### The model finder

The finder searches the recommended model lists and Hugging Face from one box. Open it with **Get a model**, **Add › A model**, a capability view's **Get** link, or a managed connection's **Get** tab. It has four rows:

1. **Search.** Typing narrows the recommended models at once and, after a pause, searches Hugging Face for GGUF files. For a local ONNX connection there is no search; **Add from Hugging Face by id** takes a model's id instead.
2. **For**: **Chat**, **Images**, **Embeddings** or **Entities**.
3. **Download to**: which of your managed connections the files go into, such as your KoboldCPP, your Ollama, or a local ONNX connection. Only programs Serene Pub can download into are offered; an online service never is. A line under it says where files will land and which memory size is set, with **Change**.
4. **Results.** **Recommended** rows come from Serene Pub's curated lists; **Hugging Face** rows come from the search. Each row has a tier chip (_Ultra Budget_ to _Enthusiast_ for GGUF files, _Fast_, _Balanced_ or _Best_ for ONNX), its size and a short description. A model you already have says so instead of offering **Get**.

**Memory size.** **Change** asks _How much memory does this machine have?_ with five answers: 4 GB, 8 GB, 12 GB, 24 GB+ or **Not sure**. Answer with your graphics card's memory, or your Mac's memory. Rows that suit it turn gold, and the first one that fits gets the one gold **Get**. **Not sure** switches all the size hints off rather than guessing. The answer is remembered in this browser, so a phone and a desktop can answer differently.

**Get.** For a GGUF model, **Get** opens a list of the model's files (its _quantizations_: smaller files are faster and lose a little quality). With a memory size set, each says _Fits in 8 GB_, _Tight in 8 GB_ or _Too big for 8 GB_. Choose one and press **Download**. Progress shows in the row and in [Downloads](#downloads). An Ollama model starts pulling at once; an ONNX model goes into the local cache.

### Downloads

Everything the pub is downloading, in one list: model files for KoboldCPP, the KoboldCPP program itself, Ollama pulls and ONNX models. Open it from the tray at the foot of the index. A managed connection's **Arriving** tab shows the same list. Each row has the name, where it is going, a progress bar (_1.2 of 4.1 GB_) and **Cancel**. Finished downloads stay listed until you press **Clear finished**. Serene Pub never shows a time estimate.

### A connection's view

Tap a connection and its view opens. For a service you connect to, such as OpenRouter, Anthropic or your own llama.cpp, it has a status card and up to two tabs.

- **Status card.** One word and one sentence: _Reachable · Answered just now_, _Not reachable · ECONNREFUSED_, _Couldn't list models · 401 Unauthorized_, or _Not checked yet_. **Test** asks the service using the settings as they are on screen, saved or not. A service that still needs a key says **Needs an API key**, in gold, with a **Get a key ↗** link to that service's key page.
- **Models tab**, when the service offers models to choose from: how many it lists and how many are no longer listed, **Refresh**, the models themselves, each with **Use** (a table with context and prices where the view is wide enough), and **Add by name** for a service that doesn't publish a list. Tap a model to open its own settings.
- **Settings tab.** The name, the API key, the address, and **Request settings** (token counter, streaming and anything particular to that service). Under **Advanced and notes** are your notes, **What this connection can do** (see [Chat messages or text completion](#chat-messages-or-text-completion)), any embedding or entity settings, and stop scripts. **Delete connection** is at the foot.

A connection with nothing to choose between, such as llama.cpp, has no tabs: its settings simply show. A new connection without its key opens on Settings. **Save** and **Discard** appear only while something has changed, and leaving with unsaved changes asks first.

KoboldCPP and Ollama run by Serene Pub, and the local ONNX connections, have their own views, described below.

## Admin › Models › Defaults

**Admin › Models › Defaults** is where each job is given its connection and model. Nothing is picked for you: a job with no default is off. A line at the top says, in red, how many jobs a pipeline needs that aren't set, or, in green, that everything needed is set.

Jobs are grouped by what they produce (text, images, embeddings, named entities). Each row shows the job, what it is for, its status (**Set**, **Not set**, **Needed** when a pipeline requires it, **Model gone** when its host stopped listing the model), a connection picker, a model picker, and a sampling config. A connection that can't do the job is still listed, greyed, with the reason. **Sampling for all** sets the sampling config for every job in a group at once. Embeddings and entities have no sampling.

Defaults can also be set from a model's **Set as default…**, a capability view's **Use**, a KoboldCPP or Ollama model's **Use for chat**, or **Make active** on a local model. They all do the same thing. The index shows the result as the status strip and job tiles, a gold **Default** chip on the model, and the **Defaults ledger** filter.

Changing the embedding or entity model here rebuilds stored work, so it asks first and shows how much; **Keep** puts the old choice back.

## Admin › Models › Connections

**Admin › Models › Connections** manages the same connections as a table, for working with several at once. It lists every connection with its service, kind, number of models, the defaults it holds and its state. Search matches name, service, address and notes; **Filter** narrows by service, kind, status or whether it holds a default; column headers sort. The address keeps your search and filters, so a filtered list can be bookmarked or shared.

Tick rows and choose **Actions › Delete selected connections…** to delete several. The confirmation lists the models that go with each one and the defaults it releases. Deleting the KoboldCPP connection also switches KoboldCPP off, and deleting the last Ollama connection switches Ollama off.

**Add connection** asks for the service and a name. A connection's own page has sections for its status and **Test**, its name and notes, its address and key, the KoboldCPP runtime (for the managed KoboldCPP), its models, the defaults that point at it, stop scripts and advanced settings, with **Save**, **Save and continue editing** (Ctrl+S) and **Delete**. **History** shows what changed and when. Starting, stopping and downloading stay in the Connections view; **Open in Connections** takes you there.

In **Models**, a model's **hide** / **show** button and **Use** wait for **Save**, like every other change on the page. Each one you press is listed under the table as _Waiting for Save_, and its **×** puts it back. Save sends them one at a time and waits for each answer, showing first, then the defaults that need them; if one is refused, the page says which and why, and leaves it waiting so you can try again. **Refresh**, **Add by name** and a local model's **Download** or **Cancel** are not changes to save: they happen as soon as you press them.

## Choosing a service

The **New connection** dialog lists every service in one searchable box, grouped under **Cloud APIs**, **Local / Self-hosted** and **Custom**, with buttons to show only text, image, embedding or entity services. Picking one shows its description and how hard it is to set up.

| Service | Runs | Good for |
| --- | --- | --- |
| **KoboldCPP, run by Serene Pub** | On this machine | Most people running models locally. Serene Pub installs and looks after it. Added from **Add**, not from this dialog. |
| **Ollama** | On this machine or your network | People who already use Ollama. Chat and embeddings from one connection. |
| **LM Studio** | On this machine or your network | People who already use LM Studio and its window for managing models. |
| **KoboldCPP** | On this machine or your network | A KoboldCPP you start yourself. |
| **Llama.cpp** | On this machine or your network | People who build and run `llama-server` themselves. |
| **OpenRouter**, **OpenAI (Official)** and other OpenAI-compatible services | Online | Hosted models. OpenRouter reaches hundreds with one key. |
| **Anthropic (Claude)** | Online | Claude models, direct from Anthropic. |
| **Stable Diffusion (A1111-compatible)** | On this machine or your network | Images from AUTOMATIC1111, Forge, SD.Next or a KoboldCPP with an image model. |
| **Local embeddings (ONNX)**, **Local named entities (ONNX)** | Inside Serene Pub | Helping characters remember a long story. See [Local ONNX models](#local-onnx-models). |
| **Embeddings (OpenAI-compatible)** | Online or your network | Embeddings from a service's `/embeddings` endpoint. |

:::note Most people: pick one
Running models on your own computer: **KoboldCPP, run by Serene Pub**. Using an online service: **OpenRouter**. Either can be added to later.
:::

Every connection form shares a pattern: the key or address it can't work without comes first, then a **Token Counter**, then **Request settings** for how requests are sent. There is no Test button on the form; **Test** is on the connection's [status card](#a-connections-view).

Most connections serve one kind of model. **Ollama** and the **KoboldCPP run by Serene Pub** serve several: one Ollama connection offers every chat and embedding model its host has pulled, and the managed KoboldCPP both writes and draws. Each model knows what it is for, so an embedding model is never offered for chat and an image model never for text.

## LM Studio

Connects to LM Studio's REST API, which you must first switch on in LM Studio's own settings. Its models are the ones LM Studio has downloaded, listed automatically. **Request settings** hold the **Base URL** (default `ws://localhost:1234`, a `ws://` address rather than `http://`), **Stream**, and **Keep Alive (seconds)** (default 60), which is how long LM Studio keeps a model loaded after a request.

## Ollama

Connects to an Ollama you installed and run yourself. Its models are whatever Ollama has pulled, listed automatically, and one connection serves both chat and **embeddings** from the same host. To use embeddings, pull an embedding model (for example `ollama pull nomic-embed-text`, or from the connection's **Get** tab) and choose it for Embeddings. Ollama 0.6 or newer says which models are which; with an older Ollama every model is offered for both.

The form shows the **Base URL** (default `http://localhost:11434/`). **Request settings** hold **Keep Alive**, a number and a unit (default `5m`), which is how long Ollama keeps a model loaded, and **Stream**. Pulling, deleting and updating happen in the connection's own view: see [Ollama, managed](#ollama-managed).

## OpenAI-compatible services

Many services accept requests in the same shape as OpenAI's API, so one kind of connection reaches all of them. The **Service** list in the New connection dialog names each of these services directly. Picking one fills in its address and a sensible token counter; you add the API key. Its models come from the service's own list when it publishes one, and **Add by name** covers a service that doesn't. **Request settings** hold the **Token Counter** and **Stream**.

| Service | Base URL |
| --- | --- |
| Custom (OpenAI-Compatible) | _(blank: fill in your own)_ |
| OpenRouter | `https://openrouter.ai/api/v1/` |
| OpenAI (Official) | `https://api.openai.com/v1/` |
| Groq | `https://api.groq.com/openai/v1/` |
| Together AI | `https://api.together.xyz/v1/` |
| DeepInfra | `https://api.deepinfra.com/v1/openai/` |
| Fireworks AI | `https://api.fireworks.ai/inference/v1/` |
| Perplexity AI | `https://api.perplexity.ai/v1/` |
| AnyScale | `https://api.endpoints.anyscale.com/v1/` |
| LocalAI | `http://localhost:8080/v1/` |
| Ollama (via OpenAI-Compatible API) | `http://localhost:11434/v1/` |
| KoboldCPP (via OpenAI-Compatible API) | `http://localhost:5001/v1/` |
| Mistral AI _(Experimental)_ | `https://api.mistral.ai/v1/` |
| xAI Grok _(Experimental)_ | `https://api.x.ai/v1/` |
| DeepSeek _(Experimental)_ | `https://api.deepseek.com/v1/` |
| Google Gemini _(Experimental)_ | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Cohere _(Experimental)_ | `https://api.cohere.ai/compatibility/v1/` |
| Novita AI _(Experimental)_ | `https://api.novita.ai/openai/` |
| Featherless AI _(Experimental)_ | `https://api.featherless.ai/v1/` |
| text-generation-webui _(Experimental)_ | `http://127.0.0.1:5000/v1/` |
| vLLM _(Experimental)_ | `http://localhost:8000/v1/` |
| SGLang _(Experimental)_ | `http://localhost:30000/v1/` |
| Aphrodite Engine _(Experimental)_ | `http://localhost:2242/v1/` |

_Experimental_ services have had less testing with Serene Pub; check the address and the service's own notes. Everything a preset fills in can be changed afterwards.

The **(via OpenAI-Compatible API)** entries for Ollama and KoboldCPP use those programs' OpenAI-style endpoints. The dedicated [Ollama](#ollama) and [KoboldCPP](#koboldcpp-you-run-yourself) connections use their own native APIs, which Serene Pub supports more fully; prefer those.

### Where the API keys come from

Make an account on the service's website, create an API key there, and paste it into the connection's **API Key** field. For OpenAI that is `platform.openai.com`, for Anthropic `console.anthropic.com`, and for OpenRouter its account settings. A key is a password for your account: keep it private. Keys are stored per connection, so you can have two connections to the same service with different keys.

## Llama.cpp

Connects to `llama-server`. **Request settings** hold the **Base URL** (default `http://localhost:8080/`) and **Stream**. There is no API key and no model list to choose from: llama-server runs the one model it was started with, and the connection lists that model. It sends a text completion by default, so a **Prompt Format** setting is shown; its chat API can be used instead (see [Chat messages or text completion](#chat-messages-or-text-completion)).

## Anthropic (Claude)

Connects directly to Anthropic's API with your **API Key** (it starts `sk-ant-`). Its models come from a built-in list of Claude models, and a newer one can be added by name. **Request settings** hold **Stream**. Extended thinking is set on the sampling config, not here: see [Reasoning](#reasoning).

## KoboldCPP you run yourself

The plain **KoboldCPP** connection talks to a KoboldCPP you start and manage yourself, on this machine or another one, through KoboldCPP's own API. If this pub also [runs its own KoboldCPP](#koboldcpp-run-by-serene-pub), the form warns you, since you probably want that connection instead.

**Its models are whatever KoboldCPP has loaded.** It lists the loaded text model and, when they are loaded, the image and embedding models, each offered only for its own job. Restart KoboldCPP with a different model and, on the next refresh, the old one is marked no longer listed and the new one appears. When KoboldCPP is restarted with a different _embedding_ model than the one set as the default, Serene Pub refuses to use it and names both models, rather than mixing two models' results in your lore. Choose the new model as the embedding default, which re-indexes after asking.

The form has the **Base URL** (default `http://localhost:5001`), a **Token Counter**, a **Prompt Format** when sending a text completion, and **Request settings**:

- **Stream**: show the reply as it is written.
- **Use Memory**: reveals a **Memory Text** box whose text is added to the start of every text-completion request.
- **Trim Stop Sequences** (on by default): cut the stop sequence that ended a reply off its end.
- **Render Special Tokens**: show the model's special tokens (such as end-of-turn markers) in the text instead of hiding them.
- **Bypass EOS Token**: keep writing past the point where the model would normally end its reply, until the length limit or a stop sequence.
- **Retain Grammar State**: carry a response grammar's position over from one request to the next instead of starting it fresh.
- **Replace Instruct Placeholders**: let KoboldCPP swap its own placeholders, such as `{{[INPUT]}}` and `{{[OUTPUT]}}`, for the loaded model's instruct tags. Serene Pub's own prompts never use them, so this only matters if you typed them yourself.

Each switch is sent to KoboldCPP with every request, on both its chat and text-completion endpoints.

## Stable Diffusion (A1111-compatible)

For images from a program that speaks the AUTOMATIC1111 API: AUTOMATIC1111 itself, Forge, SD.Next, or a KoboldCPP with an image model loaded. Point the **Base URL** at it (default `http://localhost:5001`). Its models are the checkpoints the program lists. How a picture is drawn (size, steps, CFG) comes from an image [sampling config](#sampling-configs). If you use the KoboldCPP run by Serene Pub, you don't need this connection: it draws too (see [Images from the same connection](#images-from-the-same-connection)).

## KoboldCPP, run by Serene Pub

Serene Pub can download KoboldCPP, start and stop it, fetch models into it, and load whichever model a request needs. All of that lives on one connection, **KoboldCPP, run by Serene Pub**, and its own view. Add it with **Add › KoboldCPP, run by Serene Pub**, or **On this machine** on a new pub. **Remove KoboldCPP from this pub**, in the view's **⋯** menu or at the foot of its Settings tab, switches it off again; files already on disk are left where they are.

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

In Managed mode the card shows the process state (_Running_, _Starting_, _Stopped_, _Crashed_) with **Start** or **Stop**, how long it has been running, the **Loaded model** with **Unload** to free its memory without stopping KoboldCPP, and an **Update** button when a newer KoboldCPP is out. If KoboldCPP failed to start or crashed, the error is shown under the card. **Details** opens live performance figures: busy or idle, generation and prompt speed in tokens per second, the last request's timings, and totals. In External mode the card says whether the address answered and which version it runs.

### Models tab

Lists every model file the connection has, under **Text models** and **Image models**. **Use for chat** on a text model, or **Use for images** on an image model, makes it that job's default without loading it: it loads the first time something asks. Each row's **⋯** menu has **Model settings**, **Move to image models** or **Move to text models** (for a file Serene Pub sorted wrongly), and **Delete from disk**, which asks first.

Whether a file is a text or an image model is read from inside the file, not guessed from its name or folder.

### Get and Arriving tabs

**Get** is the [model finder](#the-model-finder) with this connection as the destination; its line says which folder files will land in. **Arriving** is the [Downloads](#downloads) list.

### Settings tab

- **Binary** (Managed mode): the installed build and version, the latest version, **Check for updates**, **Change binary**, and **Update binary** when there is a newer one.
- **Model unload timer**: seconds of no use before the loaded model is unloaded (default 300; 0 means never).
- **Subprocess idle timeout**: seconds of no use before KoboldCPP itself is stopped (default 1800; 0 means never).
- **Server URL** and **Port** (default 5001): where Serene Pub reaches KoboldCPP. Changing the port needs a restart. If the two disagree, a warning says so: requests go to the Server URL, so make them match.
- **Base URL** (External mode only): the address of your KoboldCPP.
- **Models Directory**: where text models are stored and downloaded to. It must be set before anything can be listed or downloaded.
- **Image Models Directory**: where image models go. Left blank, image models are looked for in the Models Directory. Setting it never moves files; models already in the Models Directory keep working.
- **Active capabilities**: what the running KoboldCPP build supports (Image Gen, Vision, TTS, Speech-to-Text, Embeddings, Multiplayer, Web Search, Admin API).
- **Image generation**: the thread count and quantization level for loading image models, and **Test Generation**, which draws a test picture with the current image default.

### Launch settings and when a model reloads

Further down the Settings tab, under the connection's own settings, **Managed mode launch settings** decide how KoboldCPP loads a model:

- **GPU Layers**: how many layers of the model go on the graphics card. `-1` (the default) fits as many as will fit; `0` runs on the processor only.
- **Flash Attention**: a faster way of processing on graphics cards that support it. Off by default.
- **Batch Size**: how much of the prompt is processed at a time. Default `512`.

A text model can also have a **Vision projector**: its mmproj file, which lets it read images. Set it in the model's **Model settings** (the **⋯** menu in the Models tab), as the file's name; the file must be in the Models Directory, and files whose names contain `mmproj` are suggested. Setting one turns **Vision** on for that model. Clear the box to load the model without it.

Before each request, Serene Pub checks which model KoboldCPP has loaded and with which settings. If the model, any of the three settings above, its vision projector, or a larger context size than the one loaded doesn't match, it reloads KoboldCPP with the right ones and waits (up to ten minutes) before sending the request. So a change to these settings, or switching to another model, takes effect the next time the model is used, not when you save. The first request after restarting Serene Pub also reloads once, because the new Serene Pub can't be sure what the old one loaded.

The connection's settings also have the **Prompt Format**, **Token Counter** and the [same request settings](#koboldcpp-you-run-yourself) as a KoboldCPP you run yourself. There is no Base URL field: the address is the Server URL in the Settings tab.

### Images from the same connection

The managed KoboldCPP draws as well as writes. **Use for images** on an image model makes it the image default. The image model is loaded when a picture is asked for. KoboldCPP holds one model at a time, so drawing a picture unloads the chat model and the next reply loads it again; with large models that can take minutes each way.

### Troubleshooting: no model loaded, or a rejected model load

If KoboldCPP answers without a model loaded (for example, it was started with `--nomodel`), the reply fails with _KoboldCPP rejected the request — is a model loaded?_ instead of arriving blank.

In External mode, if KoboldCPP refuses to load a model, the most likely cause is that the admin password or admin directory on this connection doesn't match what KoboldCPP was started with (`--admin --adminpassword … --admindir …`).

### Troubleshooting: download or start failures

When the download or the first start fails, read the message under the status, not just the word _Failed_ or _Crashed_. A download failure is shown on the download screen; a start failure under the status card.

On Docker or a NAS, the usual cause is that Serene Pub's data folder is a mounted volume the container can't write to. Check that it can create folders and files there before retrying the download or choosing another build.

## Ollama, managed

Every Ollama connection gets its own view, and each one manages its own host: two Ollama connections (this machine and another computer, say) are two independent views. Serene Pub doesn't install or start Ollama; you install it yourself, and the view uses Ollama's API to list, pull and delete models. Add one with **Add › Ollama**, or **Something I already run** on a new pub.

The **status card** reads, for example, _Running · 0.30.7 · 4 models_, with an **Update available** chip when Ollama has a newer release. When Ollama can't be reached it says **Not reachable** with the address, **Check again**, **Change address** and a **Get Ollama** link.

- **Models** lists what this host has pulled, under **Chat models** and **Embedding models**. **Use for chat** or **Use for embeddings** makes a model that job's default (embeddings ask first, since they rebuild the index). Each row's menu has **Model settings**, **View on ollama.com** and **Delete from disk**.
- **Get** is the [model finder](#the-model-finder), pulling into this host. **Arriving** is the [Downloads](#downloads) list.
- **Settings** shows Ollama's version with **Check for updates** (and **Download update** when Ollama runs on this machine), then the connection's name and **Base URL**.

## Local ONNX models

**Local embeddings (ONNX)** and **Local named entities (ONNX)** run small models inside Serene Pub, on the processor, with no program to install and no key. They power the long-term memory described in [Embeddings and search by meaning](./embeddings-and-rag.md). They are not available on Android.

Their models come from a recommended list Serene Pub downloads from [github.com/SerenePub/serene-pub-onnx-list](https://github.com/SerenePub/serene-pub-onnx-list) (with a built-in copy for when you're offline). Each model has a tier (_Fast_, _Balanced_, _Best_), a download size, the languages it handles and its licence. **Add from Hugging Face…** adds another model by its Hugging Face id (`org/name`), after checking it has what Serene Pub needs.

### Download state and active state are independent

A model's download state is about the disk:

| State | Shows | Action |
| --- | --- | --- |
| Not downloaded | its size | **Download** |
| Downloading | a progress bar | **Cancel** |
| On disk | **On disk** and its size | **Make active** |
| Download failed | Hugging Face's own message | **Retry** |

Being **Active**, the default for that job, is separate. Downloading never makes a model active, and a model can be active without being on disk (it is shown in amber until downloaded). The active model is loaded when there is work and unloaded after the connection's idle timeout.

**Make active** asks first whenever it would throw stored work away. For embeddings, it says how many items will be re-embedded and that retrieval falls back to keywords until that finishes; the old model stays on disk. When nothing would be lost, it switches straight away. The same question appears before **Admin › Defaults** or any other **Use** changes these models.

**Cancel** can't stop a file halfway, so the current file finishes first, then the partial download is deleted. A download interrupted by a restart is marked failed.

The connection's view has four tabs, like KoboldCPP's: **Models** (on this machine first, then what's available to download), **Get**, **Arriving** and **Settings**. A model's own view shows whether it is loaded, **Unload now**, its size on disk with **Remove** (not for the active model), and its details. With room, the models show as a table.

## Endpoints and models

Everywhere you choose "which model", you are choosing a **pair**: a connection and one of its models. A connection holds what is about _where_ (the address, key, how requests are sent, prompt format, token counter, stop scripts, notes). A model holds what is about _that model_: the name the service knows it by, a display name, its own capabilities, an optional context window, and optional prompt format and token counter that override the connection's. A model's settings start blank, and blank means "use the connection's".

### Models are listed by the service

You don't normally add models by hand. Serene Pub asks each service what it offers when the Connections view opens, when you open a connection or model, after a connection is saved or tested, and after a download finishes. It skips a connection it asked less than ten minutes ago; **Refresh models** always asks again.

| Service | Lists |
| --- | --- |
| Ollama | the models it has pulled |
| LM Studio | the models it has downloaded |
| OpenAI-compatible services | the service's model list |
| Anthropic | a built-in list of Claude models |
| llama.cpp, a KoboldCPP you run | the model currently loaded |
| KoboldCPP run by Serene Pub | the model files in its folders |
| Local ONNX | the recommended list plus what you added |
| Stable Diffusion | its checkpoints |

A model the service stops listing is marked **no longer listed**, not deleted, so its settings survive if it comes back. If the service can't be reached, nothing changes: the connection says _Couldn't list models_ and its models stay as they were. A model you don't want offered can be switched **off** in its view instead.

### A model that is no longer listed is unavailable everywhere

A model that is no longer listed can't be used anywhere, and every screen says so: the row, the connection, the status strip and job tiles, **Admin › Defaults**, and the pipeline's **Model** setting. A run that would use it stops with a sentence pointing at the fix, rather than sending a request the service would reject. Its settings are kept: refresh once the service offers it again, or pick another model.

### Adding and removing by hand

Where a service's list can be incomplete, the connection's Models tab offers **Add by name**: the model's id exactly as the service expects it, and an optional display name. Use it for a service that publishes no list, or a new model the list hasn't caught up with. Models added this way can be removed from their own view.

Ollama and the KoboldCPP run by Serene Pub have no **Add** or **Remove**: their models are pulled, downloaded and deleted in their own view, and the list follows. On a local ONNX connection, models are switched on or off, and downloaded or removed from disk.

### Choosing a pair

- **Admin › Defaults** sets one pair per job. Choosing a connection picks its first usable model; the model picker beside it changes that.
- A pipeline configuration's **Model** setting picks a pair the same way, as one choice (see [Pipelines → Model and sampling](./pipelines.md#model-and-sampling)).
- A model's own **Set as default…** makes it the default for one job it can do, or all of them.
- A model that is deleted leaves whatever used it unset, with a message naming the fix. A model that is switched off or no longer listed is refused when used, rather than quietly replaced with another.

## Sampling configs

A **sampling config** is a named set of generation settings: how adventurous or predictable a model's writing is, how long a reply may be, how much of the story it is sent. Defaults name one per job, and a pipeline configuration can pick a different one for any of its model calls.

Open **Sampling** from the rail, choose **Large Language Models** or **Image Generation** (the two have nothing in common, so a config belongs to one), and pick a config. Built-in configs are marked `*` and the current default with a star. The toolbar has **Update** (save), then **Reset unsaved changes** and **Clone to a new config** as icon buttons, and **⋯** for **Set as default** and **Delete** (not for built-ins).

**Admin › Models › Sampling** lists every config as a table with its main values, what uses it, and whether it is built in, with search, filters and bulk delete. Built-in configs are read-only there; **Duplicate** makes an editable copy. Deleting a config that a default uses leaves that default unset, and requests for that job then use the service's own settings.

### Adjustable parameters

Each parameter has a checkbox and, when ticked, a slider or text box. For text there are about thirty, grouped as Core (temperature, top P, top K, min P, typical P, seed), Repetition (repetition, frequency and presence penalties, and more), Mirostat, XTC, DRY, Dynamic temperature, a KoboldCPP-only group (top A, N-sigma, smoothing factor, banned tokens), Reasoning, and Budget (response tokens, context tokens, stop sequences, logit bias). For images: steps, CFG scale, width, height, batch, seed, sampler, scheduler, CLIP skip and denoise.

**Response Tokens** is the longest reply allowed. **Context Tokens** is how much of the story, lore and instructions can be sent; set it to what your model supports. Each has **Unlock max** for unusually long-context models.

### Switching a parameter on and off

A parameter's checkbox decides whether it is sent at all. Unticked, the value is remembered but not sent, and the service uses its own default. Those defaults are not always neutral: Ollama, for example, applies its own repeat penalty, top K and top P to any request that doesn't name them.

A ticked parameter may still not reach a given service, because not every service understands every setting (Anthropic accepts only temperature, top P, top K and response tokens). Those are left out of the request and noted, never an error. An administrator can see exactly what was sent in the run inspector's **Wire** tab (see [Pipelines → Inspecting a run](./pipelines.md#inspecting-a-run)).

### Reasoning

Some models reason before they answer. That reasoning costs tokens and, on most services, counts against the reply length. It shows in the reply's **Reasoning** fold as it arrives, never in the reply itself. Two parameters control it:

- **Reasoning**: `off`, `low`, `medium` or `high`. Unticked, the model does whatever it does by default.
- **Reasoning budget**: a token count, for the services that take one (Anthropic and llama.cpp). With a level and no budget, the level decides: low 2048, medium 8000, high 32000.

Each service is sent this in its own way, and a service that can't express it ignores it. While Anthropic's extended thinking is on it does not accept temperature, top P or top K, so those are left out. Where a service reports reasoning tokens separately, the run inspector shows them.

### Immutable presets

Serene Pub ships nine configs you can't change or delete; clone one to make your own.

For text:

- **Default**: temperature, response tokens (reply length) and context tokens; everything else is left to the service.
- **Disabled**: nothing at all, so the service's own settings apply.
- **Precise (Extraction)**: low temperature, tighter top P and top K, and reasoning off, for steps that extract facts rather than write.
- **Background**: the same values as Precise, named for steps nobody reads, such as planning, record-keeping and summaries. Adventure's planner and state keeper use it.

For images, one per model family, because a model drawn at the wrong size duplicates and smears its subject:

- **SD 1.5**: 512×512, 25 steps, CFG 7. The default for images.
- **SDXL**: 1024×1024, 30 steps, CFG 6.
- **SD 3.x**: 1024×1024, 28 steps, CFG 4.5.
- **Flux**: 1024×1024, 20 steps, CFG 1.
- **Turbo / Distilled**: 512×512, 4 steps, CFG 1. For SDXS, SD-Turbo, SDXL-Turbo, Lightning and LCM models.

CFG 1 on Flux and Turbo is deliberate: those models are made to run at that setting. Sampler and scheduler are left unset, so the program uses whatever it already uses. A config's name must be unique within text or within images.

An online image service such as OpenAI's has no steps or CFG; its size and quality options are on the connection instead.

## Chat messages or text completion

A model can be sent the story in one of two ways:

- **Chat messages**: a list of messages, each marked as system, user or assistant. Online services and most programs work this way, and it is the right choice for nearly everyone.
- **Text completion**: one long piece of text laid out with the model's own markers for whose turn it is. This needs a [Prompt Format](#prompt-formats-and-token-counters) that matches the model.

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

When a connection sends a text completion, its **Prompt Format** decides how the story is laid out for the model:

- **Vicuna (Default)**
- **ChatML**
- **Basic / Legacy**
- **OpenAI**
- **LLaMA2/Mistral Instruct**
- **Claude (Human/Assistant)**
- **Instruct (Alpaca)**

The wrong format usually shows up as a model that ignores whose turn it is or writes past where it should stop. If a text-completion connection writes garbled or run-on replies, check this against the format the model was trained on (its page on Hugging Face usually says). A prompt format is not the same thing as a [prompt](./pipelines.md#prompts): the prompt says _what_ to write, the format says how it is laid out.

Every connection also has a **Token Counter**, which Serene Pub uses to estimate how much story and lore fits within the sampling config's **Context Tokens**. Nothing about it is sent to the model. **Estimate** (the default) is a quick approximation that suits most models. The others are for a model family. **OpenAI GPT-2/3**, **OpenAI GPT-3.5 Turbo**, **OpenAI GPT-4**, **OpenAI GPT-4o**, **Llama**, **Llama 3** and **Mistral/Mixtral** count with that family's own tokenizer. **Cohere (approximate)** counts with Gemma's tokenizer, because no Cohere tokenizer ships with Serene Pub. **Anthropic Claude**, **Google Gemini/PaLM** and **Google Gemma** are estimates. A matching counter gives a more accurate fit; a mismatched one can send too much or too little.

**KoboldCPP** (both kinds) and **llama.cpp** can count with the loaded model's own tokenizer, and Serene Pub asks them to: the counts are kept per piece of text, so from the second turn on almost every count is the model's own, and the token counter only estimates what has not been counted yet (scaled up by how far it has been off). This matters because a prompt the estimate thought would fit, and the server finds too long, is cut by the server from the front, on every turn. The other services publish no tokenizer and keep the estimate.

A model can override its connection's prompt format and token counter in its own view.

## Stop sequences

A stop sequence is a piece of text that ends the reply the moment the model writes it. Each request gets one list, from three sources:

- **Format**: the prompt format's own markers, such as ChatML's `<|im_end|>`.
- **Speaker**: a `Name:` label for every character and persona in the scene except the one speaking, so the model stops before writing someone else's line.
- **Your own**: whatever you put in the sampling config's **Stop sequences**, one per line. `{{char}}` and `{{user}}` are filled in.

Which of these are sent depends on how the connection sends the story:

| Sent as | Format | Speaker | Your own |
| --- | --- | --- | --- |
| **Text completion** | sent | sent | sent |
| **Chat messages** | held back | sent when messages carry name labels | sent |

Format markers mean nothing in a list of chat messages, and some services let them override the model's own stopping point, cutting replies short, so they are held back. Speaker labels are still useful in chat messages when each message starts with a name, which the default context template does.

Some services ignore stop sequences on chat messages. So Serene Pub also cuts a reply at the first line that starts with another participant's label. Only the start of a line counts, never the reply's first line, so a name mid-sentence is kept.

When a reply runs on or stops too soon, the reply's **What actually fired** shows a **Stops** row: each stop sequence, whether it was sent or held back and why, and which one the model hit where the service reports it.

## Streaming

Streaming shows a reply as it is written rather than all at once. Each connection has a **Stream** setting. Each model call in a pipeline also has a **Streaming** setting: **Automatic** (the default) follows the connection, and **Off** waits for the whole answer. Off suits steps nobody watches, such as planning, record-keeping or summaries; some services answer those faster and report their token use more fully. Automatic never turns streaming on for a connection that has it off.

## Everyday management

- **Test** on a connection's status card checks the address and key before you rely on it, and shows the service's own error when it fails.
- **Defaults are per job.** **Use for chat**, **Use for images**, **Use for embeddings**, **Make active** and **Set as default…** all set the default for one job.
- **The KoboldCPP run by Serene Pub can't be used while it is switched off.** Switched off with its files kept it says _Offline_, and **Start** switches it back on; with nothing set up it says _Not installed_ with **Set up**.
- **Deleting asks first** and says what goes with it. A model that a job's default still names can't be deleted from disk until you pick another.
- **Unsaved changes** in Connections and Sampling are kept until you save or discard; switching away asks first.
