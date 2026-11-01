# Plugins

This page is for the person who installs and runs plugins on a pub: where a package keeps its things, and which limits you can change. For the code behind one, see the SDK's [Your first plugin](./sdk/guides/your-first-plugin.md); for components made inside the app, see [Component authoring](./component-authoring.md).

Plugins run on every pub unless the person who runs it turns them off with `SP_PLUGINS_ENABLED` (see [Feature toggles](./environment-variables.md#feature-toggles)). With it off, **Admin › Plugins** says so, plugins do nothing, and packages can't be installed. There's no switch in the app yet.

Plugins are built with the SDK, which may still change before its 1.0. The SDK guide [What the SDK promises before 1.0](./sdk/guides/stability.md) says what plugin authors can rely on meanwhile.

## Installing a package

Open **Admin › Plugins** and press **Install a package…**, then pick the `.zip`: a built package, with its files under `dist/plugin/` as `serene-pub build` writes them. Nothing is sent yet. The page shows the file's name and size with **Install** and **Cancel**, and under them a review read from the package itself: the plugin's name and version, and two lists.

- **Permissions it asks for**: each thing it wants, such as storage, the network, the lorebook or sound.
- **What it can't do**: the limits that still hold on this pub (see [What a plugin can't do](#what-a-plugin-cant-do)).

The permissions it asks for come in three groups: **In a session** (what it may do in the session it is shown in), **Outside a session — its applet** (what its own page may do with your characters, lorebooks and sessions) and **On this pub** (its own files, the network and sound). On the plugin's page each group has **Allow all** and **Deny all**, and you can still tick one permission at a time.

Under the lists it says _A permission you haven't approved before stays refused until you approve it on the plugin's page._ Press **Install**: the button counts up (**Uploading… 40%**), then reads **Installing…**. The plugin lands switched off, and nothing it asks for works until you approve it on its page. That page shows **What it can't do** under its permissions, and the list follows your ticks as you approve them.

Two limits bound a package, both set in [Environment variables](./environment-variables.md): `SP_PLUGIN_PACKAGE_MAX_MB` (512 MB by default, counted as the files it unpacks to) and `SP_PLUGIN_FILES_MAX` (10000 files). A package over a limit is refused, and the message names the variable to raise.

A package is unpacked onto the pub's disk under the [data folder](./environment-variables.md#data-and-storage), in `plugins/<id>/<version>/`. When you install a newer version, the old one stays until the next start, then it is removed. Uninstalling a plugin removes its files.

### Installing from disk

A package of any size up to `SP_PLUGIN_PACKAGE_MAX_MB` uploads from the browser. On a machine you reach only by a terminal, install from a folder on that machine instead, with `npm run plugin:install -- <folder>`. See [Install a package from disk](./hosting.md#install-a-package-from-disk).

### What a plugin can't do

Some limits hold for every plugin, whatever its package asks for:

- It can't read your connections or API keys, or call a model itself.
- It can't see the secrets you type into its settings; its code gets a stand-in.
- It can't open files or run programs on this computer, or touch another plugin's files.
- It can't change your characters, lorebooks or sessions directly; every change goes through Serene Pub.

Others hold until you approve a permission that lifts them, and the list says which are left:

- With no network permission, it can't reach the internet or your local network. With one, it still can't reach a site it doesn't list, or this computer and your local network unless it names them.
- Without permission to write to sessions, it can't send or draft messages as you, or change a session's stats or states. Each half needs its own permission.
- Without an event permission, it can't hear what happens in sessions that don't use it. With one, it hears that event in every session on this pub.
- Without storage, it can't keep files of its own.

## Pictures, sound and data that come with a package

A package can ship a folder of **assets**: images, audio, fonts and data files. They are kept on disk and served read-only at an address that carries the plugin's id and its version: `/plugin-assets/<id>/<version>/<path>`. Because the version is part of the address, your browser keeps each file for good, and an upgrade never shows an old file: the old address stops working and the new one starts. Ask for an address with a version that isn't installed and you get a 404. A plugin's own code can read the same files, and only those, with `ctx.package.read`, so it can ship things such as starter worlds without bundling them into its code.

A package can also ship **lorebooks**. When the plugin is switched on and you have approved its permission to add lorebooks, Serene Pub imports each one as you, the way Lorebooks › Import would, and the plugin's page lists them with a link to each. It imports a book once per version. When the plugin is updated, the book already in your library is changed to match: an entry you have not touched is updated, an entry you edited stays as you wrote it, and nothing at all is changed in a book whose lore changes are set to Review or Off (the plugin's page says an update is waiting). When you uninstall the plugin, tick the box on its page to delete the lorebooks it provided; left unticked, they stay as ordinary lorebooks. A book you deleted by hand comes back the next time the plugin is switched on or the pub restarts.

## Languages

A package can bring its own translations as string catalogs, one `lang/<locale>.json` file per language. What the plugin's pages show in your language comes from, in order: the plugin's own catalog for your language, then the app's [automatic translations](./languages.md), then the plugin's English. So a plugin with no catalog for your language still reads in it if the pub has automatic translation on.

## The data folder and storage

A plugin keeps its own files in a place that only its own code can read. This is on for every pub. A plugin gets 64 MB unless its package asks for another size, and you can lower or raise that when you review it. Before this preview, plugin storage stayed off unless `SERENE_PUB_DATA_DIR` was set.

A package can also name some of its files to share with its own pages. Those, and only those, are readable at `/plugin-data/<id>/<path>`. Everything else stays private, and there is no listing of what is there. You see the request when you review the package. A package's own pages can read both kinds of file with a plain GET request, which is how they load data files, but they cannot reach anything else of the app that way.

A package can also ask for a folder for **each person** who uses it, with a quota of its own for every person: their saved worlds or notes, say. Only the plugin's own code reads these, always for the person who is acting at the time, and a page of the app can fetch the signed-in person's own file at `/plugin-data/<id>/me/<path>` (a sandboxed frame cannot; it asks the plugin). They are kept in `extensions_user_data` in the data folder, next to `extensions_data`. A person's files are deleted with their account. A plugin's own genre can also read one of these files while it runs (a custom world the person imported, say); that is read-only, limited to 4 MB a file, and only ever reaches that plugin's own files. When you uninstall a plugin that asks for them, its page offers to delete what it kept for each person (their files and their saved data); leave that unticked and they are kept in case you install it again.

A package can also ask to keep small saved settings for **each person**: a profile, a list of saved worlds, the kind of thing too small to be a file. Serene Pub calls this the person's **saved data**; the permission is `applet:annex:user`, and it shows in the **Outside a session — its applet** group. The plugin only ever sees the data of the person who is acting at the time, and it has no way to look at anyone else's. A person's saved data is deleted with their account. When you uninstall a plugin, the same box that offers to delete everybody's files deletes this too; leave it unticked and it is all kept in case you install the plugin again.

**Admin › Data and backups** and the support report show what each plugin takes on disk.

## Plugin actions

A package can offer **actions**: named pieces of work that run outside any session, like saving a draft world or importing a file. A plugin's page (`/x/<id>`) or one of its frames calls an action by name, and a frame gets the result back. The action runs for whoever is signed in and checks what it was given first.

Two actions the app does for a plugin are **file pick** and **file save**. A page asks for a file; the app opens its own file picker (it needs a click first), and the chosen file goes to the plugin's action. The page never sees the file's bytes. A save works the same way the other direction: the page asks the app to offer a download, and the app fetches it from the plugin's shared files or from an action's answer. Only a plugin's own pages can do either.

Both requests can carry a short **target** (up to 512 characters) that the page chooses, such as `summer/portrait`. The app does not read it; it hands it to the action, so the action knows which world a picked picture belongs to or which world to build for a download. A save action may also answer with its own file name and type. An action does not have to declare `target` in its `params` to receive it; declare it only if you want it checked.

## Rules in a package

A package can bring [rules](./rulesets.md). Installing it publishes them, and they appear in **Admin › Play › Rulesets** marked as the plugin's. Uninstalling retires them. A session keeps playing the version it started on until its owner chooses **Update rules** (see [Updating a session's rules](./sessions.md#rules-options)), so a new plugin version never changes a game in progress.

## Sound

A plugin's page can play sound by itself only when the package asked for it and you accepted the request when you reviewed it. Without that, the browser blocks autoplay in its frames.

## Related

- [Hosting Serene Pub](./hosting.md): the limits, and installing from disk.
- [What the SDK promises before 1.0](./sdk/guides/stability.md): what plugin authors can rely on while the SDK settles.
- [Environment variables](./environment-variables.md): `SP_PLUGINS_ENABLED`, `SP_PLUGIN_PACKAGE_MAX_MB`, `SP_PLUGIN_FILES_MAX`.
- [Component authoring](./component-authoring.md): components written inside the app.
- [Frames](./sdk/guides/frames.md) and [Storage](./sdk/guides/storage.md): the SDK guides for the same features.
- [Coming from SillyTavern extensions](./sdk/guides/coming-from-sillytavern-extensions.md): for authors porting an extension to a plugin.
