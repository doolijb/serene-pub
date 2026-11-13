# Themes and settings

The **Settings** view holds your own preferences: how the app looks, the language it's in, and a few choices about how it behaves for you.

:::tip What it's for
- Changing the colours, switching dark mode, or making the story text bigger.
- Building a theme of your own, or setting a picture behind the app.
- Your language, and your personal defaults for characters and lorebooks.
:::

Everything here affects only you. Settings for the whole pub are in the admin area: see [Pub settings](./system-settings.md).

## The basics: change the theme

1. Open **Settings** (the gear) on the rail.
2. Pick the **Themes** tab.
3. On the **Theme** card, click a swatch. Each one is a small preview in that theme's own colours.

:::tip You should see
The whole app changes colour at once, and the swatch you picked has a tick. The choice is saved to your account, so it follows you to other devices.
:::

The **Dark mode** switch on the same card turns light and dark on and off; every theme has both. The default theme is **Lamplight**, Serene Pub's own: gold for anything you can act on, an ember glow while the model is writing, green for healthy and connected.

Themes are grouped as **Built-in**, **My themes** (ones you made, see [Creating a custom theme](#creating-a-custom-theme)) and **Pub themes** (ones an administrator has shared with everyone).

## The Settings tabs

| Tab | What's on it |
| --- | --- |
| **User** | Your language and personal defaults. See [below](#your-preferences-the-user-tab). |
| **Media** | The images you've uploaded. See [Characters](./characters.md#cropping-an-avatar) for its **Crop** action. |
| **Data** | The pub's backups (administrators; everyone else sees that an administrator manages them). See [Data and backups](./system-settings.md#data-and-backups). |
| **Themes** | Theme and dark mode, story text size and motion, the background picture, and your own themes. |
| **Import** | Administrators, not on Android: bring in a SillyTavern folder. See [Importing from SillyTavern](./importing-from-sillytavern.md). |
| **About** | The version you're running, and links to the website, GitHub, the milestones, Discord, the issue tracker and discussions. |

## Your preferences: the User tab

Each setting is a card: its name, one sentence saying what it does, and the control (beside the words on a wide screen, under them on a narrow one). From the top:

- **Show advanced controls**: more choices on sessions, lorebooks and characters; off keeps the everyday ones. See [below](#show-advanced-controls).
- **Language**: the language the app is shown in, or **Pub default** to follow whatever an administrator has set for everyone. See [Languages](./languages.md).
- **Time zone**: the zone real-world dates and times are shown in (when a session was last active, when an account was made). It starts as your browser's zone the first time you open the app; pick another and it follows you to every device. Times are stored the same way whatever you pick, and in-story time (a session's or lorebook's own clock) is never affected.
- **Lorebook writes from sessions**: how your sessions may change the lorebooks you own (the stats they record, a summary, a compiled history, a graph). **Full**, **Review changes** or **Off**, or follow the pub's default. A lorebook can be stricter in its own Book settings, never looser. See [Lorebooks](./lorebooks.md#what-a-session-may-write).
- **Library write mode**: what you allow by default when Serene or a session adds to your library (a character or a lorebook it drafted); whether a session adds anything depends on its genre and preset. **Full (default)** adds it at once, **Review** keeps it in the session until you accept it, **Off** adds nothing. Back takes back anything it added. See [Sessions](./sessions.md#back-and-forward).
- **Background routines**: limits on your sessions' [routines](./sessions.md#routines) that run on the real clock: **Stop after nobody has played for (minutes)** and **Most runs in a row**. Leave a box empty to follow the pub's limit, shown beside it; you can only set a lower one. See [Pub settings › Background routines](./system-settings.md#background-routines).
- **Easy character creation**: on (the default), **New** in the Characters view opens a short guided creator for a character or a persona; off, it goes straight to the full form.
- **Document View**: **Switch to Document View** opens Serene Pub's simplified, high-contrast, keyboard- and screen-reader-friendly version. **Ctrl+Shift+Y** does the same from anywhere. See [Document View](./document-view.md).
- **Extension settings**: only when a plugin offers you choices; see [below](#extension-settings).
- **Data import** (administrators, not on Android): **Import from SillyTavern** opens the **Import** tab. See [Importing from SillyTavern](./importing-from-sillytavern.md).
- **User profile**: your **avatar**, the round picture shown for your account (click it or drop an image on it; the crop editor's **Save** uploads it), and your **Display name**, the name the app and the characters call you. Up to 50 characters; press **Update** to save it. Empty it and press **Update** to go by your username again. With user accounts on, the card also has **Change passphrase** and **Logout**, and a **Two-factor authentication** card appears above it. See [Users and accounts](./users-and-accounts.md#your-own-account).

Switches save as soon as you flip them.

### Show advanced controls

**Show advanced controls** is one switch, first on the **User** tab, and it is off by default. It decides how many choices you see on sessions, lorebooks and characters: off keeps the everyday ones, on adds the rest. Wherever a form hides something, a muted line at its foot reads *Some controls are hidden.* followed by **Show advanced controls**; pressing it turns the switch on in place.

Hidden never means changed. A hidden control keeps its stored value, and the session or lorebook keeps using it. The switch is a preference, not a permission: it never shows you what your role hides, and **Admin** and the **Sampling**, **Models**, **Loadouts** and **Connections** views are the same either way. People who had the old *Show all character fields* switch on start with advanced controls on. **Easy character creation** is separate and unchanged.

- **Starting and editing a session**: the rules choices on the start form, and parts of a session's **Settings** tab. See [Start a session](./sessions.md#start-a-session) and [Settings](./sessions.md#settings).
- **The session view**: **Branch from here**, **Customize layout** in the full-screen corner control, and the **Author's note** widget's number settings. See [Branch from here](./sessions.md#branch-from-here), [Session layout](./session-layout.md#open-the-editor) and [Author's note](./sessions.md#authors-note).
- **Characters**: the character form's less common fields. See [Characters](./characters.md).
- **Lorebooks**: the entry editor's regex, case and priority fold, **Rules** and **Calendar** in Book settings, the **Graph** and **Lives** views, and the graph buttons. See [Lorebooks](./lorebooks.md).

### Extension settings

Some plugins let each person make their own choices, such as a dice plugin's default roll. When a switched-on plugin offers one, the **User** tab shows an **Extension settings** card with that plugin's choices. What you save there applies to you only.

A choice you haven't set shows the value everyone gets: what an administrator set in **Admin › Plugins**, or the plugin's own default. Once you save your own, **Use the default for …** clears it again. Settings for the whole pub, such as an API key the plugin uses, are never on this card. A choice that holds structured data (JSON) is a code field: what you type is saved only once it is valid JSON, and a plugin can limit its size and shape, in which case Save says what does not fit.

## Reading and motion

Two cards on the **Themes** tab, under the theme. Unlike the theme, these are saved **in this browser only**, so your phone and your computer can differ.

- **Story text size**: 16, 17 (the default), 18 or 20. Only the story in a session changes size; names, times and the rest of the interface stay the same.
- **Animate views**: whether opening, resizing and focusing a view animates. Your system's reduced-motion setting always wins.

## A background picture

The **Background** card of the **Themes** tab puts a picture behind the app.

- **No background** (the first tile) is the default.
- **Defaults** are pictures that come with Serene Pub.
- **My uploads**: press **Upload** to add an image. Each one has a small delete button in its corner, which asks before removing it.

Once a picture is chosen, the **Opacity** slider (10 to 100%) sets how strongly it shows through. In a session, every panel sits on the layout's **Backing** (a card by default), so the story stays readable over the picture; lower the layout's own **Opacity** to let more of it through. See [Layout settings](./session-layout.md#layout-settings).

## Creating a custom theme

A theme is a small piece of CSS that sets the app's colours. The easiest way to make one is visually:

1. Design it in the [Skeleton theme generator](https://themes.skeleton.dev/themes/create) (Serene Pub is built on Skeleton, so its themes fit) and download the file.
2. On the **Themes** tab, under **Custom themes**, press **New theme**.
3. Press **Import** and choose the downloaded `.css` or `.json` file. Give it a **Display name** if it doesn't already have the one you want.
4. Press **Create**.

:::tip You should see
Your theme under **My themes** on the **Theme** card. Click it to use it.
:::

You can also write or adjust the CSS by hand in the editor; give the view Focus for more room. To change a theme later, open it and press **Update**. To remove it, open it and use the bin icon (**Delete theme**), then **Confirm delete**.

Importing strips the file's outer `[data-theme="..."] { ... }` wrapper, keeping only the declarations inside; Serene Pub adds its own wrapper when it saves. If the theme has no display name yet, the file's name fills it in.

### Sharing a theme with everyone

:::note Admins only
Only when user accounts are on.
:::

An administrator editing a custom theme sees **Make pub theme**. Turned on (it then reads **Pub theme**), the theme appears for everyone under **Pub themes**, marked **Pub**, and administrators also see who uploaded it.

## Related

- [Users and accounts](./users-and-accounts.md): your profile, passphrase and two-factor.
- [Languages](./languages.md): the language setting, and automatic translation.
- [Document View](./document-view.md): the accessible version of the app.
- [Pub settings](./system-settings.md): settings for the whole pub.
