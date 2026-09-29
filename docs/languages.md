# Languages

Serene Pub has a language setting, and it does two jobs. The obvious one is the language the interface is drawn in. The less obvious one matters more: your language decides **which text-matching techniques retrieval can use** when it decides what lore reaches the model.

## Overview

The setting lives in two places, and the difference between them is the whole design:

- **A server default**, chosen by an administrator. It is the language the instance uses, and every user who has not picked one of their own follows it.
- **A per-user language**, on the Settings panel's **User** tab. Choosing one overrides the server default for you alone; leaving it on **Server default** means an administrator can change everyone's language at once — including yours — and choosing your own means they can't.

That is the entire storage model: a user who has never opened the picker is *inheriting*, not *set to English*. Changing the server default moves every inheritor immediately and touches nobody who has made a choice.

## Choosing a Language During Setup

The first step of the setup wizard — the **Get started** screen — carries a language dropdown, before anything else it asks you.

It is there rather than on a step of its own for a practical reason: a wizard step has to be able to say when it is finished, and "you have a language" is always true because there is always a default. A dedicated step would have re-opened the whole wizard for every existing user on upgrade, to ask a question that had already been answered for them. Welcome never counts as complete and everybody passes through it, which makes it the right home — and the language you read the rest of the wizard in is a sensible first question anyway.

**If you are an admin, the choice you make there becomes the instance default** as well as your own. If you are not, it sets only your own. Either way it can be changed later in Settings.

## Which Languages Are Available

Twenty-eight, listed by their own name with the English name in brackets — so **Español (Spanish)**, **日本語 (Japanese)** — because the person looking for their language reads the first one, possibly while the interface is still in English.

### Right-to-left languages

Arabic and Hebrew are offered and will be translated like any other language, but **the interface layout is not mirrored** — text reads right-to-left, the chrome does not. That is a known gap rather than an oversight: mirroring the layout requires auditing every piece of styling in the app, and a half-mirrored interface is worse than an unmirrored one. It is tracked as its own piece of work.

### Regional variants

Only base languages are offered (`es`, `pt`, `zh`), not regional variants (`pt-BR`, `zh-TW`). That is a real limitation rather than an oversight: the translation service validates language codes against ISO 639-1 and rejects anything else, and neither of the two retrieval techniques below distinguishes Brazilian from European Portuguese. Adding regional variants is a change to one table plus a mapping down to the base code.

## How Language Affects Retrieval

This is the part that has nothing to do with what you see on screen.

When Serene Pub decides which lorebook entries are relevant to what is being said, part of that decision is text matching — does the word in the conversation correspond to a word in the entry? Two techniques do that job, and only one of them exists for every language:

- **Stemming** reduces a word to its root, so "riding", "rides" and "rode" all match an entry keyed `ride`. It is precise and it is language-specific: somebody has to write the rules for each language, and for most languages nobody has.
- **Trigram matching** compares three-character fragments, so `ashguard` and `ashguards` overlap heavily and score as a match. It is less precise, it works for every writing system, and it needs no per-language rules at all.

**Trigram matching is the default for everyone. Stemming is an enhancement, switched on for the languages it exists for.** Your language setting is what tells retrieval which case you are in. That is why this is a deliberate design rather than a limitation: the universal technique is what everyone gets, and languages with a stemmer get something extra on top.

Of the languages offered, these have stemming available:

Arabic, Danish, Dutch, English, Finnish, French, German, Greek, Hindi, Hungarian, Indonesian, Italian, Norwegian, Portuguese, Romanian, Russian, Spanish, Swedish, Turkish.

And these use trigram matching only:

Chinese, Czech, Hebrew, Japanese, Korean, Polish, Thai, Ukrainian, Vietnamese.

Being in the second list does **not** mean retrieval works badly. It means it works the way it works for everyone by default. Chinese, Japanese and Thai are further noted internally as not separating words with spaces, so for those three trigram matching is not a fallback at all — it is the only technique that can work.

