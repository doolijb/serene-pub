# Serene Pub

<!-- TOC -->
- [Project Status](#project-status)
- [Screenshots](#screenshots)
- [Features](#features)
  - [Functional](#functional)
  - [Mostly Functional](#mostly-functional)
  - [In Progress](#in-progress)
  - [Pending Priorities](#pending-priorities)
  - [Considered](#considered)
- [Getting Started (Download & Play!)](#getting-started-download--play)
- [Software Stack](#software-stack)
- [Getting Started (Source Code)](#getting-started-source-code)
  - [Requirements](#requirements)
  - [Instructions](#instructions)
- [Feedback and Contributing](#feedback-and-contributing)
  - [Feedback & Contact](#feedback--contact)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)
<!-- /TOC -->

Serene Pub is a modern, customizable chat application designed for immersive roleplay and creative conversations. Inspired by Silly Tavern, it aims to be more intuitive, responsive, and simple to configure.

Primary concerns Serene Pub aims to address:
  1. Reduce the number of nested menus and settings.
  2. Reduced visual clutter.
  3. Manage settings server-side to prevent configurations from changing because the user switched windows/devices.
  4. Make API calls & chat completion requests asyncronously server-side so they process regardless of window/device state.
  5. Use sockets for all data, the user will see the same information updated across all windows/devices.
  6. Have compatibility with the majority of Silly Tavern import/exports, i.e. Character Cards
  7. Overall be a well rounded app with a suite of features. Use SillyTavern if you want the most options, features and plugin-support.

## Screenshots

1. Clean, intuitive chat interface

   <img src="https://github.com/user-attachments/assets/aead8e09-00b5-42ec-983f-6e5f2005fddc" alt="chat" width="700"/>
   
2. Sampling/character list/token stats

   <img src="https://github.com/user-attachments/assets/4be5e4ec-08e7-47c4-bf4d-b55abfeff184" alt="sampling" width="700"/>

3. Connections/models/character editing

   <img src="https://github.com/user-attachments/assets/4a8b92a1-2e49-426c-b437-0ed3a45b4276" alt="connections" width="700"/>

4. System prompt/persona/response

   <img src="https://github.com/user-attachments/assets/35a6b563-1c9c-4b81-847d-30060b268ffb" alt="persona" width="700"/>

5. Mobile chat view

   <img src="https://github.com/user-attachments/assets/60a89d4d-f0ae-4761-b51b-385feddcddfe" alt="mobile-chat" width="400"/>

6. Mobile characters view

   <img src="https://github.com/user-attachments/assets/b28d36d2-9d2b-4c15-b9ff-c9e3c2e84c5b" alt="mobile-characters" width="400"/>

### Select theme and dark mode

Toggle night mode on or off with over 20 themes!

<img src="https://github.com/user-attachments/assets/ff425506-3524-41a7-9c18-b11f4dd673a2" alt="theme-1" width="400"/>
<img src="https://github.com/user-attachments/assets/8f6f57b0-b143-4ae2-a8b5-063551999478" alt="theme-2" width="400"/>
<img src="https://github.com/user-attachments/assets/c23e9634-374f-49b7-b6b6-1fa8ef7c3a25" alt="theme-3" width="400"/>
<img src="https://github.com/user-attachments/assets/c73d7d7c-ea27-4be2-8479-b0be7722f9f0" alt="theme-4" width="400"/>


## Project Status

**Alpha:** Serene Pub is in early development. Expect bugs and breaking changes. If you are a developer or comfortable with manual setup, your testing and feedback are appreciated!

## Features

### Functional
- Manage sampling and context limits (settings can be individually enabled/disabled)
- Manage roleplay/system prompt instructions
- Mobile responsive view
- Day/night mode & themes
- Chats: create/delete, send persona message, auto character response, edit/delete messages, streaming, regenerate, manual response, hide message, live token/history stats

### Mostly Functional
- Create, manage & import (Image Card Files supported; JSON not yet)
- Create & manage personas (import/export not yet implemented)
- Home page setup guide
- Mobile responsive layout
- Manage context settings (add your own, only one default provided)
- Group chats, continue conversation, trigger response from specific character

### In Progress
- Connect to your favorite API ([see supported options](https://github.com/doolijb/serene-pub/issues/10))
- App/user settings
- Lorebooks+ - World lore, character lore, timeline/story date tracking, multi-character linking

### Pending Priorities
- Character/chat tags

### Considered
- Multi-user logins & group chats
- Chat summarizing
- Chat/lore vectorization
- User/chat backgrounds
- Story narration/system instructions
- Screen reader support
- Lorebooks+ features: custom calendars, "eras" historical categories and more

## Getting Started (Download & Play!)

1. Download the latest release for your operating system [here.](https://github.com/doolijb/serene-pub/releases)
2. Extract the archive where every you desire, there's nothing to install.
3. Read the INSTRUCTIONS.txt file to launch Serene Pub on your OS.
4. Once launched, the node runtime will download automatically and start Serene Pub.
5. Access SerenePub on your host machine from http://localhost:3000 or https://0.0.0.0:/3000
6. You should be able to access Serene Pub from other devices on your local network as well.

## Software Stack
- SvelteKit (Svelte 5)
- Socket.io via [sveltekit-io](https://github.com/cedrictailly/sveltekit-io)
- Tailwind, themes, and components via [Skeleton UI](https://skeleton.dev)
- ORM, SQLite, and migrations via [Drizzle ORM](https://orm.drizzle.team/)
- [Bun](https://bun.sh/) for package management

## Getting Started (Source Code)

### Requirements
- [Ollama](https://ollama.com/download) (install models from [here](https://ollama.com/search?q=roleplay) or Hugging Face)
- [Node.js](https://nodejs.org/en)
- [Bun](https://bun.sh/)

### Instructions
1. Download or clone this repository.
2. Open a terminal and navigate to the directory.
3. Run `bun i` to install dependencies.
4. Run `bun run db:migrate` to generate the database.
5. Run `bun run dev` to start the server.
6. Open `http://localhost:5173` in your browser.
7. Use the UI to set up connections, characters, personas, and chats.

## Feedback and Contributing

Feel free to clone & contribute! Bug fixes are appreciated. For new features, please propose your strategy before starting work.

### Feedback & Contact
- [Open an issue](https://github.com/doolijb/serene-pub/issues) for feedback, bugs, or questions
- [Contact on Reddit](https://reddit.com/u/doolijb)
- Discord: `285999266088878080`

## Documentation
Here is a WIP documentation. At the moment, prioritization is focused on adding documentation for features that are fundamentally different than Silly Tavern's paradigms.

### Context Configuration
#### Context Template
Serene Pub abstracts how groups of information (i.e. characters, personas) are structured to ensure predictability for the LLMS to parse and understand.

How-ever placement is highly granular and customizable.

```
{{#systemBlock}}
Instructions:
"""
{{instructions}}
"""

Assistant Characters (AI-controlled):
'''json
{{{characters}}}
'''

User Characters (player-controlled):
'''json
{{{personas}}}
'''

Scenario:
"""
{{scenario}}
"""
{{/systemBlock}}

{{#if wiBefore}}
{{#systemBlock}}
{{wiBefore}}
{{/systemBlock}}
{{/if}}

{{#each chatMessages}}
  {{#if (eq role "assistant")}}
{{#assistantBlock}}
{{name}}: {{{message}}}
{{/assistantBlock}}
  {{/if}}

  {{#if (eq role "user")}}
{{#userBlock}}
{{name}}: {{{message}}}
{{/userBlock}}
  {{/if}}
{{/each}}

{{#if wiAfter}}
{{#systemBlock}}
{{wiAfter}}
{{/systemBlock}}
{{/if}}
```
Context role blocks, i.e. `{{#systemBlock}}...{{/system}}` can be arranged how-ever you prefer, spliting the contents as you wish.

Information for all characters can be inserted with a label that explains to the assistant what this information represents, i.e. `Assistant Characters (AI-controlled): {{{personas}}}`

Complex information is formatted as JSON. This keeps the data structured and predictable for the model. It also prevents arbitrary text formatting from character descriptions from confusing the overall prompt structure (a common issue with imported cards.)

Simple information, such as prompt instructions, or scenarios are wrapped in triple quotes to help prevent the model from getting confused from arbitrary text formatting.

To create a new Context Config, click the + button and enter a new name. The currently active Context Config will be cloned.

With your Context Config set, you can then select the appropriate Prompt Format in the Connections sidebar. Prompt Format is selected per-connection so you can ensure your model is always using the correct format regardless of context template.

### Directories and Files

Data is saved automatically to the following directory, based on your OS:
- **macOS:** `~/Library/Application Support/SerenePub`
- **Windows:** `%LOCALAPPDATA%\SerenePub`
- **Linux:** `~/.local/share/SerenePub`

Key files:
- **Database:** `./data/main.db`
- **Character avatar:** `./data/users/[userId]/characters/[characterId]/avatar.png`
- **Persona avatar:** `./data/users/[userId]/personas/[personaId]/avatar.png`

Avatars must be uploaded through the app; manual placement will not work.

## Troubleshooting

1. Why is my token count exceeding the limit?
    - Context Tokens set in Sampling is too low, be sure to set a healthy context limit that your model & machine can handle. The oldest messages get truncated when the estimated token count exceeds the threshold. By default, the number of tokens in the compiled prompt are estimated. You can set a more accurate token counter in the Connections sidebar.
<img src="https://github.com/user-attachments/assets/1d45dfca-3a01-4047-a662-4fad171613e2" alt="theme-4" width="400"/>


2. How do I review the compiled prompt before I hit send?
    1. In the chat input, click the "Statistics" tab, and click the "View Prompt Statistics Button"
    2. A modal will open where you can review how your prompt is compiled.
<img src="https://github.com/user-attachments/assets/5c22f18b-9939-455f-96cb-f77a5c227367" alt="theme-4" width="400"/>

3. Why aren't my new settings taking effect?
    - To enforce clarity on what configuration is being used and sent with your prompt, all settings have to be saved to apply any changes.
  
4. Why can't I save my changes?
    - Default configurations, annotated with an asterisk `*` are system defaults. Clone the configuration to begin customizating.
    - This is to ensure there are _reasonable_ defaults always available, incase you feel that you've gotten lost or made a mistake.


