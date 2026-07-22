# Connections

Connections tell Serene Pub how to reach a language model — which backend, which model, which API key, and how requests should be shaped. This page covers all seven connection types, the KoboldCPP Manager and Ollama Manager sub-systems for running local models, and the related Sampling Configs, Context Configs, Prompt Formats, and Token Counters that control how a connection actually generates text.

## Overview

The **Connections** sidebar (opened from the main navigation, admin-only) is where you create, edit, test, and delete connections. Alongside it in the nav are three related admin-only sidebars — **Sampling**, **Contexts**, and **Prompts** — plus, when enabled, **KoboldCPP Manager** and **Ollama Manager**. All of these live behind the admin gate: non-admin users benefit from whatever connection/sampling/context/prompt an admin has set as the system default, but can't open these sidebars themselves. [Prompt Configs](./prompt-configs.md) (the "Prompts" sidebar) is covered on its own page since it's a large topic in its own right; this page focuses on Connections, Sampling Configs, and Context Configs.

Each connection is a named record holding a **type** (which backend adapter to use), a **Base URL** and/or **API Key** where applicable, a selected **Model**, a **Prompt Format**, a **Token Counter**, and a bag of type-specific **Advanced Settings** (stream mode, chat-vs-completion mode, and so on). Exactly one connection can be marked as the system's default (a star icon in the sidebar), and individual Chat Prompts or chats can override it — see [Prompt Configs](./prompt-configs.md) and [Chats](./chats.md) for how that override chain resolves.

Creating a connection is done via the **+** button (or Ctrl/Cmd+N) in the Connections sidebar, which opens a **Create New AI Connection** modal: enter a name, pick a **Connection Type** from the dropdown (each option shows a difficulty rating and a short description), and for **OpenAI Chat** specifically, also pick a **Service Preset** (see below). The editor tracks unsaved changes and will prompt before you switch connections, close the sidebar, or discard edits; a refresh icon reverts to the last-saved values, and a trash icon deletes the connection (with a confirmation modal).

## Connection Types At A Glance

Serene Pub ships seven connection types, each with its own form and its own difficulty rating (shown in the New Connection modal):

| Type                  | Label              | Difficulty                                 |
| --------------------- | ------------------ | ------------------------------------------ |
| `lmstudio`            | LM Studio          | Beginner (GUI) - Minimal setup required    |
| `ollama`              | Ollama             | Beginner (No GUI) - Minimal setup required |
| `openai`              | OpenAI Chat        | Beginner - Nothing to install              |
| `llamacpp_completion` | Llama.cpp          | Intermediate - Not for beginners           |
| `koboldcpp`           | KoboldCPP          | Beginner (GUI) - Simple setup              |
| `koboldcpp_managed`   | KoboldCPP Manager  | Beginner (GUI) - Managed by Serene Pub     |
| `anthropic`           | Anthropic (Claude) | Beginner - Nothing to install              |

Every form shares a similar skeleton — a **Test Connection** button that reports "Test: Okay!" or "Test: Failed!" (with the underlying error message shown below it), a **Token Counter** dropdown, and a collapsible **Advanced Settings** section holding the Base URL and stream/behavior toggles. Forms that talk to a chat-completion API also expose a **Use Chat Mode** toggle; when it's switched off, a **Prompt Format** dropdown appears so you can pick how the raw text prompt is assembled instead.

## LM Studio

The LM Studio form has a **Model** dropdown (populated by a **Refresh Models** button that queries LM Studio's REST API) and a **Test Connection** button. Advanced Settings hold the **Base URL** (default `ws://localhost:1234` — note LM Studio's default here is a `ws://` URL, not `http://`), a **Use Chat Mode** checkbox, a **Stream** checkbox, and a **Keep Alive (seconds)** field (default 60) controlling how long LM Studio keeps the model resident after a request. LM Studio's REST API must be enabled in LM Studio's own settings before Serene Pub can reach it.

## Ollama

