# BRIEF m3-core-w2 — an applet genre's in-session frame holds `applet`; `init` says its mount

Worker brief from lane supervisor **m3-core**. Work from `/home/jody/github/serene-pub` (app) and
`/home/jody/github/serene-pub-sdk` (SDK). Report path: `plans/briefs/REPORT-m3-core-w2.md`.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'.

Also: never `git checkout` / `restore` / `stash` in `../serene-pub-sdk` — most of it is uncommitted.

## Background (plan `plans/PLAN-sdk-creation-seams-2026-10-30.md` §9, ruled 2026-10-30)
"A **widget** (placed in the normal session layout) declares ui + session only … An **applet frame** (the launcher role) declares
ui + applet, and holds session as well only while mounted in a session (Mundi: the same frame is launcher without a session, game
with one). Every grant is still ∩ the acting person." Built wrong: `src/routes/sessions/[id]/+page.svelte` (~799–815) mounts an
applet genre's session-view `PluginFrame` with no `apis`, so `PluginFrame` labels the mount `widget` and `widgetWire` never sends
`fromApplet` on `pluginActions:invoke` (`widgetWire.svelte.ts` ~611: only `i.mount === "applet"` sends it). The launcher
(`src/routes/apps/[pluginId]/+page.svelte`) passes `apis={["ui","applet"]}` and `grants={data.grants}`, where `data.grants` come
from `appletMount(...)` (`src/lib/server/plugins/appletMount.ts`: the plugin's EFFECTIVE `applet:*` keys plus `storage` /
`storage-per-user`). The session page's frame data comes from the socket `sessions:view` (`src/lib/server/sockets/sessions.ts`
~3299–3310 builds `res.sessionView = { pluginId, src, title }`; wire type `Sockets.Sessions.View.Frame` in
`src/lib/shared/sockets/types.ts` ~5624), not from a SvelteKit load.

## What to build (decided by the supervisor — build exactly this)
### A. The frame's grants from one source (server)
1. `src/lib/server/sockets/sessions.ts` (SHARED: one additive hunk in the `sessionView` block only; re-read immediately before the
   edit; never reformat; another worker edits `checkLorebookOwnership` in the same file at the same time): when
   `mode?.shape?.applet === true`, call `appletMount(owner.pluginId, { ...owner, enabled: true }, [{ genreId, name: "", shape: mode.shape }])`
   (dynamic or static import of `$lib/server/plugins/appletMount`; `owner` already carries `manifest`, `adminDenied`, `version`,
   `name`) and add `appletGrants: mount.grants` to `res.sessionView` when the mount is non-null. Ordinary genres: unchanged.
