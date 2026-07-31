# Personas

A persona is how _you_ show up inside a chat — your name, your avatar, your written description — separate from the [Characters](./characters.md) the AI plays. This page covers persona fields, the two ways to create one, the community persona library, and how to manage several personas at once.

## Overview

In Serene Pub, every chat has two kinds of participants: Characters, which are driven by the AI, and Personas, which represent human participants — typically you. When the setup wizard runs for the first time, it creates a starter persona named "You" and marks it as your default, but you are free to create as many personas as you like and switch between them per chat. A persona you create in one chat is reusable in any other chat — it lives in your personal persona library alongside your characters and lorebooks.

Personas are managed from the Personas sidebar panel, opened from the app's main navigation. From there you can create, search, view, edit, and delete personas, or pull ready-made ones from the built-in persona library.

## Persona Fields

The full persona editor exposes the following fields. Fields marked with an eye icon in the UI are explicitly flagged as visible to the model — they get sent into the chat prompt.

### Name

A required text field. This is how the persona is addressed in conversation and is injected into prompts, so pick something you want the AI to actually call you — a real name, a nickname, or a role-based identity like "Dr. Smith" or "The Investigator."

### Aliases

An optional, collapsible list of alternate names for the persona. Click "Aliases" to expand the section, then use "Add Alias" to add entries and the minus button to remove them. Like the name, aliases are visible to the model in prompts.

### Summary

An optional short text field (capped at 200 characters) hidden behind a collapsible "Summary" section. The form describes it as "used as a concise graph node description" and explicitly states it is **not** injected into chat context — it exists to give the persona a short label for graph/retrieval bookkeeping rather than for the prompt itself.

### Description

A required, longer free-text field. This is the persona's main body of text — background, personality, communication style — and is visible to the model in prompts. The persona creator wizard suggests including your background, interests, and communication style, or the role you want to play.

### Tags

An optional multi-select field shared with the same tagging system used elsewhere in the app. Type into the tag box to see autocomplete suggestions from your existing tags, press Enter to add a new one on the fly, or click an existing tag chip to remove it from the persona. See [Tags](./tags.md) for how tags work across the app.

### Creator and Category

Two optional free-text fields, always visible on the full Persona Form (not hidden behind any toggle): **Creator** names whoever authored the persona card, and **Category** is used to group the persona within the community persona library.

### Avatar and Image Gallery

An avatar image can be uploaded via a drag-and-drop dropzone (JPG, PNG, or GIF) directly in the persona form. The gallery of additional images is separate from the form, though — once a persona exists, open its **View** panel and switch to the **Gallery** tab to upload more images, click a thumbnail to open it in a lightbox, use its **⋮** menu to **Set as avatar** or **Delete** it, or drag thumbnails to reorder them. The currently active avatar is highlighted in the gallery grid.

### Default Persona Flag

A persona can be flagged as your default persona (shown as a "Default" badge on its view panel) — the starter persona the setup wizard creates for you is flagged this way automatically. You can change which persona holds the flag at any time: each persona's overflow (⋯) menu in the sidebar list (or card view) has a **Set as default** action (disabled, and labeled "Default" instead, on whichever persona currently holds it). Choosing it clears the flag from your previous default and sets it on the newly selected persona — the flag is scoped to your account, so it doesn't affect any other user's personas.

### Required vs. Optional Fields

Only **Name** and **Description** are required — the form will not let you save without them, and both show a red-bordered input with an inline error message if left blank. Aliases, Summary, Tags, and Avatar are all optional and can be filled in at any time by editing the persona later.

## Personas vs. Characters

It's worth being explicit about the distinction, since the two editors look similar: a [Character](./characters.md) is an AI-driven participant with its own personality that the model plays, while a persona is your (or another human participant's) identity in the same conversation. A chat typically pairs one or more personas with one or more characters — a persona's Name, Aliases, and Description are written from a first-person, "this is who I am" perspective, in contrast to the third-person character-sheet style used for characters.

## Creating a Persona

From the Personas sidebar panel, click the **New** button (plus icon, titled "Create New Persona"). What happens next depends on whether **Easy Persona Creation** is turned on in your [user settings](./users-and-accounts.md) (it is on by default):

- **Easy Creation Mode on** — opens the step-by-step Persona Creator wizard in a modal.
- **Easy Creation Mode off** — opens the full Persona Form directly in the sidebar panel, with every field (name, aliases, summary, description, tags, avatar) available at once.

Editing an existing persona always uses the full Persona Form, regardless of the Easy Creation Mode setting — the setting only affects what happens when you click "Create New Persona" for a brand-new persona.

### The Full Persona Form

The full form is the same editor used for both creating (when Easy Creation Mode is off) and editing any persona. It shows a header with a back/cancel arrow, a title ("Create Persona" or "Edit: <name>"), and a Save/Update button that highlights green once you have unsaved changes. Keyboard shortcuts are available while the form has focus: Ctrl/Cmd+S saves, and Escape cancels (prompting a confirmation dialog if you have unsaved changes).

## Easy Creation Mode

