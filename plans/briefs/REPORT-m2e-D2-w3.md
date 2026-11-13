# REPORT m2e-D2-w3
Status question: none relayed.

## Changed files
- runtime/fireAction.ts: `FireActionRequest.personPress` (doc'd, not `automatic`/`ActingVia.press`); forwarded to `runSpec` as `...(req.personPress ? { personPress: true } : {})` (`req` starts as `pressed` and is only spread, so the flag survives routing).
- runtime/runTurn.ts: `SpecRunRequest.personPress`; `frameCauseOfRun` is undefined on preview / lineage / `personPress !== true`, else the applet's cause; `Pick` and doc updated.
- sockets/sessions.ts: `personPress: true,` added to the two `fireAction` calls (two one-line hunks, exact-string).
- sockets/plugins.ts: `providedBookDisabledHandler` gets `undefined` translate + defensive `echo` of `pluginId` / `slug`.
- shared/sockets/types.ts: `SetProvidedBookDisabled.ErrorResponse`.
- library/writes.ts (2 selects), sockets/summarize.ts (1 select): dropped dead `uuid` / `extraJson` keys (nothing else in those blocks read them).
- Tests: frameCauseOfRun.int.test.ts rewritten (press, automatic, child, routine, event, preview, ordinary); providedBooks.int.test.ts gains the refusal-echo test and the `isNewAttachOfDisabledBook` test.

## Tests
Vitest on the brief's list: 6 files, 66 tests; first run 65 pass / 1 fail (my test: an unknown slug under a KNOWN plugin is not refused, it waits on the plugin's row, so I used unknown plugin "nope"). providedBooks rerun: 20/20 pass. tsc: no errors in my files. No fireAction test added: `fireAction.collects.int.test.ts` runs the real `runSpec`, with no cheap seam to assert on.

## Noticed, not done
- `npx prettier --check` warns on providedBooks.int.test.ts and frameCauseOfRun.int.test.ts (likely long lines in pre-existing code too); not reformatted.
- `library/writes.ts` shows a larger diff than my hunks (other lanes' edits).
- The refusal test uses an unknown plugin; an unknown slug under a known plugin is by design accepted.
