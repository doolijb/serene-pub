# Document View

Document View is a second, simpler way to use Serene Pub: high contrast, fully keyboard-operable and built for screen readers, with one plain page per task instead of sidebars and panes.

:::tip What it's for
- Using Serene Pub with a screen reader or the keyboard alone.
- Reading comfortably at large text sizes, in high contrast.
- Getting the everyday things done: starting sessions, writing to characters, managing characters and personas, and the setup an admin needs.
:::

It isn't a restyled version of the usual interface. It's a separate set of pages that works on the same data, so anything you do in one shows up in the other.

## The basics

### Turn it on

Any of these switches this browser to Document View:

- **Ctrl+Shift+Y**, anywhere, including the login screen.
- **Document View** at the bottom of the home screen, next to **Documentation**.
- **Document View** at the bottom of the login screen, so you can switch before signing in.
- **Switch to Document View** in **Settings › User**.

:::tip You should see
A plain page headed **Home**, with *Serene Pub — Document View (Accessible)* at the top. The first Tab press lands on **Skip to main content**.
:::

Your choice is remembered by this browser (not by your account) until you turn it off.

### Turn it off

- **Ctrl+Shift+Y** again, from anywhere. This turns Document View off for this browser and takes you to the same page in the usual interface.
- **Turn Off Document View** on Document View's **Settings** page.
- **Exit Document View** in the usual interface's **Settings › User**.

## Everyday use

### Every page

Every page has the same header:

- the *Serene Pub — Document View (Accessible)* link, back to Home;
- **Switch to Light Mode** / **Switch to Dark Mode**;
- **A−** and **A+** with the text size between them, from 100% to 200% in six steps;
- **Browse Standard Site** (see [Leaving Document View](#leaving-document-view)).

Then the main navigation, a plain list of links: **Home**, **Sessions**, **Characters**, **Documentation**, **Settings**, **Help** and **About** for everyone. Admins also see **Connections** and **System Settings**, **Users** once accounts are on, and **Ollama, managed** and **KoboldCPP, run by Serene Pub** when those are switched on (never in the Android app).

Every control is an ordinary link, button or form field, so Tab, Shift+Tab, Enter, Space and the browser's find-in-page all work as usual. Each page change moves focus to the top of the new page. Saves, errors and status changes (like KoboldCPP starting) are read out by your screen reader.

The text size and light or dark mode are Document View's own, separate from the usual interface's theme.

### Home

Until setup is finished, Home is a checklist of the setup steps (connection, character, persona, first session), each with a link to the page that does it and, where allowed, **Skip for now**. After that it shows your recent sessions and quick links.

### Sessions

The session list, a new-session form, and each session's page and edit page.

On a session's page:

- **Skip to latest message** and **Skip to message box** sit right under the title.
- Each message from a character or persona has a **View *name*** link to their details.
- If the session is yours, the last reply (when it's a character's) has **Swipe left (previous response)**, **Swipe right (next response)** and **Regenerate**, with *Response X of Y*, and every message has **Hide from AI** (or **Unhide**) and **Delete**.
- A hidden message says it's left out of what the AI sees.
- **Get a Response From** says who is next in the turn order and has them ready. Pick someone else, or **The narrator**, and press **Get response**. When it's your turn to write, it says so.

The edit page covers the name, characters, personas, guests, the turn order and the other choices the session's genre offers, the scenario and tags. For reading a lorebook into the session, benching a character, and the session's preset and actions, use the usual interface. See [Sessions](./sessions.md).

### Characters

The character list (personas included), a simple create form, an edit form, a view page, and **Browse Library** for the [character library](./characters.md#browsing-the-character-library). The forms cover **Name**, **Nickname**, **Description**, **Personality**, **Scenario** and **First message**, plus **Persona** and, when editing, **Default persona** (see [Personas](./personas.md)). Pictures, the gallery and the extra card fields are in the usual interface.

### Documentation

These docs, with a search that matches both pages and headings. Links between pages stay inside Document View.

### Settings, Help and About

**Settings** has your display name, your passphrase, the same text size and light or dark controls as the header, the ways back to the usual interface, and **Log out**. **Help** lists the keyboard shortcuts and every page you can reach. **About** shows the version.

### Admin pages

- **Connections**: list, create, edit, and set the default AI connection. **Ollama, managed** and **KoboldCPP, run by Serene Pub** have the same download and connect steps as the usual interface. See [Connections](./connections.md).
- **System Settings**: switch managed Ollama and KoboldCPP on or off (with KoboldCPP's server address), context debugging, the CharaVault account, and user accounts. Embeddings can't be set up here; a line says whether they're on. See [Pub settings](./system-settings.md).
- **Users** (once accounts are on): list, create, edit and delete accounts.

**Turning user accounts on** can't be undone, here or anywhere: once it's on, everyone, you included, must log in. Before it lets you, the page asks you to set a passphrase and shows your username so you can note both down. See [Users and accounts](./users-and-accounts.md).

## Going further

### Leaving Document View

There are two ways to leave, and they differ in what the browser remembers:

- **Browse Standard Site** (header) or **Browse standard site temporarily** (Settings page): use the usual interface for now, in this tab. Your Document View choice is kept, so a new tab opens Document View again.
- **Turn Off Document View** (Settings page) or **Ctrl+Shift+Y**: forget the choice. This browser opens the usual interface from now on.

Switching either way tries to keep your place: an open session opens the same session. Where there's no matching page, you land on Home.

### Visiting without switching

Opening a Document View address directly, from a bookmark, a shared link or this documentation, shows Document View for that visit only and doesn't change what this browser opens next time. To make it stick, press **Always Use Document View** on the Settings page.

### Making it the default for everyone

An administrator can make Document View the default for browsers that haven't chosen yet, with the `PUBLIC_DOCUMENT_VIEW_DEFAULT` setting (see [Feature toggles](./environment-variables.md#feature-toggles)). Once someone switches either way themselves, their choice wins.

## What's different from the usual interface

Document View covers less, on purpose: one simple, reliable page per task. Use the usual interface for:

- Lorebooks, tags, sampling, pipelines and context templates.
- Reading a lorebook into a session, benching characters, and a session's preset and actions.
- Character pictures, galleries, sprites and the extra card fields.
- Setting up embeddings.
- Themes, background images, and browsing CharaVault (connecting the account works in System Settings).

## For power users

The colours avoid pure black and white, which can make text seem to blur or shimmer for people with astigmatism, and still reach a contrast of about 17:1 in both modes (WCAG AAA asks for 7:1).

## Related

- [Themes and settings](./themes-and-settings.md)
- [Getting around](./getting-around.md): the usual interface.
- [Troubleshooting](./troubleshooting.md#stuck-in-document-view)
