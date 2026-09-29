# Users & Accounts

Serene Pub can run as a single-user app with no login at all, or you can turn on User Accounts so several people can share one server, each with their own characters, personas, and settings. This page covers enabling accounts, managing users, the per-user Settings tab, and recovering a lost passphrase.

## Overview

By default, a fresh Serene Pub install has **accounts disabled**. There's no login screen — every request is automatically treated as the built-in `admin` account (the first user created when the server starts), and anyone with access to the server has full access to everything. This is the simplest way to run Serene Pub for yourself on your own machine.

Turning on **User Accounts** switches the server into multi-user mode: a login screen appears, every person needs a username and passphrase, and each account gets its own characters, sessions, lorebooks, and tags. [Personas](./personas.md) — the "you" side of a conversation — are likewise scoped per account, so each person builds their own set rather than sharing one pool. An administrator (or several) can create accounts for other people, promote or demote admin status, and manage the server as a whole, while standard users are limited to their own content and personal settings.

This is a one-way switch — see [Enabling User Accounts](#enabling-user-accounts) below for exactly what that means. For the broader distinction between settings an admin controls for the whole server versus settings each person controls for themselves, see [Instance Settings](./system-settings.md).

## Enabling User Accounts

User Accounts are turned on from **Admin › General** (`/admin/general`), on the **User accounts** card. There's a single **User accounts** switch there, under a status line that reads _Off_ or _On — sign-in is required_.

Flipping it on opens a **Turn on user accounts?** dialog that warns the change cannot be reversed: _"User accounts turn on sign-in and multi-user support. Once on, they stay on."_ It also notes that after this, every new person needs an account, which you create in People › Users.

### The passphrase requirement before enabling

If your own (admin) account doesn't already have a passphrase set, the same dialog expands to ask for one before you can confirm. You'll see your username (read-only) and fields for **Passphrase** and **Confirm passphrase**. The server enforces:

- At least 10 characters long (128 maximum)
- At least one lowercase letter
- At least one uppercase letter
- At least one special character

The confirm button reads **Set passphrase and turn on** until you have a passphrase, then **Turn on accounts** once one is already set. Once confirmed, the switch turns on and immediately becomes disabled/greyed out — the UI enforces the one-way nature of this setting directly in the toggle itself.

### Why this can't be undone

Once accounts are enabled, the app permanently requires authentication for every user. There is no toggle or button anywhere in the UI to turn accounts back off; doing so would require direct database access. Treat enabling User Accounts as a deliberate, permanent decision for your server.

## Signing In

With accounts enabled, anyone opening Serene Pub without a valid session is shown a login screen instead of the app: username and passphrase (with a show/hide toggle for the passphrase), a **Sign in** button, a **Document View** link to the accessible shell, and the version. Behind the card an _atmosphere_ — a gentle animated background such as rain, mist or drifting glyphs — is chosen at random on each load. It follows your operating system's reduced-motion preference and freezes to a still frame when that is set. There's no self-service "forgot passphrase" link on this screen. Getting a new passphrase requires an admin to reset it for you, as described in [Resetting a Passphrase](#resetting-a-passphrase) below.

## The Users Panel

Once accounts are enabled, a **Users** icon appears in the app's left-hand navigation. Opening it shows a searchable list of accounts (search matches username or display name), with each row showing the person's display name (or username if no display name is set), their `@username`, and an **Admin** badge if they have administrator privileges.

Clicking a user's row opens a read-only profile view showing their avatar initial, admin/user badge, username, and display name, with a **Back** button to return to the list. Administrators additionally see an **Edit** button on that profile view, and, back on the list itself, a **New** button to create a user, an **Invite** button that shows the invite links, and per-row **Edit** and **Delete** buttons next to every account except their own.

Creating, editing, and deleting other user accounts are all admin-only actions, enforced by the server as well as hidden in the UI for standard users — a standard user browsing the Users view can search and view accounts but won't see any management buttons.

### Users in the Admin area

**Admin › Users** (`/admin/users`) is the same roster as a list beside the account it opens. Each row shows the username, the display name and whether the person is an admin or a member. Pick a row and the account's form opens beside the list (below desk width it takes the list's place, with **Back to list**); **New user** at the top opens a blank form there, and **Invites** opens the invite list in the same spot. While accounts are off the page says so in one line and links to **Admin › General**, where they are turned on.

## Creating Users

Admins create a user from the Users panel's **New** button, which opens a form with:

- **Username\*** — required, must be unique across the server.
- **Display name** — optional; shown instead of the username throughout the UI when set.
- **Administrator** — a checkbox. A new account can't be an administrator: the box is disabled on the create form, and on an existing account until someone has signed into it at least once. Checking it (when it wasn't already checked) pops up a **Grant administrator privileges?** confirmation listing what admins can do (manage all users and permissions, access and modify all sessions and characters, change system settings, delete content across the system) and warns this should only be done for trusted users.
- **Passphrase\*** / **Confirm passphrase** — required when creating a new user. A **Generate random** button produces a passphrase in the pattern of three capitalized dictionary words, a 3-digit number, and a special character (e.g. `Ocean-Phoenix-Quartz482!`), and a **Copy** button copies it to the clipboard. An eye icon toggles the field between hidden and plain text.

