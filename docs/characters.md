# Characters

Characters are the personas the AI plays in a chat — everything from their name and backstory to how they greet you and speak. This page covers every field on a character, how avatars and image galleries work, the two ways to create a character, importing from the built-in library or a file, exporting a character card, and controlling how much of a character's info is exposed inside a given chat.

## Overview

Every character lives in your personal character list, accessible from the Characters sidebar. From there you can create a character from scratch, import an existing character card (PNG, APNG, JPEG, JPG, WEBP, or JSON), or browse the community character library. Each character has a required **Name** and **Description**; every other field is optional. Characters can be attached to a [lorebook](./lorebooks.md) for world/setting info, tagged for organization (see [Tags](./tags.md)), marked as a favorite, and added to any number of [chats](./chats.md), including group chats with multiple characters.

Characters are private to your account — the character list is scoped to the logged-in user, so different accounts on the same Serene Pub instance don't see each other's characters. See [Users & Accounts](./users-and-accounts.md) for more on account scoping.

### Characters vs. Personas

A **character** is the persona the AI plays; a [persona](./personas.md) is the persona _you_ play as when chatting. Both are configured separately but follow a similar create/edit/avatar pattern — this page covers characters specifically.

### Searching the Character List

The search box above the character list filters as you type, matching against the character's **name**, **description**, and any attached **tags**. Favorited characters are always sorted to the top of the list, regardless of the search filter.

### The Vectorization Status Icon

Each character row shows a small status icon next to its name reflecting whether that character has been embedded for retrieval-augmented generation: a lightning-bolt icon means the character's vector embedding is up to date with the active embedding model, a refresh icon means the embedding is stale because the embedding model has since changed, and no icon appears if vectorization is disabled or the character hasn't been embedded yet. See [Embeddings & RAG](./embeddings-and-rag.md) for how character data feeds into retrieval.

## Character Fields

The character edit form (opened via **Edit** on any character) exposes the following fields. Fields marked with the eye icon are explicitly noted in the UI as "This field will be visible in prompts" — meaning they get sent to the LLM as part of the character's context.

- **Name\*** — required. The character's full or primary name.
- **Nickname** — optional. If set, the nickname is used in conversations and prompts instead of the full name.
- **Aliases** — a list of alternate names/spellings for the character (collapsible, advanced field).
- **Summary** — a short (up to 200 characters) one- or two-sentence description. The form notes this is "used as a concise graph node description" and is **not** injected into chat context — it exists for [RAG/graph](./embeddings-and-rag.md) lookups, not for prompting.
- **Description\*** — required. The character's core description (appearance, background, role).
- **Personality** — the character's personality traits and behavior. Marked visible in prompts.
- **Scenario** — the setting/situation the character is placed in. The UI notes this field is excluded from group chats. Hidden behind "Show All Fields" unless that setting is enabled.
- **Greeting (First Message)** — the character's opening message when a chat starts.
- **Alternate Greetings** — a list of additional possible opening messages (advanced field).
- **Example Dialogues** — a list of sample exchanges that teach the model the character's voice (advanced field).
- **Creator Notes** — free-text notes from whoever authored the character card (advanced field).
- **Creator Notes (Multilingual)** — per-language creator notes, keyed by language code (advanced field).
- **Group-Only Greetings** — greetings that are only used when the character is part of a group chat (advanced field).
- **Post-History Instructions** — instructions injected after the chat history, useful for steering behavior late in the prompt (advanced field).
- **Character Version** — a free-text version string (e.g. "1.0") for the character card (advanced field).
- **Creator** — a free-text field naming whoever authored the character card (advanced field).
- **Category** — a free-text field used to group the character within the Character Library (advanced field).
- **Tags** — searchable labels attached to the character; see [Tags](./tags.md).
- **Favorite** — a toggle that pins the character to the top of your character list.

### Advanced Fields and "Show All Fields"

By default, the character form only shows the core fields (Name, Nickname, Aliases, Summary, Description, Personality, Greeting). Scenario, Alternate Greetings, Example Dialogues, Creator Notes, Creator Notes (Multilingual), Group-Only Greetings, Post-History Instructions, and Character Version are hidden behind a **Show All Fields** switch at the bottom of the form. Toggling it is a per-user setting (also available on the User Settings tab as **Show All Character Fields**) and persists across every character you edit afterward.

### Favoriting a Character

Each character has an **isFavorite** flag, toggled with the **Favorite** switch in the edit form. Favorited characters get a highlighted border in the character list and are always sorted before non-favorites.

