<p align="center">
  <img src="docs-assets/readme-header.png" alt="Serene Pub logo" width="1920"/>
</p>

> **⚠️ Serene Pub is in beta! Expect bugs and rapid changes. This project is under heavy development.**

<p align="center">
  <b><a href="docs/">📚 Documentation</a> •
  <a href="https://github.com/doolijb/serene-pub/releases">⬇️ Downloads</a> •
  <a href="https://github.com/doolijb/serene-pub/issues">🐛 Issues</a> •
  <a href="https://discord.gg/3kUx3MDcSa">💬 Discord</a> •
  <a href="https://buymeacoffee.com/serenepub">☕ Buy Me a Coffee</a></b>
</p>

---

# 🦊 Serene Pub

**Modern, Open Source AI Roleplay Chat**

**Play more, tweak less.**

Serene Pub is an open source chat app for AI roleplay and creative writing — built for stories that hold together over the long run. It remembers what's happened, keeps every character honest about what they actually know, and lets you share the story with friends instead of playing alone. Local-first and model-agnostic: run it on your own hardware, or point it at whichever AI provider you like.

**Never run an LLM before? You don't need to know how.** Serene Pub's Setup Wizard can download, install, and run a local model for you in a few clicks — no terminal, no server admin experience, nothing to configure by hand. Prefer a hosted provider instead? Just plug in an API key. Either way you're chatting within minutes.

<p align="center">
  <img src="docs-assets/screenshots/desktop-chat-edit.png" alt="Serene Pub chat screen, showing an active roleplay conversation" width="900"/>
</p>

Most AI roleplay tools either drop you into a wall of raw settings and leave memory and worldbuilding entirely up to you, or lock the whole experience behind a hosted service you don't control. Long stories drift — characters forget what happened chapters ago, secrets slip to people who were never in the room, and playing with friends usually means passing one browser tab back and forth. Serene Pub was built to fix those specific problems: structured memory that actually grows with your story, characters who only act on what they've really seen, and a server you can share with the people you're playing with.

---

## Table of Contents

