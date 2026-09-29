# Importing from SillyTavern

Serene Pub can import [characters](./characters.md) (with their expression sprites), [personas](./personas.md), chats (including group chats), and lorebooks directly from a local SillyTavern install. Each SillyTavern chat becomes a Serene Pub [session](./sessions.md). The whole process runs in your browser — you pick the folder, your browser reads and uploads the relevant files, and nothing is read from the server's filesystem.

## Overview

The importer lives at the **Import from SillyTavern** button in **Settings → User**, and opens the dedicated `/import` page; the setup wizard's **Import your characters and personas** link opens the same page. This page is **admin-only**: a non-admin account is sent straight back to the home page. It isn't offered on the [Android app](./android.md).

The flow has four steps: pick your SillyTavern folder, scan it, review and select what to bring in, and run the import. A confirmation screen with next-step options appears when it's done.

An in-app notice on the import page lays out the scope up front:

- **Imported:** characters and their expression sprites, personas and their avatars, chats (including group chats), and lorebooks (SillyTavern's World Info).
- **Not imported:** the links between chat branches and checkpoints (each branch file imports as its own session), a group's earlier chats (only its current one imports), chat backgrounds, and extensions data.
- Both individual and group chats become sessions in Serene Pub's one [session](./sessions.md) system.
- Alternative message variations ("swipes") are preserved in each message's metadata.

## Picking a Folder

Click **Choose SillyTavern Folder** to open your browser's native folder picker (this uses `webkitdirectory`, so it requires a Chromium-based browser or a recent version of Firefox). Select your SillyTavern root folder — or a SillyTavern-Launcher folder, a `data` folder, or a `data/default-user` folder; the importer doesn't care what the folder is named.

Instead, it looks for one of SillyTavern's landmark subdirectories — `characters/`, `chats/`, `groups/`, or `worlds/` — or a `settings.json` file, and treats whichever directory contains one of those as the data root. If none of these are found anywhere in the picked folder, you'll see a "No SillyTavern data found" error and need to pick a different folder.

Once a folder resolves successfully, the page shows how many relevant files it found, split into files staged for scanning right away versus chat history files that are only uploaded later for whatever you actually choose to import. Everything else in the folder (extensions data, background images, caches, etc.) is skipped entirely and never uploaded.

### What Counts as a Relevant File

Within the resolved data root, only these paths are picked up: `settings.json`, and anything under `characters/`, `chats/`, `groups/`, `group chats/`, `worlds/`, or `User Avatars/`. This keeps the upload small even if your SillyTavern folder also contains large amounts of unrelated data (backgrounds, extension caches, etc.).

## Scanning & Reviewing Results

Click **Process Data** to upload the metadata-bearing files (characters, `settings.json`, groups, worlds) to the server and scan them. A progress bar tracks the upload in batches; the scan itself times out and shows an error if the server doesn't respond within 30 seconds.

When the scan finishes, a **Scan results** panel lists everything found, broken into five categories:

- **Characters** — parsed from `.png` or `.json` character cards in `characters/`.
- **Personas** — read from `settings.json`, where SillyTavern keys each persona by its avatar file: `power_user.personas` gives the name you know it by, and `power_user.persona_descriptions` its description. That avatar (`User Avatars/<file>`) is copied over as the persona's avatar. Each one is created as a character with the **Persona** flag set, so it shows under the **Personas** filter of the Characters view.
- **Individual sessions** — one per SillyTavern chat, a `.jsonl` file under `chats/<character name>/`.
- **Group sessions** — one per SillyTavern group, a `.json` file in `groups/`, each listing its member character names. Its history is the group's current chat, `group chats/<chat_id>.jsonl`.
- **Lorebooks** — one per `.json` "World Info" file in `worlds/`. Every entry lands as World lore, and each key in the file becomes one keyword, so a regex key with a comma in it (`\w{2,4}`) stays whole.

Each category shows a live `selected/total` count and a header toast summarizes totals ("Found N characters, N personas, N sessions, N lorebooks"). If the scan completes but finds nothing importable, a "Nothing found" warning suggests double-checking that you pointed it at the actual SillyTavern root.

## Selecting What to Import

Every item in the Scan results panel is a checkbox, individually toggleable, with a **Toggle all** button per category to select or deselect an entire category at once. Everything is selected by default after a scan.

Individual and group sessions each list the character names they depend on. If you deselect a character that one of them needs, that session is automatically disabled (its checkbox becomes unchecked and unclickable) and shows a "Missing character(s): ..." reason inline. Re-selecting the required character(s) re-enables it. This check re-runs any time you toggle a character or a session, so the selection panel always reflects what can actually be imported.

## Running the Import

Before importing, check the box labeled **"I understand this will import the selected data into Serene Pub"** — the **Import Selected Data** button stays disabled until it's checked.

Clicking it triggers a second, smaller upload pass: only now does the browser upload the actual chat/group-chat history files — specifically, the `.jsonl` files for the individual chats you selected, plus the entire `group chats/` folder if any group session is selected (matching a selected group to its exact history file requires re-parsing its JSON, so the whole small folder is sent instead of trying to pick out one file). A progress bar again tracks staged/total files.

Once uploaded, the server executes the import: inserting characters, personas, lorebooks, and finally the individual and group sessions with their message history in that order, linking characters and personas to each session where they can be resolved by name. This phase times out after 5 minutes if the server doesn't respond.

A character's **expression sprites** come along with it. SillyTavern keeps them in a folder named after the character file, labelled by file name (`joy.png`, `joy-2.png`), and each sprite-folder override is a subfolder; Serene Pub imports the top-level images into the character's default [sprite set](./characters.md#sprites) and each subfolder as a set of the same name. A `backgrounds` subfolder is not a sprite set and is skipped.

## After Import Completes

A completion screen replaces the wizard with an **Import complete** message summarizing what was created, e.g. "Imported 3 characters, 42 sprites, 1 persona, 5 sessions, 2 lorebooks." If any individual items failed, the count and a list of specific error messages (one per failed item) are shown below the summary, while everything else still imports successfully.

From here you have two options:

- **Back to Settings** — returns to the home page.
- **Import Another Folder** — clears the wizard's state (picked folder, scan results, and the confirmation checkbox) so you can immediately pick a different folder and repeat the process, without leaving the page.

### Duplicate Handling and Re-Importing

Running an import twice against the same data is not fully idempotent for every category:

- **Lorebooks** are matched by name — importing a lorebook (or a character's embedded lore) that already exists under your account reuses the existing record instead of creating a duplicate.
- **Characters and personas** are always inserted fresh. Re-importing the same folder, or importing overlapping folders, will create duplicate character and persona records rather than updating existing ones.

### Large Folders and Cleanup

Uploads are batched (up to 20 files or roughly 8MB per batch) and sent sequentially, so very large character or chat collections may take a while to upload — watch the progress bar rather than the button state. Files are staged into a temporary import area on the server tied to your account; if you abandon the import partway through (close the tab after scanning, for example), that area and its files are automatically cleaned up after 30 minutes of inactivity. Completed or failed imports clean theirs up immediately.