### Binding a Character to a Lorebook

Characters can be linked to a single [lorebook](./lorebooks.md) via a `lorebookId`. When you import a character card that has an embedded lorebook, Serene Pub will prompt you after import to confirm the lorebook name and import it, associating it with that character.

### Tagging a Character

The **Tags** field is a search-and-create combo box: type to filter your existing tags, click a suggestion to attach it, or press Enter (or click **Create "…"**) to create and attach a brand-new tag on the spot. Selected tags render as removable pills below the field, each colored according to the tag's assigned color preset. See [Tags](./tags.md) for how tags are managed globally.

### Fields Marked Visible in Prompts

Several fields — Name, Nickname, Aliases, Description, Personality, Scenario, Example Dialogues, and Post-History Instructions — are marked in the form with a small eye icon and the tooltip "This field will be visible in prompts." This is a direct signal from the UI about which fields the LLM actually sees versus fields like **Summary** or **Creator Notes** that are for your own organization or for RAG/graph lookups rather than being injected into the prompt every turn.

### Saving, Canceling, and Unsaved Changes

While editing, **Ctrl+S** (or **Cmd+S** on Mac) saves the form and **Escape** cancels, provided the form has focus. If you try to close a character with unsaved edits — via the Cancel button, Escape, or navigating away — a confirmation dialog appears asking whether to discard the changes. The **Create**/**Update** button itself changes color (filled vs. tonal) to indicate whether there are unsaved changes pending.

## Avatar & Gallery

Each character has one active **avatar** image plus an optional image gallery of alternates. The two live in different places: the avatar picker is part of the create/edit form, but the gallery itself is only available from a character's read-only **View** panel, in a dedicated **Gallery** tab — it's not part of the edit form.

- In the create/edit form, drop or click the dashed upload box to select an avatar image (JPG, PNG, or GIF). The image is only staged locally as a preview until you save the character — nothing uploads until you click **Create**/**Update**.
- Use **Clear Selection** to discard a staged (not-yet-saved) avatar file before saving.
- Once a character exists, open its **View** panel and switch to the **Gallery** tab to manage additional images. Here you can:
    - **Upload** additional images to the character's gallery.
    - Click a thumbnail to open it in a **lightbox** for a closer look.
    - Use each thumbnail's **⋮** (overflow) menu to **Set as avatar** or **Delete** it (deletion asks for confirmation).
    - **Drag to reorder** gallery images using each thumbnail's grip handle.
- Broken/missing gallery images are automatically hidden from the grid rather than showing a broken-image icon.
- Deleting a gallery image that's currently set as the character's active avatar automatically clears the avatar field too, so the character falls back to the no-avatar placeholder instead of pointing at a now-missing file.

