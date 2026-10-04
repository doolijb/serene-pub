# Pub settings

Pub settings are the switches that apply to your whole pub and everyone on it: sign-in, the network, backups, diagnostics and the record of admin changes.

:::note Admins only
Only administrators can open the admin area or change these. The server checks every change too, so hiding the Admin view from members is a convenience, not the protection.
:::

Nothing here needs setting up before you use the app: a new pub starts with sensible defaults (accounts off, daily backups on). Your own preferences, such as your theme and language, are in **Settings** instead: see [Themes and settings](./themes-and-settings.md).

Open **Admin** on the rail and look under **Pub**. Each page is a column of cards, and each card saves on its own.

| Page | What it holds |
| --- | --- |
| [General](#general) | Language and translation, user accounts, the CharaVault account, scripts, lorebook writes |
| [Network](#network) | The tunnel that makes your pub reachable from outside, and the allowed hosts |
| [Data and backups](#data-and-backups) | The backup policy, and the backups themselves |
| [Diagnostics](#diagnostics) | The support report, and context debugging |
| [History](#history) | Who changed what on this pub, and when |

Defaults for which model does which job are under **Models › Defaults** instead: see [System-wide defaults](#system-wide-defaults).

## General

### User accounts

The **User accounts** card controls whether Serene Pub runs in single-user mode or requires sign-in. A status line says which: a grey dot and _Off_, or a green dot and _On — sign-in is required_.

Accounts are off on a new pub: there's no sign-in screen, and everyone who reaches the pub is the first administrator. That suits a personal install, but anyone who can reach the app has full admin access, which is why a [tunnel](#network) can't start until accounts are on.

The **User accounts** switch turns sign-in on for everyone. It's **permanent**: once on, the switch locks. If your own account has no passphrase yet, the confirmation dialog asks you to set one first. The card isn't shown in the Android app, which is single-user.

Step by step, and what happens next (inviting people, roles, passphrases): [Users and accounts](./users-and-accounts.md#enabling-user-accounts).

### Language and automatic translation

The **Language** card sets the pub's default language; the **Automatic translation** card decides whether interface strings with no translation are sent to a translation service. See [Languages](./languages.md).

### Community library: CharaVault

Connect one [CharaVault](https://charavault.net) account, and everyone on your pub browses charavault.net from the character [Library](./characters.md#browsing-the-character-library) with that account's higher search limit. The account is shared by the whole pub, not one person. It works on every platform, the Android app included.

To connect: create an App Password at charavault.net named "Serene Pub", enter the account's **email** and that **App Password** (it starts `cv_`), and press **Connect**. The card then reads **Connected as** your email, with a **Disconnect** button.

### Scripts

**Run scripts** is the off switch for scripts people have written into pipelines. Turning it off deletes nothing: every script stays where it is and simply doesn't run until you turn it back on. Use it when a script misbehaves and you need the pub working first.

### Lorebook writes from sessions

How sessions may change the lorebooks they read (a stat a session records, a summary, a compiled history, a graph): **Full**, **Review changes** (the default) or **Off**, each with a line saying what it does. It's the default for everyone: a person who hasn't chosen their own in **Settings › User** follows it, and changes with it; anyone who has chosen keeps their choice. What each setting does to each kind of write is in [Lorebooks](./lorebooks.md#what-a-session-may-write) and [Stats and states](./stats-and-states.md#when-a-session-changes-the-lorebook).

### Embeddings

Embeddings (the model behind Search by meaning) are chosen in **Admin › Models › Defaults**, not here. See [Embeddings and search by meaning](./embeddings-and-rag.md).

## Network

The **Tunnel** card makes your pub reachable from outside your home network, through Cloudflare, without changing anything on your router. It needs [user accounts](#user-accounts) on. From the top:

- A **status line** — a dot and a word: grey _Not set up_ or _Stopped_, gold _Starting_, green _Running_ (with the public address and **Copy link**), or red _Failed_ (with the error beneath).
- **Mode** — **Easy** is a free Cloudflare quick tunnel with a random address that changes on every restart; **Custom domain** uses your own hostname and a Cloudflare connector token, and its address is stable. The mode, and everything below it, is locked while the tunnel runs.
- **Stop automatically after** — chips for 1, 4, 8, 12, 24 and 72 hours, **Never**, and a field for any number of hours from 15 minutes to 30 days. A running tunnel says when it will stop.
- **Start when the app starts** — brings the tunnel back after a restart (on Easy, with a new address).
- **Start tunnel** / **Stop tunnel**, and **Save configuration**. When the tunnel cannot start, one line beside the button says why: _A public address needs user accounts. Turn accounts on first_ (a link to the User accounts card on General), or _Save the configuration first._

The first start downloads Cloudflare's `cloudflared` program, so it can take up to a minute.

The **Allowed hosts** card lists which addresses may open a live connection to the pub, and why each is allowed. It's read-only; the rules are in [Hosting](./hosting.md#security-notes). If `ALLOWED_ORIGINS=*` is set, a warning above both cards says the list isn't being checked at all.

Tunnels are not available in the Android app; the card says so instead.

## Data and backups

The **Backup policy** card holds the two switches for the whole pub: **Back up daily** (on by default), which takes a copy of the database once a day on top of the one taken whenever an update is about to change the database, and **Include user files** (off by default), which archives media and avatars beside each backup. Neither ever deletes anything.

Below it is the backups list: **Back up now** (with a one-off _include user files_ box), every backup with its size and date and a **Delete** button, and any databases set aside by a recovery. Backups are kept in your [data folder](./install.md#where-your-data-lives). Restoring isn't done here, because it has to happen while the database is closed: see [Database won't open](./troubleshooting.md#database-wont-open). The same list is on the **Data** tab of **Settings**.

## Diagnostics

### Support report

**Copy report** puts a description of this pub on the clipboard, ready to paste into a bug report or hand to an AI assistant; **Download .md** saves the same text as a Markdown file. A preview shows exactly what will be shared, and **Refresh** makes it again. Nothing is stored: the report is built when you open the page or press Refresh.

It covers the app, SDK and core catalogue versions (and a few key packages), Node and the operating system, the pub's switches, which environment variables are set, database migrations and backups, connections (type, capabilities, models, last sync error), capability defaults, installed plugins with their version, source link, author and the SDK they were built against, plugin hook failures from the last seven days, recent failed pipeline runs with the node that stopped them, the server's recent warnings and errors (the last 300 since it started, kept in memory only), the **Needs you** list, and your browser's user agent, language, time zone and window size.

Before it leaves the server, one redaction step removes API keys, tokens, passwords and other secrets; credentials and query strings in URLs; email addresses; IP addresses and host names other than localhost and a short list of well-known public services; user names (shown as `user#1`, `user#2`, …) and the machine's name; and paths under your home folder (shown as `~`). A database error keeps its reason and the shape of its query, but never the values the query was writing — those can be message or lore text — so they read `[params withheld]`. Environment variable values are shown only for a few harmless ones such as `NODE_ENV` and `PORT`. Message text, characters and lore are never read. The report says at the top what was redacted, and stays under about 50 KB by dropping its oldest log lines first. Read it before you share it.

Every section has a fixed heading and the whole report ends with the same facts as a JSON block, so a person can skim it and a program or an assistant can read it exactly.

### Context debugging

**Context debugging** adds a prompt inspector to sessions, computes full retrieval diagnostics, and saves what was sent to the model alongside each reply, so you can see why a reply came out the way it did. It slows every reply a little, so leave it off unless you're investigating something.

## History

**History** lists every change an admin has made to this pub, newest first: when, who, what kind of change (added, changed, deleted, or an action such as starting a process), the object it touched, and a one-line summary such as *Changed default language from “en” to “fr”*. Select a change to open its own page, read-only: when, who, the action, the object and the event, then each changed field with its old and new value. Its **Open** button goes to the object (unless the change deleted it), and **This object's history** lists every change to that object.

What is recorded: pub settings (General, backups policy, the KoboldCPP and Ollama runtimes, the pub theme, the CharaVault account), the tunnel, users, invites and clearing a user's two-factor, backups made and deleted, connections and their models and scripts, capability defaults, sampling configs, genres and presets, pipeline configurations and options changed for the whole pub, prompts, the three template kinds, scripts, plugins and components. A change made inside one session, or by someone who is not an admin, is not a change to the pub and is not recorded. A change that fails records nothing.

**Secrets are never written down.** Passwords, API keys, tokens and other credentials show only that they changed, never their value, and a pipeline option's value is not recorded at all because an option can hold a credential. Long values are shortened.

Narrow the list with the filters beside it (behind the **Filter** button in a narrow pane): **Object** (the kind of object), **Who**, **Action**, and **When**: any date, today, the past 7 days, this month or this year. The search box matches summaries, object names, people and event names. Click **When** to sort the loaded changes oldest or newest first. The filters are part of the address, so a filtered list can be bookmarked or shared with another admin; `/admin/history?type=connection&id=12` shows one connection's history, named in a chip under the title (its **×** shows every object of that kind again). **Load older changes** fetches the next page.

Records are kept for 90 days, and never more than the newest 20,000; older ones are removed automatically. Each record keeps the person's name as it was, so the history still reads after an account is deleted.

## Local runtimes (KoboldCPP, Ollama)

A KoboldCPP or Ollama that your pub runs for you is a **connection**, set up and removed in the Connections view along with its address, port, model folders and timeouts: see [Connections](./connections.md#koboldcpp-run-by-serene-pub). The Android app can't run either; General says so on a **Local model runtimes** card.

## System-wide defaults

Which connection and model each job uses (writing replies, embeddings, images and so on) is set in **Admin › Models › Defaults**: see [Connections](./connections.md). Default sampling and pipeline configurations are chosen on their own admin pages.

## Update notifications

Serene Pub checks GitHub for a newer release at most once a day. When one is out, every admin gets a notification in the [Activity](./getting-around.md#activity) view, *Serene Pub v0.7.0 is available*, whose **See the update** button opens **Admin › Updates**. The Admin Overview shows the release too: **Update to v0.7.0** when the launcher can install it for you, or **Get v0.7.0**, linking to the project's GitHub releases page, when it can't (Docker, Android, or a server started without its launcher). You are told once per release: dismissing the notification keeps it away until a newer release comes out, and it clears by itself once your install runs that version. Non-admins are never notified, since only an admin can update the install. Nothing is downloaded until an admin presses **Download update**, and nothing changes until they press **Restart to update**: see [Updating Serene Pub](./updating.md). The version you're running is on the **About** tab of **Settings**.

Pre-release builds are the exception. On a version carrying a pre-release suffix (`0.6.0-pr-1`, `-rc-1`, `-dev`, or any suffix Serene Pub doesn't recognise), the check is switched off entirely — GitHub is never contacted about versions, no update notice appears anywhere, there is no **Admin › Updates** section, and the build never updates itself. Those builds instead carry a permanent, faint version marker in the bottom-right corner of the window, so a preview build is never mistaken for a release one. The marker never intercepts clicks and fades out as your cursor approaches it.

`-beta` is **not** a pre-release. Alpha and beta describe how mature the project is, not whether a build is released, so a `-beta` build is a normal release: no version marker, and update notifications work as described above.
