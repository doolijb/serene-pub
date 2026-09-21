# System Settings

System Settings hold the instance-wide configuration for a Serene Pub deployment — the toggles that affect every user, not just the one currently logged in. Only admin accounts can see or change them.

## Overview

Open the **Settings** view (gear icon on the rail) and select the **System** tab. This tab only appears for users whose account has admin privileges — everyone else sees only the **User**, **Themes**, and **About** tabs.

Everything on this tab is separate from your own personal preferences — easy-creation toggles and so on live on the **User** tab, while theme, dark mode, and background image live on the separate **Themes** tab — all covered in [Custom Themes & User Settings](./themes-and-settings.md). System Settings changes apply globally: turning a manager or feature on or off here changes what every user on the instance sees and can do.

### Who Can Access This Tab

Access is gated in two places, not just one. The **System** tab itself only renders for admins — everyone else simply doesn't see it in the Settings panel. But every individual setting change is also checked on the server: if a non-admin account somehow triggers one of these updates, the request is rejected as unauthorized. If the tab ever renders for a non-admin session (for example, an admin's session is downgraded while the panel is open), it falls back to a plain message: "Error: You do not have permission to view or modify system settings."

In a fresh, single-admin install, System Settings still exist and are already populated with sensible defaults (vectorization off, accounts off) — there's nothing you're required to configure before using the app.

## Accounts & Authentication

The **Account Management** section controls whether Serene Pub runs in single-user mode or requires logins.

By default, accounts are **not** enabled: the app automatically signs everyone in as the first admin user, with no login screen. The **Enable User Accounts** switch turns on authentication and multi-user support instance-wide.

This is presented as a **permanent, one-way change** — once accounts are enabled the switch becomes disabled (locked on) and the surrounding text confirms "User accounts are enabled. This setting cannot be reversed." Before that point, the description under the switch reads: "Enable user authentication and multi-user support. This is a permanent change."

Because of this, turning the switch on first opens an **Enable User Accounts** confirmation dialog with a "Warning: Permanent Change" notice. If your own admin account doesn't already have a passphrase set, the same dialog asks you to create one first — showing your username (read-only) alongside **Passphrase** and **Confirm Passphrase** fields — before it will let you proceed. The server enforces a minimum of 10 characters (128 maximum) with at least one uppercase letter, one lowercase letter, and one special character, regardless of what the dialog's own on-screen requirements list happens to say (it currently displays a stale "at least 6 characters" hint — trust the server-enforced rule, not that text). Once confirmed, a success toast reads "User accounts enabled successfully" with the description "Authentication is now required for all users."

### Why This Matters

Until accounts are enabled, Serene Pub runs in single-admin mode: every connection is automatically treated as the instance's first admin user, with no login screen at all. This is convenient for a personal, single-user install, but means anyone who can reach the app has full admin access. Enabling accounts is how you turn a personal install into a properly authenticated, multi-user instance.

See [Users & Accounts](./users-and-accounts.md) for how account creation, passphrases, and login work once this is turned on.

Once accounts are enabled, a **Users** icon appears in the main left navigation for managing accounts — but only for admins. Non-admin users never see this entry, regardless of whether accounts are enabled.

## Local runtimes (KoboldCPP, Ollama)

There are no manager toggles here any more. Since 2026-09-17 a KoboldCPP or Ollama this pub manages is a **connection**, switched on by **Add → KoboldCPP, run by Serene Pub** / **Add → Ollama** in the Connections sidebar and off by **Remove … from this pub** in that connection's view. Its server address, port, mode (managed or external), model directories, binary and timeouts all live in that view's setup screens and **Settings** tab — see [Connections](./connections.md#koboldcpp-run-by-serene-pub). The address validation is the same wherever it is entered: a well-formed URL that either includes an explicit port or uses `localhost` as the hostname.

**In the Android app** neither runtime is offered, since both depend on locally running native processes; **Add** simply does not list them.

## Embeddings

Embeddings have no switch here: the **Embeddings** card points at the Connections sidebar, where starring an embedding connection turns retrieval by meaning on. See [Embeddings and RAG](./embeddings-and-rag.md).

## Lorebooks

Lorebooks have no feature switches: every capability is available in every book, and the workspace shows what the book holds. See [Lorebooks](./lorebooks.md#one-pool-three-controls).

## Community Library: CharaVault

A **Community Library: CharaVault** card lets an admin connect one [CharaVault](https://charavault.net) account so everyone on the instance can browse charavault.net directly from the in-app Character Library. The credential is shared instance-wide, not per-user — connecting it raises the search rate limit for every user on this Serene Pub instance, not just the admin who set it up. Unlike the local runtimes above, this integration is a plain HTTP connection with no native binary involved, so the card is available on every platform, including the Android app.

To connect, create an App Password at charavault.net named "Serene Pub," then enter the account's **email** and that **App Password** (placeholder `cv_...`) into the two fields and click **Connect**. On success, a "CharaVault account connected" toast appears and the card switches to a **Connected as `<email>`** state with a **Disconnect** button; disconnecting shows a "CharaVault account disconnected" toast and returns the card to its empty form. Both actions have their own error toasts if the connect/disconnect request fails.

## Diagnostics

### Context Debugging

**Enable Context Debugging** adds a prompt-inspector tab to the session UI and makes Serene Pub compute full retrieval-augmented generation (RAG) and infill diagnostics, saving the compiled prompt metadata alongside each generated message for later inspection. This is intended for troubleshooting prompt construction and retrieval behavior, not everyday use, since it adds overhead to every generation.

## System-Wide Defaults

Several instance-wide defaults are stored alongside System Settings but are set from the areas they belong to, not from this tab directly:

- A **default connection** — the connection used when nothing more specific applies — is chosen by marking a connection as default from the [Connections](./connections.md) sidebar.
- Default sampling, context, and prompt configurations, along with default summarization and narrative-graph-build configurations, work the same way: pick a "default" from that config type's own sidebar rather than from System Settings.

## About

The **About** tab (next to **System** in the Settings panel) is visible to every user, not just admins. It shows:

- The current app version, plus a shorter **Build** identifier underneath.
- Buttons linking to the project's **Repository**, **Wiki**, **Discord**, **Issues**, and **Discussions** on GitHub.
- A copyright line crediting the project's author, and a license line noting Serene Pub is distributed under the **AGPL-3.0 License**.

### Update Notifications

If a newer release is available on GitHub, a banner reading "A newer version of Serene Pub is available!" appears above the Settings tabs (in every tab, not just About), with a **Download here** button linking to the project's GitHub releases page. This check is informational only — Serene Pub doesn't auto-update itself.

Pre-release builds are the exception. On a version carrying a pre-release suffix (`0.6.0-pr-1`, `-rc-1`, `-dev`, or any suffix Serene Pub doesn't recognise), the check is switched off entirely — GitHub is never contacted about versions, and no update notice appears anywhere. Those builds instead carry a permanent, faint version marker in the bottom-right corner of the window, so a preview build is never mistaken for a release one. The marker never intercepts clicks and fades out as your cursor approaches it.

`-beta` is **not** a pre-release. Alpha and beta describe how mature the project is, not whether a build is released, so a `-beta` build is a normal release: no version marker, and update notifications work as described above.

## Admin-Only Enforcement

Every toggle described above is enforced on the server as well as hidden in the UI: each update request confirms the requesting user is an admin before touching the database, and rejects the change otherwise. Hiding the **System** tab from non-admins is a convenience, not the actual security boundary — the boundary is enforced wherever the setting is actually saved.
