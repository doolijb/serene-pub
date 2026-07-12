# Getting Started

Serene Pub walks you through a short setup wizard the first time you sign in, then quietly turns into your home dashboard once everything is configured. This page explains exactly what each step does and how to get back to it later.

## Overview

The very first screen you see in Serene Pub (the app's home route) is a step-by-step wizard. It appears automatically whenever any required piece of your setup is missing — a connection to an AI provider, a character, a persona, or a first chat — and walks you through fixing that one thing at a time.

Once every required step is complete, the exact same screen switches to a normal home dashboard showing your characters and recent chats. There's no separate "setup mode" you have to exit; the page just notices you're done and changes what it shows. If you later delete your only character or persona, or the wizard otherwise detects something incomplete, this same screen will show the relevant step again the next time you land on it.

The wizard adapts to who you are:
- The **first admin** to set up a brand-new server sees the full wizard, including connecting an AI provider.
- An **admin logging in after the server is already configured** sees a shorter welcome message but still gets the connection/summarization/RAG steps if those aren't done yet.
- **Non-admin users** never see the connection, summarization, or RAG steps at all — those are server-wide settings an admin controls. Non-admins only go through Welcome, Character, Persona, and Create Chat. See [Users and Accounts](./users-and-accounts.md) for how admin vs. non-admin roles work.

## Step 1: Welcome

The wizard opens with a simple welcome screen and a single **Get Started** button. The heading and description change depending on your situation:

- If you're the admin setting up a brand-new server: "Welcome to Serene Pub! Let's get your server set up and ready to chat. This only takes a few minutes."
- If you're an admin but the server is already configured (e.g., a second admin account): "Welcome, Admin! The server is already configured. Let's get your personal account set up so you can start chatting."
- If you're a non-admin user: "Welcome! An administrator has already set up the server. Let's get your account ready so you can start chatting."

This step never counts as "complete" on its own — it's just an entry point. Clicking **Get Started** moves you to the next step.

## Connecting to an AI Provider

This step is only shown to admins (non-admins skip straight from Welcome to the Character step, since a shared connection is already configured for the server). It's the first thing an admin must set up, because nothing else in the app works without an active AI connection.

If you already have an active connection, this step just shows a "Connected!" confirmation with the connection's name and a **Continue** button — you can skip the rest of this section.

Otherwise you're offered three choices, each as a large clickable card:

- **KoboldCPP — Easy**: "A highly performant engine fine-tuned for storytelling and roleplay. Download and manage automatically with Serene Pub." Choosing this enables Serene Pub's built-in KoboldCPP manager.
- **Ollama — Easy**: "Incredibly easy to install, seamless and managed entirely within Serene Pub. Search, download, and activate models in a few simple clicks." Choosing this enables the built-in Ollama manager and checks whether Ollama is already reachable.
- **Manual Setup — Advanced**: "Configure OpenAI, LM Studio, Claude, LlamaCpp, or any other service yourself." Choosing this disables both managers and opens the Connections panel directly.

Full details on connection types, managers, and configuration options live in [Connections](./connections.md). The sections below only describe what happens inside the wizard itself.

### Setting up with KoboldCPP

If the KoboldCPP manager is enabled, the wizard tells you to open the **KoboldCPP Manager** (via the footer button of the same name) to download and load a model — the wizard automatically advances once a model connects successfully.

If you turn the manager off, the wizard instead walks you through a manual setup:
1. Download KoboldCPP from GitHub.
2. Download a GGUF model (a Hugging Face link is provided).
3. Launch KoboldCPP and load your model.
4. Enter your KoboldCPP URL (defaults to `http://localhost:5001`) and click **Detect**.

Once detected, a dropdown lists the models currently loaded in KoboldCPP so you can pick one, then click **Connect** in the footer.

### Setting up with Ollama

If the Ollama manager is enabled, the wizard tells you to open the **Ollama Manager** (footer button) to download and activate a model; the wizard advances automatically once a model connects.

With the manager off, you get manual instructions instead:
1. Download and install Ollama from ollama.com.
2. Run `ollama pull llama3.2` in a terminal.
3. Come back and pick a model from the dropdown — the wizard offers Llama 3.2 (Recommended), Llama 3.2 1B (faster/lighter), Qwen 2.5, and Mistral 7B as quick-pick options.

Selecting a model enables a **Connect** button in the footer, which creates the connection and activates it.

### Manual Setup for advanced users

Choosing **Manual Setup** disables both built-in managers and opens the Connections panel with a tutorial flag set, so you can configure any OpenAI-compatible endpoint, LM Studio, Claude, LlamaCpp, or another custom service yourself. The wizard shows a "Waiting for Connection" message and automatically detects and advances once you've created and activated a connection — you don't need to come back and click anything.

## Summarization Setup

Also admin-only. This step introduces manual conversation summarization and explains it in two short cards:

- **What it does**: "You trigger summarization manually in a chat. Serene compresses selected messages into a compact record that the AI uses to stay aware of past events without running out of context."
- **Resource usage**: "Increases AI usage by around 30%. Summarization only runs when you manually trigger it in a chat, so you stay in control."

Two footer buttons are offered: **Skip for now** (marks this step done without turning summarization on) and **Enable Summarization** (turns the feature on server-wide and marks the step done). Either choice advances the wizard. This step is tracked per-user on the server, independent of whether you actually have any chats yet. For the full picture of how summarization works day-to-day, see [Summarization & RAG](./summarization-and-rag.md).

## Vectorization (RAG) Setup

Admin-only, and only shown right after the Summarization step. This introduces retrieval-augmented generation (RAG) for lorebooks and chat history:

- **What it does**: "A small AI model understands the meaning of your lore. When you chat, Serene Pub finds the most relevant entries and quietly adds them to every message."
- **Resource usage**: "CPU only — runs a small model locally in the background. One-time download, then works silently without extra AI calls."

Below that is a tier picker with three cards, each labeled with the underlying model's name and download size:

- **Fast** — smallest download, lowest resource use.
- **Balanced** *(marked Recommended)* — best balance of quality and resource use for most setups.
- **Best Quality** — maximum accuracy, largest download.

The footer offers **Skip for now** (marks the RAG step complete without picking a model) or **Save & Continue**, which downloads and loads the chosen embedding model, showing a live progress bar (downloading → loading → ready) before advancing. Note that this step only *sets the embedding model* — it does not itself turn on RAG for any particular lorebook or chat. See [Summarization & RAG](./summarization-and-rag.md) for how to actually enable RAG once a model is configured.

## Creating Your First Character

Shown to every user, admin or not. The heading reads "Add Your First Character," and you're given four ways to get one:

- **Browse Library** — opens the built-in character library to pick a ready-made character.
- **Import from SillyTavern** *(admin only)* — leaves the wizard and takes you to the app's import page for pulling characters (and personas/chats) from an existing SillyTavern install. See [Importing from SillyTavern](./importing-from-sillytavern.md).
- **Import from File** — drag-and-drop or browse for a character card file (`.png`, `.apng`, `.jpeg`, `.jpg`, `.webp`, or `.json`).
- **Create from Scratch** — opens the character creator to build one manually with a name, avatar, and personality.

Any of these completing successfully advances the wizard automatically. There's also a **Skip for now** button if you'd rather come back to this later. Full character-building details are covered in [Characters](./characters.md).

## Creating Your First Persona

Immediately follows the Character step, for every user. The heading reads "Set Up Your Identity," with the same four options as the character step (Browse Library, Import from SillyTavern, Import from File — same accepted file types, Create from Scratch), plus one extra shortcut at the bottom:

> **Use a "You" placeholder persona** — instantly creates a default persona named "You" with a generic description you can edit later.

As with the character step, any successful creation or import advances the wizard, and a **Skip for now** button is available. See [Personas](./personas.md) for everything a persona can contain.

## Starting Your First Chat

The final step, titled "Start Your First Chat." It shows up to six of your characters as clickable cards (avatar, name, and description). Clicking one immediately creates a new one-on-one chat named "Chat with `<character>`," attaches your first persona if you have one, and takes you straight into that chat.

If you haven't created a character yet, this step shows a reminder to go back and add one first. The footer also has an **Open Chats Panel** button if you'd rather browse or manage chats instead of starting one right here. See [Chats](./chats.md) for everything you can do once you're in a conversation.

## The Home Dashboard After Setup

Once every required step is complete, this same screen stops showing the wizard and instead displays:

- A **Characters** grid of everything you've created or imported — clicking a character jumps to that character's chats.
- A **Recent Chats** grid (your most recent, up to six) if you have any chats yet — clicking one opens it directly.

You'll also always see a dismissible welcome banner (with a small × button to hide it) and a small alpha-status notice reminding you the app is under active development, regardless of whether the wizard or dashboard is showing.

## Returning to This Screen Later

Because the wizard and the home dashboard are the same page, there's nothing special to "exit" — the page simply re-evaluates what's missing every time you load it.

### How the wizard decides where to start

When you land on this screen, Serene Pub checks, per step: do you have an active connection, has summarization been marked complete for your account, has RAG been marked complete, do you have at least one character, at least one persona, and at least one chat. If everything required for your role is already true, you get the dashboard. If anything is missing, you get the wizard — and if some steps are already done (for example you have a connection and a character but no persona yet), the wizard skips the Welcome screen entirely and opens directly on the first incomplete step instead of making you click through steps you've already finished.

### Revisiting completed steps

While the wizard is open, the step indicator at the top is a row of numbered circles connected by a progress line. Completed steps show a checkmark and can be clicked to jump back to them; the current step is highlighted; steps you haven't reached yet are dimmed and disabled. You can't skip ahead by clicking — only backward navigation through already-completed steps is allowed, in addition to the **Back**/step-specific action buttons in the footer.

### Skipping steps

Summarization, RAG, character, and persona can all be explicitly skipped with a **Skip for now** button without actually completing the underlying setup. Skipping summarization or RAG simply records that step as acknowledged on your account (so the wizard won't nag you again) without turning either feature on. Skipping character or persona just moves you forward — since the dashboard view requires an actual character/persona/chat to appear, skipping those steps means you'll see the wizard again next time until you actually create one.

### What non-admin users see

Because connecting an AI provider, enabling summarization, and configuring RAG are all server-wide settings, they only ever appear for admin accounts. A non-admin user's wizard is just four steps: Welcome, Character, Persona, Create Chat. Everything else about how the wizard behaves — auto-skipping, step indicators, the dashboard hand-off — works identically for admins and non-admins alike.
