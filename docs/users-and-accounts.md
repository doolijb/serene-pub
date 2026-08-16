# Users & Accounts

Serene Pub can run as a single-user app with no login at all, or you can turn on User Accounts so several people can share one server, each with their own characters, personas, and settings. This page covers enabling accounts, managing users, the per-user Settings tab, and recovering a lost passphrase.

## Overview

By default, a fresh Serene Pub install has **accounts disabled**. There's no login screen — every request is automatically treated as the built-in `admin` account (the first user created when the server starts), and anyone with access to the server has full access to everything. This is the simplest way to run Serene Pub for yourself on your own machine.

Turning on **User Accounts** switches the server into multi-user mode: a login screen appears, every person needs a username and passphrase, and each account gets its own characters, chats, lorebooks, and tags. [Personas](./personas.md) — the "you" side of a conversation — are likewise scoped per account, so each person builds their own set rather than sharing one pool. An administrator (or several) can create accounts for other people, promote or demote admin status, and manage the server as a whole, while standard users are limited to their own content and personal settings.

This is a one-way switch — see [Enabling User Accounts](#enabling-user-accounts) below for exactly what that means. For the broader distinction between settings an admin controls for the whole server versus settings each person controls for themselves, see [System Settings](./system-settings.md).

## Enabling User Accounts

User Accounts are turned on from **Settings → System** (the System tab only appears for admins), under the **Account Management** section. There's a single **Enable User Accounts** switch there.

Flipping it on opens an **Enable User Accounts** confirmation dialog that warns, in the app's own words: _"Enabling user accounts will activate authentication and multi-user support. This change is permanent and cannot be reversed."_ It also notes that after enabling accounts, you'll need to create accounts for all new users.

### The passphrase requirement before enabling

If your own (admin) account doesn't already have a passphrase set, the same dialog expands to ask for one before you can confirm. You'll see your username (read-only) and fields for **Passphrase** and **Confirm Passphrase**. The server enforces:

- At least 10 characters long (128 maximum)
- At least one lowercase letter
- At least one uppercase letter
- At least one special character

The confirm button reads **Set Passphrase & Enable** until you have a passphrase, then reads **Enable Accounts** once one is already set. Once confirmed, the switch turns on and immediately becomes disabled/greyed out — the UI enforces the one-way nature of this setting directly in the toggle itself.

### Why this can't be undone

Once accounts are enabled, the app permanently requires authentication for every user. There is no toggle or button anywhere in the UI to turn accounts back off; doing so would require direct database access. Treat enabling User Accounts as a deliberate, permanent decision for your server.

## Signing In

With accounts enabled, anyone opening Serene Pub without a valid session is shown a login screen (username and passphrase, with a show/hide toggle for the passphrase field) instead of the app. There's no self-service "forgot passphrase" link on this screen — the footer simply says _"Need help? Contact your administrator."_ Getting a new passphrase requires an admin to reset it for you, as described in [Resetting a Passphrase](#resetting-a-passphrase) below.

## The Users Panel

Once accounts are enabled, a **Users** icon appears in the app's left-hand navigation. Opening it shows a searchable list of accounts (search matches username or display name), with each row showing the person's display name (or username if no display name is set), their `@username`, and an **Admin** badge if they have administrator privileges.

Clicking a user's row opens a read-only profile view showing their avatar initial, admin/user badge, username, and display name, with a **Back** button to return to the list. Administrators additionally see an **Edit** button on that profile view, and, back on the list itself, a **+** button to create a new user plus per-row **Edit** (pencil) and **Delete** (trash) buttons next to every account except their own.

Creating, editing, and deleting other user accounts are all admin-only actions, enforced by the server as well as hidden in the UI for standard users — a standard user browsing the Users panel can search and view accounts but won't see any management buttons.

## Creating Users

Admins create a user from the Users panel's **+** button, which opens a form with:

- **Username\*** — required, must be unique across the server.
- **Display Name** — optional; shown instead of the username throughout the UI when set.
- **Administrator** — a checkbox. Checking it (when it wasn't already checked) pops up a **Grant Administrator Privileges?** confirmation listing what admins can do (manage all users and permissions, access and modify all chats and characters, change system settings, delete content across the system) and warns this should only be done for trusted users.
- **Passphrase\*** / **Confirm Passphrase** — required when creating a new user. A **Generate Random** button produces a passphrase in the pattern of three capitalized dictionary words, a 3-digit number, and a special character (e.g. `Ocean-Phoenix-Quartz482!`), and a **Copy** button copies it to the clipboard. An eye icon toggles the field between hidden and plain text.

Saving emits a **Create** action and the new account appears in the Users list immediately.

### Editing an existing user

The same form is reused for editing, with two differences: the passphrase fields are optional (labeled **New Passphrase (leave blank to keep current)**), and the button reads **Update** instead of **Create**. This is also how an admin changes another user's username, display name, or admin flag after the fact.

### Passphrase strength when an admin sets it for someone else

The form's helper text reads _"Passphrase must be at least 6 characters with uppercase, lowercase, and numbers"_ — but this is a client-side hint only. The server doesn't actually enforce length or complexity on a passphrase an admin sets for someone else (creating or editing a user); it only requires the field be non-empty on creation. This is different from every self-service passphrase flow (initial admin setup and **Change Passphrase**, below), where the server strictly enforces the 10-character/upper/lower/special-character rule. In practice this means an admin _can_ set another user a passphrase that wouldn't pass the self-service rules — worth keeping in mind if you rely on the in-form hint as a real guarantee.

## Admin vs Standard Users

Every account has a single `isAdmin` flag — there's no tiered permission system beyond admin/non-admin. In practice:

**Administrators can:**

- View, create, edit, and delete any user account (except they can't delete their own account — the server explicitly blocks that).
- Grant or revoke admin status on other accounts.
- Access the **System** settings tab (server-wide connection, summarization, RAG, and account settings — see [System Settings](./system-settings.md)).
- Import data from SillyTavern via the **Data Import** section of their own Settings tab.

**Standard (non-admin) users:**

- Have their own private characters, personas, chats, lorebooks, and tags, scoped only to their account.
- Can view the Users list (to see who else is on the server) but cannot create, edit, or delete accounts.
- Only see the **User** and **Themes** tabs in Settings — no System tab.
- Get a shorter setup wizard on first login that skips the connection/summarization/RAG steps entirely, since those are server-wide and already configured by an admin. See [Getting Started](./getting-started.md) for the full wizard walkthrough.

Deleting a user is a **soft delete** — the account is flagged as deleted and disappears from the Users list and login, but its underlying data isn't destroyed outright by that action alone.

## Per-User Settings

Every account — admin or not — has its own **Settings → User** tab (opened via the gear/settings icon, then the **User** tab, which is the default tab and always visible). This is where personal preferences live, as opposed to the server-wide options on the System tab. The Settings panel has four tabs in total — **User**, **System** (admins only), **Themes**, and **About** — and theme selection, dark mode, and background image customization live on that separate **Themes** tab rather than on User; see [Themes & Settings](./themes-and-settings.md) for those.

The **User** tab itself contains, top to bottom:

- **Show All Character Fields** — a switch that expands advanced/optional fields on the character editor by default instead of hiding them behind a "Show All Fields" toggle.
- **Easy Character Creation** — a switch controlling whether the simplified character-creation flow is offered.
- **Easy Persona Creation** — the same, for persona creation.
- **Show Home Page Banner** — a switch controlling whether the dismissible logo banner appears at the top of the home page (the "Serene Pub is in beta!" notice underneath it always shows regardless of this setting).
- **Document View** — a **Switch to Document View** button that jumps to Serene Pub's simplified, high-contrast, keyboard- and screen-reader-friendly interface, also reachable any time with Ctrl+Shift+Y. See [Document View](./document-view.md).

### Data Import (admin only)

Admins additionally see a **Data Import** section with a short description and an **Import from SillyTavern** button, linking out to the app's import page for pulling in characters, personas, chats, and lorebooks. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the full process. This section doesn't appear at all in the Android app build, regardless of admin status.

### User Profile (accounts enabled only)

Once accounts are enabled, a **User Profile** section appears at the bottom of the User settings tab with:

- **Display Name** — a text field and **Update** button (disabled until you change the value) for changing how your name appears throughout the app.
- **Change Passphrase** — opens a modal (see [Changing Your Own Passphrase](#changing-your-own-passphrase) below).
- **Logout** — signs you out and returns you to the login screen.

This section is hidden entirely when accounts are disabled, since there's no separate identity to manage in single-user mode.

## Adding Other Users as Chat Guests

When accounts are enabled, editing a chat exposes a **Guests** section (in addition to the chat's personas) with an **Add Guests** button. This lets you invite other accounts on the server into a chat as guests, distinct from the AI-played characters and your own persona. Guest management is part of chat setup rather than user administration — see [Chats](./chats.md) for how guests behave once added to a conversation.

## Changing Your Own Passphrase

Any logged-in user can change their own passphrase from **Settings → User → Change Passphrase**, which opens a modal asking for:

- **Current Passphrase**
- **New Passphrase** (the UI's helper text may still say 6 characters, but the server actually requires at least **10**, with uppercase, lowercase, and a special character)
- **Confirm New Passphrase**

The server verifies your current passphrase before accepting the change, and rejects the new one if it doesn't meet the length/case/special-character requirements or if the confirmation doesn't match. On success the modal closes and a confirmation toast appears.

## Resetting a Passphrase

There are two different ways a passphrase gets reset, depending on who's locked out.

### Admin reset of another user's passphrase

If a standard user (or a second admin) forgets their passphrase, an administrator resets it the same way they'd edit any other field: open the Users panel, select the user, click **Edit**, and fill in the **New Passphrase** / **Confirm Passphrase** fields (using **Generate Random** and **Copy** if convenient), then **Update**. Leaving those fields blank on an edit leaves the existing passphrase untouched, so this only takes effect when you deliberately type a new one.

### If the admin account itself is locked out

There is currently **no self-service or API-based recovery path** if the sole/last admin account gets locked out — no emergency endpoint, no CLI script, no environment-variable override. If nobody with admin rights can log in, the only way back in is direct access to the server's database (updating the stored passphrase hash by hand), which is outside the scope of the app itself.

Because of this, it's worth treating admin lockout as a real risk to plan around rather than something recoverable from the app later: keep at least one admin's passphrase somewhere safe, and consider creating a second admin account once accounts are enabled so a single forgotten passphrase can't strand the whole instance.

### Security considerations

- Passphrase requirements are asymmetric and worth knowing precisely: **self-service** passphrases (the initial admin setup dialog and **Change Passphrase**) are strictly enforced server-side at a minimum of 10 characters (128 maximum), with at least one uppercase letter, one lowercase letter, and one special character. Passphrases an **admin sets for someone else** (the Create/Edit User form) are only required to be non-empty server-side — the form's "6 characters, uppercase, lowercase, numbers" helper text is a client-side suggestion, not an enforced rule. If you need a guaranteed-strong passphrase for another user's account, don't rely on the form alone.
- Admin status is powerful and, once granted, has no separate approval step beyond the initial confirmation dialog — grant it only to people you'd trust with full server access, since admins can read and modify every other user's characters, personas, and chats in addition to managing accounts.