> **Note:** the retrieval half of this setting is groundwork. The language is stored, and the "does this language support stemming?" question is answered by the code that ranking will consult — but ranking does not consult it yet. Nothing about how your lore is matched has changed. This page describes the design the setting exists to serve; the [Embeddings & RAG](./embeddings-and-rag.md) page describes what retrieval does today.

## Automatic Translation

Serene Pub ships **no translated text**. Choosing a language other than English gets you a translated interface only if an administrator has turned automatic translation on.

### Why it works this way

Translating an application usually means somebody writes out every string in every language, and the feature ships when the last one is done. Serene Pub took the other route: the English text in the interface *is* the key, a translation service fills in the rest, and each translated string is stored permanently the first time anybody sees it. Anything not yet reached simply stays in English, which is why a partly-translated screen looks like a partly-translated screen rather than a broken one.

Machine translation is worse than a human's. This is a starting point, not the destination — a hand-written translation stored for a string is used in preference to the machine's, permanently.

### Turning it on

**Admin › General → Automatic translation** (admin only). Off by default, and an upgrade never turns it on for you.

That default is deliberate. Turning it on is a decision to send text out of your server, so it is not something the app should quietly start doing on a self-hosted install. Two services are offered:

- **Google Translate** — no account needed, no configuration. Interface strings go to Google.
- **LibreTranslate** — an open-source translation server. Leave the URL empty to use the public instance, or **point it at your own** and nothing leaves your network at all. This is the option to use if outbound translation requests are a problem for you.

### What is sent, and what never is

Only strings that are part of Serene Pub's own interface — button labels, headings, descriptions. **Your sessions, characters, personas, and lorebook content are never translated and never sent anywhere.** They are not part of the interface, so they never enter this path; a length limit on what may be translated is a second line of defence against anything longer than a label slipping through.

Choosing English needs none of this. English is the source language, so nothing is ever translated and no request is ever made.

### How caching works

Each string is translated **once per language, ever**, and stored on your server. A second user opening the same screen pays nothing. Your browser also keeps a copy, so returning to the app paints the translated text on the first frame instead of flashing English.

The first time anyone opens a screen in a new language, some text may briefly appear in English before the translations arrive. That happens once per screen per language, and never again.

Editing an English string in a future release changes the key, so the new text is translated fresh and the old entry is simply never looked up again. There is nothing to clear and no cache to invalidate.

## For Extension Authors

Serene Pub's SDK has always been able to carry translated display text. A type declaration's `i18n` field accepts either a plain string or a map keyed by language code:

```ts
i18n: { name: { en: "Scan Depth", es: "Profundidad de escaneo" } }
```

The map is stored whole and is deliberately excluded from a type's content hash, so translating a label never counts as changing the type. When a language is not present in the map, English is used — which is why English is a required key.

Every label an extension declares — a definition's name, a setting's label, an action's label, a preset's title, a widget's title, a status — may be written either way: a plain string is the same value as a map holding only `en`. Publishing checks each one: a map without an English entry, an English entry that is empty, or something that is neither a string nor a map is refused with a message naming the field and what to write instead. Slash command names, run report notes and the text a pipeline produces at run time (a form's question, a message) are not labels and are never translated.

## Troubleshooting

**Everything is still in English after I changed my language.** Automatic translation is probably off. It is an admin setting under Admin › General → Automatic translation, and it is off by default.

**Some text is translated and some is not.** Expected. Translation happens per string as screens are visited; anything not yet reached stays in English. If it never fills in, the translation service may be unreachable — untranslated strings are retried on later visits, so a temporary outage resolves itself.

**A screen flashes English before switching.** The first visit to that screen in that language. Both your server and your browser cache the result, so it does not happen twice.

**I want a regional variant.** Not currently offered — see [Regional variants](#regional-variants) above.

**My language reads right to left and the layout looks wrong.** Known — see [Right-to-left languages](#right-to-left-languages) above.

## Related

- [Instance Settings](./system-settings.md) — where the instance default and automatic translation live.
- [Custom Themes & User Settings](./themes-and-settings.md) — the User tab, where your own language lives.
- [Embeddings & RAG](./embeddings-and-rag.md) — what retrieval does today.
- [Getting Started](./getting-started.md) — the setup wizard the language step is part of.
