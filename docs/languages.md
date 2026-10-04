# Languages

Serene Pub can show its interface in 28 languages, translated automatically the first time each piece of text is needed.

:::tip What it's for
- Using the app in your own language.
- Setting the language for everyone on your pub (administrators).
:::

Your stories are never translated. Characters, sessions and lorebooks stay in whatever language you write them in, and models usually answer in the language you write in.

## The basics: change your language

1. Open **Settings** on the rail, on the **User** tab.
2. Pick your language under **Language**. Languages are listed by their own name, with the English name in brackets, such as **Español (Spanish)** or **日本語 (Japanese)**.

:::tip You should see
Text across the app switches to your language. The first time you open a screen, some of it may show in English for a moment while it's translated.
:::

You also choose a language on the very first screen of the setup wizard (see [Getting started](./getting-started.md#1-get-started)), and can change it here any time.

:::warning If this didn't work
- **Everything is still in English.** Automatic translation is off on this pub. An administrator turns it on in **Admin › General**; see [Turning on automatic translation](#turning-on-automatic-translation).
- **Some text is translated and some isn't.** Expected: text is translated as screens are first opened. If some never fills in, the translation service may be unreachable; it's tried again on later visits.
:::

## Your language and the pub's

There are two settings:

- **The pub's default**, set by an administrator in **Admin › General** on the **Language** card. Everyone who hasn't chosen their own follows it.
- **Your own**, in **Settings › User**. **Pub default** means you follow the pub's; anything else is yours alone.

So when an administrator changes the default, everyone on **Pub default** moves with it, and anyone who has chosen keeps their choice. An administrator's choice on the wizard's first screen sets both their own language and the pub's default.

## Turning on automatic translation

:::note Admins only
Only an administrator can turn translation on.
:::

Serene Pub ships in English only. Other languages are filled in by a translation service, so they need **Automatic translation** turned on in **Admin › General**. It's off on a new pub, because turning it on sends interface text to an outside service. Choose the **Translation service**:

- **Google Translate (no account needed)**: nothing to set up. Interface text goes to Google.
- **LibreTranslate (self-hostable)**: an open-source translation server. Leave the address empty to use the public one, or point it at your own so nothing leaves your network.

### What is sent

Only Serene Pub's own interface text: button labels, headings, descriptions, short pieces at most a few hundred characters long. **Your sessions, characters, personas and lorebooks are never sent.** Choosing English sends nothing at all.

### How it's stored

Each piece of text is translated **once per language** and kept in your pub, so a second person opening the same screen waits for nothing. Your browser keeps a copy too, so the app opens straight in your language next time. Machine translation is a starting point: a hand-written translation stored for a piece of text is always used in its place.

## Known limits

### Right-to-left languages

Arabic and Hebrew are translated like any other language, but the layout is not mirrored: text reads right to left, while the menus and panes stay where they are in English.

### Regional variants

Only base languages are offered (Portuguese, Chinese), not regional ones (Brazilian Portuguese, Traditional Chinese), because the translation services only accept base language codes.

## For power users: language and lore search

Your language is also meant to tell lore search which word-matching it can use. Two techniques exist:

- **Stemming** reduces a word to its root, so "riding", "rides" and "rode" all match an entry keyed `ride`. It needs rules written for each language.
- **Trigram matching** compares three-letter fragments, so `ashguard` and `ashguards` match. It works for every language and writing system.

Stemming exists for Arabic, Danish, Dutch, English, Finnish, French, German, Greek, Hindi, Hungarian, Indonesian, Italian, Norwegian, Portuguese, Romanian, Russian, Spanish, Swedish and Turkish. The other nine languages use trigram matching only, which for Chinese, Japanese and Thai (written without spaces between words) is the only technique that works anyway.

:::note Not wired up yet
Lore search doesn't read your language yet: it matches the same way for every language today. [Embeddings and search by meaning](./embeddings-and-rag.md) describes what it does now.
:::

Plugin authors: every label a plugin declares can carry its own translations as a `{ en, … }` map. See [Your first plugin](./sdk/guides/your-first-plugin.md).

## Related

- [Pub settings](./system-settings.md#general): the pub's default language and automatic translation.
- [Themes and settings](./themes-and-settings.md#your-preferences-the-user-tab): your own settings.
- [Getting started](./getting-started.md): the setup wizard, whose first screen asks your language.
