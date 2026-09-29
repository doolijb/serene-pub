# Instance Settings

Instance settings hold the configuration for a whole Serene Pub deployment — the switches that affect every user, not just the one signed in. Only admin accounts can see or change them.

## Overview

Open the **Admin** view and look under the **Instance** group. It has four settings pages, each a single column of cards where every card saves on its own, and a **History** page:

| Page | Address | What it holds |
| --- | --- | --- |
| **General** | `/admin/general` | Language, automatic translation, user accounts, the CharaVault account, and the scripts switch |
| **Network** | `/admin/network` | The tunnel that makes this instance reachable from outside, and the allowed hosts |
| **Data and backups** | `/admin/data` | The backup policy, and the backups themselves |
| **Diagnostics** | `/admin/diagnostics` | Support report, context debugging |
| **History** | `/admin/history` | Who changed what on this instance, and when |

The old addresses still work: `/admin/settings` opens General and `/admin/servers` opens Network.

Your own preferences are separate — the **Easy character creation** toggle lives on the Settings sidebar's **User** tab, and theme, dark mode, and background image on its **Themes** tab — all covered in [Custom Themes & User Settings](./themes-and-settings.md).

Access is gated in two places, not just one. The Admin view only opens for admins, and every setting change is also checked on the server: if a non-admin account somehow sends one, it is rejected as unauthorized.

In a fresh, single-admin install the settings are already populated with sensible defaults (accounts off) — there's nothing you're required to configure before using the app.

## General

### User accounts

The **User accounts** card controls whether Serene Pub runs in single-user mode or requires sign-in. A status line says which: a grey dot and _Off_, or a green dot and _On — sign-in is required_.

By default, accounts are **not** on: the app automatically signs everyone in as the first admin user, with no login screen. The **User accounts** switch turns on authentication and multi-user support instance-wide.

This is a **permanent, one-way change** — once accounts are on, the switch locks on and the card says "User accounts are on. This setting cannot be reversed."

Turning the switch on first opens a **Turn on user accounts?** dialog that says the change cannot be reversed. If your own admin account doesn't already have a passphrase, the same dialog asks you to set one first — showing your username (read-only) alongside **Passphrase** and **Confirm passphrase** fields — before it will let you proceed. The server enforces a minimum of 10 characters (128 maximum) with at least one uppercase letter, one lowercase letter, and one special character — the rule the dialog's own requirements list shows. Once confirmed, a toast reads "User accounts turned on."

Until accounts are on, every connection is treated as the instance's first admin user. That is convenient for a personal install, but anyone who can reach the app has full admin access — which is why a tunnel cannot start until accounts are on (see [Network](#network)). The card is hidden in the Android app, which is single-user by design.

See [Users & Accounts](./users-and-accounts.md) for how account creation, passphrases, and login work once this is on. Accounts are managed under **Admin › People › Users**.

### Language and automatic translation

The **Language** card sets the instance's default language; the **Automatic translation** card decides whether interface strings with no translation are sent to a translation service. See [Languages](./languages.md).

### Community library: CharaVault

