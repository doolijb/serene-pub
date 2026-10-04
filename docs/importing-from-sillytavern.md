# Importing from SillyTavern

Bring your SillyTavern characters, personas, chats and lorebooks into Serene Pub in one go, straight from your SillyTavern folder.

:::note You'll need
- An admin account. The importer isn't offered to other accounts, or in the [Android app](./android.md).
- Your SillyTavern folder on the computer you're browsing from.
- A Chromium-based browser (Chrome, Edge, Brave…) or a recent Firefox, which can open a whole folder.
:::

New to Serene Pub as well? [Coming from SillyTavern](./coming-from-sillytavern.md) maps SillyTavern's words and habits onto this app.

Your browser reads the folder and uploads only the files the import needs. Nothing is read from the server's own disk, and your SillyTavern folder isn't changed.

## What comes across

| From SillyTavern | Becomes in Serene Pub |
| --- | --- |
| Characters, with their expression sprites | [Characters](./characters.md), with [sprites](./characters.md#sprites) |
| Personas, with their avatars | Characters marked as [personas](./personas.md) |
| Chats and group chats | [Sessions](./sessions.md), with every message and its swipes |
| World Info files | [Lorebooks](./lorebooks.md) |

Not imported: the links between a chat's branches and checkpoints (each branch file becomes its own session), a group's earlier chats (only its current one comes in), chat backgrounds, and extension data.

## Import your folder

1. Open **Settings › Import**. **Import from SillyTavern** in **Settings › User**, and the setup wizard's **Import your characters and personas**, open the same section.
2. Press **Choose SillyTavern Folder** and pick your SillyTavern folder. Its main folder, a SillyTavern-Launcher folder, its `data` folder or `data/default-user` all work.
3. Press **Process data**. The page uploads the character, group, world and settings files and lists what it found under **Scan results**.
4. Untick anything you don't want. Everything starts ticked, and each group has **Toggle all**.
5. Turn on **I understand this will import the selected data into Serene Pub**, then press **Import selected data**.

:::tip You should see
**Import complete** with a summary such as *Imported 3 characters, 42 sprites, 1 persona, 5 sessions, 2 lorebooks.* Your characters are in the Characters view and the chats are in Sessions.
:::

:::warning If this didn't work
- **"No SillyTavern data found"**: the folder has none of SillyTavern's `characters`, `chats`, `groups` or `worlds` folders, or its `settings.json`. Pick the folder that contains them.
- **"Nothing found"**: the folder was read but held nothing to import. Check you picked your real SillyTavern folder.
- **A session is greyed out with *Missing character(s)***: you unticked a character it needs. Tick the character again.
- **Import finished with errors**: everything else came in. The list under the summary says what didn't, and why.
:::

## What the scan finds

- **Characters**: each `.png` or `.json` card in `characters/`. A PNG made by an image generator, which keeps its generation settings in the file too, is still read.
- **Personas**: from SillyTavern's `settings.json`, with the avatar from `User Avatars/`.
- **Individual sessions**: one per chat file in `chats/<character name>/`.
- **Group sessions**: one per group in `groups/`, with the group's current chat from `group chats/`. A group with no chat yet comes in empty.
- **Lorebooks**: one per World Info file in `worlds/`.

Each session lists the characters it needs. Untick one of them and the session is disabled until you tick it again.

## How things come across

- **Chats** keep every message, in order, with its swipes. The characters and persona are seated by name. A chat file with a damaged line isn't imported, and the error names the line (*Line 3 of the chat file is not valid JSON*) so you can fix it and import again. An empty chat file isn't imported either.
- **A chat's Author's Note** becomes the session's [author's note](./sessions.md#authors-note), with its depth, interval and role. A note SillyTavern placed outside the chat (before or after the story string) is placed by its depth instead, and the import summary says so.
- **Lorebooks**: every World Info entry becomes world lore, and each of its keys becomes one keyword. A book's scan depth, token budget and recursive scanning come with it.
- **A session that reads a lorebook** (its chat's World Info, or its character's own book) seats its characters and persona in that book's cast, as reading a book into a session does.
- **Sprites**: SillyTavern keeps them in a folder named after the character. The images at the top of that folder go into the character's default [sprite set](./characters.md#sprite-sets), and each subfolder becomes a set of the same name. A `backgrounds` subfolder is skipped.
- Each thing is made whole or not at all: a session with all its messages, a lorebook with all its entries. Nothing is left half-imported.

## After the import

The summary's heading says how it went: **Import complete**, **Import finished with errors** (some items didn't come in), **Import stopped early**, or **Nothing was imported**. Under it:

- each item that failed, with the reason;
- **Imported, with … left unfinished**: things that came in with a part missing, such as a character whose card's lorebook was left out because you already had one of that name;
- if it stopped partway, why.

A server problem reads *Something went wrong on the server. The server log has the details.*

**Import another folder** starts again in the same section.

### Importing the same folder twice

- **Lorebooks** are matched by name: one you already have is reused as it is, not duplicated, and the summary says so.
- **Characters and personas** are always added fresh, so importing the same folder twice gives you two of each.

## Large folders

- Files upload in batches, and chat histories only upload for the sessions you tick, so a big folder can take a while. Watch the progress bar.
- One import can stage up to 4 GB, and stops if the server would be left with less than 1 GB free.
- If you leave partway (close the tab after the scan, say), the uploaded files are cleared after 30 minutes. Finished or failed imports clear theirs straight away.
- Limits per file: a character card over 64 MB (or with more than 16 MB of character data) and a World Info file over 32 MB aren't read; they're listed with the reason. For sprites, an image over 16 MB, or past 512 images or 256 MB for one character, is left behind.
- A lorebook must also fit the limits of a lorebook imported on its own (see [Lorebooks](./lorebooks.md#creating-importing-duplicating-and-deleting)); the message names the limit and the entry.

## Related

- [Coming from SillyTavern](./coming-from-sillytavern.md): where your SillyTavern habits live in Serene Pub, and what works differently.
- [Characters](./characters.md#importing-a-card): importing single card files.
- [Lorebooks](./lorebooks.md)
- [Personas](./personas.md)
