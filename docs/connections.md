# Connections

Connections tell Serene Pub how to reach a model — which backend, which model, which API key, and how requests should be shaped. This page covers every connection type (text generation and image generation both), KoboldCPP and Ollama run by Serene Pub for local models, and the related Sampling Configs, Prompt Formats, and Token Counters that control how a connection actually generates.

## Overview

The **Connections** sidebar (opened from the rail, admin-only) is where you create, edit, test, and delete connections, and where a local runtime this pub runs or hosts for it — KoboldCPP, Ollama — is set up and looked after. Alongside it in the nav are **Sampling** and **Pipelines**. There are no separate manager items: a KoboldCPP or Ollama is a connection like any other, and its management lives in that connection's own view (see [KoboldCPP, run by Serene Pub](#koboldcpp-run-by-serene-pub) and [Ollama, managed](#ollama-managed)). Most of this lives behind the admin gate: non-admin users benefit from whatever connection and sampling config an admin has set as the system default, but can't open the sidebar themselves.

Prompts and context templates are configured in the **Pipelines** view rather than here — see [Context Templates](./context-templates.md). This page focuses on Connections and Sampling Configs.

Each connection is a named record holding a **type** (which backend adapter to use), a **Base URL** and/or **API Key** where applicable, one or more **Models** (see [Endpoints and models](#endpoints-and-models)), a **Prompt Format**, a **Token Counter**, and a bag of type-specific **Request settings** (stream mode and so on; chat messages vs. text completion is a capability, not a setting). A connection is never a default by itself: each capability's instance default names a connection **and one of its models** (see [Choosing a pair](#choosing-a-pair)), and an individual pipeline configuration can override it by naming another pair in its connection slot — see [Pipelines](./pipelines.md). A session never overrides the connection: overrides are by model, never by connection (see [Sessions](./sessions.md#which-connection-a-session-uses)).

Creating a connection is done via **Add → A connection** (or Ctrl/Cmd+N) in the Connections sidebar, which opens the **New connection** dialog: enter a name, then pick a **Service** from a single searchable combobox (placeholder text: "Search for a service (Groq, Ollama, Mistral, ...)"). This picker flattens every native connection type _and_ every OpenAI-compatible preset (Groq, OpenRouter, Mistral, and so on — see [OpenAI Chat & Compatible Endpoint Presets](#openai-chat--compatible-endpoint-presets) below) into one list, grouped under **Cloud APIs**, **Local / Self-hosted**, and **Custom** — a preset isn't nested two levels deep behind a separate "OpenAI Chat" type selection; you can search and pick it directly. Whichever service you pick, its difficulty rating and description appear below the picker before you confirm. The view tracks unsaved changes and will prompt before you switch connections or close the sidebar; **Save** and **Discard** appear under the view only while something has changed, and **Delete connection** at its foot deletes it (with a confirmation modal) — see [A connection's view](#a-connections-view).

## The Connections sidebar

Connections is a rail item. Its view lives in the sidebar, can take half the window or the whole of it (Half and Focus), and is the same view on a phone (see [Getting Around](./getting-around.md)). The index answers one question first — _what can this pub do, and what is missing_ — and keeps everything else one tap in.

### The index, top to bottom

- **Add** opens a menu with five doors: **A connection** (the New connection dialog, every service and preset), **KoboldCPP, run by Serene Pub** (installs and manages a local runtime — see [KoboldCPP, run by Serene Pub](#koboldcpp-run-by-serene-pub)), **Ollama** (points at a running Ollama), **A model** (the [model finder](#the-model-finder)), and **A model by name** (for a host that does not list its models). The Android app offers neither KoboldCPP nor Ollama here, as its setup wizard does not: it cannot run a local runtime. Beside it, **Get a model** opens the finder directly. Ctrl/Cmd+N still opens the New connection dialog.
- **Filter** ("Filter N connections") matches a connection's name, service and host, and the names of its models — a connection stays in the list when one of its models matches. The popout beside it narrows to _Everything_, _Needs attention_, the _Defaults ledger_, or the connections that can serve _Chat_, _Images_, _Embeddings_ or _Entities_. The active filter shows as one chip under the row. There is deliberately no dropdown.
- **The status strip** answers the one question that blocks play: _Sessions can reply_, with the model and connection that answer, and **Change** — or _Sessions can't reply yet_ and a gold **Set up chat**. It is the only gold button on the index.
- **Other jobs** is a grid of tiles, one per remaining capability: two across in the sidebar, four in Focus, four shown with a **N more** tile for the rest. Each tile is the button. It says what is registered or _Not set up_, and a one-line description of what the job does. There is deliberately **no fraction**: nine of the ten jobs are optional and off is a perfectly good answer for all nine, so nothing here is scored out of ten.
- **Connections** lists one row per endpoint, in two groups: **On this machine** (_private · free_) and **Services** (_billed per message_). That split is the trade you are actually choosing between, and the header names it once so no row has to.

    A row is its **title**, a **service chip** where that adds something the title hasn't already said, and — on the right, in a column that lines up down the list — its **state** and one **metric**: _Ready · 9 models_, _Running · 4 models_, _Stopped · 2 on disk_, _Needs a key_. Under the title sits the host, or, when something failed, the host's own words. A gold star marks whatever the connection is the instance default for, so the list answers "which of these is my sessions actually using" without opening anything.

    There are five states and **only one of them is red**:

    | State                                                          | Means                                                                                                                                                            |
    | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | **Ready** (green)                                              | It works right now.                                                                                                                                              |
    | **Stopped**, **Offline**, **Not tested**, **Installed** (grey) | Set up, nothing wrong, not running. **Offline** is a KoboldCPP switched off with its install kept; its **Start** switches it back on and starts it in one press. |
    | **Needs a key**, **Not set up**, **N no longer listed** (gold) | It is waiting on _you_. Nothing has failed.                                                                                                                      |
    | **Checking**, **Downloading** (amber)                          | Something is in flight.                                                                                                                                          |
    | **Not working**, **Not reachable**, **Crashed** (red)          | It was finished and it still failed.                                                                                                                             |

    A connection you created a minute ago and haven't given a key to is **gold**, never red: it isn't broken, it's unfinished. A managed KoboldCPP row and the view it opens always say the same thing about the install — _Not installed_, _Not set up_, _Offline_ or the process state — because both read it one way. At most one inline action rides on a row — **Stop**/**Start** on a managed KoboldCPP, **Set up** when it needs a key, **Fix** when something genuinely failed, **Refresh** when models went missing. Tap the row to open the connection. A managed KoboldCPP is one row: its text and image models are both in that row's view.

- **Downloads tray**, at the foot while anything is downloading: a count, an overall bar, and **View** for the [Downloads view](#downloads).

Models no longer appear on the index. They are what a capability view lists and what a connection view manages.

### In Focus

Focusing the view keeps the list at 340px (wider on very large screens) and gives the rest to whatever you opened. With **nothing** open the pane shows every job tile four across, with room for the descriptions the sidebar has to clip; the list beside it keeps the status strip, so whether sessions can reply is answered once and stays answered while you open things. While something else is open, the jobs stay in reach as a row of small chips under the status strip — a dot for their state, one press to open the capability. Back always returns to the screen you came from — a capability, a connection, a connection's tab — and only lands on the index when the trail runs out. Which tab a managed connection was on survives switching between Dock, Half and Focus. With a connection open the pane holds what 400px cannot: its **model table**, with a column each for context window, price in and out per million tokens, and what each model can do, plus a filter and a **hide** control for the models you will never use (hiding is not deleting — the row, its settings and anything pointing at it all survive, and one press brings it back).

### First run

With nothing connected the index is an invitation: "Nothing is connected yet. A session cannot reply until it has a chat model. Where should it run?" and three doors — **On this machine** (KoboldCPP, installed and run by Serene Pub), **A service** (the New connection dialog), or **Something I already run**, which opens the New connection dialog narrowed to **Local / Self-hosted** services — Ollama, LM Studio, llama.cpp, KoboldCPP and the rest — with **Show all** to widen it. A quiet link, **Add a connection**, lists every service and preset for people who know what they want. Under it, a second card names what can be set up later: images, embeddings and named entities.

### Setting up chat

Chat is the one capability that blocks play, so it has a guided path: **On this machine** on the first-run card, or the status strip's gold **Set up chat** while nothing can chat yet, opens **Set up chat** — three steps on one screen, with dots for where you are.

1. **Runtime.** Serene Pub adds a KoboldCPP connection, chooses managed mode for you, and shows the build picker: pick the build for your hardware and it downloads and starts on its own. Already running KoboldCPP yourself? A link opens the connection's own view, where **I'll manage it myself** is still offered.
2. **Model.** The [model finder](#the-model-finder), already scoped to chat and to that KoboldCPP. Get one model.
3. **Done.** The first model to land becomes what sessions reply with — only when no chat default was set, so a pub that already answers with something is never re-pointed. **Start a session** or **Open KoboldCPP**; images, embeddings and named entities can be set up later from their job tiles under **Other jobs**.

The step is worked out from the facts each time, not remembered: close the sidebar with a download running and come back, and you land on the step the pub is actually at. A KoboldCPP you installed from its own view counts exactly the same.

### Defaults at a glance

Setting a default happens in several places: Admin → Defaults, a model view's **Set as default…**, a capability view's **Use**, a KoboldCPP or Ollama connection's **Use for chat**, or — for embeddings and entities — **Make active**. Every one of them is the same registration. The index shows the result three ways that always agree: the status strip and job tiles, the gold **Default** (or **Active**) chip on the model wherever it is listed, and the **Defaults ledger** filter, which turns the list into every transform grouped by output kind exactly as Admin → Defaults groups them, set ones naming their pair, unset ones dashed. An unset chat default is called out, because sessions cannot reply until it is set.

### Admin › Models › Defaults

`/admin/defaults` is where each job — each capability, such as **Chat**, **Image generation**, **Embeddings** or **Named entities** — is given its connection and model. Nothing is picked for you: a job with no default is off. The header shows one status line: in red, how many jobs a pipeline needs that are not set, or in green, that everything a pipeline needs is set. There is deliberately **no fraction** of jobs set up — most jobs are optional and off is a fine answer. The Admin overview's **Models** card says the same.

Jobs are grouped into cards by what they produce (Text, Images, Embeddings, Named entities, …). Each job is one row: its name and a line on what it is for, how many node definitions ask for it, a status (**Set**, **Not set**, **Needed** when a pipeline requires it, **Model gone** when its model is no longer listed by its host), the connection picker, the model picker, and the sampling config. Every connection is listed in the picker; one that cannot do the job is greyed with the reason. A job nothing on the instance can do says so in one line with **Add a connection**; the first job a pipeline needs gets the one filled button. A card's **Sampling for all** writes every job in the group at once; a job's own picker can differ, and says so. Embeddings and entities have no sampling.

The embeddings row carries what the old Settings card did: what it powers, that with none set retrieval falls back to keywords, and **Open embedding connections**. Changing the embedding or entity model here rebuilds the index or re-scans, exactly as the star in the Connections view does.

### The capability view

Tap a job tile (or the status strip's **Change**) and you get that one capability's own screen. At the top is a **status card**: one word for its state (_Ready_, _Not set_, _Downloading_, _Needs attention_), then the sentence that matters — for a ready capability, what happens when it is asked for ("Sessions reply with this model"); for anything else, the consequence the index already named, and the one fix when something is wrong. Under it, the registered pair (connection · model) with an **Admin → Defaults** link, or a dashed "Not set · pick one below".

The second card, **Also able to \<verb\>** — chat, draw, embed, find entities, or _serve \<label\>_ for the six other transforms — lists every model on any connection that can serve this capability and is **here** — a host's listed models, and local ONNX models on disk — each as a kind tile, its name, its connection and one fact (size and dimensions for a local model), with **Use** on the right. A local model still downloading shows without **Use**. Local models not downloaded are not rows: a line under the list says how many more are available to download and opens the finder. The server refuses to make a not-downloaded ONNX model active from anywhere, because nothing fetches one on use. **Use** is the same capability-default registration as everywhere else, so switching the embedding or entity model still opens its costed confirmation (see [Local ONNX models](#local-onnx-models)); the view itself never writes a default behind your back. Tap a row to open that model. When nothing can serve the capability yet the card says so in one line.

At the foot, **Get a \<verb\> model** opens the [model finder](#the-model-finder) already scoped to this capability.

### The model finder

One search box over every recommended list this pub can read and over Hugging Face, reached from the index's **Get a model**, from **Add → A model**, from a capability view, or in place on a managed connection's **Get** tab (where the destination is that connection and the **Download to** row is hidden). It asks four things, in order, as four rows:

1. **The query.** Typing filters the recommended rows at once and, after a short pause, searches Hugging Face for GGUF repos (or, for a local ONNX destination, offers **Add from Hugging Face by id**, because there is no search for those). Hub searches are rate-limited for the whole instance, so a search runs only for what you actually typed.
2. **For** — what the model is for: **Chat**, **Images**, **Embeddings** or **Entities**. Opening the finder from a capability presets this.
3. **Download to** — which managed connection the files land in: your KoboldCPP (text or image directory, decided by the scope), your Ollama, or the local ONNX connection for that lane. Only runtimes this pub can fetch _into_ appear; an API host is never a destination. The first pick is one that can take a file now — a KoboldCPP that is not installed or switched on is passed over for a running Ollama, and says so if you pick it anyway. A line under the pills says where files land and which **memory tier** is set, with **Change** (for GGUFs only — an ONNX model runs on the CPU, so the tier line is not shown).
4. **The results.** **Recommended** rows come from the shared GGUF list (chat and images) or the ONNX lists (embeddings, entities); **Hugging Face** rows come from the search. A row is a kind tile, the repo name, a tier chip from the list (_Ultra Budget_ … _Enthusiast_ for GGUFs, _Fast_ / _Balanced_ / _Best_ for ONNX), and one line of size · parameters · description. A GGUF already on disk or already pulled says so instead of offering **Get**. For an ONNX destination, **Recommended** lists only what can still be downloaded; a line under it counts the models already on this machine and opens them.

**Memory tier.** Every list quotes a size, and a size means nothing until you know what the machine has. **Change** on the tier line asks one question — _How much memory does this machine have?_ — with five answers: 4 GB, 8 GB, 12 GB, 24 GB+, or **Not sure**. With a tier set, the chip on each row whose tier matches turns gold and the first row that outright fits gets the one gold **Get**. **Not sure** is a real answer: it switches every fit hint off rather than guessing. The tier is remembered per browser, not per pub — a phone and a desktop reaching the same install can answer differently.

**Get.** For a GGUF repo, **Get** opens the **quant picker**: one dialog for both KoboldCPP and Ollama listing each available file with its size and, when a tier is set, a second line saying _Fits in 8 GB_, _Tight in 8 GB_ or _Too big for 8 GB_ (_Fits · lower quality_ for Q2/Q3 files). **Recommended** on a row is the list's own claim, never inferred. **Download** starts it; the row shows a bytes bar in place, the [downloads tray](#downloads) appears at the index foot, and nothing anywhere shows a time estimate. For an Ollama library entry the pull starts at once; for an ONNX row the file goes into the local cache and the model becomes available to **Make active**.

### Downloads

Everything this pub is fetching, in one list: GGUFs into KoboldCPP, the KoboldCPP binary itself, Ollama pulls (with a per-file bar, since a pull is several layers), and the local ONNX cache. Open it from the tray at the foot of the index while anything is in flight. A managed connection's **Arriving** tab is this same list, in place — every destination, not just that connection's, because one list is the point. Each row is a kind tile, the file or model name, where it is going, a bytes bar (_1.2 of 4.1 GB_) and **Cancel**. A finished download is listed once so you can see it landed, with **Clear finished** to tidy the list. Bytes and counts only; never a time estimate.

### A connection's view

Tap a connection row and its view opens, titled with its name and its service chip. For a host this pub talks to — OpenRouter, Anthropic, a llama.cpp of your own — the view puts the _whether_ above the _how_: the **status card** first, then the connection's **tabs**.

Every connection has a **Settings** tab. A **Models** tab joins it when the host lists models you can choose between — OpenRouter, Anthropic, LM Studio, OpenAI-compatible hosts. llama.cpp and a KoboldCPP you run yourself report only the one model they were started with, so there is nothing to choose and no Models tab. When a connection has only Settings, there is no tab strip at all — its settings simply show. A connection that isn't finished yet (no API key) opens on Settings, where the key goes.

- **Status card.** One dot, one word, one sentence: _Reachable · Answered just now_, _Not reachable · ECONNREFUSED_, _Listed · Models checked 3 minutes ago_, _Couldn't list models · 401 Unauthorized_, or _Not checked yet · Test it, or ask for its models_. **Test** (then **Test again**) asks the host with the settings as they are on the form, saved or not. Nothing is guessed: a test nobody ran is not a failure. There is exactly one Test button on the screen — the forms' own inline ones were removed in 0.6, because two buttons of the same name in different colours reporting into different places is not two features.

    For a service that needs a key and hasn't got one, the card says so directly — **Needs an API key**, in gold, with _"Nothing has failed — this connection isn't finished"_ and a **Get a key ↗** link straight to that service's key page. It deliberately does **not** report the listing error a missing key obviously caused.

- **Models tab.** How many models the host lists and how many are no longer listed, with **Refresh** (ask again), **Show N models** (in the sidebar, the models as a list in place, each with **Use**; in Focus they are the model table), and — for a host that serves no list — **Add by name**, which takes the identifier exactly as the host expects it and an optional label.
- **Settings tab.** The connection's name, then the thing it cannot work without — the **API key** — then the address. What shapes a request rather than establishing one (prompt format, token counter, streaming, wire mode) sits under **Request settings** inside the form.
- **Advanced and notes.** One disclosure, open when you have written a note: notes, capabilities, the embeddings or entities lane panel, stop scripts.
- **Delete connection** at the foot, with its confirmation.
- **Save** and **Discard** appear only while something has changed, pinned under the view. Leaving with unsaved changes still asks.

Advanced and notes and Delete sit inside the Settings tab.

A managed KoboldCPP or Ollama has its own view instead (below). A local ONNX connection has the same four tabs as they do — **Models** (what is on this machine), **Get** (the model finder, scoped to this connection), **Arriving** (downloads in flight) and **Settings** — see [Local ONNX models](#local-onnx-models).

## Admin › Models › Connections

**Admin › Models › Connections** (`/admin/connections`) manages the same connections the way an admin site does, rather than showing the Connections view again. It opens on a **list of every connection**: name, service, modality, how many models, which defaults it holds, and its state (_Ready_, _Unfinished_, _Broken_, …). Search matches the name, service, address and notes; **Filter** narrows by service, modality, status, or whether it holds a default (beside the table when there is room, behind the filter button in the dock), and a filter's count says what picking it would show. Column headers sort. Search, filters and sort are part of the address (`/admin/connections?service=Ollama&o=-models`), so a filtered list can be linked to. Tick rows and choose **Actions › Delete selected connections…** to delete several at once; the confirmation lists each one with the models that go with it and the defaults it releases. Deleting the KoboldCPP connection also switches KoboldCPP, run by Serene Pub, off, and deleting the last Ollama connection switches Ollama off, as removing them from the Connections view does.

**Add connection** (`/admin/connections/new`) asks for the service and a name. **Save** returns to the list, **Save and continue editing** opens the new connection, and **Save and add another** clears the form for the next one.

A row opens that connection's page (`/admin/connections/<id>`), in sections: **Status** (whether it answers, and **Test**), **Identity** (name and notes; service, type and modality shown), **Endpoint and credentials** (the same form the Connections view shows), **KoboldCPP runtime** for the managed KoboldCPP (its server address, binary and launch settings), **Models** (refresh, add by name, switch a model off, **Use** to make it a default, and download or cancel on a local ONNX endpoint), **Defaults** (which jobs point here, with a link to Admin › Defaults), **Stop scripts**, and **Advanced** (capabilities and the indexing lanes). Name, notes and the service form are saved together with **Save**, **Save and continue editing** (Ctrl+S) or **Save and add another**; everything else saves as you change it. Leaving with unsaved edits asks first. **Delete** asks first and lists what goes with it; **History** opens this connection's entries in Admin › History. Starting, stopping and setting up a runtime, and finding models to download, stay in the Connections view — **Open in Connections** opens it on this connection. Switching the embeddings or entities default to another model rebuilds stored work, so **Use** on such a model sends you to Admin › Defaults, which shows the cost first.

## Connection Types At A Glance

Serene Pub ships seven text-generation connection types, each with its own form and its own difficulty rating (shown in the New connection dialog):

| Type                | Label              | Difficulty                                 |
| ------------------- | ------------------ | ------------------------------------------ |
| `lmstudio`          | LM Studio          | Beginner (GUI) - Minimal setup required    |
| `ollama`            | Ollama             | Beginner (No GUI) - Minimal setup required |
| `openai`            | OpenAI Chat        | Beginner - Nothing to install              |
| `llamacpp`          | Llama.cpp          | Intermediate - Not for beginners           |
| `koboldcpp`         | KoboldCPP          | Beginner (GUI) - Simple setup              |
| `koboldcpp_managed` | KoboldCPP, run by Serene Pub | Beginner (GUI) - Managed by Serene Pub |
| `anthropic`         | Anthropic (Claude) | Beginner - Nothing to install              |

…plus an image-generation type, which the picker's **Image** filter lists and which image nodes in a pipeline draw from (the managed KoboldCPP above draws too — see [KoboldCPP, run by Serene Pub: the connection](#koboldcpp-run-by-serene-pub-the-connection)):

| Type    | Label                               | Difficulty                               |
| ------- | ----------------------------------- | ---------------------------------------- |
| `a1111` | Stable Diffusion (A1111-compatible) | Beginner (with KoboldCPP) - Simple setup |

Most connections serve one kind of model, decided by their type. **Two runtimes serve several:** one **Ollama** connection serves every kind of model its host has, chat and embeddings alike, and there is one connection per Ollama host; the **KoboldCPP run by Serene Pub** is one connection that chats and draws, because it is one process. Each of their models says what it is for — Ollama reports it per model, and KoboldCPP knows from its own model registry — so an embedding model is never offered for chat, nor a Stable Diffusion checkpoint for chat, nor a chat model for images. The separate **Ollama embeddings** and **KoboldCPP, run by Serene Pub (Image)** types are gone: on the next start, existing ones are folded into the Ollama or KoboldCPP connection they belong to, keeping their models and their place as a default. If you had both an Ollama and an Ollama embeddings connection to the same host, you will see two Ollama connections to it — either can be deleted. A KoboldCPP image connection is folded all the way in, with every default and pipeline that named it pointed at the one KoboldCPP connection.

Every form shares a similar skeleton — the credential or address it cannot work without first, a **Token Counter** dropdown, and a collapsible **Request settings** section holding the behaviour switches (and, for most types, the Base URL). There is no Test button on the form: **Test** lives on the connection view's [status card](#a-connections-view). Whether a connection sends chat messages or a rendered text completion is a connection **capability**, not a form switch — see the **Chat messages** / **Text completion** control (auto/on/off, with provenance) in the Capabilities panel; when text completion is in effect, a **Prompt Format** dropdown appears so you can pick how the raw text prompt is assembled.

## LM Studio

LM Studio's models are read from its REST API on their own (see [Models are synced from the host](#models-are-synced-from-the-host)). **Request settings** hold the **Base URL** (default `ws://localhost:1234` — note LM Studio's default here is a `ws://` URL, not `http://`), a **Stream** checkbox, and a **Keep Alive (seconds)** field (default 60) controlling how long LM Studio keeps the model resident after a request. Whether requests are sent as chat messages or a rendered text completion is a connection **capability**, not a form switch — see the **Chat messages** / **Text completion** control (auto/on/off, with provenance shown below it) in the Capabilities panel. LM Studio's REST API must be enabled in LM Studio's own settings before Serene Pub can reach it.

## Ollama

One Ollama connection serves both chat and **embeddings** from the same host: pull an embedding model (`ollama pull nomic-embed-text`) and choose it for Embeddings under **Defaults**, or get one from the connection's **Get** tab, whose scope switches between Chat and Embeddings — each scope has its own recommended list, and Hub search in the Embeddings scope looks only for embedding models. Which of a host's models is which comes from Ollama itself (Ollama 0.6 or newer reports it); on an older Ollama every model is offered for both.

An Ollama connection's models are whatever Ollama has pulled, synced on their own, and pulled or removed in its [managed connection view](#ollama-managed). The form shows the **Base URL** (default `http://localhost:11434/`) up front; **Request settings** hold a **Keep Alive** control split into a number field and a unit dropdown (`ms` / `s` / `m` / `h`, default `5m`) and a **Stream** switch. Reasoning is not a connection setting: it is chosen per step on the sampling config (see [Reasoning](#reasoning)). Whether requests are sent as chat messages or a rendered text completion is a connection **capability** now, not a form switch — see the **Chat messages** / **Text completion** control (auto/on/off, with provenance shown below it) in the Capabilities panel. This connection type talks to a manually-installed, already-running Ollama server — for browsing, pulling, and deleting Ollama models from inside Serene Pub, see [Ollama, managed](#ollama-managed) below — the same connection's own view, not a separate sidebar.

## OpenAI Chat & Compatible Endpoint Presets

OpenAI Chat is Serene Pub's generic OpenAI-compatible connection type, meant for the real OpenAI API as well as any of the many services that mimic its chat-completion schema. Its form has an **API Key** field (password-masked) first, then a **Base URL** field; models come from the service's `/models` listing when it serves one, and can be added by name when it does not. **Request settings** hold the **Token Counter** and a **Stream** switch. The old **Prerender Prompt** switch is gone: sending one rendered text prompt instead of role-tagged chat messages is the **Text completion** capability, and when it is in effect a **Prompt Format** dropdown appears.

Because so many services speak this same protocol, the **Service** picker in the New connection dialog (see [Overview](#overview)) lists every OpenAI-compatible preset directly alongside the native connection types, pre-filling the Base URL and a sensible Token Counter/Prompt Format for each. Selecting any preset here still creates an `openai` (OpenAI Chat) connection underneath — the preset only decides the starting values:

| Preset                                 | Base URL                                                   |
| -------------------------------------- | ---------------------------------------------------------- |
| Custom (OpenAI-Compatible) / Empty     | _(blank — fill in your own)_                               |
| Ollama (via OpenAI-Compatible API)     | `http://localhost:11434/v1/`                               |
| OpenRouter                             | `https://openrouter.ai/api/v1/`                            |
| OpenAI (Official)                      | `https://api.openai.com/v1/`                               |
| LocalAI                                | `http://localhost:8080/v1/`                                |
| AnyScale                               | `https://api.endpoints.anyscale.com/v1/`                   |
| Groq                                   | `https://api.groq.com/openai/v1/`                          |
| Together AI                            | `https://api.together.xyz/v1/`                             |
| DeepInfra                              | `https://api.deepinfra.com/v1/openai/`                     |
| Fireworks AI                           | `https://api.fireworks.ai/inference/v1/`                   |
| Perplexity AI                          | `https://api.perplexity.ai/v1/`                            |
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

Presets tagged **Experimental** are newer additions provided as a starting point but not yet as thoroughly exercised against Serene Pub as the original list above — double-check the Base URL and any service-specific quirks yourself. Every preset only sets the initial Base URL, Prompt Format, and Token Counter — you can change any of them afterward, and you'll still need to supply an API key for services that require one. The Ollama and KoboldCPP presets here talk to those backends' OpenAI-_compatible_ endpoints, a different wire protocol from the dedicated [Ollama](#ollama) and [KoboldCPP (Remote)](#koboldcpp-remote) connection types described below — the picker labels them "(via OpenAI-Compatible API)" to keep the two apart.

## Llama.cpp

Llama.cpp connects to `llama-server`'s completion API. It's the simplest form: a **Token Counter** dropdown, a **Prompt Format** dropdown (shown when text completion is in effect, which is this type's default; llama-server's chat API is available too, through the **Chat messages** capability), and **Request settings** holding just the **Base URL** (default `http://localhost:8080/`) and a **Stream** switch. There's no model picker or API key field — llama-server is expected to already have a model loaded. Its "Intermediate - Not for beginners" difficulty rating reflects that you're expected to build/run `llama-server` yourself.

## Anthropic (Claude)

Anthropic's models come from a built-in catalogue of Claude models, and a newer one can be added by name. The form has a **Token Counter** dropdown and an **API Key** field (placeholder `sk-ant-...`); **Request settings** hold a **Stream** switch. Extended thinking is no longer a connection switch: it is the **Reasoning** level and budget on the sampling config (see [Reasoning](#reasoning)). The connection preset points at `https://api.anthropic.com`, seeds `claude-sonnet-4-5` as the connection's first model, and (notably) an `OpenAI`-style default Prompt Format rather than the `Claude` one, since Anthropic sends chat messages — its only wire — rather than a rendered text prompt.

### Where the API keys come from

For OpenAI Chat and Anthropic, obtain a key from the respective service's console (`platform.openai.com` / `console.anthropic.com`, or the equivalent page for whichever OpenAI-compatible service you're using) and paste it into the connection's API Key field. Keys are stored per-connection, so you can run multiple connections against the same service with different keys or models.

## KoboldCPP (Remote)

The plain **KoboldCPP** connection type talks to a KoboldCPP instance you run and manage yourself — either on the same machine or a remote one — via KoboldCPP's native API. If this pub also [runs its own KoboldCPP](#koboldcpp-run-by-serene-pub), this form shows a warning banner suggesting you use that connection instead, unless this particular connection is deliberately pointed at a _different_ KoboldCPP instance than the one Serene Pub runs.

**Its models are whatever the instance has loaded.** Without KoboldCPP's admin API there is no way to ask what else is on its disk, so the connection lists the loaded text model and, when they are loaded, the image model and the embedding model — each offered only for what it is. Restart KoboldCPP with a different model and, on the next refresh, the old one is marked missing and the new one appears. Image generation and embeddings become available after **Test** confirms the instance has those models loaded.

For **embeddings**, KoboldCPP names the model that answered every request, and Serene Pub checks it: if the instance was restarted with a different embedding model than the one set as the default, requests are refused with both names rather than mixing vectors from two models into your lore and history. Refresh the connection's models and choose the new one — which, like any change of embedding model, rebuilds the index after asking. If you had pointed image generation at this connection's text model, pick its image model instead — the text model is no longer accepted for images.

The form has a **Prompt format** dropdown (shown only when text completion is in effect), a **Token counter** dropdown, and a **Request settings** section with the **Base URL** (default `http://localhost:5001`) plus a long list of KoboldCPP-specific request options, all as toggle switches unless noted. Whether requests are sent as chat messages or a rendered text completion is a connection **capability**, not a form switch — see the **Chat messages** / **Text completion** control (auto/on/off, with provenance shown below it) in the Capabilities panel:

- **Stream** — stream tokens as they're generated.
- **Use Memory** — when on, reveals a **Memory Text** textarea whose contents are forcefully prepended to every prompt sent to this connection.
- **Trim Stop Sequences** — strip stop sequences out of the returned text.
- **Render Special Tokens** — render special/control tokens in output instead of hiding them.
- **Bypass EOS Token** — ignore the end-of-sequence token so generation isn't cut short by it.
- **Retain Grammar State** — keep GBNF grammar state between requests.
- **Return Logprobs** — request per-token log probabilities.
- **Replace Instruct Placeholders** — substitute instruct-template placeholders in the prompt.

The old **Thinking / Reasoning** control is gone from this form; reasoning is chosen per step on the sampling config (see [Reasoning](#reasoning)).

### Power-user note: KoboldCPP request options

These switches map directly to fields in KoboldCPP's own generation API, so they're most useful when you already know what a given KoboldCPP build supports. Toggling **Use Memory** is a convenient way to force-inject setting/world notes ahead of the assembled prompt without touching a Context Template. **Bypass EOS Token** combined with a hard **Response Tokens** cap (in the active Sampling Config — see below) is a common trick for forcing longer generations out of models that like to stop early.

## KoboldCPP, run by Serene Pub

A KoboldCPP this pub runs for you is a connection with a **managed connection view**: the whole lifecycle of a local KoboldCPP install — downloading the binary, fetching GGUF models, starting and stopping the process, swapping which model is loaded, live performance — lives on that connection's own screen, distinct from the plain KoboldCPP connection type above. You add one with **Add → KoboldCPP, run by Serene Pub** (or **On this machine** on a fresh pub's first-run card); that one press switches it on and creates the connection, so there is no toggle to find in Settings first. **Remove KoboldCPP from this pub**, in the view's **⋯** menu, switches it back off; files on disk are left where they are.

The view opens with the connection's title and a teal **KoboldCPP** chip. Until a mode and a binary exist it shows a setup screen and nothing else; once it has them, a **status card** sits at the top — the process state as one dot and one word (_Running_ · _Starting_ · _Stopped_ · _Crashed_), the loaded model, and **Start** or **Stop** — over four tabs: **Models**, **Get**, **Arriving** and **Settings**. Switched off with its install kept, the card says _Offline_ with **Start**, which switches it back on and starts it. Any line the server has not yet answered for is left out rather than guessed at. On the index the row reads the same way: _Not set up · choose how to run it_ until setup is done, then _Stopped · starts on first use · 3 on disk_ or _Running · Nemo 12B loaded_, with **Start** offered only after a crash — a stopped process starts itself on first use.

### Choosing Managed or External mode

The first time you open the view, you're shown a setup screen with two choices:

- **"Let Serene Pub manage it"** (Recommended) — automatically download a KoboldCPP binary and let Serene Pub start, stop, and load models automatically. This is **Managed mode**.
- **"I'll manage it myself"** — start KoboldCPP yourself and connect Serene Pub to the running instance via URL. KoboldCPP's `--admin` API is required for integration. This is **External mode**.

Choosing Managed mode takes you straight into the binary variant picker (below). Choosing External mode shows a screen where you enter the **Address** of your already-running instance and click **Save** (or **Test** to just check reachability) — your KoboldCPP process must have been started with `--admin` for model-swap and status features to work. **Let Serene Pub run KoboldCPP** on that screen goes back to the choice; on a managed install, **Connect to a KoboldCPP I run myself** → **Switch**, at the foot of the Settings tab, moves it to External mode.

**Test** always checks whatever URL is currently typed into the field — including an edit you haven't saved yet — rather than re-checking the last-saved address. A failed test shows a **"Connection test failed"** toast with the specific error returned by the server (or a generic reachability message if none is available), instead of failing silently.

### Downloading the KoboldCPP binary

In Managed mode, the **Choose a KoboldCPP build** screen lets you pick a **Version** (defaults to "Latest", or choose a specific tagged GitHub release) and then choose a **build variant**, grouped by platform (Linux, Windows, macOS, Other) — each variant shows its filename, a short description, and its download size. Below the variant list is a **Download directory** field, pre-filled with a default directory and editable if you want the binary stored somewhere else.

The default download directory is `<app data dir>/koboldcpp`, where the app data directory is either the `SERENE_PUB_DATA_DIR` environment variable (common in Docker/self-hosted deployments) or the OS-standard app-data path if that variable isn't set. This same directory also becomes the **Admin Directory** KoboldCPP uses for its `--admindir`-jailed config reload files, so Serene Pub needs write access to it for both the initial binary download and every later model-load/reload.

Clicking **Download & Start** begins the download; progress (bytes downloaded / total, with a **Cancel** button) is shown inline. When the download finishes successfully, Serene Pub automatically marks the binary as installed and **auto-starts it as a subprocess** — you'll see "Download complete — KoboldCPP is starting…" before the sidebar switches to the main tabbed view. If either the download or the auto-start fails, the failure reason is shown directly in this screen (for a download failure) or under the status card (for a start failure) — see [Troubleshooting](#troubleshooting-download-or-start-failures) below. The binary download is also listed in [Downloads](#downloads) alongside everything else in flight.

### Models tab

The **Models** tab lists every model file the connection can see, under **Text models** and **Image models** once there are both. Each row shows the model's name, the gold **Default** mark for anything it is the default for, and one quiet facts line; **Use for chat** (a text model) or **Use for images** (an image model) registers that model as the chat or image-generation default — the same registration **Admin → Defaults** makes — without loading it: it loads on demand the first time something asks. The row's `⋯` menu has **Model settings**, **Move to image models** / **Move to text models**, and **Delete from disk**, which asks first. A filter narrows the list by name, and the refresh button asks KoboldCPP for its models again.

Which list a file is in comes from its header, not its name: an image model dropped in the text folder is read before it is ever listed, so it lands under Image models and is never offered for chat, and an LLM dropped in the image folder is still recognised as an LLM. When the header can't settle it, **Move to image models** / **Move to text models** is how you say which it is.

KoboldCPP currently holds one model at a time, so asking for a picture unloads the chat model and the next message reloads it; on large models that is minutes each way, not an instant switch.

### Get and Arriving tabs

There is no per-manager catalogue any more. **Get** is the [model finder](#the-model-finder) in place, with this connection as the destination — the same finder, with its scope, memory tier and quant picker, that every other door opens. Which directory a file lands in (the Models Directory, or the Image Models Directory when one is set and the scope is **Images**) is named on the finder's destination line. **Arriving** is the one [Downloads](#downloads) list in place — model downloads and the binary download (separate queues under the hood) beside everything else this pub is fetching.

### The status card: live status and model lifecycle

In Managed mode the status card at the top of the view is the operational heart of the connection: a colored dot and word (running/starting/stopped/crashed/stopping), the process's **PID** and uptime when running, and **Start**/**Stop**. If the process failed to start or crashed, the actual error message is displayed directly under the card — this is the same surface described in the troubleshooting section below. It also names the **Loaded model** (with **Unload** to free it from memory without stopping the whole process, and _Nothing loaded · loads on first use_ otherwise), whether **Admin mode** is active on the running instance, and an **Update available** chip with **Update** when a newer binary exists. A **Details** disclosure opens the performance panel (present for both Managed and External modes): an **Idle/Busy** badge, average generation and prompt-processing speed in tokens/sec, stats for the **Last Request** (tokens processed, prompt time, generation time), and system stats (**Uptime**, **Total generations**, **Queue depth**). In External mode the card instead says whether the address answered, and what version.

### Settings tab

The **Settings** tab holds everything that configures the runtime itself rather than an individual model:

- **Binary** info (Managed mode) — installed variant, installed version, and latest available version, with **Check for updates** and **Change binary** buttons; an "Update available" badge and an **Update binary** button appear when a newer release exists.
- **Managed settings** — **Model unload timer** (seconds of inactivity before the loaded model is unloaded from memory; 0 means never, default 300s/5 min), **Subprocess idle timeout** (seconds before the whole subprocess is shut down when idle; 0 means never, default 1800s/30 min), **Server URL** (where Serene Pub reaches KoboldCPP — usually `http://127.0.0.1:<port>`; the same setting Document View's system settings edit), and **Port** (default 5001; changing it requires a restart to take effect). Port and Server URL are stored separately and can drift apart — if they disagree, a warning under the Port field says that every request actually goes to the server URL above, not this port, and the subprocess running here may be orphaned until you change one so they match.
- **Base URL** (External mode only — in Managed mode it is the **Server URL** under Managed settings) and version/update-check info.
- **Models Directory** — the server-side path where GGUF text models are stored and downloaded to; this must be set before the Models tab or the finder can list or fetch anything.
- **Image Models Directory** — where Stable Diffusion models are stored and downloaded to. **Leave it blank and image models are looked for in the Models Directory**, which is how every installation worked before this field existed — so an upgrade keeps finding every model you already have, exactly where it is. Setting a path never moves anything on disk: new downloads from the Image list land in the new folder, and models still sitting in the Models Directory keep being listed, loaded and deleted from there. Downloads only ever write to the directory for the kind being downloaded.
- **Active capabilities** — a badge row reporting what the connected KoboldCPP build supports: Image Gen, Vision, TTS, Speech-to-Text, Embeddings, Multiplayer, Web Search, and Admin API. **Image Gen** reports what the running process has loaded at that moment, which is a different question from whether an image model is connected — that one is answered in the Models tab's Image list.

### Power-user note: GPU layers, flash attention, batch size, and reload-on-change

Per-model launch settings — **GPU Layers**, **Flash Attention**, and **Batch Size** — aren't in the view's Settings tab at all; they live on the **KoboldCPP, run by Serene Pub** _connection_'s own form (see below), because different models on the same machine often need different settings. Whenever a session generates against the KoboldCPP connection run by Serene Pub, Serene Pub runs a preflight check before the request: it asks KoboldCPP which model is currently loaded and compares it (plus the last-applied GPU Layers/Flash Attention/Batch Size, and the requested context size from the active Sampling Config) against what this connection wants. If everything already matches, generation proceeds immediately with no reload. If the model, any of those three launch settings, or a larger context size than what's currently loaded don't match, Serene Pub writes a `.kcpps` config file into the Admin Directory and calls KoboldCPP's admin `reload_config` endpoint, then waits (up to 10 minutes) for the new model to finish loading before the request continues. In practice this means: switching which connection/model you're using, or editing GPU Layers/Flash Attention/Batch Size on a connection, causes a model reload the _next_ time that connection is used to generate — not immediately when you save the connection. Restarting Serene Pub while KoboldCPP keeps running costs one such reload on the first generation too: the new server has no record of what it loaded, so it reloads the same file and waits for KoboldCPP's listener to go down and come back before sending the request, rather than trusting the old process's answer.

### Troubleshooting: no model loaded, or a rejected model load

If KoboldCPP returns a response with `finish_reason: "error"` — which it can do with a normal-looking `200 OK` when no model is actually loaded (or it was started with `--nomodel`) — Serene Pub now surfaces this explicitly as an error ("KoboldCPP rejected the request — is a model loaded?") instead of silently showing a blank reply as if generation had succeeded.

In External mode specifically, if KoboldCPP's admin API rejects a model-load request outright, the error names the likely cause: a mismatched admin password or admin directory between what's configured on this connection and what KoboldCPP was actually started with (`--admin --adminpassword ... --admindir ...`).

### Troubleshooting: download or start failures

If a binary download fails (network error, or a failure creating the destination directory) or the automatic post-download start fails, the real underlying error message is surfaced to you — a download failure shows inline on the variant-picker/download screen, and a subprocess start failure shows under the status card, right under the colored status dot. Don't take a bare "download failed" or "crashed" status as the whole story — read the message underneath it first.

A common cause on Docker and NAS-hosted deployments: the app's data directory (where the default `<app data dir>/koboldcpp` binary/admin directory lives) is a mounted volume, and the container's user doesn't have write access to it. If a download or auto-start is failing right after setup, check that the container can actually create directories and write files inside its mounted data volume before assuming the download itself is broken — this is worth checking first, before re-trying the download or picking a different variant.

## KoboldCPP, run by Serene Pub: the connection

The managed connection view above _is_ the **KoboldCPP, run by Serene Pub** connection — the `koboldcpp_managed` connection type from the [types table](#connection-types-at-a-glance). Once it has a binary installed (or is connected to an external instance with `--admin` enabled) and at least one model downloaded, its models are what sessions use. Its form is disabled (with a warning banner) if this pub no longer runs KoboldCPP.

The connection's models are the GGUF files in its model directory, synced on their own; **Use for chat** in the view's Models tab is what registers one as the chat default. Prompt Format, Token Counter, and the same long list of KoboldCPP request switches (Stream, Use Memory, Trim Stop Sequences, Render Special Tokens, Bypass EOS Token, Retain Grammar State, Return Logprobs, Replace Instruct Placeholders) all work exactly as on the plain KoboldCPP form. The Base URL field is hidden entirely — Request settings notes "Base URL is the address Serene Pub runs KoboldCPP at, and isn't set per-connection." Underneath those familiar fields, a **Managed mode launch settings** section holds:

- **GPU Layers** — number of model layers to offload to GPU; `-1` autofits as many as will fit, `0` forces CPU-only. Default `-1`.
- **Flash Attention** — toggle KoboldCPP's flash-attention kernel. Default off.
- **Batch Size** — prompt-processing batch size. Default `512`.

These three are exactly the settings described in the reload-on-change note above — changing them takes effect the next time this connection generates, not instantly.

### Images from the same connection

The KoboldCPP connection draws as well as chats: it is one process, and its model manager swaps the model it holds. Its **Models** tab lists **Text models** and **Image models** separately, and each model is only ever offered for what it is — a text GGUF for chat, an image model for images. **Use for images** on an image model registers it as the image-generation default. Its **Settings** tab carries, under the text settings, an **Image generation** section: the two load settings that belong to an image model rather than a text one (the thread count and the quantization level KoboldCPP should load it at), and **Test Generation**, which draws with the current image default.

Loading is deferred exactly as it is for text: the image model is loaded when something asks for a picture, and the request reports a "loading" stage while it happens. Since KoboldCPP holds one model at a time today, that load evicts the chat model and the next message reloads it — the same on-demand swap that already happens between two LLMs, with the same cost.

> **Behaviour change:** KoboldCPP image models are no longer connections of their own. An existing **KoboldCPP, run by Serene Pub (Image)** connection is folded into the KoboldCPP connection on the next start: its models move across, and the image default, any pipeline node that named it, and its image settings all point at the KoboldCPP connection afterwards. Deleting the last model file never removes the KoboldCPP connection — it just has no models until you get one.

## Ollama, managed

Every Ollama connection gets the managed connection view, and each one is managed against **its own host** — its own address, status, models and pulls. Two Ollama connections (this machine and a box on the network, say) are two independent views. Ollama itself is a separate program you install and run outside Serene Pub (there's no "download a binary and let us launch it" flow), so the view only ever talks to an already-running Ollama server's API to browse, pull, and manage models — the `ollama` process's own lifecycle is outside Serene Pub's control, and there is no **Start**. You add one with **Add → Ollama**, or pick Ollama under **Something I already run**. **Remove this connection** removes that one Ollama connection; the others stay.

Ollama has no setup stages. Its **status card** says _Running · 0.30.7 · 4 models_ with an **Update available** chip when Ollama has a newer release (it opens the Settings tab's version line), or **Not reachable** with the address, **Check again**, **Change address** (which opens Settings, where the address is the connection's own Base URL field) and a **Get Ollama** link. On the index each Ollama row reads its own host: _Running · 4 models · localhost:11434_ or _Not reachable · ollama.lan:11434_.

### Models tab

Lists every model this host has pulled — under **Chat models** and **Embedding models** when the host has both. A chat model's **Use for chat** registers that (connection, model) pair as the chat default; an embedding model's **Use for embeddings** registers it as the embedding default, asking first when that would rebuild the index — the same registrations **Admin → Defaults** makes. Each row's menu has **Model settings**, **View on ollama.com** and **Delete from disk**. Deleting removes the model from this host and forgets it on the connections that point at this host; it never deletes a connection.

### Get and Arriving tabs

**Get** is the [model finder](#the-model-finder) in place, pulling into this host (recommended chat or embedding models, Hugging Face search with the quant picker). **Arriving** is the one [Downloads](#downloads) list in place, where an Ollama pull shows a per-file bar because a model is several layers.

### Settings tab

A **Version** line — the host's version, and _0.34.4 available_ when a newer release exists — with **Check for updates**. **Download update** links to `ollama.com/download` only when the host is on this machine; an Ollama on another machine says to update it there. Under it is the connection's own form: its name and its **Base URL**, the one place the address is edited.

## Sampling Configs

A Sampling Config is a named, reusable bundle of generation parameters — the knobs that control how "creative" vs. deterministic a model's output is.

### Categories

The **Sampling** sidebar opens on a category picker, the same way Connections does. Admins can also manage every config from **Admin › Models › Sampling** — see [below](#admin--models--sampling).

- **Large Language Models** — temperature, penalties, context and response budgets: the parameters behind every generated reply.
- **Image Generation** — steps, CFG, size, seed and the rest, shared by every image backend whatever a connection points at.

The two vocabularies have nothing in common, so a config belongs to exactly one of them and is only ever offered where it fits. Pick a category and you get its saved configs in a dropdown (built-in ones suffixed with `*`, the current default prefixed with a star), with the usual **Clone**, **Reset** (discard unsaved edits), and **Delete** (disabled for built-ins) toolbar buttons, plus **Update** and **Set as default**.

### Admin › Models › Sampling

**Admin › Models › Sampling** (`/admin/sampling`) manages sampling configs the way an admin site does, rather than showing the Sampling view again. It opens on a **list of every config**: name, modality (_Text_ or _Image_), its key values (for text: temperature, top P, min P, context and reply tokens; for images: steps, CFG and size — only the ones switched on), how many parameters it sends, what uses it (the defaults it is set for and how many pipelines pick it), and whether it is built in or custom. Sampling configs belong to the instance, not to one user. Search matches the name, modality, and the defaults and pipelines using it; **Filter** narrows by modality, origin, or use (_Holds a default_, _Picked by a pipeline_, _Unused_). Column headers sort, and search, filters and sort are part of the address (`/admin/sampling?modality=image-gen`). Tick rows and choose **Actions › Delete selected sampling configs…** to delete several at once; the confirmation lists each one with the defaults it releases and the pipelines that pick it. Built-in configs are never deleted: the confirmation names them as kept, and if every selected config is built in it only offers **Close**. A default whose config is deleted goes unset, and requests for that job then use the backend's own settings.

**Add sampling config** (`/admin/sampling/new`) asks for a name, a modality and what it starts as — a copy of an existing config of that modality (its default is preselected) or nothing switched on. **Save** returns to the list, **Save and continue editing** opens the new config to tune it, and **Save and add another** clears the form.

A row opens that config's page (`/admin/sampling/<id>`), in sections: **Identity** (name; modality and origin shown), one section per group of parameters it sends (Core, Repetition, Budget, Size, …, with the same controls as the Sampling view), **Used by** (the defaults and pipelines that pick it, with a link to Admin › Defaults), and **Advanced**, closed at first, where parameters are switched on and off. Everything is saved together with **Save**, **Save and continue editing** (Ctrl+S) or **Save and add another**; leaving with unsaved edits asks first, and changing a value back is not an edit. **Delete** asks first and lists what it releases; **History** opens this config's entries in Admin › History. A built-in config is read-only here: **Duplicate** opens the add form with a copy of it (`/admin/sampling/new?from=<id>`). The list's **Open Sampling view** opens the Sampling view beside it.

### Adjustable parameters

Each parameter has its own checkbox and, when switched on, its own control — a slider with a click-to-edit numeric readout for numbers, a text box or one-per-line list for the rest. Ranges, defaults and descriptions all come from the parameter's own declaration, so the editor lists everything the category actually supports rather than a hand-picked subset.

For text generation that is roughly thirty parameters, grouped: Core (temperature, top P, top K, min P, typical P, seed), Repetition (repetition/frequency/presence penalties, repeat-last-N, penalize newline), Mirostat, XTC, DRY, Dynamic temperature (including tail-free sampling), a KoboldCPP-only group (top A, N-sigma, smoothing factor, banned tokens), Reasoning (see below), and Budget (response tokens, context tokens, stop sequences, logit bias).

For image generation: steps, CFG scale, width, height, batch, seed, sampler, scheduler, CLIP skip and denoise.

Response Tokens and Context Tokens each have an **Unlock max** checkbox that raises the slider's ceiling well past the everyday range (to 65,536 and 524,288 respectively) for unusually long-context models.

### Reasoning

A model that reasons before it answers spends tokens nobody reads, and on most services those tokens count against the response limit. Two sampling parameters govern it, so the choice is made per step through the sampling slot rather than per connection:

- **Reasoning**: `off`, `low`, `medium` or `high`. Unchecked, nothing is sent and the model does whatever it does by default. `off` asks the service for no reasoning at all.
- **Reasoning budget**: a token count, up to 32768, for the services that take a number (Anthropic and llama.cpp). With a level and no budget the level sets it: low 2048, medium 8000, high 32000.

What goes on the wire depends on the service: Ollama's `think` (true or false, or the level word for gpt-oss models), an OpenAI-style `reasoning_effort` (`none` for off), Anthropic's thinking block with a budget, llama.cpp's `reasoning_budget` and template switch on the chat wire only, KoboldCPP's thinking flag for on and off. Anything a service cannot express is recorded as an ignored sampler. Anthropic disables temperature, top P and top K while thinking is on, so those are dropped and recorded as ignored, and the Wire tab shows both the reasoning request and the dropped samplers. Where a service reports reasoning tokens separately, the run inspector's reply line shows them beside the completion count.

The shipped **Precise (Extraction)** config sends `off`, and a **Background** config (Precise plus reasoning off) is what the Adventure genre's planner and state keeper use: steps nobody reads should not think out loud.

### Switching a parameter on and off

A parameter's checkbox controls whether it is sent to the backend at all. Unchecked, the value is remembered but left out of the request, and the service uses its own default — so turning a sampler off and on again does not lose what you had set.

Those service defaults are not always neutral. Ollama, for instance, applies a repeat penalty of 1.1, top K 40 and top P 0.9 to any request that does not name them, so the built-in **Default** config, which sends only temperature and the two token limits, is really "temperature plus whatever the backend decides". The run inspector's Wire tab shows exactly which parameters left the app; anything absent there was the backend's call.

A parameter can be switched on and still not reach a given backend: not every connection type understands every sampler (Anthropic, for instance, accepts only temperature, top P, top K and response tokens). Those are dropped from the outgoing request and recorded as ignored rather than causing an error.

### Immutable presets

Serene Pub ships nine built-in, non-deletable configs — four for text generation and five for image generation.

Text generation:

- **Default** — temperature, response tokens and context tokens on; everything else deferring to the backend.
- **Disabled** — nothing switched on at all, so every request goes out with the connection's own defaults.
- **Precise (Extraction)** — low temperature with tightened top P/top K and reasoning off, for structured extraction rather than roleplay.
- **Background** — the Precise values with reasoning off, for steps nobody reads: planning, state keeping, summaries.

Image generation, one per model family — a diffusion model rendered at the wrong size does not degrade, it duplicates and smears the subject, so the size is part of the family rather than a taste setting:

- **SD 1.5** — 512×512, 25 steps, CFG 7. The shipped global default.
- **SDXL** — 1024×1024, 30 steps, CFG 6.
- **SD 3.x** — 1024×1024, 28 steps, CFG 4.5.
- **Flux** — 1024×1024, 20 steps, CFG 1.
- **Turbo / Distilled** — 512×512, 4 steps, CFG 1. Covers SDXS, SD‑Turbo, SDXL‑Turbo, Lightning and LCM.

CFG 1 on Flux and Turbo / Distilled is deliberate, not a placeholder: both are guidance-distilled and burn at higher CFG.

Sampler and scheduler are left unset on every image preset. The valid names are a property of the connection's checkpoint and build, so the only backend-independent answer is "whatever it already uses".

All nine are starting points to clone from. Names must be unique within a modality — "Default" can exist for text generation and for image generation, but not twice for either.

> **Upgrading:** the row previously shown as **Default (Image)** is now **SD 1.5**, and its values changed from 1024×1024 / 25 steps / CFG 5 to 512×512 / 25 steps / CFG 7. An install that left the built-in image default selected will render smaller; pick the **SDXL** preset if 1024² was intended.

These five are a _local diffusion_ vocabulary. A hosted image service — OpenAI's `gpt-image-1`, for instance — has no steps, CFG, sampler or seed at all; it takes a size from a fixed list plus quality and format options. Those live on the connection's own profile, declared by its adapter, rather than in a sampling config, and anything a backend cannot honour is reported as ignored rather than dropped silently.

### Power-user note: how sampling maps to each connection type

Internally, each Sampling Config's fields are translated to the parameter names the target API actually expects — for example `repetitionPenalty` becomes `rep_pen` for KoboldCPP but `repeat_penalty` for Ollama and `repetition_penalty` for LM Studio, and `contextTokens` becomes `num_ctx` (Ollama), `max_context_length` (LM Studio/KoboldCPP), or `n_ctx` (Llama.cpp) — OpenAI Chat and Anthropic don't accept a context-size parameter at all, so it's used only for local token-budget accounting on those types. Not every connection type supports every possible sampler in Serene Pub's data model; for example Anthropic maps only Temperature, Top P, Top K, and Response Tokens and has no equivalent for Frequency/Presence Penalty or Seed — unsupported fields are silently omitted from the outgoing request rather than causing an error.

Context templates — the Handlebars-style templates that assemble the full request sent to a model — are covered on their own page: see [Context Templates](./context-templates.md).

## Prompt Formats and Token Counters

Every connection form that can operate in text-completion mode (selected via the **Chat messages** / **Text completion** control in the Capabilities panel; text completion is Llama.cpp's default) exposes a **Prompt Format** dropdown controlling how the assembled Context Template gets flattened into a single text prompt with the right instruction/turn markers for the target model family:

- **Vicuna** (the default)
- **ChatML**
- **Basic / Legacy**
- **OpenAI**
- **LLaMA2/Mistral Instruct**
- **Claude (Human/Assistant)**
- **Instruct (Alpaca)**

Picking the wrong format for a given model typically shows up as the model ignoring turn boundaries or continuing past where it should stop — if a text-completion connection is producing garbled or run-on output, checking this dropdown against the model's actual training format is a good first step. Prompt Format is unrelated to a step's prompts (the free-text instructions covered in [Pipelines → Prompts](./pipelines.md#prompts)) despite the name similarity — prompts supply _what_ to say, Prompt Format controls _how it's laid out_ on the wire.

Every connection form also has a **Token Counter** dropdown, used for client-side token-budget estimates (for example, deciding how much lorebook/history content fits under a Sampling Config's Context Tokens limit) rather than for anything sent to the model itself. Options are **Estimate** (a fast heuristic, the default, and the only sensible choice for models without a dedicated counter below) plus tokenizer-specific counters for **OpenAI GPT-2/3**, **GPT-3.5 Turbo**, **GPT-4**, **GPT-4o**, **Llama**, **Llama 3**, **Mistral/Mixtral**, **Anthropic Claude**, **Cohere**, **Google Gemini/PaLM**, and **Google Gemma**. Picking the counter that actually matches your model gives more accurate context-budget math; picking the wrong one (or leaving it on Estimate for a model with unusual tokenization) can cause the app to under- or over-estimate how much history/lore fits in the remaining context.

## Stop sequences

A stop sequence is a string that ends the reply the moment the model writes it. Serene Pub composes one list per request, from three sources, and each entry carries the **kind** it came from:

- **`format`** — the stop strings on the connection's **completion template** (the row behind the Prompt Format above). These name the template's own delimiters, such as ChatML's `<|im_end|>` or Vicuna's `### `.
- **`speaker`** — a `Name:` label for every character and persona in the scene _except_ whoever is speaking. The speaker's own name is left out on purpose: the prompt already seeds `Ash: `, and stopping on `Ash:` would return an empty reply from any model that opens by repeating the name.
- **`explicit`** — whatever you type into the reply step's **Stop sequences** parameter, one per line. `{{char}}` and `{{user}}` are interpolated.

**The wire rule.** Which kinds are actually sent depends on the connection's wire mode (the **Chat messages** / **Text completion** control in the Capabilities panel):

| Wire                | `format`  | `speaker`                            | `explicit` |
| ------------------- | --------- | ------------------------------------ | ---------- |
| **Text completion** | sent      | sent                                 | sent       |
| **Chat messages**   | held back | sent when the transcript is labelled | sent       |

A `format` stop names a delimiter of a flat prompt, so on a chat wire it matches nothing and _overrides_ the model's own native stop tokens on servers such as Ollama's OpenAI-compatibility layer, which truncates replies for no gain. Those stay held back.

A `speaker` stop is different, because the labels are usually still there. The default context template renders each turn as `{{{name}}}: {{{message}}}`, so on a chat wire the roles mark where a turn ends while the label _inside_ the message content is what says whose turn the next line is. The prompt ends with a seeded `Ash:` and a model handed that transcript simply carries on writing it, your line included. So when the compiled messages carry inline labels, the labels ride the chat wire too, newline-prefixed (`"\nAsh:"`), because a bare label would match at the very start of a reply that opens by naming somebody and end it before it had said anything. A chat transcript with no inline labels has nothing for them to match, and they stay held back.

Your own stop sequences are your choice rather than the template's, so those ride either wire.

**Where a reply ends.** Some backends ignore a stop list on their chat leg entirely. So whatever came back is also cut at the first line that opens with another participant's label, using the same labels that went out as `speaker` stops. Only line starts count, and never the reply's own first line: a name mid-sentence ("She said Ash: was late") is prose and is kept, and a reply that opens as somebody else keeps its text rather than arriving blank. The speaker's own opening label is stripped once, so a model that repeats the seed does not show it to you.

**The exact request is kept.** Whatever an adapter renders a prompt into on its way to your endpoint is recorded on that turn's run receipt, along with the raw reply, and an administrator can read both in the run inspector's Wire tab (see [Pipelines](./pipelines.md)).

Entries the wire rule holds back are **reported, not discarded**: a reply's **What actually fired** panel shows a **Stops** row listing what was sent (with its kind) and what was held back, each carrying the sentence that decided it, so "my stop sequence did nothing" and "my reply ran on past its turn" are answerable rather than guessed at. Where the backend names the sequence it actually matched — llama.cpp is the only one that reports the word rather than a reason code — that entry is highlighted. A reply that had to be cut at a speaker boundary says so on the same row, naming the label and how much was kept.

## Streaming

Whether a request streams is normally the connection's choice (the **Stream** option on the connection form, whose default differs by service). Each generating node in a pipeline can also override it with its **Streaming** parameter:

- **Automatic** (the default) keeps the connection's answer.
- **Off** sends one request and waits for the whole reply. On an image node it also stops the progress poll, so no previews arrive.

Streaming only helps where somebody is watching tokens arrive, which on a multi-step pipeline is exactly one step: the one that writes the reply. A planner, a state keeper, a summariser or a lore extractor gains nothing from it, and some services answer a one-shot request faster and report their token usage more completely, so **Off** is the right setting for background steps. A step set to **Off** still returns its tool calls, its stop hit and its usage counts; the adapter reads them from the single response instead of the stream. **Automatic** never forces streaming on: a connection whose Stream option is off stays off.

## Endpoints and models

Since 0.6 a connection is an **endpoint** — where the compute is — and the models reachable through it are rows of their own. Anywhere you choose "which connection", you are really choosing an **(endpoint, model) pair**, and both halves are required: a connection has no default model.

Before this, a connection row held a URL, a key, a wire mode, **one** model name and **one** set of capabilities. That conflated two different things. One llama.cpp host serving three GGUFs had to be three connections, each restating the same URL and key; testing one told you nothing about the other two; and probing a vision checkpoint taught the _endpoint_ vision, so every text-only model behind the same host inherited the claim.

### What lives where

| On the endpoint (the connection)            | On the model                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Base URL, API key, connection type / preset | The identifier the service knows it by (what actually goes on the wire) |
| Wire mode (chat vs completion)              | A display name, so four quantisations of one model are tellable apart   |
| Prompt Format, Token Counter                | **Overrides** of the endpoint's Prompt Format and Token Counter         |
| Capabilities the _protocol_ can express     | Capabilities _this checkpoint_ has — layered over the endpoint's        |
| Stop scripts                                | An optional Context window                                              |
| Per-connection notes                        | Offered in pickers or not, and whether its host still lists it          |

Every per-model setting starts blank, and blank means "whatever the connection says".

### Models are synced from the host

You do not add models by hand in the ordinary case. Serene Pub asks each connection's service what it serves and keeps the connection's model list in step with the answer:

- **When it asks.** When the Connections sidebar opens, when you open a connection or a model, when a connection is created or saved, after a successful **Test**, and after a managed Ollama pulls a model or a KoboldCPP run by Serene Pub finishes a download. Automatic checks skip a connection whose listing is less than ten minutes old, so browsing costs nothing; **Refresh models** (on a group's menu, in the connection view, and in the model view) always asks again.
- **What a listing does.** Every model the service names gets a row, enabled, named as the service names it. A model the service has **stopped** naming is marked **not listed** — kept, not deleted, so its overrides and anything registered against it survive its return. A model that comes back is cleared.
- **What a failed listing does.** Nothing to any model. An unreachable host is a fact about the host, so the connection shows "Couldn't list models — …" and its rows are left exactly as they were.
- **Who lists what.** Ollama lists what it has pulled; LM Studio lists what it has downloaded; OpenAI-compatible hosts list `/models`; Anthropic lists a built-in catalogue; llama.cpp and a plain KoboldCPP list the model currently loaded; the managed KoboldCPP process lists the GGUFs in its directory; the local ONNX backends list their catalogue plus anything downloaded to this machine; A1111 lists its checkpoints.

A model you do not want in pickers is switched **off** in its model view rather than removed — a removed model that the host still lists would simply come back on the next refresh.

### A model that is no longer listed is unavailable everywhere

When a listing stops naming a model Serene Pub knows, that model is refused everywhere, and every screen says so:

- the sidebar shows a **Not listed** chip on the row, a warning on its connection's health line, a count in the totals line, and the _Needs attention_ filter gathers them;
- the model view leads with a warning naming since when, what it means, and **Check again**;
- the status strip and job tiles flag a default that points at a missing model;
- **Admin → Defaults** and a pipeline's connection option list it greyed with "no longer listed by its host", and warn beneath the picker when the chosen model is the missing one;
- a run whose resolved pair names it is refused with a sentence pointing at the fix, rather than sent to a host that would answer with its own error.

The model's settings are kept. Refresh once the host serves it again and everything resumes; or pick another model; or remove it.

### Adding and removing by hand

Where the listing can be incomplete, the connection view's models card offers **Add by name**: an OpenAI-compatible host that serves no `/models`, a catalogue that lags a launch, a llama.cpp that lists only what is loaded. Such rows can also be removed from the model view. On an **Ollama** or **KoboldCPP, run by Serene Pub** connection there is no Add and no Remove — models are pulled, downloaded and deleted in that manager, and the list follows it. On a **local ONNX** connection the rows are the recommended list plus anything added by Hugging Face id; a model is switched on or off rather than removed, and its files are downloaded and removed from disk from the sidebar — see [Local ONNX models](#local-onnx-models).

### Choosing a pair

Every picker that names a connection also names a model:

- **Admin → Defaults** registers a pair per capability. Choosing a connection pins its first switched-on, listed model; the model picker beside it changes that.
- A **pipeline's oracle node** (the Connection option on a Reply, Summarize or Image step) stores a pair the same way.
- The **model view**'s _Set as default…_ menu registers that model for one capability it can serve, or for all of them at once.
- Choosing a **different connection clears the model**, always. A model belongs to one endpoint, so carrying it across would leave a selection whose two halves name different connections.
- A model that is deleted releases anything registered against it to an incomplete registration, which resolves as unconfigured with a sentence naming the fix. A model that is _switched off_ or _not listed_ while something still names it is refused at run time with a sentence saying so, instead of quietly running a different model.

## Local ONNX models

The two local connection types — **Local embeddings (ONNX)** and **Local named entities (ONNX)** — run inside Serene Pub with no server to start. Their models are the **recommended list**, fetched from [github.com/SerenePub/serene-pub-onnx-list](https://github.com/SerenePub/serene-pub-onnx-list) (`embeddings.yaml` and `ner.yaml`), cached for a day under the data directory, and backed by a built-in copy when the network is away. The list gives each model a tier (_Fast_, _Balanced_, _Best_), its download size, dimensions or labels, input length, pooling, prefixes, languages and licence, and the sidebar shows those as facts and tags. Entries whose pooling the loader cannot honour are left off. Ids never change, so stored vectors stay valid across list updates.

### Download state and active state are independent

Every ONNX row carries a state that is a fact about the disk, re-checked on every sync:

| State           | Row                             | Action                                      |
| --------------- | ------------------------------- | ------------------------------------------- |
| Not downloaded  | size from the list              | **Download**                                |
| Downloading     | progress bar, "x of y MB"       | **Cancel**                                  |
| On disk         | **On disk** chip, measured size | **Make active** (or none, if it already is) |
| Download failed | the Hub's own sentence          | **Retry**                                   |

Being **Active** — the capability default for that modality — is a separate fact. A row can be active and not downloaded (the row shows it in amber, and _Needs attention_ gathers it), and a download never makes anything active. **Downloading warms the cache only**; the lane loads the active model lazily when it has work and unloads it after its idle timeout, which is set on the connection.

**Make active** is the same registration as **Set as default…** on any other model, so it goes through the same confirmation: the dialog names how many stored vectors will be re-embedded (and across how many lorebooks and sessions), says that retrieval answers from keywords until that finishes, and notes that the previous model stays on disk. There is no time estimate, because nothing measures a rate. When nothing is stored yet, there is nothing to confirm and the switch is immediate. Entities work the same way with re-scanning.

**Cancel** cannot interrupt the file in flight — the ONNX runtime exposes no way to abort a fetch — so the current file finishes first, then the partial download is deleted and the row returns to _Not downloaded_. The row says so while it waits. A download interrupted by a restart is marked failed at boot rather than believed.

### The group, the model view, and the endpoint table

The **group** header shows the active model and whether it is loaded ("Active: bge-small-en-v1.5 · loaded, idle 4 min" or "· on disk, not loaded"), an **Unload** button while it is loaded, and a health line with how many models are on disk, their total size, and the queue's state. Rows are split in two — **On this machine** (on disk, downloading or failed, the active model first) and **Available to download** (grouped by tier, folded away once anything is on this machine); models you added yourself sit under **Added by you**. The footer's **Add from Hugging Face…** takes a Hub id (`org/name`), validates it against the Hub before a row exists — the repo must be public and carry an ONNX export, with a readable hidden size for embeddings or an `id2label` for entities — and adds it as _Not downloaded_. The Hub's own sentence is shown when validation fails.

The **model view** of a local ONNX model leads with its status: for the active model, whether it is loaded, the queue, when it was last used, and **Unload now** (embeddings also offer **Load**); for any other model, its download state and its one action, with the re-embed cost stated beneath **Make active** before you press it. Then **On this machine** (size on disk and **Remove**, which is refused for the active model — make another active first; a model you added can also be removed from the list), **About** (the list's description and facts, with a link to the model on Hugging Face), and, for the active model, the **Lane** — the idle timeout, set on the connection, and whether the model is listed in pickers.

Given desk room, the **endpoint view** shows the same models as a table — size, dimensions or labels, input, languages, state and action — in the same two sections, with the endpoint's settings beneath it. At sidebar width the same two sections are a list of rows, each with its one action (**Make active**, **Download**, **Cancel**, **Retry**).

## Testing, defaults, and everyday management

A few behaviors apply across every connection type:

- **Test** (on the connection view's status card) sends a live probe to the configured Base URL/API Key and reports success or the exact error returned, before you commit to using it anywhere.
- **Set as default…** in a model's view — **Make active** on a local ONNX model — registers that pair as the instance default for a capability it can serve — the same registration **Admin → Defaults** makes — used by any run whose pipeline configuration names no pair of its own. Those are the only two tiers: the configuration's pair, then the instance default — see [Sessions](./sessions.md#which-connection-a-session-uses) for where that plays out during a conversation.
- The **KoboldCPP, run by Serene Pub** connection can't be used while KoboldCPP is switched off. With its install kept, the row and its view say _Offline_ and **Start** switches it back on and starts it; with nothing set up they say _Not installed_ and **Set up**.
- Defaults are per capability. **Use for chat** in an Ollama or KoboldCPP view's Models tab registers the text default; **Use for images** on a KoboldCPP image model registers the image one, and **Use for embeddings** on an Ollama embedding model the embedding one.
- Deleting a connection, Sampling Config, or Context Template that's currently in use elsewhere doesn't cascade silently — model deletion from a KoboldCPP or Ollama connection's Models tab, for instance, explicitly blocks removing the model a capability default names, and the Connections sidebar's delete action always asks for confirmation first.
- These sidebars (Connections and Sampling) track unsaved changes in-memory and will pop a confirmation modal before letting you switch selections, close the sidebar, or navigate away and lose edits.
