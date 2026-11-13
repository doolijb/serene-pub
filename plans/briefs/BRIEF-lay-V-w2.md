# BRIEF lay-V-w2 — SDK tests left asserting the pre-split / pre-R10 behaviour (session layouts, simplified)

Worker (Sonnet) under lane supervisor lay-V. SDK: /home/jody/github/serene-pub-sdk (edit here). App: /home/jody/github/serene-pub (read only for you).

This is an implementation task. Answer any relayed status question in one line in your report, and still do all the work.

## Context (ruled by the owner 2026-11-05, already built)
- R8: "Split the messages, composer and activity status/turn select into three widgets". Core ships `messages` (the log), `composer` (field, persona, actions — asks `send`, `draft`, `fire-turn`; places the host views `run-progress`, `session-controls`, `session-actions`, `retrieval-notice`…) and `turn-line` (places `session-banners`). `CORE_VIEW_ONLY_COMPONENTS = ['messages','composer','turn-line']`. Messages itself now asks e.g. `actions-seen`, `decide-proposal`, `forward-turn`, `load-older`, `remove-attachment`, `rewind-turn`, `show-channel`, `summarize` and places NO `<sp-host-view>`.
- R10: an empty widget draws nothing; CAUSE lines stay. Lead decision (2026-11-05, scope review of lay-B): Lore entries says "Nothing matches." only after a search or filter; an empty book with no search says nothing.
- The CLI clone warning for messages currently claims "<sp-host-view> is core's and is refused (shared/messages/MessagesWidget.svelte)" — a false positive: the only occurrence in Messages' source is the word `sp-host-view` inside a COMMENT at `core-catalog/components/shared/messages/MessagesWidget.svelte` ≈ line 151 ("…as `sp-host-view`s. It reads the widget's settings off…").

