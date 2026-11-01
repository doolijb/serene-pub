# REPORT — readiness lane P (Plugins: D5 cannot-do list, D1 plugins on, K6 HTTP upload) — 2026-10-30

Saved by the lead from the supervisor's hand-back (the harness refused the subagent's own write).

## Differences from the brief
- The install review did not show permissions before (staging showed only name · size); the page now reads the
  manifest in the browser and shows the review before anything is sent.
- The upload goes in pieces: adapter-node refuses any body over `BODY_SIZE_LIMIT` (512K default) before app code
  runs, so one POST would fail in production. Pieces fit under the limit; no setting changes; plain-http LAN works.
- **No admin switch (D1):** admin-wide settings are columns on `system_settings` (no JSON/key-value row), so a
  switch needs a generated migration adding `system_settings.plugins_enabled`. Stopped at the env default as
  instructed. ★ for the owner.

## D5 — the cannot-do list ("palisade")
- NEW `src/lib/shared/plugins/declaredPermissions.ts`: pure manifest-permission reader moved verbatim from
  `server/plugins/permissions.ts` (which re-exports). Event permission label now "Hears `<event>` in every
  session on this pub" (`eventHost.notify` doesn't filter by session).
- NEW `src/lib/shared/plugins/palisade.ts`: `FIXED_CANNOT` (always-true limits, each with a `rule` field and a
  comment naming where it's enforced: R53, R63, sandbox ctx, K1/Q2); `pluginPalisade(permissions)` → `{can, cannot}`.
- NEW `src/lib/shared/plugins/packageManifest.ts`: `readPackageManifest(blob)` reads only the central directory
  and the manifest via `Blob.slice` (root or one wrapper folder). `PLUGIN_BUILD_DIR` lives here now.
- NEW `client/admin/sections/plugins/PluginPalisade.svelte`: "Permissions it asks for" and "What it can't do".
- `Page.svelte`: choosing a zip shows the review (name, `slug · vX`, both lists, "A permission you haven't
  approved before stays refused until you approve it on the plugin's page.").
- `IdPage.svelte`: "What it can't do" under Permissions, following the ticks live.

## K6 — upload over HTTP, in pieces
- Removed the socket `plugins:installPackage` (types, typedSocket, interest), `IMPORT_FILE_CAPS.pluginPackageBytes`
  (70 MB), the base64 path and `unzipSync`.
- Route `src/routes/api/admin/plugins/package/+server.ts` (POST, PUT) → `server/plugins/packageUpload.ts`; wire
  contract `shared/plugins/packageUpload.ts`. Every step: 401 unauthenticated, 403 non-admin, 403 bad `Origin`
  (`isFormOriginAllowed`; plain-http LAN passes), 403 plugins off.
- Start (POST + size header) → `{upload, pieceBytes}` or 413 over `SP_PLUGIN_PACKAGE_MAX_MB`. Piece (PUT
  `?upload&offset`) appends to `<data>/plugin-uploads/<id>.part`; 404 unknown/expired/other user's; 409 out of
  step (discarded); 413 running total over cap (discarded). Finish (POST `?upload`): unpack from disk with yauzl
  (unsafe names, symlinks, too many files/bytes refused; one wrapper folder unwrapped), install through
  `installPackageFromDir`, logbook entry `plugins:installPackage`, temp files always removed.
- `pieceBytes` = `BODY_SIZE_LIMIT` (parsed as adapter-node does) − 16 KiB, clamped 64 KiB–8 MiB. Upload registry on
  `globalThis`; expires one hour after its last piece; boot clears `<data>/plugin-uploads`.
- `installPackageFromDir(dir, {via, pushIo, emitToUser})` no longer needs a socket; `pluginPushIo()` captures the
  Socket.IO server at handler registration so presets/scripts re-push after an HTTP install.
- Client `packageUploadClient.ts` `uploadPackage(file, {onProgress})`; button "Uploading… n%" then "Installing…".

## D1 — plugins on by default
- `flag.ts`: `1/true/yes/on` force on; `0/false/no/off` force off; unset/empty/other = on. `pluginsEnabledByEnv()`.
  `flag.ts` was already the only `process.env` reader; every call site uses `pluginsEnabled()`.
- `plugins:list` carries `sandboxFromEnv`. Admin › Plugins status line (`id="plugin-sandbox"`): "Plugins run on
  this pub." / "… Set by SP_PLUGINS_ENABLED on this server." / off: "Plugins are off on this server
  (SP_PLUGINS_ENABLED), so they don't run and packages can't be installed." + "How to turn them on"; Install
  disabled while off.
- Refusals reworded: install while off → "Plugins are turned off on this server (SP_PLUGINS_ENABLED), so a
  package can't be installed. Unset the variable, or set it to 1, then restart Serene Pub."; authored components
  "…which SP_PLUGINS_ENABLED turns off on this server." Plugins load at boot; a change needs a restart.
- Tests whose off cases now set `"0"`: `extensionFlag`, `plugins.installLocal`, `sessions.framePanels` (3 lines),
  `annexFields`, `authoredComponents`, `disabledPlugins`, off-message pattern in `exportPackage`.

## Verified
Grouped run of `packageUpload.test.ts`, `packageUpload.int.test.ts`, `flag.test.ts`, `src/lib/shared/plugins/`,
`src/lib/client/admin/sections/plugins/` (5 files), `permissions.test.ts`: 11 files, 112 tests pass, no temp dirs
left. D1 files: 136/137, the one failure `_withdrawDefinition is not a function` in `exportPackage.int.test.ts`
is the stale SDK build (lane S). tsc filtered to lane files clean. Prettier clean on new files.

## New terms (§25)
**palisade** 🚧 (`pluginPalisade`, `FIXED_CANNOT`, `PalisadePermission`, `Palisade`: what a plugin can and cannot
do on this pub; ⚠ not a "capability") · **upload piece** (`pieceBytes`, `PackageUploadStart`, `PackageUploadPiece`)
· `sandboxFromEnv`, `pluginsEnabledByEnv()` · labels "Permissions it asks for", "What it can't do" · event
permission label "Hears `<event>` in every session on this pub" · wire sentences "That piece is empty.", "The
upload fell out of step. Choose the file again.", "That upload has expired. Choose the file again.", "A piece of
the upload was too large.", "This upload must come from Serene Pub's own page."

## Docs hand-off
**`docs/plugins.md`:** plugins on by default; Install a package… takes a `.zip` in the `dist/plugin` layout; nothing
is sent on choosing; the review shows name/version, "Permissions it asks for", "What it can't do" and the
approval sentence; Install uploads then installs; the plugin lands switched off and nothing it asks for works until
approved; the plugin page shows "What it can't do" following the ticks. Always true: can't read your connections
or API keys or call a model itself; can't see the secrets you type into its settings (stand-in); can't open files
or run programs on this computer or touch another plugin's files; can't change characters, lorebooks or sessions
directly. Unless asked for: can't reach the internet or local network (no network host); can't reach any site it
doesn't list (no `*`); can't reach this computer or local network (no `localhost`/IP host); can't send messages or
change a session's stats as you (no widget write grants; one grant → the other half remains); can't hear sessions
that don't use it (no event permission); can't keep files of its own (no storage). Size limited only by
`SP_PLUGIN_PACKAGE_MAX_MB` and `SP_PLUGIN_FILES_MAX`; the 70 MB browser cap is gone.
**`docs/environment-variables.md`:** `SP_PLUGINS_ENABLED` default on; `0/false/no/off` off, `1/true/yes/on` force
on; restart needed; Admin › Plugins shows "Set by SP_PLUGINS_ENABLED on this server"; no in-app switch yet.
`SP_PLUGIN_PACKAGE_MAX_MB`: drop the 70 MB sentence; `BODY_SIZE_LIMIT` needs no raising.
**`docs/hosting.md`:** "Install very large packages from disk" → the no-browser case only; name/size line → "…its
name, size, the permissions it asks for and what it can't do…".
**Also:** `scripts/build-docs.js:319,329` still say plugins are switched off; STYLE-GUIDE §6.11 could note the review.

## Open
- ★ Admin › Plugins on/off switch: needs `system_settings.plugins_enabled` (generated migration); cached at boot,
  "Takes effect after a restart".
- Lead: `sdk:build` then `exportPackage.int.test.ts`; svelte-check `Page.svelte`, `IdPage.svelte`,
  `PluginPalisade.svelte`; watch for tests that assumed plugins off.
- Review layout inside `AdminChangelist`'s header snippet unchecked at narrow widths.
- Upload route uses `authenticateRequest` (no user-agent match) + origin check, like other HTTP routes, but this one writes.
- Process: worker A ran one project-wide `tsc` despite the ban (read-only).
