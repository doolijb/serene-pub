# REPORT m2e-D2-w1

Status question: none relayed.

## Changed files
- src/lib/shared/sockets/types.ts: `PluginActions.Invoke.Params.fromApplet?` (doc comment only hunk).
- src/lib/server/sockets/pluginActions.ts: validates `fromApplet` (plain object, string pluginId, sessionId absent or positive int) else passes nothing; header line added.
- src/lib/server/sockets/appletCause.ts: `appletOfSession`, FrameCause doc updated, refusal now "This person's saved data"; added `eq`/`schema` imports; sessionGenres imported dynamically.
- src/lib/server/plugins/pluginActions.ts: `fromApplet` opt, `frameCauseOfInvoke`, callHook gets its result.
- src/lib/server/pipelines/runtime/runTurn.ts: removed `frameCause` from TurnRequest/SpecRunRequest/pass-through; added `frameCauseOfRun`, derived once before `scope`, used for scope + pluginNodeBindings.
- host.ts, pluginBindings.ts: one-line doc comments only.
- Tests: hookCtx.test.ts, userAnnexHook.int.test.ts (sentence), pluginActions.int.test.ts (manifest gains `surfaces`, sessionGenres mock, new describe a-f), new runtime/frameCauseOfRun.int.test.ts.

## Signatures
- `appletOfSession(db: Db, sessionId: number): Promise<string | null>`
- `frameCauseOfInvoke(db, { pluginId, userId, plugin, fromApplet? }): Promise<FrameCause | undefined>`
- `frameCauseOfRun(request: Pick<SpecRunRequest,"db"|"sessionId"|"registration"|"triggerFamily"|"preview">): Promise<FrameCause | undefined>`

## Tests
Ran the six listed files + new one: 7 files, 79 tests, all pass (76 in the first 6, 3 in the new). tsc filtered to touched files: no output.

## frameCause producers not named by the brief
None found on runTurn/runSpec requests (grep of `frameCause:` showed only SandboxManager, tests, pluginBindings, host, runTurn, pluginActions).

## Noticed, not done
- `npx prettier --check` warns on appletCause.ts, sockets/pluginActions.ts, plugins/pluginActions.ts; could not tell if pre-existing (no stash allowed); not reformatted.
- Client must send `fromApplet` (queued for supervisor); until then no invoke gets a cause.
- runSpec callers with no trigger family default to "action", so any server-started run without a registration/triggerFamily on an applet session now gets the cause; callers like auto-advance should pass a family if that is unwanted.