Easy Creation Mode is a toggle in **User Settings** labeled "Easy Persona Creation" (there's a matching "Easy Character Creation" toggle for [Characters](./characters.md)). It is enabled by default for new accounts.

When enabled, clicking "Create New Persona" opens the **Persona Creator** — a focused, three-step modal wizard instead of the full form:

1. **Name** — required. Prompt: "What's your persona's name?" with example names and a short guideline about choosing an identity for conversations.
2. **Avatar** — optional and skippable. Upload an image via drag-and-drop or a "Skip" button to move on without one.
3. **Description** — required. Prompt: "Describe yourself," with guidance to include background, interests, and communication style, plus a worked example.

A progress bar across the top fills in as you advance, and Previous/Next buttons (or Skip, on the avatar step) move between steps. On the final step the Next button becomes "Create Persona." Closing the wizard with unfilled data prompts a "Discard Persona?" confirmation before it throws away your entries.

Turning Easy Creation Mode off in User Settings switches "Create New Persona" over to opening the full Persona Form instead, giving you aliases, summary, and tags up front rather than as a follow-up edit. Both paths create the same kind of persona — the wizard just collects a reduced set of fields first (name, avatar, description) and leaves aliases, summary, and tags to be added later via editing.

## Viewing, Editing, and Deleting a Persona

Clicking a persona in the sidebar list opens a compact view panel showing its avatar, name, "Default" badge (if applicable), tags, and description, along with buttons to open its chats, export it, or jump into editing. From the view panel's message-square button you're taken to the Chats panel with that persona pre-selected, the download-icon button opens the export dialog (see Exporting a Persona, below), and "Edit" opens the full Persona Form.

Each persona in the sidebar list also has an overflow (⋯) menu with **View**, **Edit**, **Export**, **Set as default** (disabled, and labeled "Default," if it already holds the flag — see Default Persona Flag, above), and **Delete** actions. Deleting asks for confirmation ("Delete Persona? This action cannot be undone") and performs a soft delete — the persona is hidden from your library rather than immediately purged.

### Exporting a Persona

Both the view panel's export button and the sidebar list's overflow-menu **Export** action open the same **Export Persona** dialog, offering **Export as JSON** (a standard persona-card JSON file) and **Export as PNG Card** (embeds the card data into the persona's avatar image and downloads it as a PNG). The PNG option is disabled and relabeled "Export as PNG Card (No Avatar)" if the persona has no avatar image set. Unlike character export, there's no option to embed a lorebook — personas aren't bound to a lorebook of their own the way characters can be (see [Characters](./characters.md#exporting-a-character)).

### Unsaved Changes Protection

Both the full Persona Form and the Persona Creator track whether you've made changes. If you try to close either one — via the Cancel/back button, Escape, or navigating away — while there are unsaved edits, a confirmation dialog appears asking you to keep editing or discard the changes, so accidental clicks don't silently lose your work.

## Browsing the Persona Library

The Personas sidebar shows three buttons above the list: **New**, **Import**, and **Browse**.

- **Import** (upload icon) opens a dialog with a drag-and-drop file uploader accepting PNG, APNG, JPEG, JPG, WEBP, or JSON files, for importing a persona card you already have on disk.
- **Browse** (library icon) takes you to a full-page **Persona Library** rather than a sidebar dialog — a browsable catalog of community-contributed personas pulled live from Serene Pub's public persona-list repository, grouped into category sections. A search box filters by name, description, category, or tag as you type (debounced) or immediately on Enter. Selecting a result opens a detail view with its full description, tags, author, version, and card spec, plus an image preview if one is provided. A **Download Persona** button in that detail view downloads the entry and adds it to your own persona library.

Unlike the Character Library, the Persona Library currently only draws from that one catalog — there's no equivalent of the larger third-party CharaVault source described in [Characters](./characters.md#library-source), since CharaVault doesn't host a persona catalog.

### Persona Cards Use the Same Format as Character Cards

Both the library import and the file upload path parse persona data using the same character-card parser used for [Characters](./characters.md) (spec V2/V3 PNG or JSON cards), including extracting an embedded avatar image if present. This means persona cards exported from Serene Pub or compatible tools can be shared and re-imported the same way character cards can — see [Importing from SillyTavern](./importing-from-sillytavern.md) for more on card-based imports.

## Assigning Personas to Chats

A chat can have more than one persona attached at once, just as it can have more than one character. When creating or editing a chat, use the persona picker to add personas via a searchable "Select Persona" modal (filtered to personas not already in the chat), and remove one via a confirmation dialog. This supports both a single person switching identity between chats and multiple human participants in the same group chat, each represented by their own persona. See [Chats](./chats.md) for the full chat participant model.

### Persona Lorebook Bindings

If a chat's [lorebook](./lorebooks.md) uses name-binding placeholders, personas participating in that chat are automatically given a binding the same way characters are, so lorebook entries can reference a persona by its bound token. You don't need to configure this manually — bindings are created automatically the first time a persona joins a bound chat.

## Managing Multiple Personas

The Personas sidebar list is meant to support keeping a whole roster of personas — one for a fantasy campaign, one for a more grounded chat, one just called "You" for everyday use, and so on. Each list entry shows the persona's avatar, name, a two-line description excerpt, and an embedding status icon indicating whether the persona has been processed for retrieval.

### Searching Your Personas

The search box above the persona list filters as you type, matching against a persona's name, its description text, and any tags attached to it. This is the fastest way to find a specific persona once your library grows beyond a handful of entries.

### Personas Are Per Account

Personas belong to the user account that created them — each account has its own private persona library, separate from any other account's. See [Users and Accounts](./users-and-accounts.md) for account-level details.

### The Setup Wizard's Starter Persona

The first-run setup wizard offers a one-click option that creates a starter persona named "You," pre-filled with a description explaining that it represents you in conversations and can be edited or replaced later. It's created with the default-persona flag set, giving new accounts a working persona without having to go through the creator wizard immediately.

### Personas and Retrieval

Whenever a persona is created or updated, it is automatically queued for vectorization in the background, making its description and summary available to the app's retrieval-augmented context system. See [Embeddings & RAG](./embeddings-and-rag.md) for how that indexing is used during chat.
