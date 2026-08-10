# Custom Themes & User Settings

Serene Pub ships with a large set of built-in color themes and a live CSS editor for building your own, plus a handful of personal display preferences that only affect your own view of the app. All of it lives in one place: the Settings panel.

## Overview

Click the **Settings** icon (gear icon) in the main navigation to open the Settings panel. It's organized into tabs:

- **User** — theme selection, dark mode, display preferences, background image, and (when accounts are enabled) your profile, passphrase, and logout.
- **System** — admin-only instance configuration, covered in a separate doc.
- **Themes** — the Custom Themes manager, where you create, edit, import, and delete your own themes.
- **About** — app version, build info, and links to the GitHub repository, wiki, Discord, issue tracker, and discussions.

Everything described below lives in the **User** and **Themes** tabs. See [Users & Accounts](./users-and-accounts.md) for profile, passphrase, and login-related settings.

## Switching Themes

In the **User** tab, the **Theme** dropdown lists every theme available to you, grouped into:

- **Built-in** — Catppuccin, Cerberus, Concord, Crimson, Dracula, Fennec, Hamlindigo (the default), Legacy, Mint, Modern, Mona, Nosh, Nouveau, Pine, Reign, Rocket, Rose, Rosé Pine, Sahara, Seafoam, Terminus, Vintage, Vox, and Wintry.
- **My Themes** — any custom themes you've created (see below).
- **Instance Themes** — custom themes an admin has made available to everyone, if any exist.

Selecting a theme applies it immediately and saves it as your personal preference. A separate **Dark Mode** switch toggles light/dark mode independently of which theme is selected — every theme, built-in or custom, supports both.

## Creating a Custom Theme

Open the **Themes** tab to see the Custom Themes manager. It lists your themes under **My Themes**, and any admin-shared themes under **Instance Themes**. Click **New Theme** to open the editor.

The editor has:

- A **Display name** field (e.g. "My Night Theme") — this is the label shown in the theme dropdown.
- A full CSS code editor (with line numbers, syntax highlighting, and a **Fullscreen** toggle) where you write the theme's CSS.
- An **Import** button to load a `.css` or `.json` file instead of writing CSS by hand.

A tip in the manager points you to the [Skeleton theme generator](https://themes.skeleton.dev/themes/create) — Serene Pub's UI is built on Skeleton UI, so you can visually design a theme there, download the file, and import it directly into the editor.

Once you're happy with the CSS, click **Create** (or **Update** if editing an existing theme) to save it. The theme immediately becomes available in your **Theme** dropdown under "My Themes." The status bar at the bottom of the editor shows a running line count and character count while you work.

To remove a theme, open it for editing and use the trash icon, which asks for a **Confirm delete** before removing it.

> **Note:** Serene Pub upgraded from Skeleton UI v3 to v5, which renamed a number of underlying CSS design tokens. Custom themes created before this upgrade may render incorrectly (wrong colors, missing values) since they were generated against the old token names. If a saved custom theme looks broken after updating, re-open the [theme generator](https://themes.skeleton.dev/themes/create), re-create or re-import your theme there, and re-import the regenerated CSS here. Built-in themes are unaffected.

### Importing a Theme File

When you import a `.css` or `.json` file, Serene Pub automatically strips any outer `[data-theme="..."] { ... }` wrapper (or a plain `{ ... }` wrapper) so only the inner CSS declarations are loaded into the editor — the app re-wraps the CSS with its own theme identifier when it saves. If the imported file's name isn't already used as the display name, it's used to prefill the **Display name** field (with dashes/underscores turned into spaces and each word capitalized).

### Instance Themes (Admin Only)

When account support is enabled, an admin editing any custom theme sees a **Make instance theme** button. Turning this on (it then reads **Instance theme**) makes the theme available to every user on the instance, not just its creator — it appears in everyone's **Theme** dropdown under "Instance Themes" and in the Themes manager's "Instance Themes" list, tagged with an **Instance** badge. Admins also see who uploaded each theme.

## Other Personal Display Preferences

The **User** tab includes several toggles that only affect your own session:

- **Show All Character Fields** — expands character forms to show every available field instead of a simplified set. See [Characters](./characters.md).
- **Easy Character Creation** — enables a simplified/guided character creation flow.
- **Easy Persona Creation** — enables a simplified/guided persona creation flow. See [Personas](./personas.md).
- **Show Home Page Banner** — shows or hides the dismissible Serene Pub logo banner at the top of the home page. The "Serene Pub is in beta!" notice underneath it always shows regardless of this setting.

Each toggle saves instantly and shows a confirmation toast (e.g. "Character fields display expanded" or "simplified").

## Custom Background Images

Further down the **User** tab, expand the **Background** section to set a background image behind the app UI. Options include:

- **None** — no background image (the default tile in the picker).
- **Defaults** — a set of built-in background images to choose from.
- **My Uploads** — your own uploaded images. Click **Upload** to add an image file; each thumbnail has a small delete button in its corner (always visible on touch devices, shown on hover on desktop) that opens a confirmation dialog before removing it.

Once a background is selected, an **Opacity** slider (10-100%, in 5% steps) controls how strongly the image shows through behind the interface.

## Profile, Passphrase, and Logout

When account support is enabled on this instance, the **User** tab also includes a **User Profile** section with:

- **Display Name** — an editable text field with an **Update** button. Names must be 3-50 characters.
- **Change Passphrase** — opens a modal asking for your current passphrase, a new passphrase, and confirmation. New passphrases must be at least 10 characters (128 maximum) and include an uppercase letter, a lowercase letter, and a special character.
- **Logout** — signs you out and returns you to the login/home screen.

These are covered in more detail in [Users & Accounts](./users-and-accounts.md).

## Document View

The **User** tab also has a **Document View** section with a **Switch to Document View** button — a separate, high-contrast, keyboard- and screen-reader-friendly interface. See [Document View](./document-view.md) for what it covers and how to get back.

## Importing Data (Admin Only)

If you're an admin, the **User** tab also shows a **Data Import** section with an **Import from SillyTavern** button, linking to the app's import tool for bringing in characters, personas, chats, and lorebooks from other applications. See [Importing from SillyTavern](./importing-from-sillytavern.md) for the full walkthrough.