The **Community library: CharaVault** card lets an admin connect one [CharaVault](https://charavault.net) account so everyone on the instance can browse charavault.net directly from the in-app Character Library. The credential is shared instance-wide, not per-user — connecting it raises the search rate limit for every user on this instance, not just the admin who set it up. It is a plain HTTP connection, so the card is available on every platform, including the Android app.

To connect, create an App Password at charavault.net named "Serene Pub," then enter the account's **email** and that **App Password** (placeholder `cv_...`) and click **Connect**. On success, a "CharaVault account connected" toast appears and the card shows **Connected as `<email>`** with a green dot and a **Disconnect** button. Both actions have their own error toasts if the request fails.

### Scripts

The **Run scripts** switch is the kill switch for user-authored pipeline scripts. Off is a recovery lever, not a purge: every chain and attachment stays in place and does nothing until it is switched back on.

### Embeddings

Embeddings are not on General: they are set in **Admin › Models › Defaults**, and General says so in one line. See [Embeddings and RAG](./embeddings-and-rag.md).

## Network

The **Tunnel** card makes this instance reachable from outside your network without port forwarding. From the top:

- A **status line** — a dot and a word: grey _Not set up_ or _Stopped_, gold _Starting_, green _Running_ (with the public address and **Copy link**), or red _Failed_ (with the error beneath).
- **Mode** — **Easy** is a free Cloudflare quick tunnel with a random address that changes on every restart; **Custom domain** uses your own hostname and a Cloudflare connector token, and its address is stable. The mode, and everything below it, is locked while the tunnel runs.
- **Stop automatically after** — chips for 1, 4, 8, 12, 24 and 72 hours, **Never**, and a field for any number of hours from 15 minutes to 30 days. A running tunnel says when it will stop.
- **Start when the app starts** — brings the tunnel back after a restart (on Easy, with a new address).
- **Start tunnel** / **Stop tunnel**, and **Save configuration**. When the tunnel cannot start, one line beside the button says why: _A public address needs user accounts. Turn accounts on first_ (a link to the User accounts card on General), or _Save the configuration first._

The **Allowed hosts** card lists which origins may open a realtime connection, and where each comes from. It is read-only. If `ALLOWED_ORIGINS=*` is set, a warning above both cards says the list is not being consulted at all. See [Hosting](./hosting.md).

Tunnels are not available in the Android app; the card says so instead.

## Data and backups

The **Backup policy** card holds the two instance-wide switches: **Back up daily** (on by default), which takes a copy of the database once a day on top of the one taken before every version upgrade, and **Include user files** (off by default), which archives media and avatars beside each backup. Neither ever deletes anything.

Below it is the backups list: **Back up now** (with a one-off _include user files_ box), every backup with its size and date and a **Delete** button, and any databases set aside by a recovery. Restoring is not done here — see [Troubleshooting](./troubleshooting.md). The same list is in the Settings sidebar's **Data** tab.

## Diagnostics

### Support report

**Copy report** puts a description of this install on the clipboard, ready to paste into a bug report or hand to an AI assistant; **Download .md** saves the same text as a Markdown file. A preview shows exactly what will be shared, and **Refresh** makes it again. Nothing is stored: the report is built when you open the page or press Refresh.

It covers the app, SDK and core catalogue versions (and a few key packages), Node and the operating system, instance switches, which environment variables are set, database migrations and backups, connections (type, capabilities, models, last sync error), capability defaults, installed plugins with their version, source link, author and the SDK they were built against, plugin hook failures from the last seven days, recent failed pipeline runs with the node that stopped them, the server's recent warnings and errors (the last 300 since it started, kept in memory only), the **Needs you** list, and your browser's user agent, language, time zone and window size.

Before it leaves the server, one redaction step removes API keys, tokens, passwords and other secrets; credentials and query strings in URLs; email addresses; IP addresses and host names other than localhost and a short list of well-known public services; user names (shown as `user#1`, `user#2`, …) and the machine's name; and paths under your home folder (shown as `~`). Environment variable values are shown only for a few harmless ones such as `NODE_ENV` and `PORT`. Message text, characters and lore are never read. The report says at the top what was redacted, and stays under about 50 KB by dropping its oldest log lines first. Read it before you share it.

Every section has a fixed heading and the whole report ends with the same facts as a JSON block, so a person can skim it and a program or an assistant can read it exactly.

### Context debugging

**Context debugging** adds a prompt-inspector tab to the session UI and makes Serene Pub compute full retrieval-augmented generation (RAG) and retrieval diagnostics, saving the compiled prompt metadata alongside each generated message for later inspection. It is for troubleshooting prompt construction and retrieval, not everyday use, since it adds overhead to every generation.

## History

**History** lists every change an admin has made to this instance, newest first: when, who, what kind of change (added, changed, deleted, or an action such as starting a process), the object it touched, and a one-line summary such as *Changed default language from “en” to “fr”*. Select a row to see each changed field with its old and new value, a link to the object, and **This object's history**.

What is recorded: instance settings (General, backups policy, the KoboldCPP and Ollama runtimes, the instance theme, the CharaVault account), the tunnel, users, invites and clearing a user's two-factor, backups made and deleted, connections and their models and scripts, capability defaults, sampling configs, genres and presets, pipeline configurations and options changed for the whole instance, prompts, the three template kinds, scripts, plugins and components. A change made inside one session, or by someone who is not an admin, is not an instance change and is not recorded. A change that fails records nothing.

**Secrets are never written down.** Passwords, API keys, tokens and other credentials show only that they changed, never their value, and a pipeline option's value is not recorded at all because an option can hold a credential. Long values are shortened.

Filter by kind of object, by person, by action and by date, or search the summaries, object names, people and event names. The filters are part of the address, so a filtered list can be bookmarked or shared with another admin; `/admin/history?type=connection&id=12` shows one connection's history. **Load older changes** fetches the next page.

Records are kept for 90 days, and never more than the newest 20,000; older ones are removed automatically. Each record keeps the person's name as it was, so the history still reads after an account is deleted.

## Local runtimes (KoboldCPP, Ollama)

A KoboldCPP or Ollama this pub manages is a **connection**, added from **Add** in the Connections sidebar and removed from that connection's view; its address, port, model directories, binary and timeouts live there — see [Connections](./connections.md#koboldcpp-run-by-serene-pub). In the Android app neither runtime is offered, and General shows a **Local model runtimes** card saying so.

## Lorebooks

Lorebooks have no feature switches: every capability is available in every book. See [Lorebooks](./lorebooks.md#one-pool-three-controls).

## System-wide defaults

Default connections for each capability are set in **Admin › Models › Defaults** — see [Connections](./connections.md). Default sampling and pipeline configurations are chosen from their own admin pages.

## About

The **About** tab in the Settings sidebar is visible to every user, not just admins. It shows:

- The current app version, plus a shorter **Build** identifier underneath.
- Buttons linking to the project's **Repository**, **Milestones**, **Issues** and **Discussions** on GitHub, and its **Discord**.
- A copyright line crediting the project's author, and a license line noting Serene Pub is distributed under the **AGPL-3.0 License**.

### Update Notifications

Serene Pub checks GitHub for a newer release at most once a day. When one is out, every admin gets a notification in the [Activity](./getting-around.md#activity) view, *Serene Pub v0.7.0 is available*, whose **See the update** button opens the Admin Overview. The Overview shows a **Get v0.7.0** button linking to the project's GitHub releases page. You are told once per release: dismissing the notification keeps it away until a newer release comes out, and it clears by itself once your install runs that version. Non-admins are never notified, since only an admin can upgrade the install. The check is informational only — Serene Pub doesn't auto-update itself.

Pre-release builds are the exception. On a version carrying a pre-release suffix (`0.6.0-pr-1`, `-rc-1`, `-dev`, or any suffix Serene Pub doesn't recognise), the check is switched off entirely — GitHub is never contacted about versions, and no update notice appears anywhere. Those builds instead carry a permanent, faint version marker in the bottom-right corner of the window, so a preview build is never mistaken for a release one. The marker never intercepts clicks and fades out as your cursor approaches it.

`-beta` is **not** a pre-release. Alpha and beta describe how mature the project is, not whether a build is released, so a `-beta` build is a normal release: no version marker, and update notifications work as described above.

## Admin-Only Enforcement

Every setting described above is enforced on the server as well as hidden in the UI: each update request confirms the requesting user is an admin before touching the database, and rejects the change otherwise. Hiding the Admin view from non-admins is a convenience, not the security boundary.