Gallery and avatar changes take effect immediately (they're saved via their own socket calls, independent of the rest of the character form).

### Where Avatar and Gallery Images Live

Uploaded avatar and gallery images are stored per-character on the server (in that character's own data directory), addressed by path rather than embedded in the database record. When a character is deleted, its entire data directory — avatar plus every gallery image — is removed along with the character record.

## Creating a Character

There are two ways to create a character, both reachable from the **+** button in the Characters sidebar:

- **Character Creator** (guided wizard) — used when the **Easy Character Creation** user setting is enabled (this is the default). It's a 5-step wizard: **Name**, **Avatar**, **Description**, **Personality**, **First Message**. Name and Description are required steps; Avatar, Personality, and First Message can be skipped. Each step includes an inline example and writing guidelines (e.g. what to include in a description vs. a personality). A progress bar shows which step you're on, and leaving with unsaved data prompts a **Discard Character?** confirmation.
- **Full Character Form** — used when Easy Character Creation is disabled. This opens the same detailed form used for editing (see Character Fields above), with every field available immediately (subject to the Show All Fields setting).

### Easy Character Creation Setting

The **Easy Character Creation** switch on the User Settings tab controls which of the two creation flows the **+** button opens. It's on by default. Turning it off routes new-character creation straight to the full form instead of the wizard.

### Editing and Deleting

From the character list, each entry has a menu (the "..." button) with **View**, **Edit**, and **Delete** actions. Deleting a character asks for confirmation ("Delete Character? This action cannot be undone") and removes the character's stored data directory (avatar and gallery images) along with its database record.

### Viewing a Character

Clicking a character in the list (rather than its menu) opens a read-only **View** panel showing avatar, name/nickname, version, tags, description, personality, scenario, and first message, with **View Chats** and **Edit** buttons in the header.

## Browsing the Character Library

The **Character Library** is a searchable catalog of community-contributed character cards, browsed and imported without leaving the app. Open it from the Characters sidebar's **Import Character** button, then choose **Search Library**.

- The library list is fetched live and grouped by **category**, with each entry showing its thumbnail, name, an excerpt of its description, author, and card spec version.
- Type in the search box (debounced) or press **Search** to filter by name, description, category, or tags.
- Clicking an entry opens a detail view with the full description, tags, author, version, spec, and category, plus an **Import Character** button to pull it directly into your own character list. An **Import Character** action also triggers the same lorebook-import prompt as a manual file import if the card includes an embedded lorebook.

### Library Source

The library is sourced live from a public, community-maintained catalog (the `serene-pub-chara-list` repository) rather than being bundled with the app — searching and importing require an internet connection, and new characters added to that catalog show up automatically the next time you open the Character Library.

## Importing a Character from a File

Besides the library, the **Import Character** dialog also accepts a local file upload in PNG, APNG, JPEG, JPG, WEBP, or JSON format — this covers standard character card formats (including cards exported from other apps). See [Importing from SillyTavern](./importing-from-sillytavern.md) for details on cross-compatibility with SillyTavern-style cards. On import, fields such as name, nickname, description, personality, scenario, first message, example dialogues, alternate greetings, creator notes, post-history instructions, character version, aliases, summary, and tags are all mapped in from the card, and the avatar image (if embedded) is extracted and set automatically.

### What Happens After Import

A successful import shows a confirmation toast naming the imported character and immediately refreshes your character list. If the imported card carries an embedded lorebook, a follow-up **Import Lorebook?** dialog appears, pre-filled with the lorebook's name (editable before you confirm), letting you decide whether to bring the world/setting data in alongside the character. See [Lorebooks](./lorebooks.md).

## Exporting a Character

From the edit form of an existing character, click the **export button** (upload icon) in the header to open the **Export Character** dialog, which offers two formats:

- **Export as JSON** — downloads the character as a standard character-card JSON file.
- **Export as PNG Card** — embeds the character card data into the character's avatar image and downloads it as a PNG. This option is disabled ("No Avatar") if the character has no avatar image set.

Both formats build a CharacterCard V2-compatible structure, including the character's tags, so exported characters can be re-imported into Serene Pub or shared with compatible apps.

### Export File Names

Exported files are named automatically from the character's name (lowercased, with non-alphanumeric characters stripped), e.g. a character named "Dr. John Watson" exports as `dr_john_watson.json` or `dr_john_watson.png`.

## Visibility Settings

Beyond the character's own fields, each character has a **per-chat visibility** setting that controls how much of that character's information is exposed to the model when the character is present in a chat but not the one currently responding. This is configured per character, per chat, from the chat's edit screen (see [Chats](./chats.md)) rather than from the character form itself — the same character can be fully visible in one chat and hidden in another.

Each character row in the chat's participant list has a visibility button (an eye icon) that cycles through three levels on click:

- **Full Info** — the character's complete information is shown even when they aren't the one responding.
- **Name Only** — only the character's name/nickname is shown when they aren't responding.
- **Hidden** — the character's info is fully hidden from the prompt when they aren't responding.

The button's tooltip states what happens on the character's _other_ turns — e.g. "When not speaking: Only name/nickname is included" — since a character's own information is always fully included on their own turn regardless of this setting. Its purpose is trimming prompt size in multi-character group chats by hiding detail for characters who aren't currently active in the conversation.

### Active vs. Visible

Separately from visibility, each character in a chat also has an **active/inactive** toggle (a smile/meh icon switch). An inactive character stays listed in the chat but is excluded from participating — this is distinct from the visibility level, which only affects how much of an active-or-inactive character's data is shown in context.

### Why Visibility Matters in Group Chats

Visibility levels matter most in chats with several characters at once: with every character set to Full Visibility, the prompt sent to the model grows with each additional participant, since all of their descriptions, personalities, and other prompt-visible fields are included every turn. Setting less-central characters to Minimal Visibility or Hidden keeps the prompt smaller and cheaper while the model is generating a different character's response, without removing them from the chat.

## Characters in Chats

A character isn't tied to a single conversation — the same character can be added to any number of [chats](./chats.md), including one-on-one chats and group chats with multiple characters and personas together. Characters are added to a chat, reordered by drag handle, and have their active state and visibility level managed from the chat's edit screen, as described above.
