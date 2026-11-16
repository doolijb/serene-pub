# REPORT perf-M w1 — wire reads a frame's `ready.takes`
Status question: n/a.

## Changed
- `src/lib/client/components/frames/widgetWire.svelte.ts` — option doc (~:186-191), new `peerDeclaredOneMessage` + `takesOneMessage()` after `deliveredLog` (~:236-246), two reads in `push()` now `takesOneMessage()`, `ready` branch sets the flag before `push()`, `attach()` clears it. Nothing else touched; hand-formatted.
- New `pluginFrame.oneMessage.dom.test.svelte.ts` (real PluginFrame, getter prop `get messages()` over `$state.raw` worked with `mount`; no fixture needed). 7 tests.
- `widgetWire.oneMessage.dom.test.svelte.ts` — NOTE: this file is untracked (not in HEAD), so prettier-written whole. Helper `open()` got an optional 3rd `readyMessage` arg, and `ready()` an optional payload plus a new `attachFresh()`; existing tests unchanged. Appended `describe("declared on ready (★M-1)")`, 4 tests.

## Asserted sequences (literal in test)
declared: ["messages:3","message:3:H","message:3:He","message:3:Hel","message:3:Hell","message:3:Hello","messages:3","messages:4","messages:3"]
silent: ["messages:3" x7, "messages:4","messages:3"] (1 initial + 5 streamed + settle = 7 of length 3, then add, remove), each post JSON.stringify-equal to the expected full list.
Also: declared message row has no `embedding`/`debugMeta`/`userId`; `takes: []`, `["something-else"]`, `"message"` behave as silent.

## Tests
- `vitest run frames/` : 21 files, 142 tests pass. `frames/ + host/`: 39 files, 257 tests pass.
- `tsc` filtered `widgetWire|pluginFrame`: clean. Prettier check on both test files: clean.

## Noticed, not done
- Vite emits `state_referenced_locally` warnings for `msgs` in the oneMessage test (same pattern as perf-H's existing tests).
- The "silent frame sees traffic byte-identical to today" is shown against expected lists, not against a pre-change run.
