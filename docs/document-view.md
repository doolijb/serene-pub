# Document View (Accessibility Mode)

Document View is a second, fully separate interface for Serene Pub — high contrast, keyboard-navigable, and built for screen readers, with one plain page per feature instead of the standard app's sidebars and panels. It isn't a retrofit of the regular UI; it's an independent set of pages that talks to the same server over the same events, so anything you do there shows up in the standard app and vice versa. Nothing about the standard interface changes because Document View exists — you only ever see it if you go looking for it.

## Overview

Document View lives at `/document-view` and mirrors the standard app's main areas — Home, Chats, Characters, Personas, Connections, and so on — as their own dedicated pages, each independently reachable and screen-reader-friendly on its own. It deliberately doesn't cover every feature of the standard site (see [What's Different From the Standard Site](#whats-different-from-the-standard-site) below); it covers the everyday path of chatting, managing characters and personas, and the admin configuration needed to get there.

Design commitments that hold across every page:

- **High contrast without flat black-and-white.** Both themes sit around a 17:1 contrast ratio (comfortably past the WCAG AAA 7:1 floor) using off-black/off-white tones rather than pure `#000`/`#fff` — full extremes can cause visible "halation" (text blurring or vibrating) for people with astigmatism and can trigger visual stress for some photosensitive or dyslexic readers.
- **A font-size stepper**, independent of the standard site's own zoom/theme settings, from 100% up to 200% in six steps.
- **A dark/light mode toggle**, independent of the standard site's theme system.
- **Full keyboard operability** — every control is a plain link, button, or form field, so ordinary Tab/Shift+Tab, Enter/Space, and browser find-in-page all work with no special handling to learn. A skip-to-content link is the first Tab stop on every page, and every page change moves keyboard focus to the top of the new page's content.
- **Screen-reader announcements for in-app events** — font-size changes, save confirmations, validation errors, and status changes (like a KoboldCPP subprocess starting or stopping) are all spoken through a single live region. Route/page-title changes are announced separately by the browser framework's own built-in mechanism, so you don't hear the page title read out twice on every navigation.

The in-app [Help page](/document-view/help) has the full keyboard shortcut reference and a list of every page currently available, gated to what your account can access. Opening it switches you into Document View for that visit; it doesn't change which interface this browser opens next time.

## Turning It On

Three entry points exist in the standard app, plus a keyboard shortcut:

- The home page's **Document View** button (next to the **Documentation** button).
- The **Switch to Document View** button in **Settings → User** (under a dedicated "Document View" section, alongside the Theme, Dark Mode, and Background controls — see [Custom Themes & User Settings](./themes-and-settings.md)).
- The **Switch to Document View (Accessible)** link at the bottom of the login screen, so you can reach it before signing in at all.
- **Ctrl+Shift+Y**, from anywhere in either interface, including the login screen. This is a true toggle: pressing it from inside Document View turns the preference off and returns you to the standard site. Use **Browse Standard Site Temporarily** instead if you want to come back to Document View on your next visit.

Your choice is remembered in your browser (not tied to your account), so it persists across sessions until you turn it off again — either with Ctrl+Shift+Y, **Turn Off Document View** in Document View's own settings, or **Exit Document View** in the standard site's **Settings → User**.

Only those explicit choices are remembered. Following a link to a `/document-view/*` page — a bookmark, a shared URL, or a link from the documentation — shows Document View for that visit and leaves your default alone, so nobody gets switched over permanently by clicking a link. If you arrive that way and want it to stick, use **Always Use Document View** on the Document View settings page.

An admin can also make Document View the default for anyone who hasn't visited yet, via the `PUBLIC_DOCUMENT_VIEW_DEFAULT` environment variable — useful for a deployment primarily used by vision-impaired users. It only ever applies before a given browser has its own stored preference; once someone has toggled Document View on or off themselves, that choice always wins, even if the environment variable changes later.

## Layout and Navigation

Every page shares the same header and navigation:

- **Header** — the "Serene Pub — Document View (Accessible)" brand link (back to Home), a dark/light mode toggle, an **A−** / **A+** text-size stepper with a live percentage readout between them, and a **Browse Standard Site** button.
- **Main navigation** — a plain list of links: Home, Chats, Characters, Personas, Documentation, Settings, Help, and About are always shown. Connections, System Settings, and (once the relevant manager is turned on) Ollama Manager and KoboldCPP Manager only appear for admins; Users only appears for admins once accounts are enabled. This mirrors the same gating the standard app's own sidebars use.

## Pages

### Home

Shows the same setup wizard as the standard site's home page while anything required is still missing (connection, character, persona, first chat — see [Getting Started](./getting-started.md)), then switches to a simple dashboard of your recent chats and quick links once setup is complete.

### Chats

The chat list, a new-chat form, and a chat view/edit pair. A few things work a little differently here than in the standard chat window, to suit a page-based, screen-reader-first interaction model:

- Every message from a character or persona has a **View `<name>`** link to a read-only detail page (their description, personality, scenario, or first message); if it belongs to you, that page also has an **Edit** link.
- The **last** message in a chat, if it's from a character, gets **Swipe Left (Previous Response)** / **Swipe Right (Next Response)** and **Regenerate** buttons, plus a "Response X of Y" indicator.
- Hidden ("ghosted") messages — excluded from what the AI sees but still visible in the transcript — show a note explaining that, and any message you own has a **Hide from AI** / **Unhide** toggle.
- Beyond the standard **Get Next Response** button (which asks the server to work out whose turn it is), a **Get a Response From a Specific Character** control lets you force a particular character to reply right now — useful in group chats where the automatic turn order doesn't pick who you meant, or after a full round has already completed.
- "Skip to latest message" and "Skip to message box" links sit right below the chat title, so a screen-reader or keyboard user can jump straight past the message history instead of tabbing through it.

The edit page covers the chat's name, characters, personas, guests, group reply strategy, scenario, and tags. It does **not** cover attaching a lorebook, per-character visibility/disable toggles, or per-chat AI-override settings (sampling/context/prompt configs) — chats created or edited here use whatever the system defaults are. Use the standard site for those. See [Chats](./chats.md) for the full picture of what a chat can do.

### Characters and Personas

Each has a list page, a simplified create form, an edit form, a read-only view page, and a **Browse Library** page for the same community character/persona library the standard site uses (see [Characters](./characters.md) and [Personas](./personas.md)). The simplified forms cover Name, Nickname, Description, Personality, Scenario, and First Message for characters (Name, Description, and a "set as default" toggle for personas) — no avatar/gallery management, advanced fields, or lorebook bindings. Use the standard site for those.

### Documentation

A search-and-browse view of this same set of docs, reflowed for Document View — search matches both whole pages and individual headings within them, and every in-doc link stays inside Document View instead of dropping you back onto the standard site mid-read.

### Connections, Ollama Manager, KoboldCPP Manager (Admin Only)

List, create, edit, and set-default for AI provider connections, plus the same download/browse/connect workflows as the standard site's Ollama and KoboldCPP managers when those are turned on. See [Connections](./connections.md).

### System Settings (Admin Only)

Covers the Ollama Manager and KoboldCPP Manager toggles and URLs, Summarization, Context Debugging, and CharaVault connection — see [System Settings](./system-settings.md) for what each of these does. Embeddings/RAG setup isn't available here (it requires choosing a model, which doesn't yet have a Document View page) — a status line shows whether it's enabled and points you to the standard site to configure it.

**Enabling User Accounts** works a little differently than the standard site's toggle: it's presented as one-way-on rather than a switch, since turning it on immediately requires everyone — including you — to start logging in. Before you can enable it, you need a passphrase set on your own account; the page shows your username plainly and asks you to make a note of it, since you'll need both it and your new passphrase to log back in once accounts are required. Turning accounts back **off** isn't available from Document View — use the standard site's System Settings if you need to. See [Users & Accounts](./users-and-accounts.md).

### Users (Admin Only, once accounts are enabled)

A minimal user list, create, and edit/delete — the Document View companion to enabling accounts above, since otherwise an admin would have no way to create accounts from this interface at all.

### Settings

Your own display name, passphrase (change or, if you don't have one yet, set one), the same dark/light mode and text-size controls as the header, and two ways back to the standard site (see [Leaving Document View](#leaving-document-view) below), plus logout.

### Help and About

Help has the full keyboard shortcut reference and a complete sitemap of every page you can currently reach, grouped by area. About has the app version, build info, and links — the same information as the standard site's About tab.

## Leaving Document View

Two different actions, both in the header or the Settings page:

- **Browse Standard Site** — temporary, for this browser tab only. It takes you to the standard site's equivalent page (the same open chat, for example) without forgetting your Document View preference — reloading or clicking around the standard site keeps you there, since the whole point is to let you actually use it for a while, but a fresh tab (or explicitly switching back) returns you to Document View. Pressing Ctrl+Shift+Y does the exact same thing from anywhere.
- **Turn Off Document View** (Settings page only) — a deliberate, permanent opt-out that clears your stored preference. You can always turn it back on again with any of the entry points above.

Switching between interfaces tries to land you on the equivalent page rather than always bouncing to home — an open chat maps to the same chat, for instance — falling back to each interface's home page when there's no direct equivalent (most sidebar-only standard-site panels, and most admin manager/settings pages, don't have a one-to-one Document View page to map to and vice versa).

## What's Different From the Standard Site

Document View intentionally covers a smaller surface than the full app, favoring a simple, reliable, page-per-feature model over one-to-one parity. Not available yet, all reachable from the standard site instead:

- Lorebooks (World/Character/History/Graph tabs), Tags, Prompt Configs, Sampling Configs, and Context Configs have no Document View pages at all.
- Chat editing excludes lorebook attachment, per-character visibility/disable, and per-chat AI overrides.
- Character and persona forms are simplified — no avatar/gallery management or advanced fields.
- Embeddings/RAG setup (choosing and downloading a model).
- Custom theme creation/editing, background images, and CharaVault's browsing UI (though connecting/disconnecting CharaVault itself works from System Settings).