## Goal
1. `core-catalog/components/shared/messages/MessagesWidget.svelte` ≈151: reword that comment so it no longer contains the literal `sp-host-view` (e.g. "as host views"), meaning unchanged. Comment-only; nothing else in the file. (Its effect on the clone warning needs an `sdk:build`, which the supervisor runs — do NOT build.)
2. `sdk-tests/cliClone.test.ts`:
   - "messages: allowed as a package copy…" (≈:143): assert the kinds Messages still loses (`summarize`, `load-older`, `show-channel`) instead of `send`/`draft`/`fire-turn`; replace `assert.match(err, /<sp-host-view> is core's/)` with `assert.doesNotMatch(err, /<sp-host-view>/)` (after item 1 + build it holds); keep the autofocus, `open-character`, scopes and imports assertions.
   - Add one test beside it: "composer: allowed as a package copy, with a warning naming what a plugin's widget cannot do" — `clone composer --as quick-note`, exit 0, `/view-only in the app/`, each of `send`, `draft`, `fire-turn` named, `/<sp-host-view> is core's/`. Check the actual warning text first (run the clone into a scratch dir via the test's own helpers) and assert only what it really says.
   - "--list names every core component with its sourceHash" (≈:206): `messages.loses` includes `'summarize'`; add `composer` row `viewOnly === true` and its `loses` includes `'send'`; `turn-line` row `viewOnly === true`.
3. `sdk-tests/packageConformance.test.ts` "C31 refuses an unedited clone of core's messages widget…" (≈:144): Messages places no host view any more, so the clone passes C31. Make the case an unedited clone of core's **composer** (compile `compileCoreSource('composer')` the same way `messagesClone` is built — add a `composerClone` helper next to it; grants as the composer declares, `['session:full']`), expect `pass === false` and the error `/component '…': the page refused what it placed — <sp-host-view> is core's/`. Retitle to "…core's composer widget…" and update the doc comment above it (the composer places the page's own views). Leave C30 (messages parity) as is.
4. `sdk-tests/coreLoreEntriesComponent.test.ts` "the three answers that are not a list…" (≈:361): the final block asserts that after checking the `off` filter "Nothing matches" is NOT drawn — the ruled behaviour is the opposite: after a search/filter that matches nothing, "Nothing matches." IS said. Update: before the filter nothing is said; after it, `/Nothing matches\./` is drawn (check `core-catalog/components/shared/lore-entries/LoreEntriesWidget.svelte` for which part carries it, and assert that part only if it exists). Update the comment line ("An empty book, and an empty search, say nothing") to the ruled rule. Also rewrite every `assert.equal(<query>, null)` in this test to `assert.equal(<query> === null, true)`.
5. `sdk-tests/deriveDontSpell.test.ts`, the `compiled UI module id` entry (≈:160): `count: 15` → `17` with a dated comment in the file's style: `// 2026-11-05: 15 → 17 — PLAN-session-layout-simplify (owner R8): the Composer and the Turn line are core widgets, each naming its compiled module ('composer', 'turn-line').` Do not touch any other entry (the `shared/speakMessage.ts` failure in the same file is another programme's — leave it).
6. `sdk-tests/vocabulary.test.ts`: `guides/your-first-plugin.md` now fails on 'left' ("left as they wrote it") and 'back' ("fall back to round robin") because NOMENCLATURE §9 gained the UI labels **Left** · **Middle** · **Right** (the zone switch) and the Arrange inspector's phone **Back** (2026-11-05). Both read as plain English in the guide, which is what `PLAIN_ENGLISH` is for. Add `'left', 'back'` to `PLAIN_ENGLISH` on their own line with a comment: `// The zone switch's Left (§9, 2026-11-05) and the inspector's phone Back: in a guide, "left as written", "fall back".` Do not edit the guide or NOMENCLATURE.

## Files owned (edit only these)
`core-catalog/components/shared/messages/MessagesWidget.svelte` (the one comment), `sdk-tests/cliClone.test.ts`, `sdk-tests/packageConformance.test.ts`, `sdk-tests/coreLoreEntriesComponent.test.ts`, `sdk-tests/deriveDontSpell.test.ts`, `sdk-tests/vocabulary.test.ts`.

## Out of scope
`sdk-tests/coreCatalog.test.ts` (the supervisor re-pinned it), `sdk-tests/surface.test.ts` (CREATE_SESSION_PERSONA_* — another programme's), the speakMessage allowance, anything under `cli/src`, any app file. No new exported names, no copy changes.

## Stop and ask (in your report) when
A test can only pass by changing component behaviour; the real warning text differs from what this brief expects in a way that suggests a bug; a file outside "Files owned" needs a change.

## Rules (quoted)
- "Never hand a DOM node to an assertion (compare `x === null` to `true`)." A failing assert on a happy-dom node has OOM-killed VS Code.
- Every test run inside the memory-capped scope, never bare, one file per run, logging to a file:
  `systemd-run --user --scope -p MemoryMax=6G -p MemorySwapMax=0 --quiet bash -c 'export NODE_OPTIONS=--max-old-space-size=4096; cd /home/jody/github/serene-pub-sdk/sdk-tests && timeout 900 npx tsx --test <ONE file> > /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-V-w2-<name>.log 2>&1; echo test-exit=$? >> /tmp/claude-1000/-home-jody-github-serene-pub/8810127e-6750-4726-9a7d-7b92f1fb52cd/scratchpad/lay-V-w2-<name>.log'` then grep the log (`grep -n "^✖\|^# \(pass\|fail\)\|test-exit"`).
  sdk-tests typecheck: same scope, MemoryMax=12G, `--max-old-space-size=8192`, `cd sdk-tests && npx tsc --noEmit`.
- Never run `git stash` in any form, including `--keep-index` or to probe prettier; it stashes every other lane's uncommitted work. Use `npx prettier --check <file>`.
- Never commit. Never `npm test` or `npm run build` at the SDK root. Delete only the `/tmp/serene-pub-vitest-*` dirs your own tests made, by name; never a glob over `/tmp/serene-pub-*`.
- Before any `sdk:build`, check `pgrep -af "vite dev"` for a serene-pub server. If one is up, don't build; report 'blocked on your dev server'. (In this brief: do not build at all — the supervisor builds.)
- Never `git checkout`, `git restore` or `git stash` in `../serene-pub-sdk`.
- Re-read a file right before editing it; minimal hunks; never rewrite whole files.

## Done means
Run alone (capped), green: deriveDontSpell (except the pre-existing `shared/speakMessage.ts` line — report it), vocabulary, coreLoreEntriesComponent, packageConformance (at least the C31 tests), cliClone except assertions that need the rebuilt dist (name them). sdk-tests `tsc --noEmit` 0 errors. `npx prettier --check` on each changed file (report pre-existing drift as such).

## Report (your final message)
Changed files with one line each; each run's pass/fail counts; the real composer clone warning text; which assertions wait for `sdk:build`; anything not done and why; Noticed-not-done.
