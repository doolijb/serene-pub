# Users & Multi-User Accounts

Serene Pub can run as a single-user app with no login at all, or you can turn on multi-user accounts so several people can share one server, each with their own characters, personas, and settings. This page covers enabling accounts, managing users, the per-user Settings tab, and recovering a lost passphrase.

## Overview

By default, a fresh Serene Pub install has **accounts disabled**. There's no login screen — every request is automatically treated as the built-in `admin` account (the first user created when the server starts), and anyone with access to the server has full access to everything. This is the simplest way to run Serene Pub for yourself on your own machine.

Turning on **User Accounts** switches the server into multi-user mode: a login screen appears, every person needs a username and passphrase, and each account gets its own characters, chats, lorebooks, and tags. [Personas](./personas.md) — the "you" side of a conversation — are likewise scoped per account, so each person builds their own set rather than sharing one pool. An administrator (or several) can create accounts for other people, promote or demote admin status, and manage the server as a whole, while standard users are limited to their own content and personal settings.

This is a one-way switch — see [Enabling Multi-User Accounts](#enabling-multi-user-accounts) below for exactly what that means. For the broader distinction between settings an admin controls for the whole server versus settings each person controls for themselves, see [System Settings](./system-settings.md).

## Enabling Multi-User Accounts

Multi-user accounts are turned on from **Settings → System** (the System tab only appears for admins), under the **Account Management** section. There's a single **Enable User Accounts** switch there.

Flipping it on opens an **Enable User Accounts** confirmation dialog that warns, in the app's own words: *"Enabling user accounts will activate authentication and multi-user support. This change is permanent and cannot be reversed."* It also notes that after enabling accounts, you'll need to create accounts for all new users.

### The passphrase requirement before enabling

If your own (admin) account doesn't already have a passphrase set, the same dialog expands to ask for one before you can confirm. You'll see your username (read-only) and fields for **Passphrase** and **Confirm Passphrase**, with these requirements listed directly in the dialog:

- At least 6 characters long
- At least one lowercase letter
- At least one uppercase letter
- At least one special character

The confirm button reads **Set Passphrase & Enable Accounts** (or similar wording) until you have a passphrase, then just enables accounts directly if one is already set. Once confirmed, the switch turns on and immediately becomes disabled/greyed out — the UI enforces the one-way nature of this setting directly in the toggle itself.

### Why this can't be undone

Once accounts are enabled, the app permanently requires authentication for every user. There is no toggle or button anywhere in the UI to turn accounts back off; doing so would require direct database access. Treat enabling multi-user accounts as a deliberate, permanent decision for your server.

## Signing In

With accounts enabled, anyone opening Serene Pub without a valid session is shown a login screen (username and passphrase, with a show/hide toggle for the passphrase field) instead of the app. There's no self-service "forgot passphrase" link on this screen — the footer simply says *"Need help? Contact your administrator."* Getting a new passphrase requires an admin to reset it for you, as described in [Resetting a Passphrase](#resetting-a-passphrase) below.

## The Users Panel

Once accounts are enabled, a **Users** icon appears in the app's left-hand navigation. Opening it shows a searchable list of accounts (search matches username or display name), with each row showing the person's display name (or username if no display name is set), their `@username`, and an **Admin** badge if they have administrator privileges.

Clicking a user's row opens a read-only profile view showing their avatar initial, admin/user badge, username, and display name, with a **Back** button to return to the list. Administrators additionally see an **Edit** button on that profile view, and, back on the list itself, a **+** button to create a new user plus per-row **Edit** (pencil) and **Delete** (trash) buttons next to every account except their own.

Creating, editing, and deleting other user accounts are all admin-only actions, enforced by the server as well as hidden in the UI for standard users — a standard user browsing the Users panel can search and view accounts but won't see any management buttons.

## Creating Users

Admins create a user from the Users panel's **+** button, which opens a form with:

- **Username\*** — required, must be unique across the server.
- **Display Name** — optional; shown instead of the username throughout the UI when set.
- **Administrator** — a checkbox. Checking it (when it wasn't already checked) pops up a **Grant Administrator Privileges?** confirmation listing what admins can do (manage all users and permissions, access and modify all chats and characters, change system settings, delete content across the system) and warns this should only be done for trusted users.
- **Passphrase\*** / **Confirm Passphrase** — required when creating a new user. A **Generate Random** button produces a passphrase in the pattern of three capitalized dictionary words, a 3-digit number, and a special character (e.g. `Ocean-Ember-Quartz482!`), and a **Copy** button copies it to the clipboard. An eye icon toggles the field between hidden and plain text.

The form enforces: at least 6 characters, at least one lowercase letter, one uppercase letter, and one number (the in-form helper text reads *"Passphrase must be at least 6 characters with uppercase, lowercase, and numbers."*). Saving emits a **Create** action and the new account appears in the Users list immediately.

### Editing an existing user

The same form is reused for editing, with two differences: the passphrase fields are optional (labeled **New Passphrase (leave blank to keep current)**), and the button reads **Update** instead of **Create**. This is also how an admin changes another user's username, display name, or admin flag after the fact.

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

Every account — admin or not — has its own **Settings → User** tab (opened via the gear/settings icon, then the **User** tab, which is the default tab and always visible). This is where personal preferences live, as opposed to the server-wide options on the System tab. It contains, top to bottom:

- **Theme** — a dropdown of the built-in color themes, plus **My Themes** (custom themes you've uploaded) and **Instance Themes** (custom themes shared server-wide) if any exist.
- **Dark Mode** — a switch toggling dark/light mode independently of the chosen theme.
- **Show All Character Fields** — a switch that expands advanced/optional fields on the character editor by default instead of hiding them behind a "Show All Fields" toggle.
- **Easy Character Creation** — a switch controlling whether the simplified character-creation flow is offered.
- **Easy Persona Creation** — the same, for persona creation.
- **Show Home Page Banner** — a switch controlling whether the dismissible welcome banner appears on the home dashboard.
- **Background** — a collapsible section (click the header to expand) containing the background image picker and an opacity control, for customizing the app's backdrop.

Full detail on themes, dark mode, and backgrounds lives in [Themes & Settings](./themes-and-settings.md).

### Data Import (admin only)

Admins additionally see a **Data Import** section with a short description and an **Import from SillyTavern** button, linking out to the app's import page for pulling in characters, personas, chats, and lorebooks. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the full process.

### User Profile (accounts enabled only)

When multi-user accounts are on, a **User Profile** section appears at the bottom of the User settings tab with:

- **Display Name** — a text field and **Update** button (disabled until you change the value) for changing how your name appears throughout the app.
- **Change Passphrase** — opens a modal (see [Changing Your Own Passphrase](#changing-your-own-passphrase) below).
- **Logout** — signs you out and returns you to the login screen.

This section is hidden entirely when accounts are disabled, since there's no separate identity to manage in single-user mode.

## Changing Your Own Passphrase

Any logged-in user can change their own passphrase from **Settings → User → Change Passphrase**, which opens a modal asking for:

- **Current Passphrase**
- **New Passphrase** (helper text: *"Must be at least 6 characters with uppercase, lowercase, and special character"*)
- **Confirm New Passphrase**

The server verifies your current passphrase before accepting the change, and rejects the new one if it doesn't meet the length/case/special-character requirements or if the confirmation doesn't match. On success the modal closes and a confirmation toast appears.

## Adding Other Users as Chat Guests

When accounts are enabled, editing a chat exposes a **Guests** section (in addition to the chat's personas) with an **Add Guests** button. This lets you invite other accounts on the server into a chat as guests, distinct from the AI-played characters and your own persona. Guest management is part of chat setup rather than user administration — see [Chats](./chats.md) for how guests behave once added to a conversation.

## Resetting a Passphrase

There are two different ways a passphrase gets reset, depending on who's locked out.

### Admin reset of another user's passphrase

If a standard user (or a second admin) forgets their passphrase, an administrator resets it the same way they'd edit any other field: open the Users panel, select the user, click **Edit**, and fill in the **New Passphrase** / **Confirm Passphrase** fields (using **Generate Random** and **Copy** if convenient), then **Update**. Leaving those fields blank on an edit leaves the existing passphrase untouched, so this only takes effect when you deliberately type a new one.

### Emergency admin passphrase reset

If the **admin** account itself is locked out — the one exception being nobody with admin rights can log in to use the Users panel to fix it — Serene Pub exposes a dedicated recovery endpoint at `/api/reset-admin-passphrase`. Posting JSON of the form `{"newPassphrase": "..."}` to that endpoint resets the passphrase for the account with username `admin` (the default administrator account created automatically the first time the server runs) directly at the database level, bypassing the normal login-protected UI entirely.

This is meant to be used by whoever has direct access to the server itself (for example, via `curl` from the machine or container running Serene Pub), not from within the app's own interface — there's no button for it anywhere in the UI.

### Security considerations

- The emergency reset endpoint does **not** require you to already be logged in or otherwise prove you're an administrator — it only requires network access to the server. Don't expose your Serene Pub instance's HTTP endpoints to an untrusted network without separately restricting access to routes like this one (a firewall, reverse-proxy rule, or simply keeping the server off the public internet).
- Because it always targets the account literally named `admin`, renaming or removing that specific account removes your ability to use this recovery path — plan account naming with that in mind if you expect to rely on it.
- Passphrase requirements differ slightly depending on where you set one: the admin-facing Create/Edit User form asks for uppercase, lowercase, and a number, while self-service passphrase changes (first-time setup and **Change Passphrase**) ask for uppercase, lowercase, and a special character. Either style is accepted server-side for its respective flow — there's no single universal rule, so if a passphrase is rejected, check the specific requirement text shown next to that field.
- Admin status is powerful and, once granted, has no separate approval step beyond the initial confirmation dialog — grant it only to people you'd trust with full server access, since admins can read and modify every other user's characters, personas, and chats in addition to managing accounts.
