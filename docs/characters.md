# Characters

Characters are the people in a session — the ones the AI plays and, since the library merge, the ones _you_ play too (your [personas](./personas.md)) — everything from their name and backstory to how they greet you and speak. This page covers every field on a character, how avatars and image galleries work, the two ways to create a character, importing from the built-in library or a file, exporting a character card, and controlling how much of a character's info is exposed inside a given session.

## Overview

Every character lives in your personal character list, accessible from the Characters sidebar. The **New** button at the top of the list opens a menu with the three ways to add one: **Write a character** starts from a blank card, **Browse the library** opens the community character library, and **Import a card** brings in an existing character card (PNG, APNG, JPEG, JPG, WEBP, JSON, or CHARX). Dropping a card file anywhere on the list imports it too. Each character has a required **Name** and **Description**; every other field is optional. Characters can be attached to a [lorebook](./lorebooks.md) for world/setting info, tagged for organization (see [Tags](./tags.md)), marked as a favorite, and added to any number of [sessions](./sessions.md), including group sessions with multiple characters.

Characters are private to your account — the character list is scoped to the logged-in user, so different accounts on the same Serene Pub instance don't see each other's characters. See [Users & Accounts](./users-and-accounts.md) for more on account scoping.

### Characters and Personas

A [persona](./personas.md) is a character _you_ play. There is one library and one form; a **Persona** flag on the character marks the ones that are yours to voice, and the same character can be AI-driven in one session and your persona in another. This page covers the character itself; the persona page covers the flag, the default persona and how personas behave in sessions.

### Searching the Character List

The filter box at the top of the list narrows it as you type, matching the character's **name**,
**description**, and any attached **tags**. The sliders button beside it opens a filter menu:
**All**, **Favorites**, **Personas**, or one of your tags, each tag with its colour. Pick one and a
small chip under the toolbar shows it, with an **×** to clear it. The two icons at the right switch
between a grid of portrait cards, which is the default, and a list; the choice is remembered on
this browser. Favorited characters always sort to the top of their folder. Jump (Ctrl K) with
Characters open drives the same filter.