Saving emits a **Create** action and the new account appears in the Users list immediately.

### Editing an existing user

The same form is reused for editing, with two differences: the passphrase fields are optional (labeled **New passphrase (leave blank to keep current)**), and the button reads **Update** instead of **Create**. This is also how an admin changes another user's username, display name, or admin flag after the fact (the admin flag only once that person has signed in at least once).

### Passphrase strength when an admin sets it for someone else

The form's helper text reads _"At least 10 characters, with an uppercase letter, a lowercase letter and a special character."_ — the same rule as every self-service flow, and the form will not submit a passphrase that breaks it, but that check is client-side only. The server doesn't actually enforce length or complexity on a passphrase an admin sets for someone else (creating or editing a user); it only requires the field be non-empty on creation. This is different from every self-service passphrase flow (initial admin setup and **Change passphrase**, below), where the server strictly enforces the 10-character/upper/lower/special-character rule. In practice this means an admin _can_ set another user a passphrase that wouldn't pass the self-service rules — worth keeping in mind if you rely on the in-form hint as a real guarantee.

## Admin vs Standard Users

Every account has a single `isAdmin` flag — there's no tiered permission system beyond admin/non-admin. In practice:

**Administrators can:**

- View, create, edit, and delete any user account (except they can't delete their own account — the server explicitly blocks that).
- Grant or revoke admin status on other accounts.
- Open the **Admin** view, including the **Instance** pages (General, Network, Data and backups, Diagnostics — see [Instance Settings](./system-settings.md)).
- Import data from SillyTavern via the **Data import** section of their own **Settings → User** tab.

**Standard (non-admin) users:**

- Have their own private characters, personas, sessions, lorebooks, and tags, scoped only to their account.
- Can view the Users list (to see who else is on the server) but cannot create, edit, or delete accounts.
- See the same Settings tabs as everyone else, except that the **Data** tab only says that backups are managed by an administrator.
- Get a shorter setup wizard on first login that skips the **Choose an LLM** step, since connecting a model is the pub's and an admin has already done it. See [Getting Started](./getting-started.md) for the full wizard walkthrough.

Deleting a user is a **soft delete** — the account is flagged as deleted and disappears from the Users list and login, but its underlying data isn't destroyed outright by that action alone.

## Per-User Settings

Every account — admin or not — has its own **Settings → User** tab (opened via the gear/settings icon, then the **User** tab, which is the default tab and always visible). This is where personal preferences live, as opposed to the server-wide options in the Admin area. The Settings view has five tabs — **User**, **Media**, **Data**, **Themes**, and **About** — and theme selection, dark mode, and background image customization live on the separate **Themes** tab rather than on User; see [Themes & Settings](./themes-and-settings.md) for those.

The **User** tab itself contains, top to bottom:

- **Language** — your interface language, or the server default. See [Languages](./languages.md).
- **Show all character fields** — a switch that expands advanced/optional fields on the character editor by default instead of hiding them behind a "Show All Fields" toggle.
- **Easy character creation** — a switch controlling whether the simplified character-creation flow is offered (personas are characters, so it covers them too).
- **Document View** — a **Switch to Document View** button that jumps to Serene Pub's simplified, high-contrast, keyboard- and screen-reader-friendly interface, also reachable any time with Ctrl+Shift+Y. See [Document View](./document-view.md).
- **Extension settings** — only when a switched-on plugin offers per-person choices. See [Themes & Settings](./themes-and-settings.md#extension-settings).
- **Two-factor authentication** and **User profile** — only when accounts are enabled; see below.

### Data import (admin only)

Admins additionally see a **Data import** section with a short description and an **Import from SillyTavern** button, linking out to the app's import page for pulling in characters, personas, sessions, and lorebooks. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the full process. This section doesn't appear at all in the Android app build, regardless of admin status.

### User profile (accounts enabled only)

Once accounts are enabled, a **User profile** section appears at the bottom of the User settings tab with:

- **Display name** — a text field and **Update** button (disabled until you change the value) for changing how your name appears throughout the app.
- **Change passphrase** — opens a modal (see [Changing Your Own Passphrase](#changing-your-own-passphrase) below).
- **Logout** — signs you out and returns you to the login screen.

This section is hidden entirely when accounts are disabled, since there's no separate identity to manage in single-user mode.

## Adding Other Users as Session Guests

When accounts are enabled, editing a session exposes a **Guests** section (in addition to the session's personas) with an **Add guests** button. This lets you invite other accounts on the server into a session as guests, distinct from the AI-played characters and your own persona. Guest management is part of session setup rather than user administration — see [Sessions](./sessions.md) for how guests behave once added to a conversation.

## Changing Your Own Passphrase

Any logged-in user can change their own passphrase from **Settings → User → Change passphrase**, which opens a modal asking for:

- **Current passphrase**
- **New passphrase** (at least **10** characters, with uppercase, lowercase, and a special character — enforced by the server)
- **Confirm new passphrase**

The server verifies your current passphrase before accepting the change, and rejects the new one if it doesn't meet the length/case/special-character requirements or if the confirmation doesn't match. On success the modal closes and a confirmation toast appears.

## Resetting a Passphrase

There are two different ways a passphrase gets reset, depending on who's locked out.

### Admin reset of another user's passphrase

If a standard user (or a second admin) forgets their passphrase, an administrator resets it the same way they'd edit any other field: open the Users view, select the user, click **Edit**, and fill in the **New passphrase** / **Confirm passphrase** fields (using **Generate random** and **Copy** if convenient), then **Update**. Leaving those fields blank on an edit leaves the existing passphrase untouched, so this only takes effect when you deliberately type a new one.

### If the admin account itself is locked out

If another admin can still sign in, they reset your passphrase the same way as anyone else's (above). If nobody with admin rights can sign in, recover through the environment: set `SERENE_PUB_RECOVERY_KEY` (any new string you choose) and `SERENE_PUB_RECOVERY_PASSWORD` (the new passphrase, which must meet the self-service rules above), then restart Serene Pub. On that boot the first admin account's passphrase is reset, its two-factor is cleared, and all of its sign-ins are revoked. The key is then recorded as spent, so the variables can stay in place without resetting anything on the next restart; choose a **new** key to reset again. See [Account recovery](./environment-variables.md#account-recovery).

Setting those variables needs access to the machine or container the app runs in; that access is what authorises the reset. A second admin account is still the easier route, so consider creating one once accounts are enabled.

### Security considerations

- Passphrase requirements are asymmetric and worth knowing precisely: **self-service** passphrases (the initial admin setup dialog, **Change passphrase**, and the recovery variable) are strictly enforced server-side at a minimum of 10 characters (128 maximum), with at least one uppercase letter, one lowercase letter, and one special character. Passphrases an **admin sets for someone else** (the Create/Edit User form) are only required to be non-empty server-side — the form applies the same 10-character rule, but only in the browser, not as an enforced rule. If you need a guaranteed-strong passphrase for another user's account, don't rely on the form alone.
- Admin status is powerful and, once granted, has no separate approval step beyond the initial confirmation dialog — grant it only to people you'd trust with full server access, since admins can read and modify every other user's characters, personas, and sessions in addition to managing accounts.

## Two-factor authentication

Enable it from **Settings → User → Two-factor authentication**. You will add
Serene Pub to an authenticator app, then enter a code to confirm — the factor
does not take effect until you have proved a code works, so a failed setup can
never lock you out.

### Recovery codes

You get ten when you enable it. **Each one works once**, and they are shown
exactly once — only their hashes are stored, so there is no way to display them
again. Copy or download them and keep them somewhere you can reach without this
app.

The settings page shows how many are left and warns at two remaining. Running
out is the most common way people lock themselves out; generate a new set before
that happens. Generating a new set invalidates every previous code.

If you sign in with a recovery code, treat it as a signal that your
authenticator is gone — set it up again rather than working through the
remaining codes.

### If you are locked out

Three ways back in, in the order you should try them:

1. **A recovery code**, at the sign-in prompt.
2. **Another administrator** can clear your second factor from
   **Admin → Users → (your account)**. This signs out all of your sessions; your
   password still works. This is the normal route when there is more than one
   admin.
3. **The environment**, when you are the only administrator and have lost both
   your authenticator and your codes. Set `SERENE_PUB_RECOVERY_KEY` (any string
   you choose) and `SERENE_PUB_RECOVERY_PASSWORD`, then restart. On the next
   boot your password is reset, two-factor is cleared, and every session is
   revoked.

    The key is recorded as spent, so booting again with the same key does
    nothing — the variables can stay in place without resetting your password on
    every restart. To reset again, choose a **new** key. See
    [environment variables](./environment-variables.md#account-recovery).

There is no email-based password reset. Setting those variables requires access
to the machine or container the app runs in, and that access is what authorises
the reset — anyone who has it could already edit the database directly.