2. `src/lib/shared/sockets/types.ts` `Sessions.View.Frame`: add `appletGrants?: string[]` with a 🚧 (m3-core) doc: present
   exactly when the genre is an applet genre whose frame `appletMount` mounts — the plugin's effective applet keys and storage
   keys, the launcher's grants (one source); the page adds them to the session's own. Not `grants` (a frame's whole grant list).

### B. The session page passes the three APIs (client)
3. New pure helper `src/lib/shared/plugins/sessionViewMount.ts`:
   `sessionViewMount<G extends string>(o: { applet: boolean; sessionGrants: readonly G[]; appletGrants?: readonly string[] }): { apis?: readonly FrontEndApi[]; grants: readonly string[] }`
   — applet: `{ apis: appletFrontEndApis(true), grants: [...sessionGrants, ...(appletGrants ?? [])] }` (import
   `appletFrontEndApis`, `type FrontEndApi` from `@serene-pub/sdk`); otherwise `{ grants: [...sessionGrants] }` with NO `apis`
   (an ordinary frame stays the default `ui` + `session`). 🚧 (m3-core) doc comment citing §9. Type the result so it passes
   to `PluginFrame`'s `apis` / `grants` props without casts where possible (`WireInputs["grants"]`; a single `as never` like the
   launcher's is acceptable).
4. `src/routes/sessions/[id]/+page.svelte`: derive `sessionViewMountOf = $derived(sessionViewMount({ applet: !!data.modeShape?.applet, sessionGrants: sessionViewGrants.grants, appletGrants: data.sessionViewFrame?.appletGrants }))`
   (name the local as you see fit) and pass `apis={…apis}` and `grants={…grants}` to the session-view `PluginFrame`. Nothing else
   on the page changes. (`PluginFrame` then labels the mount `applet` from `apis`, and `widgetWire` sends
   `fromApplet { pluginId, sessionId }` on its own.)

### C. `init` says the mount (SDK + host; coordinator's item)
5. SDK `../serene-pub-sdk/sdk/src/surfaces.ts` ~198, `HostFrameMessage` `init` variant: add
   `mount?: FrontEndMount` (type-only import from `./widgets.js` — check for a cycle; `surfaces.ts` already imports values from
   `./widgets.js`). Optional, like `fullscreen?`: absent from hosts that predate it. Doc (🚧 m3-core): what this frame is mounted
   as — `applet` (the launcher, and an applet genre's session view), `widget` (a frame placed in a session), `page` (a plugin
   page). Additive on a published type; bump nothing.
6. App `src/lib/client/components/frames/framePort.ts` `initMessage(surface, assetsBase?, fullscreen?, mount?)`: add the 4th
   optional param, spread only when given (the existing style). `src/lib/client/components/frames/PluginFrame.svelte`: lift the
   mount label (~232: `surface === "page" ? "page" : apis?.includes("applet") ? "applet" : "widget"`) into ONE `$derived` and
   use it both in `inputs` and in the `initMessage(...)` call (~268). No new prop.
7. Preview harness twin `../serene-pub-sdk/ui-preview/src/lib/framePort.ts` `initMessage(surface)` → `initMessage(surface, mount?)`
   with the same optional spread; its caller(s) (`ui-preview/src/lib/FrameStage.svelte`) pass a mount only if the stage already
   knows what it mounts (read it; if it has no such notion, leave the call unchanged and say so).
8. SDK guide `../serene-pub-sdk/guides/frames.md` ~210–215: the paragraph currently says "The same frame is mounted again inside
   each session, holding `ui` and `session`. Read which one it is from `init`: a mount without a session gets no `session`
   section." — make it say the in-session frame holds `ui`, `session` **and** `applet` (§9), and add ONE sentence: `init`'s
   `mount` reads `applet` in both places (`widget` for a frame placed in a session, `page` for a plugin page; absent from older
   hosts); whether a session is mounted is still told by the `session` section. Keep the guide's voice; touch nothing else.
9. Then `npm run sdk:build` from the app root (after the `pgrep` check) before the app tests.

## Files owned
`src/lib/server/sockets/sessions.ts` (sessionView hunk only), `src/lib/shared/sockets/types.ts` (the `Frame` field only),
new `src/lib/shared/plugins/sessionViewMount.ts` (+ its test), `src/routes/sessions/[id]/+page.svelte`,
`src/lib/client/components/frames/{PluginFrame.svelte,framePort.ts}`, new tests named below,
`../serene-pub-sdk/sdk/src/surfaces.ts`, `../serene-pub-sdk/ui-preview/src/lib/{framePort.ts,FrameStage.svelte}`,
`../serene-pub-sdk/guides/frames.md`. Other programmes edit these trees: re-read every file immediately before each edit;
additive hunks; never reformat (no `prettier --write`).

## Tests
- New `src/lib/shared/plugins/sessionViewMount.test.ts`: applet → the three APIs in order `ui, session, applet` and the grants
  concatenated; ordinary → no `apis`, grants unchanged.
- New `src/lib/client/components/frames/pluginFrame.appletSession.dom.test.ts` (model: `pluginFrame.dom.test.ts` harness, which
  captures the init post and the port; `widgetWire.pluginAction.dom.test.svelte.ts` mocks `./pluginActions`): mount
  `PluginFrame` with `surface: "session-view"`, a plugin src (`frameOwnerOf` must read the owner — see `frameOwner.test.ts`),
  `session: { id: 7, … }` and the props `sessionViewMount({ applet: true, … })` returns → the init message has `mount: "applet"`
  and a frame `invoke` of a plugin action calls `invokePluginAction(owner, key, payload, { pluginId: owner, sessionId: 7 })`;
  the same with `applet: false` → init `mount: "widget"` and the 4th argument `undefined`.
- New `src/lib/client/components/frames/frameInitMount.test.ts` (model: `frameInitFullscreen.test.ts`): `initMessage` carries
  `mount` when given and omits the key when not.
- Server: new `src/lib/server/sockets/sessions.appletSessionView.int.test.ts` (model: `sessions.framePanels.int.test.ts`, which
  already drives `sessions:view` with a plugin's session view): an applet genre (`shape: { applet: true, view: <pluginId> }`) whose
  plugin declares `applet:*` permissions → `sessionView.appletGrants` equals what `appletMount` returns for the same row; an
  ordinary genre with a `view` → no `appletGrants`. 60 s timeouts for DB tests.
- Preview twin: if `ui-preview` has a framePort test, extend it additively and run it alone inside `ui-preview`
  (`npx vitest run <file>` there; never the SDK root's `npm test`).

## Done means (run each with `npx vitest run <files>`; never pipe vitest into `head`)
The four new test files + `frames/pluginFrame.dom.test.ts`, `frames/frameInitFullscreen.test.ts`, `frames/framePort.test.ts`,
`frames/frameAssetsBase.test.ts`, `frames/widgetWire.frontEndApis.dom.test.svelte.ts`,
`frames/widgetWire.pluginAction.dom.test.svelte.ts`, `sockets/sessions.framePanels.int.test.ts`,
`plugins/pluginActions.int.test.ts`, `sockets/appletSessions.int.test.ts` — green, or shown to fail identically before your change.
`npm run sdk:build` clean. `npx tsc --noEmit -p .` filtered to your paths: clean. `npx svelte-check` is the lead's; but run
`npx svelte-check --threshold error 2>&1 | grep -E "sessions/\[id\]|PluginFrame"` once and report what it says.

## Rules (quoted — they bind you)
- CLAUDE.md: "after any SDK change run `npm run sdk:build` before app tests or builds — **never while a serene-pub `vite dev`
  runs**". "Browser code runs on plain-http LAN addresses and phones: no `crypto.randomUUID`, no `navigator.clipboard`."
- "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`." · "`socket.off(event)` with
  no handler removes every listener app-wide; always pass the handler."
- Sockets: "one domain context per event family … is the only listener, and the only place that toasts; views … never call
  `toaster`." You add no event.
- "Removing or renaming a published SDK name is the owner's call." You only ADD an optional field.
- "Do what was asked, at the size asked. Findings along the way go under **Noticed, not done**, never fixed in passing. Nothing
  'for later'." Don't touch the launcher page (`routes/apps/**`) — note it if it should use `appletFrontEndApis(false)`.
- NOMENCLATURE R1 one word one meaning · R3 qualify, never the bare noun · R6 mark 🚧. New names you add: `appletGrants` (the
  wire field), `sessionViewMount` (helper), the `init` message's `mount`. Grep each across `src` and the SDK first; report any
  collision instead of shipping it. Any other new exported name → stop and report.
- Heavy SDK DOM tests run in a capped scope; a failing assert on a happy-dom element has OOM-killed VS Code — keep DOM asserts on
  plain values.

## Stop and report (don't decide) when
A new name / setting / event beyond those above seems needed; `appletMount` returns null for a genre you expected (say why);
`surfaces.ts` → `widgets.ts` makes an import cycle that breaks the build.

## Report (`plans/briefs/REPORT-m3-core-w2.md`)
Changed files (with each hunk's purpose), tests run with pass/fail counts, `sdk:build` result, Noticed, not done.