The Ollama connection form has a **Model** dropdown populated via **Refresh Models**, plus **Test Connection**. Advanced Settings expose the **Base URL** (default `http://localhost:11434/`), a **Keep Alive** control split into a number field and a unit dropdown (`ms` / `s` / `m` / `h`, default `300ms`), and three switches: **Use Chat Mode**, **Stream**, and **Think** (passes Ollama's `think` flag for reasoning-capable models). This connection type talks to a manually-installed, already-running Ollama server — for browsing, pulling, and deleting Ollama models from inside Serene Pub, see [Ollama Manager](#ollama-manager) below, which is a separate admin sidebar from this connection form.

## OpenAI Chat & Compatible Endpoint Presets

OpenAI Chat is Serene Pub's generic OpenAI-compatible connection type, meant for the real OpenAI API as well as any of the many services that mimic its chat-completion schema. Its form has a **Model** dropdown (via **Refresh Models**), **Test Connection**, a **Base URL** field, and an **API Key** field (password-masked). Advanced Settings hold a **Stream** switch and a **Prerender Prompt** switch — when Prerender Prompt is on, a **Prompt Format** dropdown appears so the prompt is rendered to text client-side before being sent as a single chat message, rather than sent as native multi-message chat.

Because so many providers speak this same protocol, creating a new **OpenAI Chat** connection shows an extra **Service Preset** dropdown in the New Connection modal, pre-filling the Base URL and a sensible Token Counter/Prompt Format for each:

| Preset            | Base URL                                 |
| ----------------- | ---------------------------------------- |
| Empty             | _(blank — fill in your own)_             |
| Ollama            | `http://localhost:11434/v1/`             |
| OpenRouter        | `https://openrouter.ai/api/v1/`          |
| OpenAI (Official) | `https://api.openai.com/v1/`             |
| LocalAI           | `http://localhost:8080/v1/`              |
| AnyScale          | `https://api.endpoints.anyscale.com/v1/` |
| Groq              | `https://api.groq.com/openai/v1/`        |
| Together AI       | `https://api.together.xyz/v1/`           |
| DeepInfra         | `https://api.deepinfra.com/v1/openai/`   |
| Fireworks AI      | `https://api.fireworks.ai/inference/v1/` |
| Perplexity AI     | `https://api.perplexity.ai/v1/`          |
| KoboldCPP         | `http://localhost:5001/v1/`              |

These presets only set the initial Base URL, Prompt Format, and Token Counter — you can change any of them afterward, and you'll still need to supply an API key for services that require one.

## Llama.cpp

Llama.cpp connects to `llama-server`'s completion API. It's the simplest form: a **Test Connection** button, a **Prompt Format** dropdown (always visible — this connection type is text-completion only, with no chat-mode toggle), a **Token Counter** dropdown, and Advanced Settings holding just the **Base URL** (default `http://localhost:8080/`) and a **Stream** checkbox. There's no model picker or API key field — llama-server is expected to already have a model loaded. Its "Intermediate - Not for beginners" difficulty rating reflects that you're expected to build/run `llama-server` yourself.

## Anthropic (Claude)

The Anthropic form has a **Model** dropdown (via **Refresh Models**), **Test Connection**, a **Token Counter** dropdown, and an **API Key** field (placeholder `sk-ant-...`). Advanced Settings hold a **Stream** switch and an **Extended Thinking** switch — enabling it reveals a **Thinking Budget Tokens** field (1024–32000, default 8000) controlling how many tokens Claude may spend thinking before responding. Extended thinking requires a Claude 3.7+ model. The default connection preset points at `https://api.anthropic.com` with model `claude-sonnet-4-5` and (notably) an `OpenAI`-style default Prompt Format rather than the `Claude` one, since Anthropic responses go through native chat mode by default rather than a rendered text prompt.

### Where the API keys come from

For OpenAI Chat and Anthropic, obtain a key from the respective provider's console (`platform.openai.com` / `console.anthropic.com`, or the equivalent page for whichever OpenAI-compatible service you're using) and paste it into the connection's API Key field. Keys are stored per-connection, so you can run multiple connections against the same provider with different keys or models.

## KoboldCPP (Remote)

The plain **KoboldCPP** connection type talks to a KoboldCPP instance you run and manage yourself — either on the same machine or a remote one — via KoboldCPP's native API. If the [KoboldCPP Manager](#koboldcpp-manager) is enabled system-wide, this form shows a warning banner suggesting you use a **KCPP Manager** connection instead, unless this particular connection is deliberately pointed at a _different_ KoboldCPP instance than the one the manager controls.

The form has a **Test Connection** button, a **Prompt Format** dropdown (shown only when Use Chat Mode is off), a **Token Counter** dropdown, and an Advanced Settings section with the **Base URL** (default `http://localhost:5001`) plus a long list of KoboldCPP-specific request options, all as toggle switches unless noted:

- **Use Chat Mode** — use OpenAI-style chat completion instead of raw text completion.
- **Stream** — stream tokens as they're generated.
- **Use Memory** — when on, reveals a **Memory Text** textarea whose contents are forcefully prepended to every prompt sent to this connection.
- **Trim Stop Sequences** — strip stop sequences out of the returned text.
- **Render Special Tokens** — render special/control tokens in output instead of hiding them.
- **Bypass EOS Token** — ignore the end-of-sequence token so generation isn't cut short by it.
- **Retain Grammar State** — keep GBNF grammar state between requests.
- **Return Logprobs** — request per-token log probabilities.
- **Replace Instruct Placeholders** — substitute instruct-template placeholders in the prompt.
- **Thinking / Reasoning** — a three-way Auto / On / Off control (default Auto, which lets the model's own template decide) for reasoning-capable models.

### Power-user note: KoboldCPP request options

These switches map directly to fields in KoboldCPP's own generation API, so they're most useful when you already know what a given KoboldCPP build supports. Toggling **Use Memory** is a convenient way to force-inject setting/world notes ahead of the assembled prompt without touching a Context Config. **Bypass EOS Token** combined with a hard **Response Tokens** cap (in the active Sampling Config — see below) is a common trick for forcing longer generations out of models that like to stop early.

## KoboldCPP Manager

KoboldCPP Manager is a full sub-system, separate from the plain KoboldCPP connection type above, for letting Serene Pub own the entire lifecycle of a local KoboldCPP install: downloading the binary, downloading GGUF models, starting/stopping the process, swapping which model is loaded, and surfacing live performance stats. It's enabled by an admin from System Settings; once enabled, a **KoboldCPP Manager** icon appears in the main left navigation (admin-only) opening its own sidebar.

### Choosing Managed or External mode

The first time you open the KoboldCPP Manager sidebar, you're shown a setup screen with two choices:

- **"Let Serene Pub manage it"** (Recommended) — automatically download a KoboldCPP binary and let Serene Pub start, stop, and load models automatically. This is **Managed mode**.
- **"I'll manage it myself"** — start KoboldCPP yourself and connect Serene Pub to the running instance via URL. KoboldCPP's `--admin` API is required for integration. This is **External mode**.

Choosing Managed mode takes you straight into the binary variant picker (below). Choosing External mode shows a **Connect to KoboldCPP** screen where you enter the **Server URL** of your already-running instance and click **Save & Connect** (or **Test** to just check reachability) — your KoboldCPP process must have been started with `--admin` for model-swap and status features to work. A **Reconfigure** button (in the Settings tab, or a **Back**/**Switch to Managed Mode** option on the setup screens) lets you reset the mode and start over.

**Test** always checks whatever URL is currently typed into the field — including an edit you haven't saved yet — rather than re-checking the last-saved address. A failed test shows a **"Connection test failed"** toast with the specific error returned by the server (or a generic reachability message if none is available), instead of failing silently.

### Downloading the KoboldCPP binary

In Managed mode, the **Download KoboldCPP** screen lets you pick a **Version** (defaults to "Latest", or choose a specific tagged GitHub release) and then choose a **build variant**, grouped by platform (Linux, Windows, macOS, Other) — each variant shows its filename, a short description, and its download size. Below the variant list is a **Download directory** field, pre-filled with a default directory and editable if you want the binary stored somewhere else.

The default download directory is `<app data dir>/koboldcpp`, where the app data directory is either the `SERENE_PUB_DATA_DIR` environment variable (common in Docker/self-hosted deployments) or the OS-standard app-data path if that variable isn't set. This same directory also becomes the **Admin Directory** KoboldCPP uses for its `--admindir`-jailed config reload files, so the Manager needs write access to it for both the initial binary download and every later model-load/reload.

Clicking **Download & Start** begins the download; progress (bytes downloaded / total, with a **Cancel** button) is shown inline. When the download finishes successfully, Serene Pub automatically marks the binary as installed and **auto-starts it as a subprocess** — you'll see "Download complete — KoboldCPP is starting…" before the sidebar switches to the main tabbed view. If either the download or the auto-start fails, the failure reason is shown directly in this screen (for a download failure) or in the **Performance** tab's status card (for a start failure) — see [Troubleshooting](#troubleshooting-download-or-start-failures) below.

### Models tab

The **Models** tab lists every GGUF model file present in the configured Models Directory (set in the Settings tab). Each model card shows its name, whether it's currently loaded (a "Loaded" badge), and action buttons: **Set Default** / **Default** (creates or points a **KoboldCPP Manager**-type connection at this model and marks it the system default), an **Edit** gear icon (jumps to that model's connection in the Connections sidebar, if one already exists), and **Delete** (removes the file from disk — blocked if the model backs the current default connection, with a toast explaining why). A search box filters the list by name, and a refresh button re-queries both the model list and the connections list.

### Available and Downloads tabs

The **Available** tab is where you find new models to download — a **Recommended** list of curated options (with VRAM-tier badges from "Ultra Budget" up to "Enthusiast" based on estimated VRAM need) or a **Hugging Face** search box for GGUF repos. Picking a model opens a **Select Quantization** modal listing each available quant file with its size; Q4*K_M is flagged as "Recommended" when present. Starting a download switches you to the **Downloads** tab, which shows active downloads with progress bars and a per-item **Cancel** button, plus a **Completed** section with a **Clear History** button. Model downloads (GGUF files into the Models Directory) are a separate download queue from the KoboldCPP \_binary* download described above — both have their own progress UI but work the same way under the hood.

### Performance tab: live status and model lifecycle

The **Performance** tab is the operational heart of the Manager. In Managed mode it shows a subprocess status card with a colored dot (running/starting/stopped/crashed/stopping), the process's **PID** when running, and **Start**/**Stop** buttons. If the process failed to start or crashed, the actual error message is displayed directly under the status card — this is the same surface described in the troubleshooting section below. It also shows the **Loaded model** (name plus context size once known), an **Unload** button to free it from memory without stopping the whole process, whether **Admin mode** is active on the running instance, and which **Binary** variant/directory is configured. Below that, a **Performance** panel (present for both Managed and External modes) shows an **Idle/Busy** status badge, average generation and prompt-processing speed in tokens/sec, stats for the **Last Request** (tokens processed, prompt time, generation time), and system stats (**Uptime**, **Total generations**, **Queue depth**).

### Settings tab

The **Settings** tab holds everything that configures the Manager itself rather than an individual model:

- **Binary** info (Managed mode) — installed variant, installed version, and latest available version, with **Check for updates** and **Change binary** buttons; an "Update available" badge and an **Update Binary** button appear when a newer release exists.
- **Managed Settings** — **Model unload timer** (seconds of inactivity before the loaded model is unloaded from memory; 0 means never, default 300s/5 min), **Subprocess idle timeout** (seconds before the whole subprocess is shut down when idle; 0 means never, default 1800s/30 min), and **Port** (default 5001; changing it requires a restart to take effect). This Port setting can drift out of sync with the KoboldCPP **Server URL** configured on the [System Settings](./system-settings.md) tab, since the two are edited in different places — if they disagree, a warning appears under the Port field explaining that every request actually goes to the Server URL, not this Port, and the subprocess running here may be orphaned until you reconcile the two.
- **Base URL** (External mode only — in Managed mode the URL is derived automatically from the configured port) and version/update-check info.
- **Models Directory** — the server-side path where GGUF files are stored and downloaded to; this must be set before the Models/Available tabs can list or fetch anything.
- **Active Capabilities** — a badge row reporting what the connected KoboldCPP build supports: Image Gen, Vision, TTS, Speech-to-Text, Embeddings, Multiplayer, Web Search, and Admin API.

### Power-user note: GPU layers, flash attention, batch size, and reload-on-change

Per-model launch settings — **GPU Layers**, **Flash Attention**, and **Batch Size** — aren't set in the Manager sidebar at all; they live on each individual **KoboldCPP Manager**-type _connection_ (see below), because different models on the same machine often need different settings. Whenever a chat generates against a KoboldCPP Manager connection, Serene Pub runs a preflight check before the request: it asks KoboldCPP which model is currently loaded and compares it (plus the last-applied GPU Layers/Flash Attention/Batch Size, and the requested context size from the active Sampling Config) against what this connection wants. If everything already matches, generation proceeds immediately with no reload. If the model, any of those three launch settings, or a larger context size than what's currently loaded don't match, Serene Pub writes a `.kcpps` config file into the Admin Directory and calls KoboldCPP's admin `reload_config` endpoint, then waits (up to 10 minutes) for the new model to finish loading before the request continues. In practice this means: switching which connection/model you're using, or editing GPU Layers/Flash Attention/Batch Size on a connection, causes a model reload the _next_ time that connection is used to generate — not immediately when you save the connection.

### Troubleshooting: no model loaded, or a rejected model load

If KoboldCPP returns a response with `finish_reason: "error"` — which it can do with a normal-looking `200 OK` when no model is actually loaded (or it was started with `--nomodel`) — Serene Pub now surfaces this explicitly as an error ("KoboldCPP rejected the request — is a model loaded?") instead of silently showing a blank reply as if generation had succeeded.

In External mode specifically, if KoboldCPP's admin API rejects a model-load request outright, the error names the likely cause: a mismatched admin password or admin directory between what's configured in this Manager and what KoboldCPP was actually started with (`--admin --adminpassword ... --admindir ...`).

### Troubleshooting: download or start failures

If a binary download fails (network error, or a failure creating the destination directory) or the automatic post-download start fails, the real underlying error message is surfaced to you — a download failure shows inline on the variant-picker/download screen, and a subprocess start failure shows in the **Performance** tab's status card, right under the colored status dot. Don't take a bare "download failed" or "crashed" status as the whole story — read the message underneath it first.

A common cause on Docker and NAS-hosted deployments: the app's data directory (where the default `<app data dir>/koboldcpp` binary/admin directory lives) is a mounted volume, and the container's user doesn't have write access to it. If a download or auto-start is failing right after setup, check that the container can actually create directories and write files inside its mounted data volume before assuming the download itself is broken — this is worth checking first, before re-trying the download or picking a different variant.

## KoboldCPP Manager connections

Once the Manager has a binary installed (or is connected to an external instance with `--admin` enabled) and at least one model downloaded, you create a **KoboldCPP Manager**-type connection to actually use a model in chats — this is the `koboldcpp_managed` connection type from the [types table](#connection-types-at-a-glance) above, distinct from the manager sidebar itself. Its form is disabled (with a warning banner) until the Manager is enabled system-wide.

The form's **Model** dropdown is populated straight from the Manager's model list (with its own refresh button) — picking one here is equivalent to using **Set Default** from the Models tab. Prompt Format, Token Counter, and the same long list of KoboldCPP request switches (Use Chat Mode, Stream, Use Memory, Trim Stop Sequences, Render Special Tokens, Bypass EOS Token, Retain Grammar State, Return Logprobs, Replace Instruct Placeholders, Thinking/Reasoning) all work exactly as on the plain KoboldCPP form. The Base URL field is hidden entirely — Advanced Settings notes "Base URL is managed by KoboldCPP Manager's configured address and isn't set per-connection." Underneath those familiar fields, a **Managed mode launch settings** section holds:

- **GPU Layers** — number of model layers to offload to GPU; `-1` autofits as many as will fit, `0` forces CPU-only. Default `-1`.
- **Flash Attention** — toggle KoboldCPP's flash-attention kernel. Default off.
- **Batch Size** — prompt-processing batch size. Default `512`.

These three are exactly the settings described in the reload-on-change note above — changing them takes effect the next time this connection generates, not instantly.

## Ollama Manager

Ollama Manager is the equivalent local-model dashboard for an Ollama installation, but with an important structural difference from KoboldCPP Manager: Ollama itself is a separate program you install and run outside Serene Pub (there's no KoboldCPP-style "download a binary and let us launch it" flow). Ollama Manager's job is purely to talk to an already-running Ollama server's API to browse, pull, and manage models — the underlying `ollama` process's own lifecycle is entirely outside Serene Pub's control.

When you first open the Ollama Manager sidebar without a working connection, you get a **Connect to Ollama** screen with a link to download Ollama directly from `ollama.com/download`, plus a **Server URL** field (default `http://localhost:11434`) and **Save & Connect** / **Test** buttons. Once connected, the sidebar shows four tabs: **Installed**, **Available**, **Downloads**, and **Settings**.

As with KoboldCPP's setup screen, **Test** checks the URL currently typed into the field (not necessarily what's already saved), and a failed test shows a **"Connection test failed"** toast naming the specific error instead of failing silently.

### Installed tab

Lists every model Ollama currently has pulled, with size, last-modified date, parameter count, and a "Running" badge for models Ollama has resident in memory. Each card has **Set Default**/**Default** (creates or updates an `ollama`-type connection pointed at this model and marks it system default), a settings-gear **Edit** button to jump to that connection, a **View** (external link) button to the model's page on Ollama's library or Hugging Face, and **Delete** (blocked for the model backing the current default connection).

### Available tab

Search for new models to pull, with a source dropdown (**Recommended** curated list, similar VRAM-tier badges as KoboldCPP's recommended list, or search sources for Ollama's library / Hugging Face). A **Manual Download** button opens a modal for pulling an arbitrary model string directly (e.g. a specific tag not surfaced by search). Hugging Face results open a quantization-picker modal before pulling, matching the pattern used by KoboldCPP's Available tab. Clicking install switches you to the Downloads tab.

### Downloads tab

Shows active and completed pulls. Because Ollama models are often split across multiple layer files, each in-progress download shows a **per-file** progress bar (not just one aggregate bar) along with an overall status line and a **Cancel** button; a **Clear History** button removes completed entries from the list.

### Settings tab

Shows the Ollama logo/attribution, **Ollama Base URL** (with Save), current and latest Ollama version with **Check Version** / **Check for Updates** buttons, and an "Update Available" callout linking to `ollama.com/download` when a newer Ollama release exists — since Serene Pub can't update Ollama itself, this only ever links out rather than performing an in-app update.

## Sampling Configs

A Sampling Config is a named, reusable bundle of generation parameters — the knobs that control how "creative" vs. deterministic a model's output is. The **Sampling** sidebar lists saved configs in a dropdown (built-in ones suffixed with `*`, your active one prefixed with a star), with the usual **+** (clone into a new named config), refresh (discard unsaved edits), and delete (disabled for built-ins) toolbar buttons, plus **Update** and **Set Default** (star) buttons.

### Adjustable parameters

The editor exposes nine core parameters, each as a slider with a min/max range and a click-to-edit numeric readout in the middle:

| Parameter          | Range                            | Step |
| ------------------ | -------------------------------- | ---- |
| Response Tokens    | 1 – 4096 (unlockable to 65536)   | 1    |
| Context Tokens     | 1 – 32768 (unlockable to 524288) | 1    |
| Temperature        | 0 – 2                            | 0.01 |
| Top P              | 0 – 1                            | 0.01 |
| Top K              | 0 – 200                          | 1    |
| Repetition Penalty | 0.5 – 2                          | 0.01 |
| Frequency Penalty  | 0 – 2                            | 0.01 |
| Presence Penalty   | 0 – 2                            | 0.01 |
| Seed               | -1 – 999999                      | 1    |

Response Tokens and Context Tokens each have an **Unlock max** checkbox next to the slider that raises their ceiling well past the normal range (to 65,536 and 524,288 respectively) for unusually long-context models.

### Enabling and disabling individual samplers

The **Select Samplers** button switches the sidebar into an "Enable/Disable Weight Options" screen — a checkbox grid, one per parameter, controlling whether that field is sent to the model at all (versus left at the provider's own default and hidden from the editor). This is how the built-in **Disabled** preset works: it ships with Temperature, Context Tokens, and Response Tokens all disabled, letting the connection's native defaults take over for those three.

### Power-user note: how sampling maps to each connection type

Internally, each Sampling Config's fields are translated to the parameter names the target API actually expects — for example `repetitionPenalty` becomes `rep_pen` for KoboldCPP but `repeat_penalty` for Ollama and `repetition_penalty` for LM Studio, and `contextTokens` becomes `num_ctx` (Ollama), `max_context_length` (LM Studio/KoboldCPP), or `n_ctx` (Llama.cpp) — OpenAI Chat and Anthropic don't accept a context-size parameter at all, so it's used only for local token-budget accounting on those types. Not every connection type supports every possible sampler in Serene Pub's data model; for example Anthropic maps only Temperature, Top P, Top K, and Response Tokens and has no equivalent for Frequency/Presence Penalty or Seed — unsupported fields are silently omitted from the outgoing request rather than causing an error.

### Immutable presets

Serene Pub ships two built-in, non-deletable Sampling Configs: **Default** (all nine parameters enabled with standard ranges) and **Disabled** (Temperature, Context Tokens, and Response Tokens turned off, deferring to the connection's own defaults). Both act as safe starting points to clone from via the **+** button.

## Context Configs

Where a Sampling Config controls _how_ a model samples tokens, a Context Config controls _what_ gets sent to it — the full Handlebars-style template that assembles the system block, character/persona data, scenario, lorebook entries, chat history, and any post-history instructions into the final request. The **Contexts** sidebar manages these with the same dropdown/toolbar pattern as Sampling Configs (built-ins marked `*`, **+**/refresh/delete, **Update**, **Set Default**). A **Show Advanced** / **Hide Advanced** button reveals the raw **Template** textarea — this is deliberately hidden by default since editing it means writing valid Handlebars.

**Context Configs are distinct from Prompt Configs.** A Prompt Config (see [Prompt Configs](./prompt-configs.md)) supplies the free-text _instructions_ — writing style, tone, rules — that get slotted into a Context Config's template via the `{{{instructions}}}` variable below. The Context Config is the structural template itself.

### The default template and available variables

The built-in **Default** Context Config's template (shown here verbatim) illustrates every variable and helper Serene Pub currently interpolates:

````handlebars
{{#systemBlock}}
	Instructions: """
	{{#if currentDate}}
		The current date in the story is {{{currentDate}}}.
	{{/if}}

	{{{instructions}}}
	""" Assistant Characters (AI-controlled): ```json
	{{{characters}}}
	``` User Characters (player-controlled): ```json
	{{{personas}}}
	``` Scenario: """
	{{{scenario}}}
	"""

	{{#if worldLore}}
		World lore: ```json
		{{{worldLore}}}
		```
	{{/if}}

	{{#if history}}
		Story history: ```json
		{{{history}}}
		```
	{{/if}}

	{{#if narrativeGraph}}
		Story relationships: ```json
		{{{narrativeGraph}}}
		```
	{{/if}}

	{{#if exampleDialogue}}
		Example dialogue: """
		{{{exampleDialogue}}}
		"""
	{{/if}}
{{/systemBlock}}

{{#each chatMessages}}
	{{#if (eq role "assistant")}}
		{{#assistantBlock}}
			{{{name}}}: {{{message}}}
		{{/assistantBlock}}
	{{/if}}
	{{#if (eq role "user")}}
		{{#userBlock}}
			{{{name}}}: {{{message}}}
		{{/userBlock}}
	{{/if}}
{{/each}}

{{#if postHistoryInstructions}}
	{{#systemBlock}}
		{{{postHistoryInstructions}}}
	{{/systemBlock}}
{{/if}}
````

Available variables include `currentDate`, `instructions` (from the active Chat Prompt), `characters` and `personas` (each rendered as JSON), `scenario`, `worldLore`, `history`, `narrativeGraph`, and `exampleDialogue` (all optional — wrap them in `{{#if ...}}` since they may be empty), `chatMessages` (an array iterated with `{{#each}}`, each entry exposing `role`, `name`, and `message`), and `postHistoryInstructions`. Triple-brace `{{{...}}}` is used throughout to output raw text/JSON without HTML-escaping.

### Why character, persona, and lore data is JSON, not prose

Notice that `characters`, `personas`, `worldLore`, `history`, and `narrativeGraph` are all fenced as ` ```json ` blocks, while `instructions`, `scenario`, and `exampleDialogue` stay wrapped in plain `"""` prose fences. That split is deliberate: the JSON-fenced fields are _facts_ (who someone is, what they know, what happened), and the prose-fenced fields are _directives_ (how to write, what tone to take, what's happening right now) — the template keeps those two kinds of content visibly distinct rather than blending everything into one undifferentiated paragraph.

The reasoning behind serializing the factual side as JSON specifically:

- **Explicit key boundaries reduce attribute bleed.** In a group chat with several characters, prose descriptions concatenated back-to-back are genuinely ambiguous for a model to attribute correctly — a trait mentioned near the end of one character's paragraph can get picked up as belonging to the next one. A JSON array of objects with explicit `name` keys removes that ambiguity structurally, independent of how any individual field is written.
- **It's a base-model competency, not a roleplay one.** The instinct is that RP-oriented models — fine-tuned mostly on the prose/PList-style character cards common across other popular roleplay applications — would parse JSON _worse_ than the format they were tuned on. In practice, RP fine-tuning mostly reshapes _output_ voice and pacing, not _input_ parsing; general structured-data comprehension (reinforced heavily in most base/instruct training via function-calling and tool-use data) tends to survive underneath a lighter RP fine-tune layer largely intact.
- **It keeps the retrieval paths consistent.** Both Context Infill Engines (keyword matching and RAG — see [Embeddings & RAG](./embeddings-and-rag.md)) serialize these same fields to JSON before injection, so switching retrieval modes doesn't also change the shape of what the model sees.

### Block helpers: systemBlock, assistantBlock, userBlock

Three custom block helpers structure the output by speaker role: `{{#systemBlock}}...{{/systemBlock}}` wraps system-level content, `{{#assistantBlock}}...{{/assistantBlock}}` wraps a line spoken by an AI-controlled character, and `{{#userBlock}}...{{/userBlock}}` wraps a line spoken by the player's persona. The connection adapter is responsible for turning these blocks into whatever shape the target API needs — separate chat messages with `system`/`assistant`/`user` roles for chat-mode connections, or concatenated into one flat prompt (using the connection's selected [Prompt Format](#prompt-formats-and-token-counters)) for text-completion connections. An `{{eq role "assistant"}}` helper is used inside the `{{#each chatMessages}}` loop to branch on each message's role.

### Editing and creating custom templates

Because the built-in **Default** config is immutable, customizing the template means cloning it first via the **+** button (which copies the current template into a new, editable config under a name you choose), then editing the **Template** textarea under **Show Advanced**. This is an advanced, all-or-nothing operation — a malformed template can break every connection that uses it, so it's worth testing changes on a low-stakes chat before setting a custom Context Config as your default.

## Prompt Formats and Token Counters

Every connection form that can operate in text-completion mode (Use Chat Mode off, or always for Llama.cpp) exposes a **Prompt Format** dropdown controlling how the assembled Context Config template gets flattened into a single text prompt with the right instruction/turn markers for the target model family:

- **Vicuna** (the default)
- **ChatML**
- **Basic / Legacy**
- **OpenAI**
- **LLaMA2/Mistral Instruct**
- **Claude (Human/Assistant)**
- **Instruct (Alpaca)**

Picking the wrong format for a given model typically shows up as the model ignoring turn boundaries or continuing past where it should stop — if a text-completion connection is producing garbled or run-on output, checking this dropdown against the model's actual training format is a good first step. Prompt Format is unrelated to Chat Prompts (the free-text instruction templates covered in [Prompt Configs](./prompt-configs.md)) despite the name similarity — Chat Prompts supply _what_ to say, Prompt Format controls _how it's laid out_ on the wire.

Every connection form also has a **Token Counter** dropdown, used for client-side token-budget estimates (for example, deciding how much lorebook/history content fits under a Sampling Config's Context Tokens limit) rather than for anything sent to the model itself. Options are **Estimate** (a fast heuristic, the default, and the only sensible choice for models without a dedicated counter below) plus tokenizer-specific counters for **OpenAI GPT-2/3**, **GPT-3.5 Turbo**, **GPT-4**, **GPT-4o**, **Llama**, **Llama 3**, **Mistral/Mixtral**, **Anthropic Claude**, **Cohere**, **Google Gemini/PaLM**, and **Google Gemma**. Picking the counter that actually matches your model gives more accurate context-budget math; picking the wrong one (or leaving it on Estimate for a model with unusual tokenization) can cause the app to under- or over-estimate how much history/lore fits in the remaining context.

## Testing, defaults, and everyday management

A few behaviors apply across every connection type:

- **Test Connection** sends a live probe to the configured Base URL/API Key and reports success or the exact error returned, before you commit to using it anywhere.
- **Set Default** (the star button) marks a connection as the system-wide default used by any chat or Chat Prompt that doesn't specify its own override — see [Prompt Configs](./prompt-configs.md) for the full per-chat/per-prompt override resolution order, and [Chats](./chats.md) for where that plays out during a conversation.
- A **KoboldCPP Manager** connection can't be set as the system default while the KoboldCPP Manager itself is disabled — the **Set Default** button is disabled with an explanatory tooltip in that case.
- Deleting a connection, Sampling Config, or Context Config that's currently in use elsewhere doesn't cascade silently — model deletion from the KoboldCPP/Ollama Manager tabs, for instance, explicitly blocks removing a model that backs the current default connection, and the Connections sidebar's delete action always asks for confirmation first.
- All four sidebars (Connections, Sampling, Contexts, Prompts) track unsaved changes in-memory and will pop a confirmation modal before letting you switch selections, close the sidebar, or navigate away and lose edits.