- [Multiplayer](#-multiplayer)
- [Screenshots](#-screenshots)
- [Features](#-features)
- [Is Serene Pub Right For You?](#-is-serene-pub-right-for-you)
- [Platforms](#-platforms)
- [Quick Start](#-quick-start)
- [Docker](#-docker)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🤝 Multiplayer

Most AI roleplay tools are built for one person in one browser tab. Serene Pub isn't.

Turn on multi-user accounts and one server becomes a shared, multi-tenant instance — every account gets its own private characters, personas, chats, and lorebooks. Invite a friend into a chat as a guest and they show up as themselves: their own persona, and their own characters pulled straight from their own library and dropped into the scene right alongside yours. Everything updates live for everyone in the chat as it happens — no refreshing, no passing a tab back and forth.

This is the thing that sets Serene Pub apart from almost everything else in the space: a real, self-hosted, shared story — not a single-player tool with a login screen bolted on.

- **Multi-tenant accounts** — every account's characters, personas, chats, and lorebooks are private to them, invisible to everyone else on the server
- **Guests bring their own cast** — friends join a chat with their own persona and their own characters, not just a shared login
- **Live, not turn-passing** — every message, edit, and generation syncs instantly to everyone in the chat over WebSockets

> 🖼️ A screenshot of a live multiplayer session is coming soon.

---

## 🖼️ Screenshots

### Desktop Experience

| Chat & Editing                                | Connections & Characters                                   | Contexts & Lorebooks                                   |
| --------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| ![](docs-assets/screenshots/desktop-chat-edit.png) | ![](docs-assets/screenshots/desktop-connections-characters.png) | ![](docs-assets/screenshots/desktop-contexts-lorebooks.png) |

| Prompt Details                                     | Prompts & Chats                                   | Sampling & Personas                                   |
| -------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| ![](docs-assets/screenshots/desktop-prompt-details.png) | ![](docs-assets/screenshots/desktop-prompts-chats.png) | ![](docs-assets/screenshots/desktop-sampling-personas.png) |

| Theme Example 1                                     | Theme Example 2                                     | Theme Example 3                                     |
| --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| ![](docs-assets/screenshots/desktop-theme-example-1.png) | ![](docs-assets/screenshots/desktop-theme-example-2.png) | ![](docs-assets/screenshots/desktop-theme-example-3.png) |

| Theme Example 4                                     | Theme Example 5                                     |
| --------------------------------------------------- | --------------------------------------------------- |
| ![](docs-assets/screenshots/desktop-theme-example-4.png) | ![](docs-assets/screenshots/desktop-theme-example-5.png) |

### Lorebooks+ & Worldbuilding

| Character Bindings                                       | Character Lore                                       | Lorebook History                              | World Lore                                       |
| ---------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- | --------------------------------------------------- |
| ![](docs-assets/screenshots/lorebooks-character-bindings.png) | ![](docs-assets/screenshots/lorebooks-character-lore.png) | ![](docs-assets/screenshots/lorebooks-history.png) | ![](docs-assets/screenshots/lorebooks-world-lore.png) |

> Scenes, the Narrative Graph, the KoboldCPP Manager, and the Character/Persona library browsers are new in 0.5.0 — screenshots coming soon.

### Ollama Manager

| Available Models                                             | Downloads                                                    | Installed Models                                             | Settings                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------ |
| ![](docs-assets/screenshots/sidebar-ollama-manager-available.png) | ![](docs-assets/screenshots/sidebar-ollama-manager-downloads.png) | ![](docs-assets/screenshots/sidebar-ollama-manager-installed.png) | ![](docs-assets/screenshots/sidebar-ollama-manager-settings.png) |

### Mobile Experience

| Chat                                    | Connections                                    | Edit Character                                    |
| ---------------------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| ![](docs-assets/screenshots/mobile-chat.png) | ![](docs-assets/screenshots/mobile-connections.png) | ![](docs-assets/screenshots/mobile-edit-character.png) |

| Home                                    | Navigation                                    |
| ---------------------------------------- | ------------------------------------------------ |
| ![](docs-assets/screenshots/mobile-home.png) | ![](docs-assets/screenshots/mobile-navigation.png) |

---

## 🚀 Features

### Memory & Worldbuilding

A story that actually remembers itself, instead of relying on you to keep notes.

- **Lorebooks+:** World lore, character lore, and a dated history timeline, all bindable to your cast via `{{char:N}}` tokens
- **Scenes:** Capture a consecutive run of chat messages as a standalone summary, attached to a point in your story's history
- **Summarization:** Compress chat messages, scenes, and history entries into permanent, editable lorebook content on demand — so long stretches of roleplay don't just get forgotten
- **Narrative Graph:** Tracks who's connected to whom, and how, so your world stays consistent across long campaigns — build it from your summarized scenes and history, or extend it as the story grows
- **Relationship Visibility:** Every relationship in the graph is secret, acknowledged, or public — replies are generated from each character's own vantage point on the graph, so a one-sided crush or a private understanding stays exactly as hidden, or as shared, as you intended
- **Long-Term Memory (RAG):** Finds the right lore, history, and past messages by meaning, not just keywords, so details from hundreds of messages ago can resurface exactly when they matter. Retrieval draws from the same structured Lorebooks+ entries and relationship graph the rest of the app uses — not raw chat scrollback — and is scoped to what each character actually knows, so results come back relevant *and* in character, not just textually similar. Runs fully local (on-device) or against any OpenAI-compatible embeddings API

### Characters & Perspective

- **Character & Persona Management:** Import, create, and edit with rich metadata, avatars, and image galleries
- **Character & Persona Library Browsers:** Search and import thousands of community-made cards without leaving the app, including direct **CharaVault** integration
- **Per-Character Visibility:** Full / Minimal / Hidden visibility per character, per chat — a context-budget control for keeping large casts affordable, independent of the relationship secrecy described above
- **On-Demand Narrator:** Trigger a response from the environment itself — weather, scenery, an NPC shopkeeper — with no permanent "Narrator" character cluttering your cast
- **Group Chats:** Chat with as many characters at once as you wish, with drag-to-reorder round-robin turn order
- **Built for Coherence:** Character and lore data is structured, not freeform prose, in every request sent to the model — a deliberate choice made after side-by-side testing, and part of why some users report characters staying truer to their profiles

### AI Connections & Local Models

Bring your own model, or download and run one yourself — no terminal, no manual installs.

- **AI Model Agnostic:** Connect to OpenAI, Anthropic, Ollama, KoboldCPP, LM Studio, Llama.cpp, and more
- **KoboldCPP Manager:** Download the KoboldCPP binary, browse and download GGUF models, and load or switch between them — all from inside the app, in a few clicks
- **Ollama Manager:** Search, download, and activate Ollama models from a built-in UI — a few clicks, no command line
- **Per-Task AI Override:** Point the narrator, summarizer, and chat at different connections and sampling settings, per prompt config — run dialogue on a fast local model and narration or summarization on a heavyweight cloud model
- **Context Config Builder:** Decide exactly what the model sees, and in what order, with a drag-and-drop card interface — reorder blocks, toggle sections, and see a live preview, no hand-written template required (the raw Handlebars template is still there if you want it)
- **Prompt Statistics & Context Debugging:** Inspect the compiled prompt and full retrieval diagnostics behind any reply, so "why did it forget that" has an actual answer

### Everywhere You Are

- **Desktop:** Linux, macOS, and Windows
- **Docker:** Pre-built images published on every release
- **Android:** A native APK bundling the full server — self-contained and offline-capable (aside from your chosen AI connection)
- **Mobile-First Design:** Fully responsive, works great on phones and tablets

### Getting Started & Polish

- **Setup Wizard:** A guided first-run flow that adapts to your role — if you don't already have a model, it can download, install, and run one for you in a few clicks, then walks you through your first character, persona, and chat
- **Built-In Docs Browser:** The full documentation, searchable, right in the app
- **Document View:** A separate, high-contrast, keyboard- and screen-reader-friendly interface — one plain page per feature instead of panels and sidebars — reachable any time with `Ctrl+Shift+Y`
- **Themes & Dark Mode:** 20+ built-in themes, instant switching, accessibility options, and a custom theme editor for building or importing your own and sharing them instance-wide
- **Tags:** Organize and filter chats, characters, personas, and lorebooks
- **Chat & Context Tools:** Auto character response, edit/delete messages, streaming & regenerate, manual & hidden responses, swipe left/right on messages, live token and history stats
- **Portable & Secure:** Embedded database, no cloud required, runs anywhere
- **SillyTavern Import/Export:** Bring in your existing character cards and avatars, or import characters and chat history directly from a SillyTavern data directory — no manual card-by-card migration. Export your own in the same format, too

---

## 🤔 Is Serene Pub Right For You?

**Already have a character library?** Serene Pub imports SillyTavern-format character cards directly — or point it at a whole SillyTavern data directory to bring over your characters and chat history in one go — so you're not starting over. Everything else here (Lorebooks+, RAG, Summarization, the Narrative Graph, local-model management) is built in from day one, not something you piece together afterward.

**Want to run a shared story with friends?** Multi-user accounts and guest-invited chats make Serene Pub a real shared table, self-hosted end to end — something few AI roleplay tools support at all. Everyone plays their own persona and brings their own characters onto a server you control.

**Writing long-form solo stories?** Lorebooks+, Summarization, and the Narrative Graph exist specifically so a story doesn't lose the thread after a hundred messages — structured memory that keeps characters and world facts straight well past where flat lorebooks tend to break down.

---

## 🧩 Platforms

Serene Pub builds and ships for the platforms below. The core app is the same everywhere — multiplayer, Lorebooks+, RAG, Summarization, the Narrative Graph — but a couple of features depend on native binaries that aren't available on every platform. Where that's the case, it's called out explicitly rather than left to surface as a confusing error.

| Platform | Distribution | Local embedding models | KoboldCPP / Ollama Manager |
| --- | --- | --- | --- |
| 🪟 Windows (x64) | [GitHub Release](https://github.com/doolijb/serene-pub/releases) `.zip` | ✅ | ✅ |
| 🍎 macOS — Apple Silicon (arm64) | [GitHub Release](https://github.com/doolijb/serene-pub/releases) `.zip` | ✅ | ✅ |
| 🍎 macOS — Intel (x64) | [GitHub Release](https://github.com/doolijb/serene-pub/releases) `.zip` | ⚠️ Unavailable¹ | ✅ |
| 🐧 Linux (x64) | [GitHub Release](https://github.com/doolijb/serene-pub/releases) `.zip` | ✅ | ✅ |
| 🐧 Linux (arm64) | Docker only² | ✅ | ✅ |
| 🐳 Docker (`linux/amd64`, `linux/arm64`) | [ghcr.io/doolijb/serene-pub](https://github.com/doolijb/serene-pub/pkgs/container/serene-pub) | ✅ | ✅ |
| 📱 Android (arm64, API 26+) | [GitHub Release](https://github.com/doolijb/serene-pub/releases) `.apk` | ⚠️ Unavailable³ | ⚠️ Unavailable⁴ |

**Annotations:**

1. **macOS Intel — no local embedding models**: `onnxruntime-node` (the native ONNX runtime `@huggingface/transformers` uses for in-app embeddings) stopped publishing prebuilt binaries for Intel Macs as of v1.24.3 — only Apple Silicon remains. The app detects this and disables the option with an explanation rather than failing at runtime; use an external embeddings API instead (OpenAI, Ollama, LM Studio, or any OpenAI-compatible `/embeddings` endpoint), which works identically to local models everywhere else. Alternatively, running the Docker image on an Intel Mac provides full local embedding support, since the container uses Linux binaries.
2. **Linux arm64 — Docker only**: there's no standalone desktop build for Linux arm64 today (GitHub-hosted CI runners can't cross-compile the native dependencies involved). The multi-arch Docker image covers this architecture with the full feature set, including local embedding models.
3. **Android — no local embedding models**: Android's Bionic userspace isn't glibc-compatible, and `onnxruntime-node`'s prebuilt binaries require glibc — not fixable via packaging. As with Intel Mac, use an external embeddings API instead; it works normally on Android.
4. **Android — no KoboldCPP/Ollama Manager**: the *managed* (auto-download-and-run) modes for KoboldCPP and Ollama are hidden on Android — KoboldCPP's upstream releases don't include a Linux arm64 binary to run on-device, and Ollama's manager has no local-subprocess story in this app at all. **Connecting to a remote/already-running KoboldCPP or Ollama server is unaffected** — set it up as a normal connection in the Connections panel, same as any other provider.

See [`android/README.md`](android/README.md) for the full list of Android-specific technical constraints.

---

## 🛠️ Quick Start

No config files. No build step. No separate services to wire up first — pick your platform and go.

| Platform | Get Serene Pub |
| --- | --- |
| 🪟 **Windows** | [Download](https://github.com/doolijb/serene-pub/releases) → extract → run `run.cmd` |
| 🍎 **macOS** | [Download](https://github.com/doolijb/serene-pub/releases) → extract → run `run.sh` (first launch may need right-click → Open, or `xattr -d com.apple.quarantine` — see [Troubleshooting](docs/troubleshooting.md)) |
| 🐧 **Linux** | [Download](https://github.com/doolijb/serene-pub/releases) → extract → run `run.sh` (optional: run `install-desktop-shortcut.sh` once to add a desktop icon) |
| 📱 **Android** | [Download the APK](https://github.com/doolijb/serene-pub/releases) → install → open |
| 🐳 **Docker** | `docker compose -f docker-compose.dist.yml up -d` — see [Docker](#-docker) below |

Desktop opens at [http://localhost:3000](http://localhost:3000); Android opens straight into the app. Either way, the **Setup Wizard** takes it from there — it'll connect an AI provider for you if you don't already have one (or download and set up KoboldCPP/Ollama on your behalf, in a few clicks), then walk you through your first character, persona, and chat.

### From Source

#### Requirements

- [Node.js](https://nodejs.org/en) 24 or later
- (Optional) [Ollama](https://ollama.com/download) for local models

#### Steps

1. Clone this repo
2. `npm i` to install dependencies
3. `npm run dev` to start the dev server, or `npm run dev:host`
4. Visit [http://localhost:5173](http://localhost:5173)

Prefer Docker instead? `docker compose -f docker-compose.dev.yml up -d --build` builds the image from your local source (rather than pulling the published one) into its own isolated data volume — handy for testing changes in a container without touching the pre-built release image.

## 🐳 Docker

Pre-built images are published to the GitHub Container Registry on every release:

```
ghcr.io/doolijb/serene-pub:latest   ← always the latest stable release
ghcr.io/doolijb/serene-pub:0.5.0    ← exact version pin
```

**Quickstart** — download [`docker-compose.dist.yml`](docker-compose.dist.yml) from the release assets, then:

```bash
docker compose -f docker-compose.dist.yml up -d
```

The web UI will be at **http://localhost:3000**.

**Data directory** — all persistent data (database, model cache, uploads) is stored under a single directory controlled by the `SERENE_PUB_DATA_DIR` environment variable. The default inside the container is `/data`, which is mounted as a named Docker volume. To use a host path instead:

```bash
docker run -p 3000:3000 -p 3001:3001 \
  -e SERENE_PUB_DATA_DIR=/data \
  -v "$(pwd)/serene-pub-data":/data \
  ghcr.io/doolijb/serene-pub:latest
```

See [DOCKER.md](DOCKER.md) for full documentation — ports, volumes, reverse proxy setup, Ollama/KoboldCPP integration, and more. For a full environment variable reference and reverse-proxy/tunnel setups (Docker or not), see [HOSTING.md](HOSTING.md) or the in-app [Environment Variables](docs/environment-variables.md) reference.

**Need help?** Check out our **[Getting Started guide](docs/getting-started.md)**.

---

## 📚 Documentation

### **[Complete Documentation Available in docs/](docs/)**

The same documentation also ships inside the app itself, via a built-in, dedicated **Docs** page — no need to leave Serene Pub to look something up.

**Popular Pages:**

- **[Getting Started](docs/getting-started.md)** - The setup wizard, walked through step by step
- **[Connections](docs/connections.md)** - How to connect to AI models, and manage local models with KoboldCPP/Ollama Manager
- **[Characters](docs/characters.md)** and **[Personas](docs/personas.md)** - Creating and managing your cast and your own identity in a chat
- **[Lorebooks](docs/lorebooks.md)** - World-building, history, scenes, and the narrative graph
- **[Embeddings & RAG](docs/embeddings-and-rag.md)** - How semantic retrieval keeps long stories coherent
- **[Prompt Configs](docs/prompt-configs.md)** and **[Connections: Context Configs](docs/connections.md#context-configs)** - Customizing AI prompts and the Context Config builder
- **[Document View](docs/document-view.md)** - The accessible, high-contrast, keyboard/screen-reader-friendly alternative interface
- **[Troubleshooting](docs/troubleshooting.md)** - Common issues and solutions

### 🗺️ Planned Features

Nothing here is promised on a timeline — this is the list of what's actively under consideration for future releases.

- **Cross-Lorebook Copying:** Copy character lore entries from one lorebook to another
- **Lore Recursion & Nested Locations:** Lore children, and world lore modeled as nested locations
- **"Who Knows What" Console:** A dedicated view into what each character currently knows, for debugging relationship visibility and lore scope
- **Hybrid RAG Retrieval (NER):** Named-entity detection alongside the existing embedding-based retrieval, so names get found as reliably as topics
- **Lore/History Weighting Controls:** Tune how much the model favors lorebook content versus extended chat history during recall
- **Hands-Off Summarization & Graph Extension:** Optional automatic summarization and Narrative Graph updates, without manually triggering either
- **Modular Character Stats:** Health, equipment, and other stat-like fields for narrative purposes
- **Forced-Perspective Narration:** Choose which background character's perspective an on-demand narration query is generated from
- **Stepped Thinking:** Visible intermediate reasoning before a reply is generated
- **Alternate Chat Layouts:** Additional layout options beyond the current chat view
- **Text-to-Speech (TTS):** Originally targeted for 0.5.0, but held back — no integration found yet that's small, fast, expressive, and tunable without relying on voice cloning or a massive sample library
- **Image Generation**
- **Modular Multi-Agents**
- **Custom Context Data Structures:** Alternate ways to encode context sent to the model — custom JSON structures, prose formatting, and more
- **Extension System:** On hold until the rest of Serene Pub's infrastructure is stable enough to design and harden it properly
- **2FA & Security Hardening**

---

## ❤️ Contributing

Serene Pub is community-driven! Bug fixes, features, and feedback are welcome. Please [open an issue](https://github.com/doolijb/serene-pub/issues) or [start a discussion](https://github.com/doolijb/serene-pub/discussions) before submitting large changes.

**For development setup and contribution guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).**

---

## 🛡️ License

AGPL-3.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for details.

---

## 🙏 Special Thanks

Special thanks to **Nivelle** for creating Serene Pub community library characters, and **subpanopticon** for feedback and testing.

---

<p align="center">
  <b>Serene Pub — Play more, tweak less. 100% open source.</b><br>
  <b>📚 <a href="docs/">Read the full documentation</a></b>
</p>