Characters you have put in a [folder](#folders) are listed under that folder's header, which
collapses on click; characters in no folder come first, under no header. A filter that empties a
folder hides the folder.

Each row shows the avatar, the name with a small star when favorited and a small person badge
when it is one of your personas, the first line of the description, and the first tag as a
coloured chip, with **+N** when there are more. The row's menu (⋮) offers **View**, **Edit**,
**Export**, **Use as persona** (or **Not a persona**), **Set as default persona**, **Move to
folder…** and **Delete**.

### The Vectorization Status Icon

Each character row shows a small status icon next to its name reflecting whether that character has been embedded for retrieval-augmented generation: a lightning-bolt icon means the character's vector embedding is up to date with the active embedding model, a refresh icon means the embedding is stale because the embedding model has since changed, and no icon appears if vectorization is disabled or the character hasn't been embedded yet. See [Embeddings & RAG](./embeddings-and-rag.md) for how character data feeds into retrieval.

## Character Fields

The character edit form (opened via **Edit** on any character) exposes the following fields. Fields marked with the eye icon are explicitly noted in the UI as "This field will be visible in prompts" — meaning they get sent to the LLM as part of the character's context.

- **Name\*** — required. The character's full or primary name.
- **Nickname** — optional. If set, the nickname is used in conversations and prompts instead of the full name.
- **Aliases** — a list of alternate names/spellings for the character.
- **Summary** — a short (up to 200 characters) one- or two-sentence description. The form notes this is "used as a concise graph node description" and is **not** injected into session context — it exists for [RAG/graph](./embeddings-and-rag.md) lookups, not for prompting.
- **Description\*** — required. The character's core description (appearance, background, role).
- **Personality** — the character's personality traits and behavior. Marked visible in prompts.
- **Scenario** — the setting/situation the character is placed in. The UI notes this field is excluded from group sessions. Hidden behind "Show All Fields" unless that setting is enabled.
- **Greeting (First Message)** — the character's opening message when a session starts.
- **Alternate Greetings** — a list of additional possible opening messages (advanced field).
- **Example Dialogues** — a list of sample exchanges that teach the model the character's voice (advanced field).
- **Creator Notes** — free-text notes from whoever authored the character card (advanced field).
- **Creator Notes (Multilingual)** — per-language creator notes, keyed by language code (advanced field).
- **Group-Only Greetings** — greetings that are only used when the character is part of a group session (advanced field).
- **Post-History Instructions** — instructions injected after the session history, useful for steering behavior late in the prompt (advanced field).
- **Character Version** — a free-text version string (e.g. "1.0") for the character card (advanced field).
- **Creator** — a free-text field naming whoever authored the character card (advanced field).
- **Category** — a free-text field used to group the character within the Character Library (advanced field).
- **Tags** — searchable labels attached to the character; see [Tags](./tags.md).
- **Favorite** — a toggle that pins the character to the top of your character list.

### The Editor's Tabs, and "Show All Fields"

The editor opens on the character's name and nickname beside the avatar, and sorts everything else
into three tabs. **Profile** holds Summary, Description, Aliases, Tags and Favorite. **Voice** holds
Personality and First message. **Notes** holds Creator notes. Turning on **Show all fields**, at the
foot of the form, adds the rest of what a character card can carry: Version, Creator and Category
on Profile; Scenario, Alternate greetings, Example dialogues, Group-only greetings and Post-history
instructions on Voice; and the multilingual creator notes on Notes. The switch is a user setting
and is remembered.

A tab whose required field is missing shows a small red dot. The **Save** button at the top right
lights up gold when there are unsaved changes; **Ctrl S** saves and **Esc** leaves the form while
the cursor is inside it.

### Favoriting a Character

Each character has an **isFavorite** flag, toggled with the **Favorite** switch in the edit form. Favorited characters get a highlighted border in the character list and are always sorted before non-favorites.

### The Persona Flag

Beside **Favorite**, the form has a **Persona** switch ("a character you play") and, under it, **Default persona**. The Persona flag is also set for you the first time the character joins a session as your persona, and it can be toggled from the row's ⋮ menu. What the flag means, and what the default is for, is on the [Personas](./personas.md) page.

### Folders

Folders group characters in the list for your own organisation — "Campaign 2", "Retired", "NPCs". They are flat (no folders inside folders), a character sits in one folder or none, and a folder holds only characters. Folders are yours alone and never affect a session or a prompt.

- **New folder** under the **New** button creates one; folder names are unique within your account.
- **Move to folder…** in a character's ⋮ menu opens a picker listing your folders plus **No folder**; choosing one moves the character there, and **No folder** takes it back out.
- A folder header shows its name and character count; click it to collapse or expand, and use its own ⋮ menu to **Rename** or **Delete** the folder. Deleting a folder keeps its characters — they simply return to the top of the list.

Folders and [tags](./tags.md) are different tools: a tag is a label a character can carry several of and that also applies to lorebooks and sessions; a folder is one place in one list.

### Tagging a Character

The **Tags** field is a search-and-create combo box: type to filter your existing tags, click a suggestion to attach it, or press Enter (or click **Create "…"**) to create and attach a brand-new tag on the spot. Selected tags render as removable pills below the field, each colored according to the tag's assigned color preset. See [Tags](./tags.md) for how tags are managed globally.

### Saving, Canceling, and Unsaved Changes

While editing, **Ctrl+S** (or **Cmd+S** on Mac) saves the form and **Escape** cancels, provided the form has focus. If you try to close a character with unsaved edits — via the Cancel button, Escape, or navigating away — a confirmation dialog appears asking whether to discard the changes. The **Create**/**Update** button itself changes color (filled vs. tonal) to indicate whether there are unsaved changes pending.

### Binding a Character to a Lorebook

Characters can be linked to a single [lorebook](./lorebooks.md) via a `lorebookId`. When you import a character card that has an embedded lorebook, Serene Pub will prompt you after import to confirm the lorebook name and import it, associating it with that character.

### Fields Marked Visible in Prompts

Several fields — Name, Nickname, Aliases, Description, Personality, Scenario, Example Dialogues, and Post-History Instructions — are marked in the form with a small eye icon and the tooltip "This field will be visible in prompts." This is a direct signal from the UI about which fields the LLM actually sees versus fields like **Summary** or **Creator Notes** that are for your own organization or for RAG/graph lookups rather than being injected into the prompt every turn.

## Avatar & Gallery

Each character has one active **avatar** image plus an optional image gallery of alternates. The two live in different places: the avatar picker is part of the create/edit form, but the gallery itself is only available from a character's read-only **detail**, in a dedicated **Gallery** tab — it's not part of the edit form.

- In the create/edit form, drop or click the dashed upload box to select an avatar image (JPG, PNG, or GIF). The image is only staged locally as a preview until you save the character — nothing uploads until you click **Create**/**Update**.
- Use **Clear Selection** to discard a staged (not-yet-saved) avatar file before saving.
- Once a character exists, open its **detail** and switch to the **Gallery** tab to manage additional images. Here you can:
    - **Upload** additional images to the character's gallery.
    - Click a thumbnail to open it in a **lightbox** for a closer look.
    - Use each thumbnail's **⋮** (overflow) menu to **Set as avatar** or **Delete** it (deletion asks for confirmation).
    - **Drag to reorder** gallery images using each thumbnail's grip handle.
- Broken/missing gallery images are automatically hidden from the grid rather than showing a broken-image icon.
- Deleting a gallery image that's currently set as the character's active avatar automatically clears the avatar field too, so the character falls back to the no-avatar placeholder instead of pointing at a now-missing file.

Gallery and avatar changes take effect immediately (they're saved via their own socket calls, independent of the rest of the character form).

### Where Avatar and Gallery Images Live

Uploaded avatar and gallery images are stored per-character on the server (in that character's own data directory), addressed by path rather than embedded in the database record. When a character is deleted, its entire data directory — avatar plus every gallery image — is removed along with the character record.

### Avatar URLs Carry a Revision

Your browser caches an image against the exact address it was loaded from, so an avatar address that never changes would keep showing the old face after you replace it. Every avatar link Serene Pub renders therefore carries the image's current revision number, and the server bumps that number whenever the bytes behind a link change — a replaced avatar, a re-cut thumbnail, or an image reclaimed by storage cleanup. A new revision is a new address, so the new picture loads straight away. Open sessions are told about both kinds of change over their live connection, which is why every message avatar, the composer, the scene portraits and the sidebars all switch to the new image at once, with no page refresh.

### Cropping an Avatar

Small pictures of an avatar (the sidebars, message avatars, scene portraits, the composer) are cut from one **crop** stored against the image. Until you choose one, that crop is the largest square taken from the **top** of the picture and centred across it, because character art is usually a portrait with the face in the upper part of the frame; a landscape image keeps its full height instead.

To choose your own:

- **When you pick a new avatar**, the crop editor opens over the image you chose, before anything is uploaded. Drag the picture to move it under the square, use the wheel, a pinch or the zoom slider to zoom, and the arrow keys to nudge it a pixel at a time (hold Shift for ten). Two live previews show exactly what the round and the square avatar will look like. **Save** keeps your crop; **Cancel** uploads the image uncropped, which means the default crop above.
- **For an avatar you already have**, the **Adjust crop** button beside the avatar in the character or persona form opens the same editor on the stored image, starting from the crop that is in force.
- **From the Media panel**, any image's **⋮** menu has a **Crop** action, which edits the same value.

**Reset** puts the crop back to the default rule rather than to whatever it was before. The crop is never destructive: the full image is always kept, so a lightbox still shows everything and you can re-crop as often as you like. Changing the crop re-cuts the small picture and gives it a new address, so every open view switches to it at once (see below).

## Sprites

A character's **sprites** are the faces it can show beside what it says: an emotion (`joy`, `anger`), an outfit (`swimsuit`) or a pose (`sleeping`). Each sprite has a **sprite label**, the name the image goes by, and a label can hold several images (**variants**). Sprites are part of the character card, so every lorebook and session that uses the card shows the same art.

Open a character and switch to the **Sprites** tab to manage them.

- **Upload** takes one or more images at once and labels each by its file name, the way SillyTavern does: `joy.png` and `joy-2.png` are both "joy".
- **Start from the standard set** adds 28 empty emotion slots (SillyTavern's standard list). Upload into an empty slot by clicking it.
- Each image has a menu to make it the label's first variant, add another variant, change its label, move it to another set, or delete it. Deleting a sprite never deletes an image that is also the avatar or part of a conversation.
- **Try a line** shows which sprite a reply like the one you type would show, with how closely it matched.

Sprite images do not appear in the **Gallery** tab, because they have their own home here. The avatar stays in the gallery even when the same image is also a sprite.

### Sprite sets

A **sprite set** groups sprites: an outfit, an age, a form. Every character with sprites has a **default set**, and you can add more from the set menu (**New set**, **Rename set**, **Make default**, **Delete set**). The default set can only be deleted when it is the last one.

Which set a character is shown in is decided by the story, not the card:

1. A session can show a character in another set for itself alone — see [Sessions](./sessions.md#sprites).
2. Otherwise, a lorebook's cast member can name a set, and change it at dates in the story like any other cast field (see [Lorebooks](./lorebooks.md)).
3. Otherwise, the card's default set is used.

A set is chosen by name, so renaming one leaves anything that chose the old name showing the default set until it is pointed at the new one; the rename dialog says so.

## Creating a Character

There are two ways to create a character, both reachable from **Write a character** under the **New** button in the Characters sidebar (**Write a persona**, in the same menu, is the same flow with the Persona flag already on):

- **Character Creator** (guided wizard) — used when the **Easy Character Creation** user setting is enabled (this is the default). It's a 5-step wizard: **Name**, **Avatar**, **Description**, **Personality**, **First Message**. Name and Description are required steps; Avatar, Personality, and First Message can be skipped. Each step includes an inline example and writing guidelines (e.g. what to include in a description vs. a personality). A progress bar shows which step you're on, and leaving with unsaved data prompts a **Discard Character?** confirmation.
- **Full Character Form** — used when Easy Character Creation is disabled. This opens the same detailed form used for editing (see Character Fields above), with every field available immediately (subject to the Show All Fields setting).

### Easy Character Creation Setting

The **Easy Character Creation** switch on the User Settings tab controls which of the two creation flows the **New** button opens. It's on by default. Turning it off routes new-character creation straight to the full form instead of the wizard.

### Editing and Deleting

From the character list, each entry has a menu (the "..." button) with **View**, **Edit**, **Export**, the persona and folder actions described above, and **Delete**. Deleting a character asks for confirmation ("Delete Character? This action cannot be undone") and removes the character's stored data directory (avatar and gallery images) along with its database record.

### Viewing a Character

Clicking a character in the list (rather than its menu) opens a read-only **detail**: the
avatar, name and nickname, version and owner on one line, its tags, then Details (description,
personality, scenario, first message, alternate greetings, creator notes, each shown only when it
has content) and a **Gallery** tab. The pencil in the header edits; the menu offers **View
Sessions** and **Export**. At full page the list stays beside the panel.

## Browsing the Character Library

The **Character Library** is a searchable catalog of community-contributed character cards, browsed and imported without leaving the app. Open it from **Browse the library** under the **New** button in the Characters sidebar — unlike creating or importing a file, this takes you to a full-page Character Library rather than opening a dialog in the sidebar.

- A **Characters · Personas** switch at the top picks which kind of card you are browsing; the Personas catalog is described on the [Personas](./personas.md#the-personas-catalog) page. Under Characters, if more than one catalog is available, a row of tabs lets you switch between sources. Today there are two: the original **Serene Pub** catalog (the `serene-pub-chara-list` GitHub repository, grouped into named categories) and **CharaVault**, a much larger third-party card catalog shown as a flat grid instead, since CharaVault's own category/folder structure doesn't map onto a meaningful browsing grouping the way the curated catalog's does.
- Each entry shows its thumbnail, name, an excerpt of its description, author, and card spec version. Type in the search box to filter by name, description, category, or tags — it searches as you type (debounced) or immediately on Enter; there's no separate Search button.
- When browsing CharaVault specifically, you also get a **Sort** dropdown (Top Rated, Most Downloaded, Newest, Oldest, Name A–Z/Z–A, Token Count, Most Discussed), an **Only cards with a lorebook** toggle, a creator filter (click an author's name in a card's detail view to filter the whole list to their cards, removable via the chip that appears above the results), and support for advanced query syntax in the search box — `tag:name`, `-exclude`, `creator:name`, and `"exact phrase"`, which can be combined freely (e.g. `elf tag:fantasy -romance creator:anon`). If the admin has enabled unsafe/NSFW browsing, an **Include NSFW results** toggle also appears. Results load a page at a time with a **Load More** button rather than infinite scroll, and a source that's unreachable or rate-limited shows its own message with a **Retry** button instead of an empty grid.
- Clicking an entry opens a detail view with the full description, tags, author, version, spec, category, and (if the card carries one) a note that it includes a lorebook, plus a **Download Character** button to pull it directly into your own character list. Downloading also triggers the same lorebook-import prompt as a manual file import if the card includes an embedded lorebook.

### Library Source

The Serene Pub catalog is sourced live from a public, community-maintained catalog (the `serene-pub-chara-list` repository) rather than being bundled with the app, and CharaVault is queried live from its own public API — both require an internet connection to search or import from, and new or updated cards on either source show up automatically the next time you open the Character Library.

## Importing a Character from a File

Besides the library, **Import a card** under the **New** button opens a dialog that accepts a local file upload, and dropping a card file anywhere on the list imports it the same way; the dialog accepts a local file upload in PNG, APNG, JPEG, JPG, WEBP, JSON, or CHARX format — this covers standard character card formats (including cards exported from other apps). See [Importing from SillyTavern](./importing-from-sillytavern.md) for details on cross-compatibility with SillyTavern-style cards. On import, fields such as name, nickname, description, personality, scenario, first message, example dialogues, alternate greetings, creator notes, post-history instructions, character version, aliases, summary, and tags are all mapped in from the card, and the avatar image (if embedded) is extracted and set automatically.

A **CHARX** file is the zip-based Character Card V3 container that RisuAI writes. Serene Pub reads the card and any embedded lorebook from it, takes the card's main icon as the avatar, and imports its emotion images as the character's [sprites](#sprites). RisuAI's PNG cards and older RisuAI cards carry emotion images too, and those are imported the same way. Other assets, such as backgrounds, alternate icons and RisuAI modules, are not imported. The import toast says how many were left behind, because exporting the character again will not include them. An image stored as a web address is not downloaded, so a sprite or icon kept only online is left behind and counted.

### What Happens After Import

A successful import shows a confirmation toast naming the imported character and immediately refreshes your character list. If the imported card carries an embedded lorebook, a follow-up **Import Lorebook?** dialog appears, pre-filled with the lorebook's name (editable before you confirm), letting you decide whether to bring the world/setting data in alongside the character. See [Lorebooks](./lorebooks.md).

## Exporting a Character

From the edit form of an existing character, click the **export button** (upload icon) in the header to open the **Export Character** dialog, which offers three formats:

- **Export as JSON** — downloads the character as a standard character-card JSON file.
- **Export as CHARX, with sprites** — a zip holding the card, the avatar and every sprite. This is the only format that carries sprites. The default set's first image for each sprite label is written as a standard emotion asset, which RisuAI and SillyTavern read; other sets and extra variants use a Serene Pub asset type that those apps keep and re-export, and that Serene Pub reads back into the same sets.
- **Export as PNG Card** — embeds the character card data into the character's avatar image and downloads it as a PNG. This option is disabled ("No Avatar") if the character has no avatar image set.

If the character has one or more lorebooks bound to it, the dialog also shows an **Include a lorebook (optional)** dropdown above the format buttons, letting you embed one of those bound lorebooks into the exported card so it travels with the character on import (see [Lorebooks](./lorebooks.md)). Leave it set to "None" to export the character without any lorebook data.

Both formats build a CharacterCard V2-compatible structure, including the character's tags, so exported characters can be re-imported into Serene Pub or shared with compatible apps.

### Export File Names

Exported files are named automatically from the character's name (lowercased, with non-alphanumeric characters stripped), e.g. a character named "Dr. John Watson" exports as `dr_john_watson.json`, `dr_john_watson.charx` or `dr_john_watson.png`.

## Visibility Settings

Beyond the character's own fields, each character has a **per-session visibility** setting that controls how much of that character's information is exposed to the model when the character is present in a session but not the one currently responding. This is configured per character, per session, from the session's edit screen (see [Sessions](./sessions.md)) rather than from the character form itself — the same character can be fully visible in one session and hidden in another.

Each character row in the session's participant list has a visibility button (an eye icon) that cycles through three levels on click:

- **Full Info** — the character's complete information is shown even when they aren't the one responding.
- **Name Only** — only the character's name/nickname is shown when they aren't responding.
- **Hidden** — the character's info is fully hidden from the prompt when they aren't responding.

The button's tooltip states what happens on the character's _other_ turns — e.g. "When not speaking: Only name/nickname is included" — since a character's own information is always fully included on their own turn regardless of this setting. Its purpose is trimming prompt size in multi-character group sessions by hiding detail for characters who aren't currently active in the conversation.

### Active vs. Visible

Separately from visibility, each character in a session also has an **active/inactive** toggle (a smile/meh icon switch). An inactive character stays listed in the session but is excluded from participating — this is distinct from the visibility level, which only affects how much of an active-or-inactive character's data is shown in context.

### Why Visibility Matters in Group Sessions

Visibility levels matter most in sessions with several characters at once: with every character set to Full Visibility, the prompt sent to the model grows with each additional participant, since all of their descriptions, personalities, and other prompt-visible fields are included every turn. Setting less-central characters to Minimal Visibility or Hidden keeps the prompt smaller and cheaper while the model is generating a different character's response, without removing them from the session.

## Characters in Sessions

A character isn't tied to a single conversation — the same character can be added to any number of [sessions](./sessions.md), including one-on-one sessions and group sessions with multiple characters and personas together. Characters are added to a session, reordered by drag handle, and have their active state and visibility level managed from the session's edit screen, as described above.
