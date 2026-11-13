# REPORT m3-core-w2

Status question: none relayed.

## Changed files
- `src/lib/server/sockets/sessions.ts` (sessionView block only): an applet genre's frame gets `appletGrants: mount.grants` from `appletMount(owner.pluginId, {...owner, enabled:true}, [{genreId, name:"", shape}])` (dynamic import, as the file already does elsewhere); `if (owner && decl)` became a block. Ordinary genres unchanged.
- `src/lib/shared/sockets/types.ts`: `Sessions.View.Frame.appletGrants?: string[]` (🚧 m3-core doc).
- NEW `src/lib/shared/plugins/sessionViewMount.ts` (+ `.test.ts`): the pure helper, signature per brief.
- `src/routes/sessions/[id]/+page.svelte`: import, `sessionViewMountOf` $derived, `apis=` and `grants=` (single `as never`) on the session-view `PluginFrame`.
- `src/lib/client/components/frames/framePort.ts`: `initMessage(..., mount?)`, spread only when given; `FrontEndMount` type import.
- `src/lib/client/components/frames/PluginFrame.svelte`: one `mount` $derived used in `inputs` and in `initMessage(...)`; type import.
- SDK `sdk/src/surfaces.ts`: `init.mount?: FrontEndMount` (type import added to the existing `./widgets.js` import; no cycle, sdk:build clean).
- SDK `ui-preview/src/lib/framePort.ts`: `initMessage(surface, mount?)`. `FrameStage.svelte` unchanged: it has no notion of a mount (only a surface point), so its call is left as is. No ui-preview framePort test exists.
- SDK `guides/frames.md`: in-session frame holds `ui`, `session` and `applet`; one sentence on `init`'s `mount`.
- New tests: `sessionViewMount.test.ts`, `frames/pluginFrame.appletSession.dom.test.ts`, `frames/frameInitMount.test.ts`, `sockets/sessions.appletSessionView.int.test.ts`.

Name greps (`appletGrants`, `sessionViewMount`) found no collision before the change.

## Tests
`npx vitest run` of the 4 new files plus the 9 listed: 13 files, 87 tests, all pass. (Console noise: happy-dom ECONNREFUSED fetching the plugin-ui src in the new DOM test; harmless, the test stands the frame in.)
`sdk:build`: clean (no vite dev server was up).
`npx tsc --noEmit -p .` filtered to my paths: clean.
`svelte-check --threshold error | grep "sessions/\[id\]|PluginFrame"`: no output.

## Noticed, not done
- `npx prettier --check` flags my 4 new files (tabs/semicolon style vs repo config); I did not run `--write`. Neighbouring tests may be the same; lead's call.
- Launcher `routes/apps/[pluginId]/+page.svelte` still passes `apis={["ui","applet"]}`; it should use `appletFrontEndApis(false)` per §9 (not touched).
- `PluginFrame` mount label for the preview harness: `ui-preview` could pass `mount` once the stage knows what it mounts.
