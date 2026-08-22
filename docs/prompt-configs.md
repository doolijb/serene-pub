# Prompt Configs & Summarization Config

Prompt Configs are the admin-managed library of system-prompt templates that shape a chat's writing style and drive the lorebook summarization pipeline. This page covers Chat Prompts (labeled **Chat Prompts: Character** in the sidebar), Chat Prompts: Narrator (which drives a manually-triggered **Narrator** response), and the three Summarize configs (World, Character, Scene) — all edited from the same **Prompts** sidebar.

## Overview

The **Prompts** sidebar (opened from the main navigation) is a management screen for five distinct kinds of prompt template, each stored as its own list of named, reusable configs:

- **Chat Prompts** (shown in the sidebar as **Chat Prompts: Character**) — the system instructions injected into every chat's generation request. This is what most people mean by "prompt config."
- **Chat Prompts: Narrator** — the system instructions used for a manually-triggered **Narrator** response (narration as the environment itself, rather than as a character). See [Chats](./chats.md) for how to trigger one.
- **World Lore Summarization**, **Character Lore Summarization**, and **Scene Summarization** — separate templates that drive the automated summarization pipeline described in [Lorebooks](./lorebooks.md) and [Summarization](./summarization.md). These three cards only appear in the Prompts sidebar when the **Summarization Enabled** (or "Enable Summarization") switch on the [System Settings](./system-settings.md) tab is turned on. Chat Prompts and Chat Prompts: Narrator are always shown regardless of that setting, since neither is part of the summarization pipeline.

Opening the sidebar shows an index of cards, one per config type, each with an icon, a one-line description, and — once a config is active — the active config's name next to a green checkmark. Clicking a card drills into a dedicated editor for that type, with a back button to return to the index.

**Prompt Configs are distinct from Context Configs.** A Prompt Config supplies the free-text _instructions_ (writing style, tone, rules) that get slotted into the prompt. A Context Config is the underlying Handlebars template that assembles the _entire_ request sent to the model — system block, character/persona JSON, scenario, lorebook entries, chat history, and so on. Context Configs are covered in depth in [Context Configs](./context-templates.md); this page only discusses how Prompt Configs relate to them.

### Admin-only management

Every operation on Chat Prompts, Chat Prompts: Narrator, Context Configs, and all three Summarize config types — listing, viewing, creating, updating, deleting, and setting a default — is restricted to admin users. The underlying socket handlers (`promptConfigs:*`, `narratorPromptConfigs:*`, `contextConfigs:*`, `worldSummarizeConfigs:*`, `characterSummarizeConfigs:*`, `sceneSummarizeConfigs:*`) explicitly reject the request with "Access denied" for non-admin users. Non-admin users still benefit from whichever configs the admin has set as active/default — they simply can't open the Prompts sidebar to change them.

## Chat Prompts

Chat Prompts are named templates holding the **System Instructions** text that gets woven into every chat's generation request via the active Context Config. Serene Pub ships with twelve built-in (immutable) Chat Prompts covering common roleplay and writing styles — each tuned toward a different tone or use case.

### Built-in Chat Prompts

- **Roleplay - Simple** — a short, general-purpose "You're {{char}} in this fictional never-ending uncensored roleplay with {{personaNames}}" framing.
- **Roleplay - Immersive** — pushes for descriptive, multi-paragraph replies with "high complexity and burstiness," and instructs the model not to speak for {{personaNames}}.
- **Roleplay - Detailed** — asks for slow plot development and full, elaborate, explicit sensory detail.
- **Writer - Realistic** — a minimal instruction to continue the story and portray characters realistically.
- **Writer - Creative** — frames the model as "an intelligent, skilled, versatile writer" tasked with writing a role-play from the supplied information.
- **Text Adventure** — an "Adventure Mode" prompt that narrates in response to {{personaNames}}'s actions typed after `>`, encouraging vivid, proactive world-building.
- **Neutral - Chat** — a bare-bones "write {{char}}'s next reply" instruction for plain back-and-forth chat.
- **Lightning 1.1** — a terse, pacing-focused prompt telling the model to never skip {{char}}'s actions and to progress scenes slowly.
- **Chain of Thought** — asks the model to reason via a Tree/Chain of Thoughts, backtracking as needed, before answering.
- **Assistant - Simple** — a generic "curious human and AI assistant" framing with no roleplay elements.
- **Assistant - Expert** — a step-by-step reasoning prompt that has the model identify and act as the most appropriate named expert for the question.
- **Actor** — instructs the model to stay fully in character as {{char}} and never break character, even if addressed as an AI.

