# Characters

A character is someone in your stories: their name, who they are, how they talk and how they greet you.

:::tip What it's for
- Giving the AI someone to play, with a description and personality it reads every reply.
- Playing someone yourself: a character you play is a [persona](./personas.md).
- Bringing in characters other people made, from the built-in library or a **card** file.
:::

A **card** is a character saved as a file, usually a picture with the character written inside it. Cards are how characters are shared between apps such as Serene Pub and SillyTavern.

Your characters are yours: other accounts on the same server don't see them.

## The basics

### Add a character

Open **Characters** on the rail and press **New**. The menu has three ways to add one:

- **Write a character**: start from a blank card. See [Write one yourself](#write-one-yourself).
- **Browse the library**: pick a ready-made character made by the community. See [Browsing the character library](#browsing-the-character-library).
- **Import a card**: a card file from your computer (PNG, APNG, JPEG, WebP, JSON or CHARX). You can also drop the file anywhere on the list. See [Importing a card](#importing-a-card).

The same menu has **Write a persona** (a character you play) and **New folder**.

:::tip You should see
The new character in your list, with its picture, name and the first line of its description.
:::

### Write one yourself

**Write a character** opens a short guided creator, one step at a time: **Name**, **Avatar**, **Description**, **Personality** and **First message**. Only the name and description are required; skip the rest and fill them in later. Each step shows an example and tips on what to write.

- **Description**: who they are: looks, background, role in the story.
- **Personality**: how they think, feel and behave.
- **First message**: what they say when a session starts.

Prefer every field at once? Turn off **Easy character creation** in **Settings › User**, and **New** opens the full form instead.

:::warning If this didn't work
- **Next stays grey**: the name or the description is empty.
- **The new character isn't in the list**: check the filter above the list isn't set to a tag or **Favorites**. The chip under the search box clears it.
:::

## Everyday use

### Find a character

The box at the top of the list filters as you type, matching name, description and tags. The sliders button beside it narrows the list to **All**, **Favorites**, **Personas**, or one of your tags; a chip under the box shows the filter, with an **×** to clear it. The two icons at the end switch between portrait cards (the default) and a list.

Favorites sort to the top. Characters in a [folder](#favorites-folders-and-tags) are listed under its header, which collapses on click.

Click a character to open it. Its page shows the picture, name, tags and details, with **Gallery** and **Sprites** tabs. The pencil edits it; its menu has **View sessions** and **Export character**.

Each character's **⋮** menu has **View**, **Edit**, **Use as persona** (or **Not a persona**), **Set as default persona**, **Move to folder…**, **Export** and **Delete**.

### Edit a character

Press the pencil on a character's page, or **Edit** in its **⋮** menu. The name, nickname and picture sit at the top, and the rest is in three tabs:

| Tab | Fields |
| --- | --- |
| **Profile** | **Summary**, **Description**, **Aliases**, **Tags**, **Favorite**, **Persona**, **Default persona** |
| **Voice** | **Personality**, **First message** |
| **Notes** | **Creator notes** |

Only **Name** and **Description** are required. A field with a small eye icon is sent to the AI with every reply ("This field will be visible in prompts"); the others are for you.

- **Nickname**: used in the story instead of the full name.
- **Aliases**: other names the character goes by.
- **Summary**: one or two sentences, up to 200 characters. It isn't sent with replies; it describes the character in the lorebook's relationship graph.

**Show all fields**, at the bottom of the form, adds everything else a card can carry. It's remembered for next time.

- On **Profile**: **Version**, **Creator** and **Category**.
- On **Voice**: **Scenario** (left out of group sessions), **Alternate greetings**, **Group-only greetings**, **Example dialogues** (sample exchanges that teach the AI the character's voice; with several, each session uses one of them for the whole session), and **Post-history instructions** (sent after the conversation, to steer the reply).
- On **Notes**: creator notes in other languages.

Press **Save** (or **Ctrl S**) to keep your changes. While there are unsaved changes the header says **Unsaved changes**, and leaving asks **Discard unsaved changes?** first.

### Favorites, folders and tags

- **Favorite** (on the form) pins a character to the top of its folder, with a small star.
- **Folders** group the list for you alone: "Campaign 2", "Retired", "NPCs". Create one with **New › New folder**, and file a character with **Move to folder…** in its **⋮** menu. A character is in one folder or none, and folders can't hold folders. A folder's own **⋮** menu renames or deletes it; deleting a folder keeps its characters.
- **Tags** are labels a character can carry several of, shared with lorebooks and sessions. Type in the **Tags** field to pick one, or press Enter to create it. See [Tags](./tags.md).

### Delete a character

**Delete** in the **⋮** menu asks first. The character leaves your list for good, but sessions that already have its messages keep showing its name and picture.

## Avatar and gallery

The **avatar** is the character's main picture. On the form, click the picture beside the name (or drop an image on it) to choose one. Nothing is uploaded until you press **Save**.

The **gallery** holds more pictures. Open the character and switch to its **Gallery** tab to **Upload** images, click one to see it full size, drag to reorder, or use its **⋮** menu to **Set as avatar** or **Delete** it. Gallery changes are saved at once. Deleting the image that is the avatar leaves the character with no avatar.

### Cropping an avatar

The small round and square pictures (in the list, beside messages, in the scene) are cut from a **crop** of the avatar. Until you choose one, it's the largest square from the top of the picture, where a portrait's face usually is.

- **Choosing a new avatar** opens the crop editor before anything is uploaded. Drag the picture under the square, zoom with the wheel, a pinch or the slider, and nudge with the arrow keys (Shift for bigger steps). Two previews show the round and square results. **Save** keeps the crop; **Cancel** uses the default one.
- **For the avatar you have**, choose **Adjust crop** from the menu under the picture on the form.
- In **Settings › Media**, any image's **⋮** menu has **Crop**.

**Reset** goes back to the default crop. The full image is always kept, so you can re-crop as often as you like, and every open view switches to the new crop straight away.

## Sprites

**Sprites** are the faces a character can show beside what it says: an emotion (`joy`, `anger`), an outfit (`swimsuit`) or a pose (`sleeping`). Each sprite has a **sprite label**, and a label can hold several images (**variants**). Sprites belong to the character, so every session that uses it shows the same art.

Open the character and switch to the **Sprites** tab:

- **Upload** takes several images at once and labels each by its file name, as SillyTavern does: `joy.png` and `joy-2.png` are both "joy".
- **Start from the standard set** (when there are none yet) adds 28 empty emotion slots. Click a slot to upload into it.
- Each image's menu can **Make first**, **Add a variant**, **Change label**, move it to another set, or **Delete** it.
- **Try a line**: type a reply and see which sprite it would show, and how closely it matched.

How sessions pick and show sprites is in [Sessions](./sessions.md#sprites). Sprites have their own tab, so they don't appear in the **Gallery**.

### Sprite sets

A **sprite set** groups sprites by outfit, age or form. Every character with sprites has a **default set**; the set menu has **New set**, **Rename set**, **Make default**, **Add the standard set** and **Delete set**.

The story decides which set is shown, not the card:

1. A session can show a character in another set, for that session only (see [Sessions](./sessions.md#sprites)).
2. Otherwise, the character's place in a lorebook's cast can name a set, and change it at dates in the story (see [Cast and relationships](./lorebook-cast.md)).
3. Otherwise, the default set.

Sets are chosen by name, so renaming one sends anything that chose the old name back to the default set until you choose again; the rename dialog warns you.

## Browsing the character library

The **Library** is a searchable catalogue of characters made by the community. Open it with **New › Browse the library** in Characters (or **Browse Characters** when your list is empty).

- **Search** as you type. **Load more** fetches the next page.
- **Source** switches between two catalogues: **Serene Pub**'s own, grouped into categories, and **CharaVault**, a much larger one.
- On CharaVault you also get **Sort**, **Only with a lorebook**, **More by …** on a card (to see that creator's other characters) and search words such as `tag:fantasy`, `-romance`, `creator:anon` and `"exact phrase"`.
- A card's page shows its picture, author, description, tags, and whether it comes with a lorebook.
- **Import** adds it to your characters. The button becomes **Open in Characters**, and the Library stays where you were so you can keep browsing.

Both catalogues are online, so the Library needs an internet connection. A catalogue that can't be reached shows **Retry**. An administrator can connect a CharaVault account to raise its search limits (see [Pub settings](./system-settings.md#community-library-charavault)), and can allow adult content, which adds an **Include NSFW** switch.

To play a library character yourself, import it, then choose **Use as persona** from its **⋮** menu.

## Importing a card

**New › Import a card**, or drop a file on the list. Serene Pub reads PNG, APNG, JPEG and WebP cards (the character is stored inside the picture), JSON cards, and CHARX files (a zip with the card, its pictures and its expressions, written by RisuAI). The card's avatar becomes the character's avatar.

A CHARX file's emotion images, and those in RisuAI's PNG cards, become the character's [sprites](#sprites). Other extras, such as backgrounds, extra icons and RisuAI modules, are left out; the message after the import says how many and why, because exporting the character again won't include them.

Coming from SillyTavern with a whole folder of characters? See [Importing from SillyTavern](./importing-from-sillytavern.md).

### When the card is already in your list

A card exported from Serene Pub remembers which character it came from:

- If nothing has changed, you see **Character already imported** and the existing character is used.
- If it has changed, you choose **Overwrite existing**, **Import as new**, or **Cancel**. The file waits up to 15 minutes for your answer; after that, choose it again.

### Cards that carry a lorebook

Some cards come with a lorebook (their world). After the import, **Import the lorebook?** asks whether to bring it in too, with its name ready to change. See [Lorebooks](./lorebooks.md).

### Cards that won't import

- **Larger than 64 MB**, or whose character data is larger than 16 MB, is refused before it uploads.
- **A damaged card** is refused with a message, rather than half-imported.
- **Pictures stored as web addresses** inside a card aren't downloaded, so those sprites are left out (and counted in the message).
- **Too many at once**: you can import two cards or lorebooks at a time. A third waits until one finishes.

## Exporting a character

Choose **Export** from a character's **⋮** menu, or **Export character** on its page:

- **Export as JSON**: the card as a text file.
- **Export as CHARX, with sprites**: a zip with the card, avatar and every sprite. The only format that carries sprites; RisuAI and SillyTavern read its emotions too.
- **Export as PNG card**: the card inside the avatar picture. It needs an avatar, so it's greyed out without one.

If the character is in a lorebook's cast, **Include a lorebook (optional)** can put that book inside the card, so it travels with the character. The card holds the book as it reads on its main line, without branches or dated changes. SillyTavern reads it as ordinary world info.

The file is named after the character, such as `john_watson.v3.json`, `john_watson.charx` or `john_watson.v3.png`.

## Characters in sessions

The same character can be in any number of [sessions](./sessions.md), alone with you or in a [group](./group-sessions.md).

- **How much of each character the AI reads** on other characters' turns is one setting for the whole session: [Character detail](./group-sessions.md#character-detail). A character always gets its own card in full on its own turn.
- **Benching** a character keeps it in the session but out of the turn order: see [Bench a character](./group-sessions.md#bench-a-character).
- **Lorebooks**: when a character joins a session that reads a lorebook, it joins the book's cast. See [Cast and relationships](./lorebook-cast.md).

## For power users

- **The lightning icon** beside a name means the character is indexed with the current [embedding model](./embeddings-and-rag.md); a refresh icon means the model has changed since and it will be indexed again. No icon: retrieval is off, or it hasn't been indexed yet.
- **Exported cards** are Character Card V3, with the character's tags. A Serene Pub card also carries its id, which is how a re-import is recognised.
- **A lorebook inside an exported card**: places and items become plain entries in SillyTavern, an archived entry is switched off, pattern keywords are written as patterns, and each entry's whole-word setting is kept.
- **Card limits**: a card's own data may hold at most 1,000,000 values, nested at most 64 levels; a CHARX may hold at most 10,000 files. Images larger than 8,192 × 8,192 pixels are kept as they are but no small pictures are cut from them. Serene Pub reads at most three cards at once for everyone together, and past that asks you to try again in a moment.

## Related

- [Personas](./personas.md): characters you play.
- [Sessions](./sessions.md) and [Group sessions](./group-sessions.md).
- [Lorebooks](./lorebooks.md) and [Cast and relationships](./lorebook-cast.md).
- [Tags](./tags.md).
- [Importing from SillyTavern](./importing-from-sillytavern.md).
