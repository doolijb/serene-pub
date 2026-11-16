# BRIEF — perf-F worker w3 — the SDK conversation's rows read O(1) facts

SDK repo: `/home/jody/github/serene-pub-sdk` (a sibling of the app at `/home/jody/github/serene-pub`). Use absolute
paths. Report back in your final message (the supervisor reads it); write no report file.

## Context

Core's conversation widget runs in a UI worker. On every streamed token the host posts the **whole** message list,
every row a fresh object, so `conv.ctx.messages.v1` is a new array of new objects per token. Each mounted
`SessionMessage` then reruns per-row deriveds that **scan the whole list**, which makes a token cost O(N²):

- `SessionMessage.svelte:61–62`: `allMessages.some((m) => m.isGenerating)` (`hasGeneratingMessage`), in every row.
- `SessionMessage.svelte:66`: `conv.dossier?.scened.includes(msg.id)`, an array scan, in every row.
- `SessionMessage.svelte:212`: `isDiceLine(msg, allMessages)`. Its answer-form branch does `messages.find(...)`
  over the whole list (`core-catalog/src/shared/ui/conversation/diceLine.ts`).
- `SessionMessage.svelte:125`: `messageCount = allMessages.length` (O(1), but N deriveds per token).
- `SessionContainer.svelte:160–268`: about 8 O(N) deriveds (`cueAt`, `startsEntry`, `settledMarkAfter`,
  `lanePlaces`, `laneById`, `lastOwnId`, …) rerun per token. `marks` and `entryMarks` are already keyed on
  `msgOrderKey` (~164), which joins id and hidden flag, plus `untrack`.
- `MessagesWidget.svelte:206–210`: `selectable` (O(N), plus a Set of `scened`) is recomputed per token but read only
  in the *Select all* button's `onclick` (~394). Also `:195–200` and the tabs' `seen` effect and `dots` (~225–260).

## Goal

The values every row and every derived produce stay **exactly** what they are today, for every input. Only how often
they are computed changes.

1. In `core-catalog/components/shared/messages/conversation.svelte.ts` (note: this path, beside the components, not
   the `src/shared/ui/conversation/` path a plan named), compute once per list change and expose on the
   conversation object (internal names; list them in your report):
   - whether any row of `ctx().messages.v1` is generating (the same `some`)
   - a by-id lookup over `ctx().messages.v1`. It must return what `Array.prototype.find((m) => m?.id === id)` returns,
     so on a duplicate id the **first** row wins.
   - a `Set` of `dossier.scened`, with a membership read. Use it in the verbs too (~692 `toggle`, ~707 `range`), with
     the same answers.
   - the message count, if rows read it.
2. `SessionMessage.svelte`: read those O(1). For the dice line keep calling the published `isDiceLine`, but give it
   only the asked row: `isDiceLine(msg, asked ? [asked] : [])`, where `asked` is the by-id lookup of
   `Number(msg.metadata?.answersForm?.messageId)`, done the way `isDiceLine` itself parses it. The result is identical
   because `isDiceLine` only ever `find`s that id. Don't change `diceLine.ts`. Leave `staleOf(block, msg, allMessages)`
   (~1211) alone: it runs lazily per form block. Keep `allMessages` only where something else still needs it.
3. `SessionContainer.svelte`: key its O(N) deriveds so a token that changes no field they read does not recompute
   them. For each derived, list the row fields it reads (`id`, `isHidden`, `channel`, interleaved-ness via
   `conv.isInterleaved`, `metadata`…). Key it on a string that covers **every** field it reads: extend or add
   beside `msgOrderKey`. Compute the body under `untrack`, as `marks` does. A derived whose **output holds row
   objects** (`drawnMessages`, anything handing rows to the template) must not be keyed this way: it would hand out
   stale objects. Leave those.
4. `MessagesWidget.svelte`: `selectable` becomes a computation done when *Select all* is pressed (a function called
   in the `onclick`), so nothing is computed while not selecting, and the press gets the same ids it gets today.
   Apply the same keying to `markRun`, `seen`/`dots` only if each reads nothing outside its key. Otherwise leave it
   and say why.

## Files owned (edit only these, in `/home/jody/github/serene-pub-sdk`)

`core-catalog/components/shared/messages/SessionMessage.svelte`, `SessionContainer.svelte`, `MessagesWidget.svelte`,
`conversation.svelte.ts`, and new tests in `sdk-tests/`. **Never touch** `TurnLine.svelte`, `rewindStrip.ts`,
`ComposerWidget.svelte`, `sdk/src/sessionDossier.ts` (another session owns them), `diceLine.ts`, or anything in
`sdk/src/`. Most of this repo is uncommitted work: re-read before editing and never revert anything.

## Rules that bind (quoted)

- Owner 2026-11-13: "change how often, never what." Lane brief: "Stop and ask when … the SDK change would alter a
  widget's visible behaviour."
- CLAUDE.md Hard rules: "`$state(new Set())` / `new Map()` is not reactive on mutation — use `SvelteSet` / `SvelteMap`."
  (A `Set`/`Map` built inside a `$derived` and never mutated afterwards is fine.)
- "Removing or renaming a published SDK name is the owner's call." Don't change any export of
  `@serene-pub/core-catalog/conversation` (`isDiceLine`, `staleOf`, …).
- No markup or styling change.

## Stop and ask when

A derived can't be keyed without risking a stale value; a value would change; you'd need a file outside the list.

## Tests

- Add `sdk-tests/conversationRowFacts.test.ts`, which pins the equivalences, as **pure** tests where possible:
  - the by-id lookup equals `find`, including duplicate ids
  - `isDiceLine(msg, [asked])` equals `isDiceLine(msg, all)` across the cases in `diceLine.ts` (own dice blocks,
    answers a roll on another row, answers a non-roll, a missing row, a bad id)
  - the scened set's answers equal `includes`
  If you pull a pure helper out of `conversation.svelte.ts` to test it, keep it inside
  `core-catalog/components/shared/messages/` and report its name.
- Run in a capped scope (heavy DOM): `cd /home/jody/github/serene-pub-sdk/sdk-tests && systemd-run --user --scope -p MemoryMax=10G npx tsx --test coreConversationComponent.test.ts coreConversationScenes.test.ts conversationSceneMarks.test.ts conversationMessageOrder.test.ts conversationChannelLanes.test.ts coreSceneBoundaries.test.ts messageVerbs.test.ts conversationRowFacts.test.ts`,
  plus `npx tsc --noEmit -p .` in `sdk-tests` (that is the first half of its `npm test`). If `systemd-run` is
  refused, report that and don't run the DOM files uncapped.
- **Don't run `npm run sdk:build` or `npm run sdk:test`.** The supervisor runs those after telling the lead.
- `npx prettier --check` on each changed file (from the SDK repo; it has its own config). **Never `prettier --write`
  a file that wasn't clean before your edit**: check `git -C /home/jody/github/serene-pub-sdk show HEAD:<path>` the
  same way, and if it wasn't clean, format only your own lines by hand and say so.

## Done means

Tests above green; report: changed files; for each derived touched, the fields it reads and the key it uses now (or
why not); the new internal names; tests with results; anything noticed but not done.

## Verbatim rules

- This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report "blocked on your dev server". (You run no `sdk:build`.)
- Never pipe vitest into `head`. Heavy SDK DOM tests run in a capped scope (`systemd-run --user --scope -p MemoryMax=10G`).
- Never `git checkout` / `restore` / `stash` in `../serene-pub-sdk`.