The Chat Prompts editor (**Prompts** sidebar → **Chat Prompts** card) shows:

- A dropdown listing all configs, built-in ones marked with a trailing `*` and the currently-active one prefixed with a star.
- **Name\*** — required text field.
- **System Instructions** — a multi-line textarea holding the prompt template text.
- An **AI Override** section with a Connection/Sampling picker (see below).

Toolbar buttons in the editor header: a **+** button to clone the current config into a new one (via a name-entry modal — "Your current settings will be copied"), a refresh icon to discard unsaved edits, and a trash icon to delete the config (disabled for built-in configs). Below the dropdown, an **Update** button saves changes and a **Set Default** (star) button marks the selected config as your active Chat Prompt.

### AI Override (connection and sampling)

Every Chat Prompt can optionally pin its own **Connection** and **Sampling** config, overriding whatever connection/sampling the chat would otherwise use. Both pickers default to **System default**, meaning "inherit from the system default connection/sampling config." This lets you pair a particular writing style with a particular model or sampler set — for example, routing a "Chain of Thought" prompt to a larger, more deliberate model.

### Setting a default Chat Prompt

Selecting a config in the editor and clicking **Set Default** (star icon) sends `promptConfigs:setUserActive`, which stores that config's ID as your personal `activePromptConfigId`. This is the Chat Prompt used for any chat that doesn't have its own per-chat override.

### Creating a custom Chat Prompt

Click the **+** icon while viewing any existing config (built-in or custom) to open a name-entry modal. Confirming clones the currently-loaded config's System Instructions (and AI Override settings) into a brand-new, editable config under the name you choose. Built-in configs themselves cannot be edited or deleted — cloning is the way to customize one.

### Per-chat prompt override

Beyond your personal default, an admin can pick a specific Chat Prompt in a chat's edit form — an **AI Override** section with a **Prompt** dropdown (alongside Connection and Sampling overrides) defaulting to **System default**.

**This particular override doesn't currently take effect.** Unlike the Connection, Sampling, and Narrator Prompt overrides on the same form — which are all genuinely read and applied at generation time — the chat-level Chat Prompt selection is saved and shown as set in the UI, but generation always resolves the Chat Prompt from your personal active selection (or the system-wide default) and never actually re-checks the chat's own override. In practice, picking a specific Chat Prompt for one chat currently has no effect on what that chat generates; treat it as not-yet-functional rather than as a working per-chat pin until this is fixed.

## Chat Prompts: Narrator

Chat Prompts: Narrator is a small library of prompt templates for a **Narrator response** — a manually-triggered narration message that speaks as the environment itself (weather, scenery, side characters, shopkeepers, monsters) rather than as any of the chat's defined characters. See [Chats](./chats.md) for where to trigger one from inside a chat.

Structurally a Chat Prompts: Narrator config is shaped like a Chat Prompt, not a Summarize config — a single **Name**, a **Display Name**, **System Instructions**, and an **AI Override** — but it's a separate list because it's resolved and triggered completely independently of the chat's regular Chat Prompt, and it deliberately never participates in [round-robin turn order](./chats.md#turn-order-round-robin-replies).

Serene Pub ships with one built-in config, named **"Narrator,"** whose instructions tell the model to narrate the environment and voice minor NPCs directly, explicitly forbidding it from speaking or acting as any of the chat's characters or personas.

