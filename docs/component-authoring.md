# Component authoring

A **component** is the code behind a widget: the portrait row, the stats cards, the world state
strip. Serene Pub ships its own, plugins bring theirs, and an admin can write one right here in
the app — an **authored component**. You can start from blank, or clone one of core's widgets
and change how it looks.

An authored component belongs to this pub. It is not a plugin: there is nothing to package
or install, and it never replaces the widget it was cloned from. It sits beside core's as a new
widget that layouts can place.

:::note Who sees this
Authoring is for admins, and only while the extension subsystem is on (the
`SP_PLUGINS_ENABLED` environment variable, the same switch plugins use). With it off, the
**Components** page says so and does nothing else, and no authored component is drawn in any
session.
:::

## Where to find it

Open **Admin › Components** (below Plugins). The page has two lists:

- **Your components** — the ones written or imported on this pub. Each row shows its name,
  its widget id (`authored.<id>:<slug>`), its framework, and an **On / Off** switch. A **Needs
  review** badge means it asks for something you have not decided on yet (see
  [Scopes](#switching-it-on-and-reviewing-its-scopes)); **Clone of** names the core widget it
  started from.
- **Core's components** — the widgets Serene Pub ships. **View source** shows one as core ships
  it, read only. **Clone** copies it into your list. **Messages** (the conversation and the field you write
  into) is marked **View only**: you can read its source, but it cannot be cloned, because it runs
  with core's own trust.

To start from nothing, pick **Svelte** or **Vanilla** beside **New component**. Svelte is the
usual choice; Vanilla is plain TypeScript or JavaScript that builds its own elements.

## Cloning a core widget

**Clone** makes a new component with a copy of every one of the core widget's files. It is a
new widget with its own id, so your sessions keep core's version until you place yours instead.

A clone remembers which version of core's source it came from. When a later Serene Pub update
changes that widget, the editor says so — _Core's Stats has changed since you cloned it_ — and
**Compare** opens the **Core** tab, a side-by-side view of your files against core's current
ones. Nothing is merged for you; copy across what you want.

## The editor

Open a component to edit it. The files are on the left, one tab each; the entry file is marked
with a small play icon. **New file** adds one, and the buttons beside the tabs rename or delete
the one open. Paths are relative (`parts/Row.svelte`), and a component imports its own files
relatively.

On the right are four tabs:

- **Preview** — the component running against a made-up session, so you can see it before any
  real session does.
- **Problems** — what went wrong compiling or running it. A problem with a place in a file is a
  button: press it to jump to that line.
- **Widget** — the name in your list, the title on the widget, its icon (a
  [Lucide](https://lucide.dev/icons) icon name), and what it may read from a session.
- **Core** — only on a clone: the comparison described above.

**Ctrl+S** saves and **Ctrl+Enter** previews. An **Unsaved** badge by the title means the files
on screen differ from what is stored.

### What a component can use

A component runs in the page's worker, not in the page itself, and the page mirrors what it
draws. So:

- It places plain HTML and the app's `sp-*` elements (menus, tabs, dialogs, popovers and the
  rest), which the page renders with its own controls. Anything else is dropped.
- It imports only from its own files, Svelte, the Serene Pub SDK and core's widget kits. Any
  other import is a compile problem that lists what is allowed.
- It has no network, no storage and no `fetch`. What it shows arrives from the session.
- A `<style>` block is dropped. Style it with the app's utility classes, or with a widget style
  (see [Session layout](./session-layout.md#style)).

:::warning Utility classes the app does not already use
The app's utility classes are generated when Serene Pub is built, from the classes its own code
uses. A class nothing in the app uses — an unusual colour stop, an odd size — simply does
nothing in your component: there is no error, it is just unstyled. If a class seems to be
ignored, pick one core's widgets use, or give the widget a style instead.
:::

A component is limited to 64 files, 256 KB per file and 1 MB of source in all.

## Previewing

**Preview** compiles what is on screen without saving it and runs it in the **Preview** tab,
fed a made-up session: a short conversation, a cast, their stats and a little lore. Nothing in
a preview touches a real session — pressing a button there never writes, sends or opens
anything. The preview link is yours alone and expires after ten minutes; press **Preview**
again for a fresh one.

If what is on screen does not compile, the tab keeps showing the last version that did, with a line
saying so, and the reasons are under **Problems**.

## Saving, and compile problems

**Save** stores the source and compiles it. A save always keeps your files, even when they do
not compile — and a save that does not compile never takes a working widget away from a session.

- **It compiles.** It becomes the component's **last save**: what sessions run, what is offered
  to layouts and what **Export** writes.
- **It does not compile, and the component has compiled before.** Your files are kept as a
  **draft** beside the last save, and nothing else changes: sessions keep running the last
  save, in place. The list shows **Draft** by its name. The editor opens on the draft, under the
  banner _Draft — doesn't compile; sessions keep running the last save_, with the reasons under
  **Problems**. **Compare** (or the **Last save** tab) shows the draft against the last save, one
  file at a time. Fix it and save again — the draft becomes the last save — or press **Revert
  to last save** to throw the draft away (and any unsaved edits with it) and go back to what
  sessions run. The name, title, icon and scopes in the same save are not source, so they apply
  either way.
- **It does not compile, and the component never has** — a new, cloned or imported one with
  problems. There is no last save to keep, so the files are stored as they are; it is not
  offered to layouts until it compiles. The list shows **Last compile failed** under its name,
  and the editor repeats the reason at the top.

If someone else saved the same component while you had it open, your save is refused rather
than overwriting theirs; **Reload** brings their version in. A save from another tab shows a
banner too.

## Switching it on and reviewing its scopes

A component is **off** until you switch it on — **Offered to layouts** in the editor, **On /
Off** in the list. Off, it is drawn nowhere. In the editor the switch is part of the form, like
the source: it changes when you press **Save**.

Beyond the basics every widget gets, a component asks for what it wants to read, on the
**Widget** tab under _What it may read beyond the basics_:

| Scope                      | What it gives the widget                                     |
| -------------------------- | ------------------------------------------------------------ |
| **Stats and states**       | The cast's and the world's values.                           |
| **The cast**               | Who is in the session, with their faces and sprites.         |
| **Lore**                   | It may ask for pages of the session's lorebook entries.      |
| **The whole conversation** | Provisional: its shape is not settled yet.                   |
| **The viewer's persona**   | Declared, but nothing supplies it yet.                       |

Asking is not having. Every scope it asks for waits under **Scope review** as _Waiting for
review_, and is refused until you tick or untick it and press **Save** (the review is saved
first, then the switch, then the source; if one is refused, the form says which). This is the
same review plugins get, and the same **Needs review** badge. Changing what a component asks
for puts the new request back into review.

A widget that was refused a scope is told so, so a well-made one says _not granted_ rather than
waiting forever. Core's widgets do this, so a clone of one does too.

## Adding it to a session

Once a component is on and compiled, it is offered to every session's layout editor like any
other widget; a scope you have not reviewed yet is simply not given to it. Open a session, press **Layout**, and on the **Move** tab
drag it from the tray into a zone (see [Session layout](./session-layout.md#move)). It gets the
same settings window as every other widget: a title of your own, and a style.

A component switched on while a session is open appears in that session's tray the next time the
session is opened.

If the list shows **Not offered** under a component's name, with a reason such as _built for
widget protocol 3_, its compiled module was made for a different version of Serene Pub than this
one. This happens to an imported module. On a pub that can compile, save the component once
to rebuild it here.

## Live reload

Saving a component that compiles reloads it in every open session that shows it — yours and everyone else's
— in place, without reloading the page. Switching it off or deleting it turns it into _This
widget isn't available_ in those sessions; switching it back on brings it back where it was.

Deleting a component cannot be undone. Layouts that placed it keep the space and show it as
missing.

## Sharing: export and import

**Export** (on the list or in the editor) downloads a **share file**, `<slug>.component.json`.
It holds the component's source and, once it has compiled, the compiled module too. It exports
the last save: unsaved changes are not in it, and neither is a draft that does not compile —
the editor says so when it leaves one out.

**Import** on the Components page takes a share file, or a single `.svelte`, `.ts` or `.js`
file, dropped, chosen, or pasted (up to 4 MB). Before anything is stored, **Import a component**
shows what the file brings:

- **Runs** — how it will run here. On a pub that can compile, it is always recompiled
  from its source; a compiled module inside the file is never used. On one that cannot, it runs
  the compiled module the file carries — or cannot run at all if the file carries none.
- **Compiled module** — whether the file carries one, and whether it still matches the hash
  recorded when it was exported. One that does not match was changed after export, and a
  pub without a compiler will not run it.
- **Based on** — for a clone, the core widget and version it came from, and whether core's has
  changed since.
- **Scopes** — what it will ask for. Each one needs your review.
- **Files** — every file, with its size.
- Whether it compiles here. One that does not can still be imported and fixed in the editor.

An imported component always arrives **switched off**, with every scope waiting for review. If
you already have a component with the same name, it arrives as a copy under a new one.

## Android

The Android app has no component compiler: writing components on a phone is impractical, and
the compiler does not run on its bundled server. On Android the Components page says _Authoring
is not available on this pub_. You can still switch components on and off, review their
scopes, export and delete them, and **import share files that carry their compiled module** —
those run the module they carry, in the same sandbox as everywhere else.

## Type checking and larger projects

The in-app editor compiles and highlights, but it does not type-check. For a component big
enough to want that, or one you mean to ship as part of a plugin, use the SDK's command line
(`serene-pub create component`, `serene-pub build`), where your editor and `tsc` check the
code. See the SDK's [Widgets](./sdk/guides/widgets.md) guide.
