# Personas

A persona is you, in the story: the name the AI calls you, your picture, and a description of who you are.

:::tip What it's for
- Telling the AI who it's talking to, so replies fit you.
- Playing different people in different stories: a knight in one session, a detective in another.
:::

A persona isn't a separate kind of thing: **a persona is a [character](./characters.md) you play**. Your personas live in the same Characters list, use the same form and import and export as the same cards. A small **Persona** flag marks the ones that are yours to play.

## The basics

### Make a persona

1. Open **Characters** on the rail and press **New › Write a persona**.
2. Give it a **Name** and a **Description**. Write the description as "this is who I am": your background, what you're like, how you talk, or the role you want to play.
3. Save it.

:::tip You should see
Your persona in the Characters list with a small person badge after its name. The filter menu's **Personas** pick shows just your personas.
:::

**Write a persona** opens the same guided creator (or full form) as **Write a character**, with the Persona flag already on. Fields you won't need for yourself, such as personality, first message and example dialogues, can stay empty.

### Use it in a session

When you start a session, **Who you play as** offers your personas, with your default persona already picked. See [Sessions](./sessions.md#start-a-session).

## Everyday use

### Turn a character into a persona

Any character can be a persona. Choose **Use as persona** from its **⋮** menu, or turn on the **Persona** switch on its form (beside **Favorite**). **Not a persona** turns it off.

The flag is also set for you when:

- you play a character in a session (pick it as your persona),
- the [SillyTavern importer](./importing-from-sillytavern.md) brings in a SillyTavern persona,
- the setup wizard's **Just call me "You"** makes a starter persona named "You".

The flag only decides where a character shows up: under the **Personas** filter, and first when a session asks who you are. Turning it off doesn't take it out of sessions where you already play it. It's never turned off for you.

A card from the [Library](./characters.md#browsing-the-character-library), or one you import, arrives as a plain character. Mark it with **Use as persona** if it's you.

### Your default persona

Your **default persona** is the one every new session starts with. Change it with **Set as default persona** in a character's **⋮** menu, or the **Default persona** switch on its form. There is one per account, so choosing a new one replaces the old, and the default is always a persona.

### Several personas in one session

A session can have more than one of your personas. When you add a persona to a session, the picker lists your personas first; **Show all characters** widens it to every character, and picking one marks it as a persona. Removing a persona from a session asks first.

To change who you're writing as mid-session, see [Switch which persona you write as](./sessions.md#switch-which-persona-you-write-as).

## Going further

- **Lorebooks**: when a session reads a [lorebook](./lorebooks.md), your persona joins its cast like any character, so lore can mention you. Nothing to set up. See [Cast and relationships](./lorebook-cast.md).
- **Embeddings**: a persona's description and summary are indexed like any character's. See [Embeddings and search by meaning](./embeddings-and-rag.md).
- **Cards**: a persona exports as an ordinary character card (JSON, PNG or CHARX) and imports from any card a character can. See [Exporting a character](./characters.md#exporting-a-character) and [Importing a card](./characters.md#importing-a-card).
- **Older lorebooks**: importing a lorebook exported by Serene Pub 0.5, which listed its personas separately, brings them in as characters marked as personas.

## Related

- [Characters](./characters.md)
- [Sessions](./sessions.md)
- [Upgrading from 0.5](./upgrading-from-0.5.md): what happened to 0.5's separate personas.
