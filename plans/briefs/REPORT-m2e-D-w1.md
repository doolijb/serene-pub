# REPORT m2e-D-w1

Status question: none relayed. All three parts built.

## Changed files
App
- src/lib/server/sockets/appletCause.ts: `FrameCause`, `frameCauseFor`, `frameOpenFor`, `appletClosedRefusal`, `USER_ANNEX_CLOSED`, `USER_STORAGE_CLOSED`.
- src/lib/server/plugins/SandboxManager.ts: `CallOptions.frameCause`; `annexJobFor` and the per-user storage dir derive from it.
- src/lib/server/plugins/types.ts, QuickJsSandbox.ts, SesWorkerSandbox.ts (NOT in my list; needed): `InvokeOptions.userStorageDenied`, so `ctx.storage.user` rejects with the closed sentence instead of "no person is acting".
- src/lib/server/plugins/pluginActions.ts: sets `frameCause` (this is the frame's `ctx.invoke` door).
- src/lib/server/pipelines/runtime/{runTurn,host,pluginBindings}.ts: `TurnRequest` / `SpecRunRequest` / `HostScope` / `PluginBindingOptions` carry `frameCause`, passed on the node and tool `callHook`s beside `user`.
- src/lib/server/pipelines/boot/registrySync.ts: plugin preset `enabled: true` on insert; header comment rewritten.
- src/lib/server/db/defaults.ts: `sampling-reply` literal; first-run `SEEDED_SAMPLING_DEFAULTS["text->text"]` now `sampling-reply`.
Tests: hookCtx.test.ts, userAnnexHook.int.test.ts, userStorage.int.test.ts, scheduleTick.test.ts, eventHost.test.ts, pluginActions.int.test.ts, pluginBindings.int.test.ts, pluginPresets.int.test.ts, defaults.seedKey.int.test.ts, loadouts.int.test.ts, sockets/plugins.descriptor.int.test.ts (NOT in my list: its hook call now passes the frame cause).
SDK (../serene-pub-sdk)
- core-catalog/src/loadouts.ts: Reply `sampling: 'sampling-reply'` (Tool calling untouched).
- sdk/src/hookGrants.ts: one doc paragraph. GRANTS table and `HookCtxGrants` UNCHANGED.
- sdk/src/pluginPermissions.ts (NOT in my list): the annex bullet now states the frame rule; guides/plugin-permissions.md regenerated (`npx tsx scripts/gen-plugin-permissions.ts`).
- `npm run sdk:build` run (no vite dev up).

## Tests run
- plugins: hookCtx, userAnnexHook.int, userAnnex.int, scheduleTick, eventHost, eventHost.fanout, userStorage.int, pluginActions.int, pluginActions.storage.int, runtime/pluginBindings.int: 10 files, 116 pass.
- pluginPresets.int 16 pass; registrySync.int, plugins.descriptor.int, loadouts, db/: all pass except 2 failures that are not mine: `atticStash` (expects no `0139_m2b_permission_model` upgrade) and `0108_layering_registrations` (speak-message actions).
- SDK: pluginPermissions.test.ts 2 pass (guide held in step); loadouts.test.ts 8 pass.
- `npx tsc --noEmit -p .`: no errors in touched files.
- `npx prettier --check`: fails on 20 files, all already failing on HEAD (repo is not prettier-formatted); I did not reformat.

## New names (grepped, no clash) with §25 row drafts
- **frame-origin cause** / `frameCause` 🚧: the applet whose mounted frame's own request (or a person's press in it) caused a call; set by server code at a frame's door, carried beside `user`. Not `ActingVia` (who acts), not `EventCause.pluginId` (whose write an event came from), not `via`.
- **`appletClosedRefusal(thing)`** 🚧: the one sentence `<thing> is only available while the app is open.` Words used: "This person's saved documents" (annex, prefixed `annex('user'): `), "Per-person storage" (prefixed `storage.user: `).
- **`sampling-reply` / "Reply"** 🚧: seeded immutable sampling row, reasoning off, 1024 response tokens, 8192 context; the Reply default's sampling. Not "Default", not the Reply loadout.
- `userStorageDenied` (internal sandbox-call field): not user-facing.

## Published types changed
None published. `CallOptions`, `InvokeOptions` and `TurnRequest` are app-internal. The SDK change is a doc comment, the guide text and the Reply loadout's `sampling` string (`CORE_LOADOUTS`, `@experimental`).

## Decisions
- The grant applies only when `frameCause.pluginId` equals the called plugin (as briefed).
- Members stay present per kind and reject at run time; no `HookCtxGrants` member added.
- Nothing sets the cause for event hooks (`eventHost`, `sessionEvents`) or the schedule tick: absent by construction, and tests assert it. I did not touch `eventHost.ts`/`sessionEvents.ts`.
- Not gated: the host.ts library-write node (`actingPersonFor` via press/routine) keeps its own `libraryWriteMode` gate; I only carried the cause on the scope. Gating it would break core genres' library writes.
- `invokePluginAction` itself sets the cause: its only caller is the `pluginActions:invoke` socket handler, i.e. a frame's `ctx.invoke`. The appletDoor needed no change: its handlers don't call the sandbox, so a door field would have been unused.
- ★47 found a second writer: the first-run registration in `defaults.ts` (`setCapabilityDefault('text->text', {samplingConfigId: sampling-default})`) overwrites the claimed Reply loadout's sampling, so the catalog pointer alone never reached a fresh install. I changed that literal to `sampling-reply`. Existing installs have a capability default already, so they are unchanged.
- ★39: the UPDATE path never writes `enabled` (verified; test now disables, syncs twice, asserts it stays false). No boot pass for existing installs: it cannot tell "never enabled" from "admin disabled".
- Tests for ★47: seedKey test asserts one row, second sync changes nothing, sampling seeds before loadouts (fresh Reply points at it, Tool calling keeps Default); loadouts test asserts insert-only (existing pick survives re-seed).

## Noticed, not done
- No `fromApplet` path starts a run today (`sessions:create` / `sessions:delete` only judge the grant; `sessions:fireAction` has no `fromApplet`). So `TurnRequest.frameCause` has no setter yet and is exercised only by the pluginBindings test; the brief's "runs a frame's request starts" does not exist yet.
- `fromApplet` on `sessions:create` is client-posted; the door only checks the plugin's grant. Likewise `pluginActions:invoke` cannot tell a mounted frame from a hand-posted event. Same trust as the other applet doors.
- docs/ and NOMENCLATURE §25 need the rows above and the ★39/★47 behaviour (not my files).
- Stale test: atticStash expects an upgrades list without `0139_m2b_permission_model`; 0108 test lacks the speak-message actions.
- SDK `pluginHarness.ts` ctx.storage.user / annex messages still say "no person is acting"; a harness has no frame, left alone.
