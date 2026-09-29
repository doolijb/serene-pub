# Personas

A persona is how _you_ show up inside a session — the name the AI calls you, your avatar, your written description. A persona is not a separate kind of thing: **a persona is a [character](./characters.md) you play**. One library, one form, one card format; a small flag says which characters are yours to voice. This page covers that flag, the default persona, how a character becomes a persona, and how personas behave in sessions.

## Overview

Every session has two kinds of participants: characters the AI voices, and characters _people_ voice — the personas. Both come from the same Characters list. The same character can be AI-voiced in one session and your persona in another; nothing about the character itself changes, only who is speaking for it in that session.

Open the **Characters** sidebar view from the rail (see [Getting Around](./getting-around.md)). The filter menu beside the search box has a **Personas** pick that narrows the list to the characters flagged as yours, and each persona shows a small person badge after its name, the way a favourite shows a star.

## The Persona flag

Each character carries a **Persona** flag: "this is one I play". It is set for you the first time the character joins a session as your persona, and you can set or clear it by hand at any time. It is never cleared automatically, so a character you played once stays in your Personas list until you say otherwise.

The flag is set automatically when:

- you add the character to a session as a persona (the session's persona picker, or **Add your persona** as a guest),
- the [SillyTavern importer](./importing-from-sillytavern.md) creates it from a SillyTavern persona,
- the setup wizard's **Just call me "You"** makes a starter persona named "You".

To set or clear it by hand, use the character's **⋮** menu in the list (**Use as persona** / **Not a persona**) or the **Persona** switch beside **Favorite** on the character form.

The flag is a library fact, not a session fact. Flagging a character does not add it to any session, and clearing it does not remove it from sessions where it is already your persona. It only decides where the character shows up: in the Personas filter, and as the first choice when a session asks who you are.

## Default persona

One character per account can be your **default persona** — the one a new session starts with. The setup wizard flags the starter persona "You" as the default; change it from a character's **⋮** menu with **Set as default persona**, or with the **Default persona** switch on the character form. Choosing a new default clears the previous one, and a character made the default is a persona too, whether or not it was flagged before. The default is scoped to your account and does not affect anyone else's characters.

## Creating a persona

Personas are created the same ways as characters: **Write a character**, **Browse the library** or **Import a card** under the **New** button in the Characters view — see [Creating a Character](./characters.md#creating-a-character). A card from the [Library](./characters.md#browsing-the-character-library) lands as a plain character; flag it afterwards with **Use as persona**. The **New** menu also has **Write a persona**, which opens the same creator (or the full form, depending on the **Easy Character Creation** setting) with the Persona flag already on. That one setting governs characters and personas alike.

A persona needs only a **Name** and a **Description** — write the description as "this is who I am": your background, interests and how you talk, or the role you want to play. Aliases, a short summary, tags, an avatar and a gallery all work exactly as they do for any character, and the AI-facing fields you would not use on a persona (personality, scenario, first message, example dialogues) can simply stay empty.

## Persona cards

A persona exports and imports as an ordinary character card (it exports as Character Card V3 JSON, PNG or CHARX, and imports any of the card formats a character does) — see [Exporting a Character](./characters.md#exporting-a-character) and [Importing a Character from a File](./characters.md#importing-a-character-from-a-file). A card you import lands as a plain character; flag it as a persona afterwards if that is what it is. Persona cards written by older Serene Pub versions import the same way, and their `extensions.serenepub` fields (uuid, category, aliases, summary) are honoured.

Lorebook export is paused for now. Importing a lorebook exported by Serene Pub 0.5, which listed its personas separately, brings them back as characters flagged as personas (see [Creating, importing, duplicating and deleting](./lorebooks.md#creating-importing-duplicating-and-deleting)).

## Personas in sessions

A session can have more than one persona attached at once, just as it can have more than one character. When creating or editing a session, the persona picker lists your personas first; a **Show all characters** toggle widens it to the whole library, and picking an unflagged character there flags it for you. Removing a persona from a session asks for confirmation. See [Sessions](./sessions.md#personas--persona-switching) for switching between several of your personas inside one session, and for what a guest can and cannot do with persona messages.

### Personas in a lorebook's cast

If a session reads a [lorebook](./lorebooks.md), a persona joining the session becomes a member of the book's [cast](./lorebooks.md#cast) the same way a character does, so entries can refer to it by its placeholder. Nothing to configure — the member is made the first time the persona joins, and never twice for the same card.

### Personas and retrieval

A character's description and summary are queued for embedding whenever it is created or updated, personas included. See [Embeddings & RAG](./embeddings-and-rag.md).

## Where did the Personas view go?

Before the merge the rail had a separate **Personas** entry with its own list, form, creator, library and export dialog, all duplicates of the character ones. Everything they did is now in the Characters view: the **Personas** filter pick, the persona badge on a row, **Write a persona** in the New menu and the persona controls in a character's **⋮** menu and form. Existing personas were moved into your Characters list with the flag set, keeping their avatars, galleries, tags, lorebook bindings and every session and message that referred to them.
