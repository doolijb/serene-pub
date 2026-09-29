# Custom Themes & User Settings

Serene Pub ships with a large set of built-in color themes and a live CSS editor for building your own, plus a handful of personal display preferences that only affect your own view of the app. All of it lives in one place: the Settings panel.

## Overview

Click the **Settings** icon (gear icon) on the rail to open the Settings view. It's organized into tabs:

- **User** — your language, the character-form preferences, Document View, any plugin settings of your own, the SillyTavern importer (admins), and (when accounts are enabled) your profile, passphrase, and logout.
- **Media** — the images you have uploaded; see [Characters](./characters.md#cropping-an-avatar) for what its **Crop** action does.
- **Data** — the database backups (admins only; everyone else sees that an administrator manages them).
- **Themes** — the theme picker, dark mode, story text size and view animation, background image, and the Custom Themes manager, where you create, edit, import, and delete your own themes.
- **About** — app version, build info, and links to the website, the GitHub repository and roadmap, Discord, the issue tracker, and discussions.

There is no System tab: settings for the whole instance live in the Admin area (see [Instance Settings](./system-settings.md)).

Everything described below lives in the **Themes** and **User** tabs. See [Users & Accounts](./users-and-accounts.md) for profile, passphrase, and login-related settings.

## Switching Themes

In the **Themes** tab, the **Theme** card shows every theme available to you as a grid of swatches — each a small preview in that theme's own colours (its ground, two lines of text and its accent), with the name below and a check on the one in use. The grid is two across in the docked view and four across when Settings is in Focus. Themes are grouped into:

- **Built-in** — Catppuccin, Cerberus, Concord, Crimson, Dracula, Fennec, Hamlindigo, Lamplight (the default), Legacy, Mint, Modern, Mona, Nosh, Nouveau, Pine, Reign, Rocket, Rose, Rosé Pine, Sahara, Seafoam, Terminus, Vintage, Vox, and Wintry.
- **My themes** — any custom themes you've created (see below).
- **Instance themes** — custom themes an admin has made available to everyone, if any exist.

Selecting a theme applies it immediately and saves it as your personal preference. A separate **Dark mode** switch in the same card toggles light/dark mode independently of which theme is selected — every theme, built-in or custom, supports both.

## Reading and motion

Two more preferences sit under **Reading and motion** in the **Themes** tab. Unlike the theme, both are saved **in this browser only**, so a phone and a desktop can differ:

- **Story text size** — 16, 17 (the default), 18 or 20. Only the story in a session changes size — the messages' prose in every message style; names, times and the rest of the interface stay the same.
- **Animate views** — whether opening, resizing and focusing a view animates. Your system's reduced-motion setting always wins over it.

## Lamplight

Lamplight is Serene Pub's own theme and the default for new installs. It keeps the indigo ground
of Hamlindigo and gives each colour role one job, so the interface reads the same way everywhere:
lamp gold is anything you can act on, ember means the model is working, moss means healthy or
connected, and teal marks system and admin surfaces. Text and headings use Funnel Sans and Funnel
Display, shipped with the app, so nothing is fetched from the web.

Every other theme keeps working, because the interface asks for roles (primary, warning,
success, tertiary) rather than particular colours. Under Rose or Cerberus the same controls simply
take that theme's colours. If you already chose a theme, upgrading does not change it; only a fresh
install, or a user who never picked one, starts on Lamplight.

## Creating a Custom Theme

Open the **Themes** tab to see the Custom Themes manager. It lists your themes under **My themes**, and any admin-shared themes under **Instance themes**. Click **New theme** to open the editor.

The editor has:

- A **Display name** field (e.g. "My Night Theme") — this is the label shown under its swatch in the theme picker.
- A full CSS code editor (with line numbers and syntax highlighting; use the view's **Focus** width for more room) where you write the theme's CSS.
- An **Import** button to load a `.css` or `.json` file instead of writing CSS by hand.

A tip in the manager points you to the [Skeleton theme generator](https://themes.skeleton.dev/themes/create) — Serene Pub's UI is built on Skeleton UI, so you can visually design a theme there, download the file, and import it directly into the editor.

Once you're happy with the CSS, click **Create** (or **Update** if editing an existing theme) to save it. The theme immediately becomes available in the **Theme** picker under "My themes." The status bar at the bottom of the editor shows a running line count and character count while you work.

To remove a theme, open it for editing and use the trash icon (**Delete theme**), which asks for a **Confirm delete** before removing it.

> **Note:** Serene Pub upgraded from Skeleton UI v3 to v5, which renamed a number of underlying CSS design tokens. Custom themes created before this upgrade may render incorrectly (wrong colors, missing values) since they were generated against the old token names. If a saved custom theme looks broken after updating, re-open the [theme generator](https://themes.skeleton.dev/themes/create), re-create or re-import your theme there, and re-import the regenerated CSS here. Built-in themes are unaffected.

### Importing a Theme File

When you import a `.css` or `.json` file, Serene Pub automatically strips any outer `[data-theme="..."] { ... }` wrapper (or a plain `{ ... }` wrapper) so only the inner CSS declarations are loaded into the editor — the app re-wraps the CSS with its own theme identifier when it saves. If the imported file's name isn't already used as the display name, it's used to prefill the **Display name** field (with dashes/underscores turned into spaces and each word capitalized).

### Instance Themes (Admin Only)

When account support is enabled, an admin editing any custom theme sees a **Make instance theme** button. Turning this on (it then reads **Instance theme**) makes the theme available to every user on the instance, not just its creator — it appears in everyone's **Theme** picker under "Instance themes" and in the Themes manager's "Instance themes" list, tagged with an **Instance** badge. Admins also see who uploaded each theme.

## Other Personal Display Preferences

The **User** tab includes two toggles that only affect your own account:

- **Show all character fields** — expands character forms to show every available field instead of a simplified set. See [Characters](./characters.md).
- **Easy character creation** — writing a character or a persona from the Characters view's **New** menu opens a quick, guided creator instead of the full form. On by default.

Each toggle saves instantly and shows a confirmation toast (e.g. "Character fields display expanded" or "Easy character creation enabled").

## Custom Background Images

At the foot of the **Themes** tab, the **Background** section sets a background image behind the app UI. Options include:

- **No background** — the first tile in the picker, and the default.
- **Defaults** — a set of built-in background images to choose from.
- **My uploads** — your own uploaded images. Click **Upload** to add an image file; each thumbnail has a small delete button in its corner (always visible on touch devices, shown on hover on desktop) that opens a **Delete Background** confirmation before removing it.

Once a background is selected, an **Opacity** slider (10-100%, in 5% steps) controls how strongly the image shows through behind the interface.

In a session, the conversation reacts to a background: the message log and composer sit on one
translucent panel over the image, so the prose always has a ground while the picture shows around
and faintly through it. Your own turns and the composer stay opaque inside it. See
[Session layout](./session-layout.md#what-the-messages-widget-offers).

## Profile, Passphrase, and Logout

When account support is enabled on this instance, the **User** tab also includes a **User profile** section with:

- **Display name** — an editable text field with an **Update** button. Names must be 3-50 characters.
- **Change passphrase** — opens a modal asking for your current passphrase, a new passphrase, and confirmation. New passphrases must be at least 10 characters (128 maximum) and include an uppercase letter, a lowercase letter, and a special character.
- **Logout** — signs you out and returns you to the login/home screen.

These are covered in more detail in [Users & Accounts](./users-and-accounts.md).

## Document View

The **User** tab also has a **Document View** section with a **Switch to Document View** button — a separate, high-contrast, keyboard- and screen-reader-friendly interface. See [Document View](./document-view.md) for what it covers and how to get back.

## Extension settings

Some plugins let each person make their own choices, such as a dice plugin's default roll. When
a switched-on plugin offers one, the **User** tab shows an **Extension settings** card with that
plugin's choices. What you save there applies to you only.

A choice you have not set shows the value everyone gets, which an administrator sets in
**Admin → Plugins**, or the plugin's own default if they have not. Once you save your own, a
**Use the default for …** button clears it again. Settings that apply to the whole instance,
such as an API key the plugin uses, are never on this card: only an administrator can change
them.

## Importing Data (Admin Only)

If you're an admin, the **User** tab also shows a **Data import** section with an **Import from SillyTavern** button, linking to the app's import tool for bringing in characters, personas, chats (as sessions), and lorebooks from SillyTavern. It isn't shown on the Android app. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the full walkthrough.
