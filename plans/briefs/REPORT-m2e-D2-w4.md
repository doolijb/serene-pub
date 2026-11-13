# REPORT m2e-D2-w4
Status question: none relayed.
Changed: fireAction.ts (field renamed to `fromPressDoor`, doc rewritten, forward), runTurn.ts (field, frameCauseOfRun type/check/doc), sockets/sessions.ts (2 lines), frameCauseOfRun.int.test.ts (4), host.ts and pluginBindings.ts (doc comments).
Tests: frameCauseOfRun + pluginBindings int: 2 files, 16 passed. tsc: no matches for the grep pattern. `grep personPress src/` leaves only the unrelated SDK `personPressCurrent` in client files.
Noticed, not done: none.