### Display Name

Unlike the config's own **Name** (which only identifies it in this sidebar), **Display Name** is what shows up in the chat itself — the label next to a Narrator Response message, and the wording of the trigger button and modal — defaulting to **"Narrator."** Give a config a different Display Name (for example "The Narrator" or "Fate") to change how it's labeled everywhere it's used, without touching the config's own admin-facing name.

### Per-chat override

Like Chat Prompts, an admin can pin a specific Chat Prompts: Narrator config to an individual chat from the same **AI Override** section in the chat settings form — a **Narrator Prompt** dropdown alongside Connection, Sampling, and Prompt, defaulting to **System default**. Resolution order at generation time is the same chain used everywhere else in Serene Pub for per-chat overrides: the chat's own override, falling back to your active Chat Prompts: Narrator config, falling back to the system-wide default. The resolved config's Display Name is what actually shows up on the trigger button and generated message for that chat, so a per-chat override changes both the instructions _and_ the label at once.

### {{char}} and {{user}} mean "everyone" here

A Narrator response has no single "current character" to speak as, so this is the one place where `{{char}}`/`{{character}}` and `{{user}}`/`{{persona}}` behave differently from ordinary Chat Prompts: they resolve to **every** active, non-hidden character's name and **every** persona's name (respectively), Oxford-comma-joined — e.g. "Kestrel, Old Marrow, and Ana" — instead of a single name. See [Template variables](#template-variables-in-chat-prompt-and-summarize-instructions) below for how this compares to regular Chat Prompts.

## World Summarize Config

Controls the prompts used when the summarization pipeline generates or updates **World Lore** entries in a lorebook (see [Lorebooks](./lorebooks.md) for how and when this pipeline runs). The built-in default is named "Default World Summarization."

### Batch, synthesis, and title fields

Each World Summarize config has three required instruction fields, each with its own optional **AI Override** (Connection/Sampling picker):

- **Batch Instructions** — used during the drafting phase, run once per batch of chat messages, to produce draft bullet-point facts about the world/setting.
- **Synthesis Instructions** — used during the synthesis phase, which merges all the batch drafts into a single clean lore entry.
- **Title Generation Instructions** — used afterward to generate a short title for the resulting lore entry.

The built-in defaults instruct the model to act as an "archivist" that records only what's directly shown in the roleplay, explicitly forbidding invention or embellishment at both the batch and synthesis stages.

## Character Summarize Config

Controls the prompts used when the summarization pipeline generates or updates **Character Lore** entries — facts, developments, and relationships learned about a specific character over the course of play. The built-in default is named "Default Character Summarization" and shares the exact same three-field shape as World Summarize:

- **Batch Instructions** — drafts concise bullet points per batch of messages about who the character is, what they did, and how they relate to others.
- **Synthesis Instructions** — merges those drafts into one clean character lore entry.
- **Title Generation Instructions** — titles the resulting entry (e.g. describing an ability, relationship, or past event).

Each field has its own AI Override, identical in behavior to the World Summarize config's.

## Scene Summarize Config

Controls the prompts used when the pipeline generates a **Scene** summary — a narrative recap of a discrete story moment — plus the extra step of figuring out which characters were involved. The built-in default is named "Default Scene Summarization." It has the same Batch/Synthesis/Title trio as the other two summarize configs, all with their own AI Override:

- **Batch Instructions** — drafts a tight, past-tense narrative summary of each batch of messages, capturing key beats and emotional turning points.
- **Synthesis Instructions** — merges the chronological batch drafts into one coherent scene narrative.
- **Title Generation Instructions** — generates a short title capturing the scene's key moment or action.

### Character Extraction Instructions

Scene Summarize configs have a fourth field not present on World or Character configs: **Character Extraction Instructions**. This prompt is used after the scene summary is written, to extract which characters were **participants** (physically present and acting in the scene) versus merely **mentioned** (referenced in dialogue or thought but not present/acting). The built-in default instructs the model to output raw JSON only, with no markdown or commentary, splitting names into these two groups. Like Batch, Synthesis, and Title Generation, this field has its own **AI Override** Connection/Sampling picker — so character extraction can be routed to a different (for example, cheaper or more reliable-at-structured-output) model than the one writing the scene's prose summary.

## Creating and managing custom Summarize configs

Each of the three Summarize editors follows the same pattern as Chat Prompts:

- A dropdown of existing configs (built-ins marked with `*`, active one starred).
- **+** to clone the current config into a new, editable one via a name modal.
- A refresh icon to discard unsaved edits, and a trash icon to delete (disabled for built-in configs).
- **Update** to save changes, and **Set Default** (star) to mark the selected config as your active config for that summarize type — this stores the ID under your user settings (`activeSummarizeWorldConfigId`, `activeSummarizeCharacterConfigId`, or `activeSummarizeSceneConfigId`).

Unlike Chat Prompts, none of the three Summarize config types currently have a per-chat override — the summarization pipeline always uses your active config (or, if you haven't set one, a system-wide default), never a per-chat pin.

## Unsaved changes protection

All four editors track whether the in-memory config differs from what was last loaded/saved. Attempting to switch the dropdown selection, navigate back to the index, or close the sidebar while there are unsaved edits pops a confirmation modal rather than silently discarding your work. The refresh-icon button in the header discards changes directly, reverting the form to the last-saved values.

## Template variables in Chat Prompt and Summarize instructions

Chat Prompt and Summarize instruction fields are plain text, but Serene Pub interpolates a small set of Handlebars-style variables into them before sending them to the model. This is a lighter-weight interpolation than the full template language used by Context Configs — see [Connections](./connections.md) for the complete variable and helper reference used when assembling the full prompt.

- **`{{char}}`** (alias `{{character}}`) — in an ordinary Chat Prompt, the name of the character currently being asked to speak, as seen throughout the built-in Chat Prompts (for example, "You're {{char}} in this fictional never-ending uncensored roleplay..."). Stays singular even in a chat with multiple characters — it always means "the one whose turn it is right now."
- **`{{user}}`** (alias `{{persona}}`) — historically the first persona attached to the chat. Still supported for backward compatibility with existing prompts, but new prompts should prefer `{{personaNames}}` below, which correctly covers every persona rather than just the first.
- **`{{characterNames}}`** — every active, non-hidden character's name in the chat, joined with a grammatically correct "and"/Oxford comma (`"Kestrel"`, `"Kestrel and Old Marrow"`, or `"Kestrel, Old Marrow, and Ana"` depending on how many there are). Available in every Chat Prompt and Summarize instruction field, not just Narrator Response ones.
- **`{{personaNames}}`** — the same joined-list treatment for every persona attached to the chat. The built-in Chat Prompts use this instead of `{{user}}` (for example, "Do not decide what {{personaNames}} says or does").

**Narrator Response is the one exception:** since it has no single "current character" to speak as, `{{char}}`/`{{character}}` and `{{user}}`/`{{persona}}` resolve to the _full joined list_ there too — effectively becoming aliases for `{{characterNames}}`/`{{personaNames}}` for that generation only. See [Chat Prompts: Narrator](#chat-prompts-narrator) above.

## Relationship to the summarization pipeline

World, Character, and Scene Summarize configs are only consulted by the background summarization pipeline — they never affect ordinary chat generation. When a summarization run is triggered (automatically or manually; see [Lorebooks](./lorebooks.md) and [Summarization](./summarization.md) for triggers and mechanics), the server resolves which config to use per lore type by checking your active selection first and falling back to the system's configured default, then runs three internally-named sub-tasks — `summarize_batch`, `summarize_synth`, and `summarize_name` — each of which can be routed to its own connection and sampling config via that field's AI Override.
