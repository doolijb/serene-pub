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

From the top:

- **Language**: the language the app is shown in, or **Pub default** to follow whatever an administrator has set for everyone. See [Languages](./languages.md).
- **Lorebook writes from sessions**: how your sessions may change the lorebooks you own (the stats they record, a summary, a compiled history, a graph). **Full**, **Review changes** or **Off**, or follow the pub's default. See [Lorebooks](./lorebooks.md#what-a-session-may-write).
- **Show all character fields**: the character form shows every field, including the less common ones, instead of just the usual few. See [Characters](./characters.md).
- **Easy character creation**: on (the default), **New** in the Characters view opens a short guided creator for a character or a persona; off, it goes straight to the full form.
- **Document View**: **Switch to Document View** opens Serene Pub's simplified, high-contrast, keyboard- and screen-reader-friendly version. **Ctrl+Shift+Y** does the same from anywhere. See [Document View](./document-view.md).
- **Extension settings**: only when a plugin offers you choices; see [below](#extension-settings).
- **Data import** (administrators, not on Android): **Import from SillyTavern** opens the **Import** tab. See [Importing from SillyTavern](./importing-from-sillytavern.md).
- **User profile**: your **Display name**, the name the app and the characters call you. Up to 50 characters; press **Update** to save it. Empty it and press **Update** to go by your username again. With user accounts on, the card also has **Change passphrase** and **Logout**, and a **Two-factor authentication** card appears above it. See [Users and accounts](./users-and-accounts.md#your-own-account).

Switches save as soon as you flip them.

### Extension settings

Some plugins let each person make their own choices, such as a dice plugin's default roll. When a switched-on plugin offers one, the **User** tab shows an **Extension settings** card with that plugin's choices. What you save there applies to you only.

A choice you haven't set shows the value everyone gets: what an administrator set in **Admin › Plugins**, or the plugin's own default. Once you save your own, **Use the default for …** clears it again. Settings for the whole pub, such as an API key the plugin uses, are never on this card.

## Reading and motion

Two preferences under **Reading and motion** on the **Themes** tab. Unlike the theme, these are saved **in this browser only**, so your phone and your computer can differ.

- **Story text size**: 16, 17 (the default), 18 or 20. Only the story in a session changes size; names, times and the rest of the interface stay the same.
- **Animate views**: whether opening, resizing and focusing a view animates. Your system's reduced-motion setting always wins.

## A background picture

The **Background** section of the **Themes** tab puts a picture behind the app.

- **No background** (the first tile) is the default.
- **Defaults** are pictures that come with Serene Pub.
- **My uploads**: press **Upload** to add an image. Each one has a small delete button in its corner, which asks before removing it.

Once a picture is chosen, the **Opacity** slider (10 to 100%) sets how strongly it shows through. In a session, the messages and the composer sit on a translucent layer over the picture, so the story stays readable. See [Session layout](./session-layout.md#what-the-messages-widget-offers).

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
