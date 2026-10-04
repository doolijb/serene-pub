# Upgrading from 0.5

Serene Pub 0.6 opens your 0.5.3 data and brings it across by itself the first time it starts. There's nothing to export or import.

:::note Before you start
- You're on Serene Pub **0.5.3**.
- Close 0.5.3 before starting 0.6.
- 0.6 uses the same data folder as 0.5 by default (see [Where your data is](./troubleshooting.md#where-your-data-is)). If you moved yours with `SERENE_PUB_DATA_DIR`, start 0.6 with the same setting.
:::

## Upgrade

1. Install 0.6 (see [Install](./install.md)) and start it.
2. Wait. The first start converts your data before the first page opens. A big database (tens of thousands of messages) can take a few minutes. Leave it running.
3. Open Serene Pub as usual and sign in.

:::tip You should see
Your sessions, characters and lorebooks where you left them. Admins get a notification, *Your 0.5.3 data was upgraded to 0.6*, whose **Open History** button lists every note the upgrade left.
:::

:::warning If this didn't work
- **It won't open after the upgrade**: the conversion stopped partway and was undone, so nothing is lost, and the pre-upgrade backup is there too. The startup log says why. Fix that (or ask for help with the log) and start again; it picks up where it stopped.
- **Something is missing or looks different**: check the notes in **Admin › History** (below). Each one names the chat, lorebook, connection or config it's about.
:::

## What happens on the first start

1. **A backup is taken first.** It's `backups/serene-pub-0.5.3-beta-<date>.tgz` in your data folder (or `serene-pub-0.0.0-<date>.tgz` if you only ever ran 0.5 from source). If the backup fails, nothing is changed. Keep this file: it's the only copy of your data as 0.5 stored it.
2. **Your data is converted.** All of it comes across, or none of it does: if the start is interrupted (a crash, a power cut), the next start tries again from where it was.
3. **Leftover migration records are cleared.** If you ever ran an earlier 0.5 build or 0.5 from source, your database may remember migrations that 0.6 doesn't ship. They're removed this one time, and a note says how many. None of your data is in them.
4. **The upgrade leaves notes.** Each note is one thing it changed or couldn't carry, in **Admin › History**, filtered to the data upgrade.

Every start after that is a normal one.

## Where things are now

A few things work differently in 0.6, so they live somewhere new:

- **Chats are sessions**, in the **Sessions** view. See [Sessions](./sessions.md).
- **Personas are characters** marked as personas. They're in the **Characters** view: the filter's **Personas** pick lists them, **Write a persona** is under **New**, and a character's **⋮** menu has **Use as persona** and **Set as default persona**. See [Personas](./personas.md).
- **Which model replies** is no longer chosen per chat. It's set once in **Admin › Models › Defaults**, or per pipeline. See [Connections](./connections.md).
- **Prompts and configs** belong to pipelines now, in **Admin › Pipelines**. See [Pipelines](./pipelines.md#upgrading-from-05).
- **Context configs** are replaced by [context templates](./context-templates.md#upgrading-from-05).

## What comes across

- **Accounts**: every user, their passphrase, admin status, settings and theme. Anyone signed in stays signed in.
- **Characters**, with their avatars and galleries, which join the media library (**Settings › Media**).
- **Personas**, as characters marked as personas. Each person's default persona stays their default. If a persona's card id clashed with one of that person's characters, it gets a new id, and a note says which.
- **Chats**, as **Chat** sessions with every message in order: swipes, reasoning, edits, hidden messages, narrator messages, drafts and scenarios. Characters, personas and guests keep their seats.
    - **Group reply strategy** becomes the session's turn order: *Manual* stays manual, *User split* becomes *Round robin by user*, and *Ordered* (or none) is the usual round robin. See [Group sessions](./group-sessions.md#choose-how-the-turn-order-works).
    - **Character visibility** is now one setting per session, **Character detail**: *visible* is *Everything*, *minimal* is *Name and description*, *hidden* is *Only whoever is speaking*. Where a group chat mixed them, the most detailed wins, and a note lists those chats.
    - A chat that **ignored retrieval** has **Search by meaning** off; turn it back on in the session's pipeline settings.
- **Lorebooks**: world lore, character lore and history become entries of the same kinds, with their keywords, regex and case settings, *always on* and *enabled* switches, and priorities. Scenes and the relationship graph come too.
    - A history date 0.6 can't store (a year, month or day of 0 or less, or a day without a month) moves to the nearest valid date, with a note.
    - Character bindings keep their tags. The short form `{char:N}` is written `{{char:N}}`. Where two bindings shared a tag, or one character was bound twice, they're merged, with a note.
- **Connections**, with their models and API keys. In 0.5 a connection was one model; in 0.6 it's one service with as many models as you like. So connections to the same service become **one connection that lists every model they used**: ten Ollama connections to `localhost:11434` become one **Ollama** connection with ten models.
    - *The same service* means the same kind of connection, the same address and the same API key. A trailing slash or capital letters don't make a different address, but a different path (`/v1` or not) or host does, and `localhost` and `127.0.0.1` count as two addresses.
    - Each connection takes the name 0.6 gives a new connection to that service: *OpenRouter*, *Ollama*, *LM Studio*, *Anthropic (Claude)*, or *Custom (OpenAI-Compatible)* for an address no preset knows. A second connection to the same service, at another address or with another key, is numbered: *OpenRouter 2*. A note lists what was combined or renamed, with the names you gave them in 0.5.
    - Where one of the combined connections set something differently (its prompt format, reasoning or keep-alive), its own model keeps that setting. Where two of them used the same model with different settings, the first one's settings are kept, and the note says so.
    - A *llama.cpp completion* connection becomes **Llama.cpp**. An **llmman** connection becomes an **Ollama** connection at the same address, keeping its reasoning, keep-alive and chat settings. KoboldCPP run by Serene Pub is always one connection, listing every model you used with it.
    - A text connection's prompt format becomes the matching completion template; a format 0.6 doesn't have is left unset, with a note. Your default connection and sampling become the defaults for writing replies, on the model that connection used.
- **Sampling configs**, with their values and switches. A name that now clashes with another (ignoring case) gets ` (2)`, and a value outside what 0.6 accepts moves to the nearest allowed one. Both get a note.
- **Embeddings**: your embedding setup becomes an embedding connection, set as the default. Stored embeddings are kept only if they came from that same model; the rest are made again when an embedding model is starred. On a paid service, that first re-index is billed once, like any new index.
- **Prompt text**: each prompt, narrator, summarizer and graph-build config you wrote becomes a configuration of the pipeline it fed, with its text. Each person's active choices are selected on every session they own (and, with one person, for the whole server). A chat's own narrator config stays that session's. A chat that ran on 0.5's built-in reply prompt keeps it as that session's; new sessions start on 0.6's default.
- **Ollama and KoboldCPP settings**, KoboldCPP's model list, custom themes, tags, and the duplicate pairs you dismissed.

## What doesn't come across

0.6 has no place for these. They stay in the pre-upgrade backup, and the notes list them:

- **A chat's own connection.** Replies use the default connection (**Admin › Models › Defaults**) or a pipeline configuration's own choice.
- **A chat's own "AI Override" prompt config.** 0.5 stored it but never used it, so replies were written with the owner's active config, as they still are. The config itself comes across and can be selected.
- **Everything in a prompt config other than its text**: its post-history placement and token trigger, its own connection and sampling, and its other settings. Set them again in **Admin › Pipelines** if you want them.
- **Context configs.** Every pipeline uses the shipped [context template](./context-templates.md#upgrading-from-05). A template you wrote is named in the notes, and its text is in the backup.
- **Character card assets**, **persona list order**, the **summarization on/off switch** and its setup step (summarization is always on), and the **easy persona creation** switch.
- **Embeddings from a different model** (see above).
- **A scene whose history entry no longer existed**.

## Going further

### Restoring a 0.5 backup later

A 0.5.3 database restored through 0.6 (**Settings › Data**, the recovery page, or `npm run db:recover -- --restore`) is upgraded the same way on the next start.

0.5 had no backup feature, so a 0.5 archive you made yourself has no saved copy of `meta.json` beside it. Your current `meta.json` is kept, and its key may not be the one that encrypted the API keys in that database. Copy the 0.5 install's `cryptoSecretKey` into `meta.json` first (with Serene Pub stopped), or enter the API keys again afterwards. See [Restore the newest backup by hand](./troubleshooting.md#restore-the-newest-backup-by-hand).

### Going back to 0.5.3

1. Stop 0.6.
2. Restore the pre-upgrade backup by hand ([the same steps](./troubleshooting.md#restore-the-newest-backup-by-hand)).
3. Set `version` in `meta.json` back to the one in the backup's companion `.meta.json` file (`0.5.3-beta`). 0.5.3 refuses a database that says it's newer.

Anything you did in 0.6 stays only in the database you moved aside.

## Related

- [Troubleshooting → Database](./troubleshooting.md#database)
- [Context templates → Upgrading from 0.5](./context-templates.md#upgrading-from-05)
- [Pipelines → Upgrading from 0.5](./pipelines.md#upgrading-from-05)
