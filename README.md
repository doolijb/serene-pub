<p align="center">
  <img src="static/readme-header.png" alt="Serene Pub logo" width="1920"/>
</p>

> **⚠️ Serene Pub is in alpha! Expect bugs and rapid changes. This project is under heavy development.**

<p align="center">
  <b><a href="https://github.com/doolijb/serene-pub">Repo</a> •
  <a href="https://github.com/doolijb/serene-pub/wiki/Home">Wiki</a> •
  <a href="https://github.com/doolijb/serene-pub/releases">Downloads</a> •
  <a href="https://github.com/doolijb/serene-pub/issues">Issues</a> •
  <a href="https://discord.gg/3kUx3MDcSa">Discord</a> •
  <a href="https://buymeacoffee.com/serenepub">Buy Me a Coffee</a></b>
</p>


---

## Table of Contents
- [Why Serene Pub?](#-why-serene-pub)
- [Screenshots](#-screenshots)
- [Features](#-features)
- [Quick Start / Download](#-quick-start)
- [Installation & Setup](#installation--setup)
- [Documentation & Help](#-documentation--help)
- [Planned Features](#-planned-features)
- [Considered Features](#-considered-features)
- [How to Update](#-how-to-update)
- [Contributing](#-contributing)
- [License](#-license)
- [Special Thanks](#-special-thanks)

# 🦊 Serene Pub

**Modern, Open Source AI Roleplay Chat**

Serene Pub is a brand new, open source chat application for immersive AI roleplay and creative conversations. Designed for simplicity, speed, and beautiful usability, Serene Pub brings your characters and worlds to life—on your terms, with your data, and your favorite AI models.

---

## ✨ Why Serene Pub?

- **Zero Clutter, Maximum Fun:** Clean, intuitive UI with minimal menus and instant access to everything you need.
- **Real-Time Sync:** All chats, settings, and characters update live across devices via WebSockets.
- **Portable & Private:** Runs locally, no accounts, no cloud lock-in. Your data stays with you.
- **AI Freedom:** Connect to OpenAI, Ollama, LM Studio, Llama.cpp, and more. Mix and match models, run local or cloud.
- **Roleplay-First:** Built for character-driven, story-rich experiences. Import Silly Tavern cards, manage personas, and more.
- **Mobile Ready:** Responsive design for desktop and mobile. Pick up your story anywhere.
- **Open Source:** AGPL-3.0. Hack it, extend it, make it yours!

---

## 🖼️ Screenshots

### Desktop Experience

| Chat & Editing | Connections & Characters | Contexts & Lorebooks |
| -------------- | ------------------------ | -------------------- |
| ![](static/screenshots/desktop-chat-edit.png) | ![](static/screenshots/desktop-connections-characters.png) | ![](static/screenshots/desktop-contexts-lorebooks.png) |

| Prompt Details | Prompts & Chats | Sampling & Personas |
| -------------- | --------------- | ------------------- |
| ![](static/screenshots/desktop-prompt-details.png) | ![](static/screenshots/desktop-prompts-chats.png) | ![](static/screenshots/desktop-sampling-personas.png) |

| Theme Example 1 | Theme Example 2 | Theme Example 3 |
| --------------- | --------------- | --------------- |
| ![](static/screenshots/desktop-theme-example-1.png) | ![](static/screenshots/desktop-theme-example-2.png) | ![](static/screenshots/desktop-theme-example-3.png) |

| Theme Example 4 | Theme Example 5 |
| --------------- | --------------- |
| ![](static/screenshots/desktop-theme-example-4.png) | ![](static/screenshots/desktop-theme-example-5.png) |

### Lorebooks+ & Worldbuilding

| Character Bindings | Character Lore | Lorebook History | World Lore |
| ------------------ | -------------- | ---------------- | ---------- |
| ![](static/screenshots/lorebooks-character-bindings.png) | ![](static/screenshots/lorebooks-character-lore.png) | ![](static/screenshots/lorebooks-history.png) | ![](static/screenshots/lorebooks-world-lore.png) |

### Mobile Experience

| Chat | Connections | Edit Character |
| ---- | ----------- | -------------- |
| ![](static/screenshots/mobile-chat.png) | ![](static/screenshots/mobile-connections.png) | ![](static/screenshots/mobile-edit-character.png) |

| Home | Navigation |
| ---- | ---------- |
| ![](static/screenshots/mobile-home.png) | ![](static/screenshots/mobile-navigation.png) |

---

## 🚀 Features

- **AI Model Agnostic:** Connect to OpenAI, Ollama, Llama.cpp, and more
- **Character & Persona Management:** Import, create, and edit with rich metadata and avatars
- **Lorebooks+:** Organize world lore, character lore, and history for deep roleplay
- **Group Chats:** Multi-character chats for immersive group roleplay and dynamic storylines
- **Chat & Context Tools:**
  - Auto character response
  - Edit/delete messages
  - Streaming & regenerate
  - Manual & hidden responses
  - Swipe left/right on messages
  - Live token and history stats
- **Prompt Statistics:** View compiled prompts before sending
- **Context Templates:** Handlebar-based, customizable prompt formats
- **Mobile-First Design:** Fully responsive, works great on phones and tablets
- **Themes & Dark Mode:** 20+ themes, instant switching, and accessibility options
- **Portable & Secure:** Embedded database, no cloud required, runs anywhere
- **Silly Tavern Compatibility:** Import/export character cards and avatars
- **Open Source & Extensible:** AGPL-3.0, modular adapters, easy to hack

---

## 🛠️ Quick Start

### Download & Run (No Install Required)

Linux, MacOS and Windows are supported!

1. [Download the latest release](https://github.com/doolijb/serene-pub/releases) for your OS
2. Extract the archive anywhere
3. Read the included `INSTRUCTIONS.txt` for your platform
4. Run the launcher script (`run.sh`/`run.cmd`)
5. Open [http://localhost:3000](http://localhost:3000) in your browser
6. Add your first AI connection and start chatting!

### Source Code

#### Requirements

- [Node.js](https://nodejs.org/en)
- (Optional) [Ollama](https://ollama.com/download) for local models

#### Steps

1. Clone this repo
2. `npm i` to install dependencies
3. `npm run dev` to start the dev server, or `npm run dev:host`
4. Visit [http://localhost:5173](http://localhost:5173)


---

## 📚 Documentation & Help

### 🧩 Context Configuration

Serene Pub uses Handlebars-style templates to build highly customizable prompts. Templates can include dynamic information like date, world lore, and structured history. Example:

````hbs
{{#systemBlock}}
Instructions:
"""
{{#if currentDate}} 
The current date in the story is {{{currentDate}}}.
{{/if}}

{{{instructions}}}
"""

Assistant Characters (AI-controlled):
```json
{{{characters}}}
```

User Characters (player-controlled):
```json
{{{personas}}}
```

Scenario: """ {{{scenario}}} """

{{#if worldLore}} World lore:
```json
{{{worldLore}}}
```
{{/if}}

{{#if history}} Story history:
```json
{{{history}}}
```
{{/if}}

{{#if exampleDialogue}} {{{exampleDialogue}}} {{/if}} {{/systemBlock}}

{{#each chatMessages}} {{#if (eq role "assistant")}} {{#assistantBlock}} {{{name}}}: {{{message}}} {{/assistantBlock}} {{/if}} {{#if (eq role "user")}} {{#userBlock}} {{{name}}}: {{{message}}} {{/userBlock}} {{/if}} {{/each}}

{{#if postHistoryInstructions}} {{#systemBlock}} {{{postHistoryInstructions}}} {{/systemBlock}} {{/if}}
````


### 📝 Prompt Configuration

Prompt Configurations define the tone and behavior of the AI's responses. These instructions are sent alongside your message history and context blocks.

Example:

````text
Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging.
````

### 👤 Personas

Personas are user-controlled characters. Give your persona a name, description, and avatar to represent yourself in chats. Personas let you roleplay as different characters, each with their own style and background.

### 🤖 Characters

Characters are AI-controlled participants in your chats. Each character can have a name, description, avatar, personality, and greeting.

- **Greeting:** The greeting is the first message a character inserts into the chat. It helps ground the AI and provides an example of how the character should behave. You can add additional greetings or group-only greetings for more variety.
- **Importing:** Character cards can be imported from Silly Tavern or your favorite character card website, making it easy to bring your favorite personalities into Serene Pub.

### 📖 Lorebooks+

Lorebooks+ are advanced worldbuilding and context management tools that let you deeply enrich your roleplay experience. With Lorebooks+, you can:

- **Character Bindings:** Hotswappable characters linked in the lorebook. Dynamically update character and persona names in lorebook entries, so the right information is injected into the prompt for the current cast of your chat.
- **World Lore:** Store and organize facts, rules, and background information about your world, setting, or universe. World lore can be automatically included in relevant chats.
  - *Imported lorebooks/world books are inserted into "world lore" for easy access and editing.*
- **Character Lore:** Linked to character bindings and extends the character profiles. Maintain detailed backstories, traits, and secrets for each character, ensuring the AI stays consistent and in-character.
- **History:** Track and inject important story events, chat history, or evolving facts as the narrative progresses. *History entries are experimental and may change in future releases.* This helps maintain continuity and depth in long-running stories.

To use a lorebook, select it when creating or editing a chat. Lorebook entries are triggered by keywords, but may also be pinned to ensure they are always present in the prompt. Vectorization will be added in the future as a replacement for keyword engineering, making context injection smarter and more flexible.

Lorebooks+ make it easy to manage complex worlds, keep characters consistent, and ensure the AI always has the right context for immersive storytelling.

### 💬 Chats

Create a chat by adding one or more characters and at least one persona. You can:
- Optionally add a scenario to tell the AI what the current objective is. In non-group chats, this overrides character scenarios.
- Enable or disable characters from responding automatically in group chats for more control over the conversation flow.
- Optionally select a lorebook to inject world, character, or historical lore into your chat for richer context and storytelling.

### 🏷️ Tags (Coming in 0.4.0)
Tags are a planned feature for the 0.4.0 release. Tags will help you organize and filter your content, making it easier to manage complex stories and worlds.

### 📂 Data Location

Your data is saved locally in your OS-specific app directory:

- **macOS:** `~/Library/Application Support/SerenePub`
- **Windows:** `%LOCALAPPDATA%\SerenePub`
- **Linux:** `~/.local/share/SerenePub`

### ⚡ Troubleshooting

- Adjust "Context Tokens" in the Sampling tab.
- Configure a more accurate tokenizer in the Connections sidebar.
- Use the "View Prompt Statistics" modal to preview your final prompt.

* Save your configuration to apply changes.
* Default templates marked with `*` cannot be edited directly; clone to customize.
- Ensure you are editing a cloned configuration, not the defaults.

### 🔌 Connections

Serene Pub supports a variety of AI model connections, both local and cloud-based. For a full list of currently supported (or in development) connection options, see the [Supported Connections Issue](https://github.com/doolijb/serene-pub/issues/10).

- **Connection Types:** Some adapters support chat APIs, completion APIs, or both. You can mix and match connections to suit your needs. When using completion APIs (Serene Pub precompiles the entire prompt), you can select from available prompt formats to best match your model's requirements.
- **Token Counter:** Each connection uses a token counter to estimate the number of tokens in your chat history, character definitions, and prompt. This helps manage context size and avoid exceeding model limits.
- **Setup:** Add and configure connections in the app sidebar. Test connections and refresh available models directly from the UI.

---

## 🗺️ Planned Features
- 🏷️ Tags (coming in 0.4.0)
- 🧠 Vectorization
- 🔌 More API connection types
- 🤖 Assistant Chat: Ask AI questions about Serene Pub and get suggestions to improve your characters, personas, and lore
- 🦙 Ollama Manager UI: Manage, download, and update Ollama models directly from the app

## 💡 Considered Features
- 👥 Multi-user logins & multi-user group chats
- 📝 Chat summarizing
- 🖼️ User/chat backgrounds
- 📖 Story narration/system instructions
- 🦯 Screen reader support
- 📅 Lorebooks+ features: custom calendars, "eras" historical categories, and more
- 🕹️ Text adventure & narrator modes
- 🖼️ Image generation

---

## 🔄 How to Update

**Updating from 0.2.x, 0.3.x:**
- Download the latest version and extract to your desired location and run. Your data will automatically be copied from the old database to the new, more powerful database.

**Updating to future versions:**
- Download the latest version and extract to your desired location and run (it doesn't matter where). Run the application. Any database migrations will be performed automatically.

---

## ❤️ Contributing

Serene Pub is community-driven! Bug fixes, features, and feedback are welcome. Please [open an issue](https://github.com/doolijb/serene-pub/issues) or [start a discussion](https://github.com/doolijb/serene-pub/discussions) before submitting large changes.

---

## 🛡️ License

AGPL-3.0. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for details.

---

## 🙏 Special Thanks

Special thanks to **crazyaphro** for Q/A, **M3d4r** for editing the Wiki, and **Nivelle** for early feedback.

---

<p align="center"><b>Serene Pub — Play more, tweak less. 100% open source.</b></p>