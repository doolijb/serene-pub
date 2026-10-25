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
The new character in your list, with its picture, name and one line about it: its **Summary**, or else the first sentence of its creator notes or description.
:::

### Write one yourself

**Write a character** opens a short guided creator, one step at a time: **Name**, **Avatar**, **Description**, **Personality** and **First message**. Only the name and description are required; skip the rest and fill them in later. Each step shows an example and tips on what to write. **Write a persona** is the same creator without **First message**: the AI never plays a persona, so it has nothing to open with.

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

The box at the top of the list filters as you type, matching name, description and tags. The sliders button beside it narrows the list to **All**, **Favorites**, **Personas**, or one of your tags; a chip under the box shows the filter, with an **×** to clear it. The two icons at the end switch between a list and portrait cards: docked beside the page the list is the default, and at Half or in Focus the cards are. Once you pick one, this browser remembers it at every width.

Favorites sort to the top. Characters in a [folder](#favorites-folders-and-tags) are listed under its header, which collapses on click.

The line under each name is the character's **Summary** when it has one. Otherwise it's the first sentence of the creator notes or the description, skipping sheet lines such as "Name: …" and "Gender: …" at the top.

With the **Personas** filter on and no personas yet, the list offers **Write a persona**.

Click a character to open it. Its page shows the picture, name and tags over three tabs: **Details**, **Gallery** and **Sprites**. **Edit** under the name edits it; the **⋮** menu at the top has **View sessions** and **Export character**.

Each character's **⋮** menu has **View**, **Edit**, **Use as persona** (or **Not a persona**), **Set as default persona**, **Move to folder…**, **Export** and **Delete**.

### Edit a character

Press **Edit** under the name on a character's page, or **Edit** in its **⋮** menu. The name, nickname and picture sit at the top, and the rest is in five tabs:

| Tab | Fields |
| --- | --- |
| **Profile** | **Summary**, **Description**, **Aliases**, **Tags**, **Favorite**, **Persona**, **Default persona** |
| **Voice** | **Personality**, **First message** |
| **Notes** | **Creator notes** |
| **Likeness** | How pictures of the character are drawn. See [Likeness](#likeness). |
| **Stats** | The stats the character brings to every session. See [Stats on a card](#stats-on-a-card). |

Only **Name** and **Description** are required. A field with a small eye icon is sent to the AI with every reply ("This field will be visible in prompts"); the others are for you.

- **Nickname**: what others call them in replies.
- **Aliases**: other names they go by. When lore is looked up, a mention of one counts as a mention of the character.
- **Summary**: a one-line blurb, up to 200 characters, for character lists and the lorebook **Graph**. It isn't part of the prompt.

Hover a field's name, or the box itself, for what it's for. **Summary** counts its characters once you are near the 200.

**Show all fields**, at the bottom of the form, adds everything else a card can carry. It's remembered for next time.

- On **Profile**: **Version**, **Creator** and **Category**.
- On **Voice**: **Scenario** (left out of group sessions), **Alternate greetings**, **Group-only greetings**, **Example dialogues** (sample exchanges that teach the AI the character's voice; with several, each session uses one of them for the whole session), and **Post-history instructions** (placed after the conversation, just before the reply; good for style reminders).
- On **Notes**: creator notes in other languages.

Press **Save** (or **Ctrl S**) to keep your changes. While there are unsaved changes the header says **Unsaved changes**, and leaving asks **Discard unsaved changes?** first.

A card is a starter: it gives enough to begin a story. Once the card is in a lorebook, it represents a **cast member** there, and what a story changes about the character is kept on that member (see [What the member tells in their own words](./lorebook-cast.md#what-the-member-tells-in-their-own-words)). When a card represents any cast members, a line under the name says in which lorebooks (_In 1 lorebook: Atlas of Everything_); each lorebook's name opens that member. If one retells parts of the card, such as its description or face, the line names those parts after the lorebook (_(retells description, face)_); hover the line for how many members the card represents. Editing the card changes every member that still reads that part from the card; a member's retold parts stay as they are.

### Favorites, folders and tags

- **Favorite** (on the form) pins a character to the top of its folder, with a small star.
- **Folders** group the list for you alone: "Campaign 2", "Retired", "NPCs". Create one with **New › New folder**, and file a character with **Move to folder…** in its **⋮** menu. A character is in one folder or none, and folders can't hold folders. A folder's own **⋮** menu renames or deletes it; deleting a folder keeps its characters.
- **Tags** are labels a character can carry several of, shared with lorebooks and sessions. Type in the **Tags** field to pick one, or press Enter to create it. See [Tags](./tags.md).

### Delete a character

**Delete** in the **⋮** menu asks first, naming the character. It leaves your list for good, along with the gallery and sprites on its card. Sessions that already have it keep it in their cast, with every message, its name and its picture.

## Avatar and gallery

The **avatar** is the character's main picture. On the form, click the picture beside the name (or drop an image on it) to choose one. Nothing is uploaded until you press **Save**.

The **gallery** holds more pictures. Open the character and switch to its **Gallery** tab to **Upload** images, click one to see it full size, drag to reorder, or use its **⋮** menu to **Set as avatar** or **Delete** it. Gallery changes are saved at once. Deleting the image that is the avatar leaves the character with no avatar. A picture's menu also has **Use as likeness image**, which makes it the picture an image model is shown (see [Likeness](#likeness)).

### Generate a portrait

**Generate portrait** on the **Gallery** tab draws a few pictures of the character for you to choose from. You need a model set for images (see [Images](./images.md)); if none is, the dialog says an admin has to choose one. The character's owner or an admin can use it.

1. Open the character's **Gallery** tab and press **Generate portrait**.
2. Pick **How many** pictures, from 1 to 4.
3. Pick a **Style**. **Tags** describes the picture as a list of short words, which most local image models read best. **Prose** describes it in a plain sentence, which hosted image services read best.
4. The dialog says how many pictures that is and how many requests it takes (*2 pictures · 1 call*). A model that can return several pictures at once draws them in one request; others take one request each. An admin also sees which model draws them and, when it's known, the price.
5. Press **Generate**. Before anything is drawn, a review card shows the prompt: change it if you like, then **Approve**. **Reject** stops without drawing.

The pictures are drawn from the character's [likeness](#likeness): the likeness image is shown to the model, and the likeness prompt is the prompt. A model that can't take a reference image draws from the likeness prompt alone, and the dialog says so before you start. A character with no likeness gets a general portrait, which rarely looks like them; fill in the **Likeness** tab first.

The new pictures are added to the gallery, marked **New**. Nothing else changes until you choose: open a picture's **⋮** menu and pick **Set as avatar** or **Use as likeness image**, or **Delete** the ones you don't want. **Stop** on the progress line ends a run that is still drawing.

### Cropping an avatar

The small round and square pictures (in the list, beside messages, in the scene) are cut from a **crop** of the avatar. Until you choose one, it's the largest square from the top of the picture, where a portrait's face usually is.

- **Choosing a new avatar** opens the crop editor before anything is uploaded. Drag the picture under the square, zoom with the wheel, a pinch or the slider, and nudge with the arrow keys (Shift for bigger steps). Two previews show the round and square results. **Save** keeps the crop; **Cancel** uses the default one.
- **For the avatar you have**, choose **Adjust crop** from the menu under the picture on the form.
- In **Settings › Media**, any image's **⋮** menu has **Crop**.

**Reset** goes back to the default crop. The full image is always kept, so you can re-crop as often as you like, and every open view switches to the new crop straight away.

## Sprites

**Sprites** are the faces a character can show beside what it says: an emotion (`joy`, `anger`), an outfit (`swimsuit`) or a pose (`sleeping`). Each sprite has a **sprite label**, and a label can hold several images (**variants**). Sprites belong to the character, so every session that uses it shows the same art.

Open the character and switch to the **Sprites** tab:

- **Upload images** (just **Upload** once the set has sprites) takes several images at once and labels each by its file name, as SillyTavern does: `joy.png` and `joy-2.png` are both "joy".
- The **start from the standard set** link under it (when there are none yet) adds 28 empty emotion slots. Click a slot to upload into it.
- Each image's menu can **Make first**, **Add a variant**, **Change label**, move it to another set, or **Delete** it.
- **Try a line**: type a reply and see which sprite it would show, and how closely it matched.
- **Fill empty sprites** draws the missing faces for you from the character's likeness (below).

How sessions pick and show sprites is in [Sessions](./sessions.md#sprites). Sprites have their own tab, so they don't appear in the **Gallery**.

### Fill empty sprites

**Fill empty sprites** draws a picture for each sprite label from the character's [likeness](#likeness). You need a model set for images (see [Images](./images.md)); if none is, the form says an admin has to choose one. The character's owner or an admin can use it.

1. Open the character's **Sprites** tab and press **Fill empty sprites**. If the set has no labels yet, add the standard set first.
2. Pick the **Sprite set**. Every label in it that has no picture yet is ticked; tick or untick any. **Empty ones** and **All** change the ticks in one go.
3. Read the line under the labels: how many pictures it will draw and how many requests that takes. An admin also sees which model draws them and, for a paid service that publishes a price, about what it costs.
4. Press **Generate**.

Each picture is drawn from the likeness image and the likeness prompt, with a short description of the expression (*joy* becomes *joyful expression, smiling warmly*). Every picture in one fill shares a seed, so a set looks alike. A model that can't take a reference image draws from the likeness prompt alone, and the form says so before you start. A character with no likeness is drawn from the sprite label alone, which rarely looks like them; fill in the **Likeness** tab first.

The background is removed so the sprite sits cleanly over a session. The first fill downloads the background remover once, which the form mentions and the progress line shows.

While it runs, a **contact sheet** shows a tile per label, filling as the pictures arrive. **Stop** ends it early and keeps what is finished. Each picture is added to the set as soon as the fill ends, so there is nothing to save. For each tile:

- **Keep** marks it as fine. It is already in the set.
- **Redo** draws that label again. The new picture is added beside the old one as a variant; delete the one you don't want from the label's menu.
- **Move to** (the tile's menu), or dragging the tile onto another, moves that sprite to the other label.
- A label that came back empty shows an empty tile with **Redo**.

When the model set for sprites can change a picture's expression (NovelAI can), a sprite's menu, on the Sprites tab or on a contact-sheet tile, also offers **Re-express from neutral**: it redraws the set's *neutral* sprite with that label's expression, which keeps the face and outfit closer than a fresh drawing, and adds the result to the label like any other new picture. It needs a *neutral* sprite with a picture in the set.

**Redo all** draws every label on the sheet again, adding variants rather than replacing anything. The descriptions of each expression are a prompt an admin can edit (**Sprite label phrases**).

### Sprite sets

A **sprite set** groups sprites by outfit, age or form. Every character with sprites has a **default set**; the set menu has **New set**, **Rename set**, **Make default**, **Add the standard set** and **Delete set**.

The story decides which set is shown, not the card:

1. A session can show a character in another set, for that session only (see [Sessions](./sessions.md#sprites)).
2. Otherwise, the character's place in a lorebook's cast can name a set, and change it at dates in the story (see [Cast and relationships](./lorebook-cast.md)).
3. Otherwise, the default set.

Sets are chosen by name, so renaming one sends anything that chose the old name back to the default set until you choose again; the rename dialog warns you.

## Likeness

A character's likeness tells an image model how to draw them, so every picture of them looks like the same person. Open the character, press **Edit** and switch to the **Likeness** tab. Personas have one too.

- **Likeness image** is the picture the image model is shown. It starts as the **Avatar** and follows it when the avatar changes. **Gallery** or **Sprite** picks one of the character's own images instead; save the character first to see them.
- **Likeness prompt** is a short line of what can be seen, separated by commas: *adult woman, red braid, green cloak, freckles*. Keep it to looks, not personality. This line does most of the work, so a good one matters more than a good image. **Describe from image** writes it for you from the likeness image; the button appears once a model that reads pictures is set up, and nothing is kept until you **Save**.
- **Avoid** lists what should never show up in a picture of them: *glasses, beard*. It's optional.

The likeness is saved with the character's **Save**. It isn't the description: the AI that writes replies never sees it unless a prompt asks for it.

The likeness travels with the card when you export it, and with a persona inside an exported lorebook. A SillyTavern card's image-generation prompt is read into **Likeness prompt** and **Avoid** when you import it.

## Stats on a card

A character can bring its own stats, such as health, gold or nerve, to every session it joins. Open the character, press **Edit** and switch to the **Stats** tab.

- **Sheets** are ready-made groups of stats. **Add a sheet** picks one; the arrows move it earlier or later, and **×** removes it. Sheet changes apply at once. The order matters: it's the order the stats are listed in a session.
- **Stats** lists every stat the sheets bring. Set where each one starts: a number, a choice, yes or no, a text, or a list of items. A stat that is worked out from others shows **Worked out in play**. **Limits**, under a stat, sets this character's own lowest and highest (or longest, or most items); empty keeps the stat's own, and **Reset** clears them.
- **Save stats** keeps your values and limits. It's separate from the character's **Save**: the line beside it counts the stats not saved yet, and **Discard** drops them.
- **New slot…** declares a stat of your own; **New sheet…** groups stats into a sheet of your own.

The card is the template: its stats are where the character starts. A lorebook's cast can give the character other values in that world, and a session changes its own as play goes on; neither changes the card. A genre that tracks nothing more, such as **Chat**, leaves the card's stats out. See [Stats and states](./stats-and-states.md#the-character-card).

## Browsing the character library

The **Library** is a searchable catalogue of characters made by the community. Open it with **New › Browse the library** in Characters (or **Browse characters** when your list is empty).

- **Search** as you type. **Load more** fetches the next page.
- **Source** switches between two catalogues: **Serene Pub**'s own, grouped into categories, and **CharaVault**, a much larger one.
- On CharaVault you also get **Sort**, **Only with a lorebook**, **More by …** on a card (to see that creator's other characters) and search words such as `tag:fantasy`, `-romance`, `creator:anon` and `"exact phrase"`.
- A card's page shows its picture, author, description, tags, and whether it comes with a lorebook.
- **Import** adds it to your characters. The button becomes **Open in Characters**, and the Library stays where you were so you can keep browsing.
- Opened from the setup wizard's character step, the same button reads **Pick this character**: it imports the card and chooses it on that step, and the card shows **Picked**. See [Getting started](./getting-started.md#4-pick-a-character).

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

### What else a card brings

- **A likeness.** A Serene Pub card brings its [likeness](#likeness). A SillyTavern card's image-generation prompt fills **Likeness prompt** and **Avoid**. Its likeness image is kept only when it is one of your own pictures (a card you exported from here); otherwise the avatar is used.
- **Stats from Serene Pub.** A card exported from Serene Pub brings its [stats](#stats-on-a-card) back exactly. A stat someone else declared becomes yours: it's added to your stats under your name, and the message says so. A stat that differs from one you already have is added beside it with a new name, rather than replacing yours.
- **Other apps' data.** What other apps keep in the card (its extensions) is kept as it is, and goes back out when you export the character.

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

The file carries:

- **Description and personality as one text each.** This is what other apps read.
- **The [likeness](#likeness)**: its prompt, its avoid list and which image it uses.
- **Serene Pub's own stats**, so a Serene Pub import gets them back exactly. Stats you declared yourself travel under your name, and whoever imports the card gets their own copy under theirs.
- **Other apps' data** that came in with the card.

If the character is in a lorebook's cast, **Include a lorebook (optional)** can put that book inside the card, so it travels with the character. The card holds the book as it reads on its main line, without branches or dated changes. SillyTavern reads it as ordinary world info.

The file is named after the character, such as `john_watson.v3.json`, `john_watson.charx` or `john_watson.v3.png`.

## Sharing a character

On a pub with [user accounts](./users-and-accounts.md), you can let another person see one of your characters. Open the character and choose **Share…** from its **⋯** menu, then tick the people. Untick someone to take it back.

What they get is read-only: the character appears in their Characters view under **Shared with you**, they can open it and read everything, and they can **Copy to my characters** to make their own copy (or export the card). They can't edit yours, and they can't put yours in a session as it is: a session's cast is made of characters its owner has, so they copy first. A shared character can also be attached in [Messages](./messages.md#attaching-things) to anyone it is shared with.

Guests in your sessions see the cast's characters without any sharing; sharing is for a character outside a session.

## Characters in sessions

The same character can be in any number of [sessions](./sessions.md), alone with you or in a [group](./group-sessions.md).

- **How much of each character the AI reads** on other characters' turns is one setting for the whole session: [Character detail](./group-sessions.md#character-detail). A character always gets its own card in full on its own turn.
- **Benching** a character keeps it in the session but out of the turn order: see [Bench a character](./group-sessions.md#bench-a-character).
- **Lorebooks**: when a character joins a session that reads a lorebook, it joins the book's cast. See [Cast and relationships](./lorebook-cast.md).

## For power users

- **The lightning icon** beside a name means the character is indexed with the current [embedding model](./embeddings-and-rag.md); a refresh icon means the model has changed since and it will be indexed again. No icon: retrieval is off, or it hasn't been indexed yet.
- **Exported cards** are Character Card V3, with the character's tags. Stats travel under `extensions.serenepub.dowry`, the likeness under `extensions.serenepub.likeness`. On import, SillyTavern's `extensions.sd_character_prompt` is read into the likeness when the card has no likeness of its own; Serene Pub never writes that key.
- **In prompts**, `{{likeness}}` and `{{likenessNegative}}` are the speaking character's likeness prompt and avoid list, and the **Likenesses** variable lists everyone in the scene with their likeness prompt. A Serene Pub card also carries its id, which is how a re-import is recognised.
- **A lorebook inside an exported card**: places and items become plain entries in SillyTavern, an archived entry is switched off, pattern keywords are written as patterns, and each entry's whole-word setting is kept.
- **Card limits**: a card's own data may hold at most 1,000,000 values, nested at most 64 levels; a CHARX may hold at most 10,000 files. Images larger than 8,192 × 8,192 pixels are kept as they are but no small pictures are cut from them. Serene Pub reads at most three cards at once for everyone together, and past that asks you to try again in a moment.

## Related

- [Personas](./personas.md): characters you play.
- [Sessions](./sessions.md) and [Group sessions](./group-sessions.md).
- [Lorebooks](./lorebooks.md) and [Cast and relationships](./lorebook-cast.md).
- [Images](./images.md): portraits, sprites and likenesses.
- [Tags](./tags.md).
- [Importing from SillyTavern](./importing-from-sillytavern.md).
