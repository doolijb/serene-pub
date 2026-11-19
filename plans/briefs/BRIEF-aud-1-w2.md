# BRIEF — lane `aud-1`, worker w2 — server and docs defects (audit findings 3 server half, 5, 6, docs for 4)

Repo `/home/jody/github/serene-pub` (SvelteKit 5, TypeScript, Vitest 4, Drizzle + PGlite).
Supervisor: lane `aud-1`. Report to your supervisor with your final message (changed files, tests run with
results, anything you could not do, **Noticed, not done**). Do not write a report file.

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.

Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.

Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (You have no reason to run `sdk:build` at all: the SDK is not touched.)

Also: never `git checkout` / `restore`; never `prettier --write`; never `pkill -f` a generic pattern; no migration;
no `npm run build`; no full test run. Do **not** touch `src/lib/server/sockets/sessions.ts` or any
`sessions.*.ts` (another lane), nor `src/lib/server/pipelines/runtime/bindings.*` / `host.*`. Read files by line
range, not whole large files.

## Goal

Each code fix with a test that fails before and passes after.

### A. `pluginUserSettings:set` answers its own success (finding 3, server half)

`src/lib/server/sockets/plugins.ts` ~1430–1474, `pluginUserSettingsSet`. Today a success emits only a fresh
`pluginUserSettings:list` (no plugin named), so the client cannot tell which plugin's save landed. A failure
already emits `pluginUserSettings:set:error` with `{ pluginId, error }`.

Fix: on success, keep the `:list` emit exactly as is, and AFTER it add
`emitToUser("pluginUserSettings:set", res)` where `res` is the handler's existing
`Sockets.PluginUserSettings.Set.Response` (`{ pluginId, settings }`). No new event name, no type change (the event
and its response type already exist in `src/lib/client/sockets/typedSocket.ts` ~642 and
`src/lib/shared/sockets/types.ts` ~1789). Do not add it to `GATED_EVENTS` (`src/lib/shared/sockets/interest.ts`
is not yours). Update the handler's doc comment to say a success answers on `:set` (naming the plugin) after the
refreshed list. The client half is done by another worker.

Test: in `src/lib/server/sockets/plugins.int.test.ts` (around the existing `pluginUserSettingsSet` cases ~530–620,
which use a `collector()` whose `emit` records events), assert a successful set emits `pluginUserSettings:list`
then `pluginUserSettings:set` with that `pluginId`, and a refused set emits `pluginUserSettings:set:error` and no
`pluginUserSettings:set`.

### B. `samplingConfigs:usedBy` is admin-only (finding 5)

`src/lib/server/sockets/samplingConfigs.ts` ~302–315. It has no admin check and a comment
(`// No admin check: which jobs and pipelines pick a config are read-only facts…`) defending that. Standing
ruling (CLAUDE.md): *"Members never see or touch model plumbing — connections, models, sampling, loadouts."*
Every sibling handler in the file is admin-gated.

Fix: gate it like its siblings — follow `samplingConfigsSetDefaultFor` (~322–327): if `!socket.user!.isAdmin`,
`emitToUser("samplingConfigs:usedBy:error", { error })` and `throw new Error(error)`, with the existing sentence
`"Access denied. Only admin users can manage sampling configs."` (already used by `samplingConfigs:get`; no new
copy). Replace the comment with one stating the rule (admin-only, like every sampling handler: members never see
sampling). Check `Sockets.SamplingConfigs.UsedBy.Response` admits `{ error }` on the `:error` emit; if the type
needs a change in `src/lib/shared/sockets/types.ts`, stop and report rather than editing it.

Confirm by grep that no member-facing view calls it: `grep -rn "samplingConfigs:usedBy" src/lib/client src/routes`.
Known callers: `src/lib/client/components/sidebars/SamplingSidebar.svelte` (the Sampling view, opened from the
Admin rail) and `src/lib/client/components/connections/JobSheetSampling.svelte` (check whether anything imports
it at all). If any caller is reachable by a non-admin, **stop: do not gate**, report the caller.

Test: `src/lib/server/sockets/samplingConfigs.usedBy.int.test.ts`. Its first test calls the handler with
`socketFor(false)` (a member) — that encodes the defect: switch it to `socketFor()` and add a test that a member
is refused (rejects with /admin/, records `samplingConfigs:usedBy:error`, no `samplingConfigs:usedBy`).

### C. Docs (finding 6, and the doc line finding 4 moves)

`docs/connections.md`:
- ~582: "…it reloads KoboldCPP with the right ones and waits (up to ten minutes) before sending the request."
  The managed wait is 30 minutes while KoboldCPP is running (`src/lib/server/koboldcpp/modelManager.ts`
  `hardTimeoutMs: isAlive ? 30 * 60_000 : 600_000`, `isAlive` set only in managed mode,
  `koboldcpp/managedPreflight.ts` ~302–305). Change to "waits (up to 30 minutes while KoboldCPP is running)".
- ~307: "Deleting the KoboldCPP connection also switches KoboldCPP off, and deleting the last Ollama connection
  switches Ollama off." The client fix (other worker) makes Admin delete release managers like the Connections
  view's Remove: the last KoboldCPP row (text or image) switches KoboldCPP off, the audio.cpp row switches
  audio.cpp off, the last Ollama switches Ollama off. Rewrite the sentence to say that, using the docs' own
  names for the KoboldCPP image connection (grep the file for how it calls that row) — e.g. "Deleting the last
  KoboldCPP connection (text or image) also switches KoboldCPP off, deleting the audio.cpp connection switches
  audio.cpp off, and deleting the last Ollama connection switches Ollama off." Plain sentences; it is a **pub**,
  never an instance/server; a **session**, never a chat.

## Files owned (edit only these)

- `src/lib/server/sockets/plugins.ts` (only `pluginUserSettingsSet` and its comment), `plugins.int.test.ts`
- `src/lib/server/sockets/samplingConfigs.ts` (only `samplingConfigsUsedBy`), `samplingConfigs.usedBy.int.test.ts`
- `docs/connections.md` (only the two lines above)

## Out of scope

Everything under `src/lib/client/**`, `src/lib/shared/**`, other docs, any new user-facing words beyond the two
doc sentences, any other handler.

## Stop and ask when

A type, event or name change beyond this brief; a member-reachable caller of `usedBy`; a finding turns out false.

## Rules quoted for this work

- Inside `db.transaction(async (tx) => …)` use only `tx` (you should not need a transaction).
- An int test that opens a DB inside an `it` needs a 60 s timeout under load.
- An event in `SCOPED_EVENTS` must carry its scope key; neither event here is scoped.

## Tests — exact form, one run at a time

Before each run wait until no other vitest and no sdk:build is running:

```
until ! pgrep -f "vitest" >/dev/null && ! pgrep -f "sdk:build" >/dev/null; do sleep 5; done
```

(its own Bash call, long timeout). Then from the repo root:

```
systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 <paths> > plans/aud-1-w2-<n>.log 2>&1"
```

and read the log. Never pipe vitest into `head`. Show the new assertions fail on the unfixed code if practical,
then pass. Type check with `NODE_OPTIONS=--max-old-space-size=10240 npx tsc --noEmit -p .` (filter for your files)
and `npx prettier --check` on your files.

## Done means

Green: `src/lib/server/sockets/plugins.int.test.ts`, `src/lib/server/sockets/samplingConfigs.usedBy.int.test.ts`
(and the other `samplingConfigs.*.int.test.ts` files beside it); no tsc errors in your files; prettier --check clean.
