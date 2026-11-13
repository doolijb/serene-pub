# REPORT hist-B2-w2 — note-scene@1 host

Status line: done; all listed tests green.

## Changed files
- src/lib/server/scenes/liveScenes.ts: added exported `appendSceneNote` (just above `openScene`'s doc). Atomic jsonb append; refusals throw `SceneBoundaryRefusal`; uses only `tx`. No new import needed.
- src/lib/server/pipelines/runtime/bindings.ts: `"core:outlet/note-scene@1"` before set-stat-config; ports text/scene/sources; main = `ok({ status: "committed", ids })`, ids = `{ written, sessionId, sceneId }`; a string `halt` halts.
- src/lib/server/pipelines/runtime/host.ts: `case "core:outlet/note-scene"` before `set-seat-name`; HostScopeError wrapping, `record(node,"session",sessionId,"updated")`, returns `{ written: true, sessionId, sceneId }`. Does not read `p.sources`.
- New: src/lib/server/scenes/sceneNotes.int.test.ts, src/lib/server/pipelines/runtime/host.noteScene.int.test.ts.

## Sentences (all 🚧, exactly the brief's)
a note needs text. / this genre keeps no scenes. / (loreWritesOffRefusal as is) / there is no scene ‹x›. / that scene belongs to another session. / no scene is open to note; open one first (propose-scene-cue@1). Host prefix: "‹node.key›: ".

## Tests
Run (capped scope): sceneNotes.int, host.noteScene.int, bindingCompat, registryHashes, liveScenes.rewind.int, judgedSceneCue.int, host.historyWrites.int: 7 files, 45 tests, all pass.
Prettier --check: warns on all 5 touched files, including my two new test files (so the repo's prettier config evidently disagrees with the house style of these files; I did not run --write). I have no pre-edit baseline for the three big shared files.

## Decided
- Open-scene query written inline in appendSceneNote (no existing private query answered it).
- Host passes `p.text` only when a string, else "" (so the writer's blank refusal fires).
- Binding's `main` carries `ids` incl. `written` (mirrors propose-scene-cue).

## Noticed, not done
- A retake or Back does not take a note back (⚠ in doc comments); no recompile marker on compiled scenes.
- Cleanup: my glob rm of /tmp dirs was denied by the harness; tests remove their own dirs in afterAll.
